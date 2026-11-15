package com.oneline.api.service;

import com.oneline.api.db.Database;
import com.oneline.api.config.InternalServiceAuth;
import com.oneline.api.js.Js;
import com.oneline.api.support.EventLoop;
import com.oneline.api.support.Fetch;
import com.oneline.api.support.AiCallLog;
import com.oneline.api.zod.Z;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * 기존 createActivityMetadataQueue (src/activity-metadata.js).
 * 활동별로 저장을 묶는다. 동일 입력의 실패는 자동 재호출하지 않고 새 기록 변경만 다시 접수한다.
 * 모든 메서드는 EventLoop 잠금을 잡은 상태에서 호출한다.
 */
public final class ActivityMetadataQueue {
    private final Database db;
    private final EventLoop loop;
    private final String aiBaseUrl;
    private final InternalServiceAuth auth;
    private final long delayMs;
    private final Map<Object, Job> jobs = new HashMap<>();
    private boolean closed;
    private final ScheduledExecutorService timers = Executors.newSingleThreadScheduledExecutor(daemon("activity-metadata-timer"));
    private final ExecutorService runners = Executors.newCachedThreadPool(daemon("activity-metadata-run"));

    private static final class Job {
        ScheduledFuture<?> timer;
        Object timerToken;
        CompletableFuture<Void> running;
        boolean dirty;
        boolean cancelled;
        Fetch.Controller controller;
    }

    public ActivityMetadataQueue(Database db, EventLoop loop, String aiBaseUrl, long delayMs, InternalServiceAuth auth) {
        this.db = db;
        this.loop = loop;
        this.aiBaseUrl = aiBaseUrl;
        this.auth = auth;
        this.delayMs = delayMs;
        db.run("UPDATE activities SET metadata_status = 'failed', metadata_error = ? WHERE metadata_status IN ('queued', 'running')",
                "서버가 재시작되어 활동 정보 분석이 중단됐어요. 다시 분석해 주세요.");
    }

    private static java.util.concurrent.ThreadFactory daemon(String name) {
        return runnable -> {
            Thread thread = new Thread(runnable, name);
            thread.setDaemon(true);
            return thread;
        };
    }

    private void markFailed(Object id) {
        try {
            db.run("UPDATE activities SET metadata_status = 'failed', metadata_error = ? WHERE id = ?",
                    closed ? "서버가 종료되어 분석이 중단됐어요. 다시 분석해 주세요."
                            : "활동 정보를 갱신하지 못했어요. 저장한 자료와 기존 정보는 유지했어요. 다시 분석해 주세요.", id);
        } catch (RuntimeException ignored) {
            // 상태 기록도 실패할 경우 저장된 자료는 보존하며 조회의 stale로 재시도를 안내한다.
        }
    }

    public boolean schedule(Object id) {
        if (closed) return false;
        try {
            if (ActivityMetadata.activitySnapshot(db, id) == null) return false;
            Job existing = jobs.get(id);
            Job job = existing != null ? existing : new Job();
            if (job.running != null) {
                job.dirty = true;
                return true;
            }
            db.run("UPDATE activities SET metadata_status = 'queued', metadata_error = NULL WHERE id = ?", id);
            clearTimer(job);
            jobs.put(id, job);
            Object token = new Object();
            job.timerToken = token;
            job.timer = timers.schedule(() -> runners.submit(() -> loop.run(() -> fire(id, job, token))), delayMs, TimeUnit.MILLISECONDS);
            return true;
        } catch (RuntimeException e) {
            markFailed(id);
            return false;
        }
    }

    private static void clearTimer(Job job) {
        if (job.timer != null) job.timer.cancel(false);
        job.timer = null;
        job.timerToken = null;
    }

