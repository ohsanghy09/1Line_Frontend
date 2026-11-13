package com.oneline.api.service;

import com.oneline.api.db.Database;
import com.oneline.api.js.Json;
import com.oneline.api.support.EventLoop;
import org.slf4j.LoggerFactory;

import java.time.Instant;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

import static com.oneline.api.js.Js.obj;

/** 내부 홈 작업만 만료한다. 요청과 같은 EventLoop 및 트랜잭션으로 완료 결과를 보호한다. */
public final class InternalJobExpiry implements AutoCloseable {
    private final Database db;
    private final EventLoop loop;
    private final long queuedMs;
    private final long runningMs;
    private final ScheduledExecutorService timer;
    private boolean closed;

    public InternalJobExpiry(Database db, EventLoop loop, long queuedMs, long runningMs, long intervalMs) {
        if (queuedMs <= 0 || runningMs <= 0 || intervalMs <= 0)
            throw new IllegalArgumentException("Internal job expiry durations must be positive");
        this.db = db; this.loop = loop; this.queuedMs = queuedMs; this.runningMs = runningMs;
        timer = Executors.newSingleThreadScheduledExecutor(task -> {
            var thread = new Thread(task, "internal-job-expiry");
            thread.setDaemon(true);
            return thread;
        });
        timer.scheduleWithFixedDelay(() -> {
            try { scan(Instant.now()); }
            catch (RuntimeException e) {
                // 입력·원본을 로그에 노출하지 않고 다음 주기에 재시도한다.
                LoggerFactory.getLogger(InternalJobExpiry.class).error("Internal job expiry scan failed");
            }
        }, intervalMs, intervalMs, TimeUnit.MILLISECONDS);
    }

    public void scan(Instant now) {
        loop.run(() -> {
            if (closed) return;
            db.transaction(() -> {
                for (var row : db.all("""
                        SELECT j.id, j.analysis_id, j.status, j.updated_at FROM ai_chat_jobs j
                        JOIN internal_chat_publications p ON p.job_id = j.id
                        WHERE (j.status = 'queued' AND p.accepted_at_ms <= ?)
                           OR (j.status = 'running' AND p.progress_received_at_ms <= ?)""",
                        now.toEpochMilli() - queuedMs, now.toEpochMilli() - runningMs)) {
                    boolean queued = "queued".equals(row.get("status"));
                    var error = obj("code", queued ? "queue_timeout" : "analysis_timeout", "error", queued
                            ? "분석 요청이 많아 대기 시간이 초과됐어요. 잠시 후 다시 요청해 주세요."
                            : "분석 진행을 확인할 수 없어 작업을 종료했어요. 다시 요청해 주세요.");
                    // AI 서버 시계가 앞서 있어도 정본 updatedAt이 뒤로 가지 않는다.
                    Instant previous = Instant.parse((String) row.get("updated_at"));
                    String updated = new java.time.format.DateTimeFormatterBuilder().appendInstant(3).toFormatter()
                            .format(previous.isAfter(now) ? previous : now);
                    db.run("UPDATE ai_chat_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?",
                            Json.stringify(error), updated, row.get("id"));
                    db.run("UPDATE analyses SET reply = ? WHERE id = ?", Json.stringify(null), row.get("analysis_id"));
                    db.run("UPDATE internal_chat_publications SET revision = revision + 1, publish_signature = NULL WHERE job_id = ?", row.get("id"));
                }
            });
        });
    }

    @Override public void close() {
        loop.run(() -> closed = true);
        timer.shutdownNow();
    }
}
