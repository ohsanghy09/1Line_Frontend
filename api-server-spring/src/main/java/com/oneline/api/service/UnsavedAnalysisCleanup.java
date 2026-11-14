package com.oneline.api.service;

import com.oneline.api.db.Database;
import com.oneline.api.support.EventLoop;
import org.slf4j.LoggerFactory;

import java.time.Instant;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/** 원본이 있는 미저장 초안만 정리한다. 저장 요청과 같은 EventLoop·트랜잭션에서 판정한다. */
public final class UnsavedAnalysisCleanup implements AutoCloseable {
    private final Database db;
    private final EventLoop loop;
    private final long retentionMs;
    private final ScheduledExecutorService timer;
    private boolean closed;

    public UnsavedAnalysisCleanup(Database db, EventLoop loop, long retentionMs, long intervalMs) {
        if (retentionMs <= 0 || intervalMs <= 0) throw new IllegalArgumentException("Cleanup durations must be positive");
        this.db = db; this.loop = loop; this.retentionMs = retentionMs;
        timer = Executors.newSingleThreadScheduledExecutor(task -> {
            var thread = new Thread(task, "unsaved-analysis-cleanup");
            thread.setDaemon(true);
            return thread;
        });
        timer.scheduleWithFixedDelay(() -> {
            try { scan(Instant.now()); }
            catch (RuntimeException error) {
                LoggerFactory.getLogger(UnsavedAnalysisCleanup.class).error("Unsaved analysis cleanup failed");
            }
        }, intervalMs, intervalMs, TimeUnit.MILLISECONDS);
    }

    public static void touch(Database db, Object analysisId, long nowMs) {
        db.run("""
                INSERT INTO analysis_retention (analysis_id, touched_at_ms) VALUES (?, ?)
                ON CONFLICT(analysis_id) DO UPDATE SET touched_at_ms = MAX(touched_at_ms, excluded.touched_at_ms)
                """, analysisId, nowMs);
    }

    /** 삭제한 분석 수를 반환한다. 구형 데이터는 첫 발견 시점부터 보관 기간을 보장한다. */
    public int scan(Instant now) {
        int[] removed = {0};
        loop.run(() -> {
            if (closed) return;
            db.transaction(() -> {
                long nowMs = now.toEpochMilli();
                db.run("INSERT OR IGNORE INTO analysis_retention SELECT id, ? FROM analyses", nowMs);
                // 정식 기록과 구형 작업의 2.8초 대기 중 원본도 보호한다.
                for (var row : db.all("""
                        SELECT a.id FROM analyses a JOIN analysis_retention t ON t.analysis_id = a.id
                        WHERE t.touched_at_ms <= ?
                          AND EXISTS (SELECT 1 FROM files f WHERE f.analysis_id = a.id)
                          AND NOT EXISTS (SELECT 1 FROM records r WHERE r.analysis_id = a.id)
                          AND NOT EXISTS (SELECT 1 FROM ai_chat_jobs j WHERE j.analysis_id = a.id
                                          AND j.status NOT IN ('completed', 'failed'))
                          AND NOT EXISTS (SELECT 1 FROM analysis_jobs j WHERE j.analysis_id = a.id
                                          AND j.error IS NULL AND j.started_at > ?)
                        ORDER BY t.touched_at_ms, a.id LIMIT 25
                        """, nowMs - retentionMs, nowMs - 2800)) {
                    Object id = row.get("id");
                    InternalChatJobs.rememberRetiredAnalysis(db, id);
                    db.run("DELETE FROM files WHERE analysis_id = ?", id);
                    db.run("DELETE FROM analysis_jobs WHERE analysis_id = ?", id);
                    db.run("DELETE FROM ai_chat_jobs WHERE analysis_id = ?", id);
                    db.run("DELETE FROM analyses WHERE id = ?", id);
                    removed[0]++;
                }
            });
        });
        if (removed[0] > 0) LoggerFactory.getLogger(UnsavedAnalysisCleanup.class)
                .info("Unsaved analysis cleanup removed={} retention_ms={}", removed[0], retentionMs);
        return removed[0];
    }

    @Override public void close() {
        loop.run(() -> closed = true);
        timer.shutdownNow();
    }
}