    private void fire(Object id, Job job, Object token) {
        // clearTimeout 이후에는 실행하지 않는다.
        if (job.timerToken != token) return;
        job.timer = null;
        job.timerToken = null;
        CompletableFuture<Void> running = new CompletableFuture<>();
        job.running = running;
        try {
            run(id, job);
        } catch (Throwable error) {
            if (!job.cancelled) markFailed(id);
        } finally {
            try {
                if (jobs.get(id) == job) {
                    job.running = null;
                    if (!closed && job.dirty) {
                        job.dirty = false;
                        if (!schedule(id)) jobs.remove(id);
                    } else {
                        jobs.remove(id);
                    }
                }
            } finally {
                running.complete(null);
            }
        }
    }

    private void run(Object id, Job job) {
        ActivityMetadata.Snapshot initial = ActivityMetadata.activitySnapshot(db, id);
        if (initial == null) return;
        if (initial.records().isEmpty()) {
            // 기록이 다른 활동으로 모두 이동했으면 기존 AI 생성 정보도 남기지 않는다.
            db.run("""
                    UPDATE activities SET summary = CASE WHEN metadata_model IS NOT NULL THEN NULL ELSE summary END,
                            role = CASE WHEN metadata_model IS NOT NULL THEN NULL ELSE role END,
                            status = CASE WHEN metadata_model IS NOT NULL THEN NULL ELSE status END,
                            start_date = CASE WHEN metadata_model IS NOT NULL THEN NULL ELSE start_date END,
                            end_date = CASE WHEN metadata_model IS NOT NULL THEN NULL ELSE end_date END,
                            period = CASE WHEN metadata_model IS NOT NULL THEN NULL ELSE period END,
                            metadata_status = 'idle', metadata_fingerprint = NULL, metadata_error = NULL,
                            metadata_review_fields = NULL WHERE id = ?""", id);
            return;
        }
        db.run("UPDATE activities SET metadata_status = 'running' WHERE id = ?", id);
        job.controller = new Fetch.Controller();
        try (var call = new AiCallLog("activity_metadata", id)) {
            String base = Fetch.aiBase(aiBaseUrl);
            String input = ActivityMetadata.requestJson(db.get("SELECT * FROM activities WHERE id = ?", id), initial);
            Fetch.Response response = Fetch.post(loop, base + "/api/analyze/activities/" + Js.encodeURIComponent(Js.str(id)),
                    input, 150000, job.controller, auth, call);
            Object body = response.jsonOrNull();
            if (job.cancelled) { call.cancelled(); return; }
            if (!response.ok()) throw new IllegalStateException("활동 정보를 분석하지 못했어요. AI 서버 상태를 확인하고 다시 분석해 주세요.");
            Z.SafeParseResult parsed = ActivityMetadata.OUTPUT.safeParse(body);
            if (!parsed.success()) throw new IllegalStateException("활동 정보 분석 응답 형식을 확인하지 못했어요.");
            Map<String, Object> output = Js.asObject(parsed.data());
            boolean applied = db.transaction(() -> {
                ActivityMetadata.Snapshot current = ActivityMetadata.activitySnapshot(db, id);
                if (current == null) return false;
                if (!current.fingerprint().equals(initial.fingerprint())
                        || !Js.strictEquals(output.get("sourceFingerprint"), current.fingerprint())
                        || ((Number) output.get("recordCount")).doubleValue() != current.records().size()) {
                    // 실제 입력이 변경된 경우에만 새 입력으로 한 번 더 분석한다.
                    if (!current.fingerprint().equals(initial.fingerprint())) job.dirty = true;
                    throw new IllegalStateException("분석 중 기록이 변경됐어요. 최신 기록으로 다시 분석해 주세요.");
                }
                Map<Object, List<Object>> sources = new HashMap<>();
                for (Object raw : current.records()) {
                    List<Object> row = Js.asArray(raw);
                    Object summary = Js.path(com.oneline.api.js.Json.parse((String) row.get(2)), "analysis", "summary");
                    sources.put(row.get(0), Js.arr(row.get(1), summary));
                }
                Map<String, Object> metadata = Js.asObject(output.get("metadata"));
                Object period = metadata.get("period");
                List<Object> items = new ArrayList<>();
                for (Object item : Js.arr(metadata.get("summary"), metadata.get("role"), metadata.get("status"),
                        Js.get(period, "start"), Js.get(period, "end"))) {
                    if (Js.truthy(item)) items.add(item);
                }
                for (Object item : items) {
                    for (Object ref : Js.asArray(Js.get(item, "evidence"))) {
                        List<Object> candidates = sources.get(Js.get(ref, "recordId"));
                        boolean found = false;
                        if (candidates != null) {
                            for (Object source : candidates) {
                                if (Js.includes(source, Js.get(ref, "quote"))) {
                                    found = true;
                                    break;
                                }
                            }
                        }
                        if (!found) throw new IllegalStateException("활동 정보의 근거가 저장된 기록과 일치하지 않아요.");
                    }
                }
                Map<String, Object> previous = db.get("SELECT * FROM activities WHERE id = ?", id);
                Map<String, Object> parsedPeriod = ActivityMetadata.periodParse(
                        Js.coalesce(Js.opt(Js.get(period, "start"), "value"), previous.get("start_date")),
                        Js.coalesce(Js.opt(Js.get(period, "end"), "value"), previous.get("end_date")));
                Object start = parsedPeriod.get("start"), end = parsedPeriod.get("end");
                List<String> review = ActivityMetadata.reviewFields(previous);
                if (metadata.get("status") != null) review.remove("status");
                if (metadata.get("role") != null) review.remove("role");
                if (!Js.nullish(Js.get(period, "start"))) review.remove("start_date");
                if (!Js.nullish(Js.get(period, "end"))) review.remove("end_date");
                if (!Js.nullish(Js.get(period, "start")) || !Js.nullish(Js.get(period, "end"))) review.remove("period");
                db.run("""
                                UPDATE activities SET summary = ?, status = ?, role = ?, start_date = ?, end_date = ?, period = ?,
                                  metadata_status = 'ready', metadata_error = NULL, metadata_fingerprint = ?, metadata_model = ?,
                                  metadata_updated_at = ?, metadata_review_fields = ? WHERE id = ?""",
                        Js.get(metadata.get("summary"), "value"),
                        Js.coalesce(Js.opt(metadata.get("status"), "value"), previous.get("status")),
                        Js.coalesce(Js.opt(metadata.get("role"), "value"), previous.get("role")),
                        start, end,
                        Js.truthy(start) || Js.truthy(end)
                                ? Js.str(Js.coalesce(start, "미확인")) + " ~ " + Js.str(Js.coalesce(end, ""))
                                : previous.get("period"),
                        current.fingerprint(), output.get("model"), Js.nowIso(), com.oneline.api.js.Json.stringify(review), id);
                return true;
            });
            if (applied) call.applied(); else call.cancelled();
        } catch (Throwable error) {
            // 자료와 이전 메타정보를 보존한다. 공급자 원문·사용자 입력은 오류 로그에 남기지 않는다.
            if (!job.cancelled) markFailed(id);
        }
    }

    public void cancelPending(Object id) {
        Job job = jobs.get(id);
        if (job == null) return;
        job.cancelled = true;
        job.dirty = false;
        clearTimer(job);
        if (job.controller != null) job.controller.abort();
        jobs.remove(id);
    }

    public boolean hasActive() {
        return !jobs.isEmpty();
    }

    /** 종료 시 대기 중 작업을 취소하고 실행 중 작업이 끝나기를 기다린다. EventLoop 잠금 밖에서 호출한다. */
    public void close() {
        List<CompletableFuture<Void>> running = new ArrayList<>();
        loop.run(() -> {
            closed = true;
            for (Job job : jobs.values()) {
                clearTimer(job);
                if (job.controller != null) job.controller.abort();
                if (job.running != null) running.add(job.running);
            }
        });
        for (CompletableFuture<Void> future : running) {
            try {
                future.get(10, TimeUnit.SECONDS);
            } catch (Exception ignored) {
            }
        }
        loop.run(jobs::clear);
        timers.shutdownNow();
        runners.shutdownNow();
    }
}
