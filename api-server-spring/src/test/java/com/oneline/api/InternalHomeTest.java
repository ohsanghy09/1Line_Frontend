package com.oneline.api;

import com.oneline.api.js.Js;
import com.oneline.api.js.Json;
import com.oneline.api.service.InternalChatJobs;
import com.oneline.api.service.InternalJobExpiry;
import java.time.Instant;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.*;

import static com.oneline.api.js.Js.obj;
import static org.junit.jupiter.api.Assertions.*;

class InternalHomeTest {
    @Test
    void cleanupRetiresUnsavedFilesAndRejectsLatePublicationWithoutResurrection() {
        try (var s = TestServer.start()) {
            var p = publication("cleanup", List.of(file("cleanup-file", "report.txt", new byte[]{1, 2})));
            assertEquals(201, publish(s, p).status());
            s.sql(db -> db.run("UPDATE analysis_retention SET touched_at_ms = 123"));
            assertEquals(200, publish(s, p).status());
            assertEquals(123, ((Number) s.row("SELECT touched_at_ms FROM analysis_retention").get("touched_at_ms")).longValue());
            var failed = copy(p);
            failed.put("expectedRevision", 1); failed.put("status", "failed");
            failed.put("error", obj("code", "invalid_analysis", "error", "분석 실패"));
            assertEquals(200, publish(s, failed).status());
            assertTrue(((Number) s.row("SELECT touched_at_ms FROM analysis_retention").get("touched_at_ms")).longValue() > 123);
            s.sql(db -> db.run("UPDATE analysis_retention SET touched_at_ms = 0"));
            assertEquals(200, publish(s, failed).status());
            assertEquals(0, ((Number) s.row("SELECT touched_at_ms FROM analysis_retention").get("touched_at_ms")).longValue());
            var cleaner = s.context.getBean(com.oneline.api.service.UnsavedAnalysisCleanup.class);
            assertEquals(1, cleaner.scan(Instant.now()));
            assertEquals(0, count(s, "files"));
            assertEquals(0, count(s, "analyses"));
            assertEquals(1, count(s, "internal_job_tombstones"));
            assertEquals(404, internal(s, "GET", "/chat-jobs/" + p.get("jobId"), null).status());
            assertEquals(409, publish(s, p).status());
            assertEquals(0, count(s, "files"));
            assertEquals(404, s.post("/records", obj("activityId", "line1-hackathon", "analysisId", p.get("analysisId"))).status());
        }
    }

    @Test
    void legacyPublicationTableMigratesWithoutLosingResultsAndRestartRecoveryRemainsIdempotent() throws Exception {
        Path path = Files.createTempDirectory("internal-expiry-migration-").resolve("db.sqlite");
        try (var db = com.oneline.api.db.Database.open(path.toString())) {
            var p = publication("expiry-legacy", List.of(file("legacy-file", "a.txt", new byte[]{1, 2})));
            InternalChatJobs.publish(db, (String) p.get("jobId"), p);
            var complete = completed(publication("expiry-legacy-done", List.of()), general("Legacy result"), 0);
            InternalChatJobs.publish(db, (String) complete.get("jobId"), complete);
            db.exec("ALTER TABLE internal_chat_publications DROP COLUMN accepted_at_ms");
            db.exec("ALTER TABLE internal_chat_publications DROP COLUMN progress_received_at_ms");
        }
        for (int attempt = 0; attempt < 2; attempt++) {
            try (var s = TestServer.start("oneline.db-path=" + path.toString().replace('\\', '/'))) {
                var failed = job(internal(s, "GET", "/chat-jobs/ai-expiry-legacy", null));
                assertEquals("failed", failed.get("status")); assertEquals(2, revision(failed));
                assertEquals("server_restarted", Js.path(failed, "error", "code"));
                assertEquals(1, Js.asArray(failed.get("files")).size());
                var done = job(internal(s, "GET", "/chat-jobs/ai-expiry-legacy-done", null));
                assertEquals("Legacy result", Js.path(done, "reply", "content")); assertEquals(1, revision(done));
                assertEquals(201, publish(s, publication("expiry-after-migration-" + attempt, List.of())).status());
                assertNotNull(s.row("SELECT accepted_at_ms, progress_received_at_ms FROM internal_chat_publications WHERE job_id = ?",
                        "ai-expiry-after-migration-" + attempt).get("accepted_at_ms"));
            }
        }
    }

    @Test
    void expiryUsesBackendReceiptBoundariesAndPreservesOriginalsAndTerminalResults() {
        try (var s = TestServer.start()) {
            var queued = publication("expiry-queued", List.of(file("expiry-file", "a.txt", new byte[]{1})));
            publish(s, queued);
            var running = publication("expiry-running", List.of());
            running.put("status", "running"); running.put("phase", "analyzing");
            // Remote timestamps are deliberately far in the future; they must not determine expiry.
            running.put("createdAt", "2099-01-01T00:00:00.000Z");
            running.put("updatedAt", "2099-01-01T00:00:01.000Z");
            publish(s, running);
            var complete = publication("expiry-completed", List.of());
            publish(s, complete); publish(s, completed(complete, general("Saved result"), 1));
            var failed = publication("expiry-failed", List.of());
            failed.put("status", "failed"); failed.put("error", obj("code", "model_failed", "error", "Original error"));
            publish(s, failed);
            Instant now = Instant.now();
            s.sql(db -> {
                db.run("UPDATE internal_chat_publications SET accepted_at_ms = ?, progress_received_at_ms = ?",
                        now.toEpochMilli() - 600000, now.toEpochMilli() - 300000);
            });
            var expiry = s.context.getBean(InternalJobExpiry.class);
            expiry.scan(now.minusMillis(1));
            assertEquals("queued", job(internal(s, "GET", "/chat-jobs/ai-expiry-queued", null)).get("status"));
            assertEquals("running", job(internal(s, "GET", "/chat-jobs/ai-expiry-running", null)).get("status"));
            expiry.scan(now);
            var q = job(internal(s, "GET", "/chat-jobs/ai-expiry-queued", null));
            var r = job(internal(s, "GET", "/chat-jobs/ai-expiry-running", null));
            assertEquals("failed", q.get("status")); assertEquals("failed", r.get("status"));
            assertEquals("queue_timeout", Js.path(q, "error", "code"));
            assertEquals("analysis_timeout", Js.path(r, "error", "code"));
            assertEquals("분석 요청이 많아 대기 시간이 초과됐어요. 잠시 후 다시 요청해 주세요.", Js.path(q, "error", "error"));
            assertEquals("분석 진행을 확인할 수 없어 작업을 종료했어요. 다시 요청해 주세요.", Js.path(r, "error", "error"));
            assertNull(q.get("reply")); assertNull(r.get("reply"));
            assertEquals(copy(queued).get("files"), q.get("files"));
            assertEquals(2, revision(q)); assertEquals(2, revision(r));
            assertEquals(running.get("updatedAt"), r.get("updatedAt"));
            expiry.scan(now.plusSeconds(600));
            assertEquals(2, revision(job(internal(s, "GET", "/chat-jobs/ai-expiry-queued", null))));
            assertEquals("Saved result", Js.path(job(internal(s, "GET", "/chat-jobs/ai-expiry-completed", null)), "reply", "content"));
            assertEquals("model_failed", Js.path(job(internal(s, "GET", "/chat-jobs/ai-expiry-failed", null)), "error", "code"));
            assertEquals(1, revision(job(internal(s, "GET", "/chat-jobs/ai-expiry-failed", null))));
            assertEquals("null", s.row("SELECT reply FROM analyses WHERE id = ?", queued.get("analysisId")).get("reply"));
            assertEquals(409, publish(s, completed(queued, general("Late result"), 2)).status());
            var lateProgress = copy(queued); lateProgress.put("status", "running"); lateProgress.put("expectedRevision", 2);
            assertEquals(409, publish(s, lateProgress).status());
            assertEquals("failed", job(publish(s, queued)).get("status"));
            assertEquals(409, s.post("/records", obj("activityId", "line1-hackathon", "analysisId", queued.get("analysisId"))).status());
        }
    }

    @Test
    void progressRefreshesRunningReceiptWhileRetriesAndReadsDoNotExtendQueuedOrRunning() {
        try (var s = TestServer.start()) {
            var p = publication("expiry-progress", List.of()); publish(s, p);
            long old = System.currentTimeMillis() - 600000;
            s.sql(db -> db.run("UPDATE internal_chat_publications SET accepted_at_ms = ?, progress_received_at_ms = ?", old, old));
            publish(s, p); internal(s, "GET", "/chat-jobs/ai-expiry-progress", null);
            assertEquals(old, ((Number) s.row("SELECT accepted_at_ms FROM internal_chat_publications").get("accepted_at_ms")).longValue());
            var running = copy(p); running.put("status", "running"); running.put("phase", "analyzing"); running.put("expectedRevision", 1);
            long before = System.currentTimeMillis(); publish(s, running);
            long received = ((Number) s.row("SELECT progress_received_at_ms FROM internal_chat_publications").get("progress_received_at_ms")).longValue();
            assertTrue(received >= before);
            assertEquals(old, ((Number) s.row("SELECT accepted_at_ms FROM internal_chat_publications").get("accepted_at_ms")).longValue());
            publish(s, running); internal(s, "GET", "/chat-jobs/ai-expiry-progress", null);
            assertEquals(received, ((Number) s.row("SELECT progress_received_at_ms FROM internal_chat_publications").get("progress_received_at_ms")).longValue());
            var expiry = s.context.getBean(InternalJobExpiry.class);
            expiry.scan(Instant.ofEpochMilli(received + 299999));
            assertEquals("running", job(internal(s, "GET", "/chat-jobs/ai-expiry-progress", null)).get("status"));
            running.put("expectedRevision", 2); running.put("phase", "persisting");
            assertEquals(3, revision(job(publish(s, running))));
            var q = publication("expiry-still-queued", List.of()); publish(s, q);
            s.sql(db -> db.run("UPDATE internal_chat_publications SET accepted_at_ms = ? WHERE job_id = ?", old, q.get("jobId")));
            var queuedUpdate = copy(q); queuedUpdate.put("expectedRevision", 1); queuedUpdate.put("updatedAt", "2026-11-13T00:00:01.000Z");
            publish(s, queuedUpdate);
            expiry.scan(Instant.now());
            assertEquals("failed", job(internal(s, "GET", "/chat-jobs/ai-expiry-still-queued", null)).get("status"));
            assertEquals("running", job(internal(s, "GET", "/chat-jobs/ai-expiry-progress", null)).get("status"));
        }
    }

    @Test
    void expiryRollsBackAllChangesOnDatabaseFailure() {
        try (var s = TestServer.start()) {
            publish(s, publication("expiry-rollback", List.of()));
            s.sql(db -> {
                db.run("UPDATE internal_chat_publications SET accepted_at_ms = 0");
                db.execStatement("CREATE TRIGGER reject_expiry BEFORE UPDATE ON internal_chat_publications BEGIN SELECT RAISE(ABORT, 'test rollback'); END");
            });
            assertThrows(RuntimeException.class, () -> s.context.getBean(InternalJobExpiry.class).scan(Instant.now()));
            var current = job(internal(s, "GET", "/chat-jobs/ai-expiry-rollback", null));
            assertEquals("queued", current.get("status")); assertEquals(1, revision(current)); assertNull(current.get("error"));
            s.sql(db -> db.exec("DROP TRIGGER reject_expiry"));
            s.context.getBean(InternalJobExpiry.class).scan(Instant.now());
            assertEquals("failed", job(internal(s, "GET", "/chat-jobs/ai-expiry-rollback", null)).get("status"));
        }
    }

    @Test
    void concurrentExpiryAndCompletionProduceOneTerminalState() throws Exception {
        try (var s = TestServer.start(); var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var p = publication("expiry-race", List.of()); publish(s, p);
            s.sql(db -> db.run("UPDATE internal_chat_publications SET accepted_at_ms = 0"));
            var latch = new CountDownLatch(1);
            var expiry = executor.submit(() -> { latch.await(); s.context.getBean(InternalJobExpiry.class).scan(Instant.now()); return true; });
            var completion = executor.submit(() -> { latch.await(); return publish(s, completed(p, general("Race result"), 1)).status(); });
            latch.countDown(); expiry.get(10, TimeUnit.SECONDS);
            int status = completion.get(10, TimeUnit.SECONDS);
            var current = job(internal(s, "GET", "/chat-jobs/ai-expiry-race", null));
            assertEquals(2, revision(current));
            if (status == 200) {
                assertEquals("completed", current.get("status")); assertNull(current.get("error"));
                assertEquals("Race result", Js.path(current, "reply", "content"));
            } else {
                assertEquals(409, status); assertEquals("failed", current.get("status")); assertNull(current.get("reply"));
            }
        }
    }

    @Test
    void scheduledExpiryUnblocksResetAndAllowsANewRequest() throws Exception {
        try (var s = TestServer.start("oneline.internal-job-scan-interval-ms=25")) {
            var p = publication("expiry-timer", List.of()); publish(s, p);
            assertEquals(409, s.post("/settings/reset-data", obj("confirmation", "전체 삭제")).status());
            s.sql(db -> db.run("UPDATE internal_chat_publications SET accepted_at_ms = 0"));
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
            while (!"failed".equals(s.row("SELECT status FROM ai_chat_jobs").get("status")) && System.nanoTime() < deadline)
                Thread.sleep(10);
            assertEquals("failed", job(internal(s, "GET", "/chat-jobs/ai-expiry-timer", null)).get("status"));
            assertEquals(201, publish(s, publication("expiry-new-request", List.of())).status());
            s.sql(db -> db.run("UPDATE internal_chat_publications SET accepted_at_ms = 0"));
            s.context.getBean(InternalJobExpiry.class).scan(Instant.now());
            assertEquals(200, s.post("/settings/reset-data", obj("confirmation", "전체 삭제")).status());
        }
    }

    @Test
    void failedInitialPublicationDiscardsReplyButPreservesErrorAndOriginals() {
        try (var s = TestServer.start()) {
            var p = publication("failed-initial", List.of(file("failed-file", "note.txt", new byte[]{1, 2})));
            p.put("status", "failed"); p.put("phase", "completed");
            p.put("reply", TestServer.mockReply("", List.of("note.txt"), false));
            var error = obj("code", "publish_failed", "error", "Result publication failed");
            p.put("error", error);
            var response = publish(s, p);
            assertEquals(201, response.status(), response.text());
            var stored = job(internal(s, "GET", "/chat-jobs/ai-failed-initial", null));
            assertEquals("failed", stored.get("status"));
            assertNull(stored.get("reply"));
            assertEquals(error, stored.get("error"));
            assertEquals(copy(p).get("files"), stored.get("files"));
            assertEquals(p.get("message"), stored.get("message"));
            assertEquals("null", s.row("SELECT reply FROM analyses").get("reply"));
            assertEquals(409, s.post("/records", obj("activityId", "line1-hackathon", "analysisId", p.get("analysisId"))).status());
        }
    }

    @Test
    void failedUpdateNormalizesBeforeRetrySignatureAndStillChecksRevisionAndError() {
        try (var s = TestServer.start()) {
            var p = publication("failed-update", List.of());
            assertEquals(201, publish(s, p).status());
            var running = copy(p);
            running.put("status", "running"); running.put("phase", "persisting");
            running.put("expectedRevision", 1);
            assertEquals(2, revision(job(publish(s, running))));
            var failed = completed(p, general("Leftover result"), 1);
            failed.put("status", "failed");
            failed.put("error", obj("code", "publish_failed", "error", "Result publication failed"));
            assertEquals(409, publish(s, failed).status());
            assertEquals("running", job(internal(s, "GET", "/chat-jobs/ai-failed-update", null)).get("status"));
            failed.put("expectedRevision", 2);
            var invalid = copy(failed); invalid.put("error", null);
            assertEquals(400, publish(s, invalid).status());
            invalid = copy(running); invalid.put("reply", general("Unexpected pending result"));
            assertEquals(400, publish(s, invalid).status());
            assertEquals(3, revision(job(publish(s, failed))));
            assertEquals(3, revision(job(publish(s, failed))));
            failed.put("reply", null);
            assertEquals(3, revision(job(publish(s, failed))));
            failed.put("reply", obj("incomplete", true));
            var retry = job(publish(s, failed));
            assertEquals(3, revision(retry));
            assertNull(retry.get("reply"));
            assertEquals(failed.get("error"), retry.get("error"));
            assertEquals(409, publish(s, completed(p, general("Late result"), 3)).status());
        }
    }

    @Test
    void failedPublicationCannotOverwriteAnAlreadyCompletedResult() {
        try (var s = TestServer.start()) {
            var p = publication("completed-protection", List.of());
            assertEquals(201, publish(s, p).status());
            var result = general("Persisted result");
            assertEquals(2, revision(job(publish(s, completed(p, result, 1)))));
            var failed = completed(p, result, 2);
            failed.put("status", "failed");
            failed.put("error", obj("code", "publish_failed", "error", "Response was lost"));
            assertEquals(409, publish(s, failed).status());
            failed.put("expectedRevision", 1);
            assertEquals(409, publish(s, failed).status());
            var stored = job(internal(s, "GET", "/chat-jobs/ai-completed-protection", null));
            assertEquals("completed", stored.get("status"));
            assertEquals(result, stored.get("reply"));
            assertEquals(2, revision(stored));
            assertNull(stored.get("error"));
        }
    }

    @Test
    void documentedExchangeIsAcceptedByTheRealInternalEndpoints() throws Exception {
        var example = Js.asObject(Json.parse(Files.readString(Path.of("../docs/backend-ai-integration/examples/home-job-exchange.json"))));
        try (var s = TestServer.start()) {
            assertEquals(201, publish(s, Js.asObject(example.get("queuedPublication"))).status());
            var completed = publish(s, Js.asObject(example.get("completedPublication")));
            assertEquals(200, completed.status(), completed.text());
            assertEquals(example.get("completedResponse"), completed.json());
        }
    }

    private static Map<String, Object> copy(Object value) { return Js.asObject(Json.parse(Json.stringify(value))); }
    private static Map<String, Object> file(String id, String name, byte[] bytes) {
        return obj("id", id, "name", name, "mimeType", "text/plain", "size", bytes.length,
                "contentBase64", Base64.getEncoder().encodeToString(bytes));
    }
    private static Map<String, Object> publication(String id, List<Object> files) {
        return obj("jobId", "ai-" + id, "analysisId", "analysis-" + id, "conversationId", "conversation",
                "requestId", "request-" + id, "requestFingerprint", "fingerprint-" + id,
                "kind", "chat", "status", "queued", "phase", "preparing", "message", "직접 구현한 경험입니다.",
                "sourceUrl", null, "reply", null, "files", files, "error", null,
                "createdAt", "2026-11-13T00:00:00.000Z", "updatedAt", "2026-11-13T00:00:00.000Z", "expectedRevision", 0);
    }
    private static Map<String, Object> completed(Map<String, Object> original, Object reply, long revision) {
        var p = copy(original);
        p.put("status", "completed"); p.put("phase", "completed"); p.put("reply", reply);
        p.put("expectedRevision", revision); p.put("updatedAt", "2026-11-13T00:00:01.000Z");
        return p;
    }
    private static Map<String, Object> general(String content) {
        return obj("id", "reply-general", "role", "assistant", "kind", "general", "content", content, "analysis", null);
    }
    private static TestServer.Response internal(TestServer s, String method, String path, Object input) {
        return s.request(method, "/internal" + path, input == null ? null : "application/json", input == null ? null : Json.stringify(input),
                Map.of("Authorization", "Bearer " + TestServer.TOKEN));
    }
    private static TestServer.Response publish(TestServer s, Map<String, Object> p) {
        return internal(s, "PUT", "/chat-jobs/" + p.get("jobId"), p);
    }
    private static Map<String, Object> job(TestServer.Response r) {
        assertTrue(r.status() == 200 || r.status() == 201, r.text());
        return Js.asObject(r.map().get("job"));
    }
    private static long revision(Map<String, Object> job) { return ((Number) job.get("revision")).longValue(); }
    private static long count(TestServer s, String table) { return ((Number) s.row("SELECT COUNT(*) AS n FROM " + table).get("n")).longValue(); }

    @Test
    void publicationRoundtripSupportsExistingSaveAndOriginalDownload() {
        try (var s = TestServer.start()) {
            byte[] bytes = "실제 보관할 원본".getBytes(StandardCharsets.UTF_8);
            var p = publication("roundtrip", List.of(file("file-1", "note.txt", bytes)));
            var accepted = publish(s, p);
            assertEquals(201, accepted.status(), accepted.text());
            assertEquals(1, revision(job(accepted)));
            assertEquals(0, count(s, "records"));
            assertEquals(409, s.post("/records", obj("activityId", "line1-hackathon", "analysisId", p.get("analysisId"))).status());
            var c = completed(p, TestServer.mockReply("", List.of("note.txt"), false), 1);
            assertEquals(2, revision(job(publish(s, c))));
            var stored = job(internal(s, "GET", "/chat-jobs/ai-roundtrip", null));
            assertEquals(Base64.getEncoder().encodeToString(bytes), Js.path(Js.asArray(stored.get("files")).get(0), "contentBase64"));
            assertEquals(201, s.post("/records", obj("activityId", "line1-hackathon", "analysisId", p.get("analysisId"))).status());
            assertEquals(409, s.post("/records", obj("activityId", "line1-hackathon", "analysisId", p.get("analysisId"))).status());
            assertArrayEquals(bytes, s.get("/files/file-1").raw().body());
            assertEquals("", s.row("SELECT message FROM records").get("message"));
            assertFalse(s.get("/conversations/conversation/messages").text().contains("contentBase64"));
        }
    }

    @Test
    void retriesAreIdempotentAndInputAndRevisionConflictsPreserveTheOriginal() {
        try (var s = TestServer.start()) {
            var p = publication("retry", List.of(file("first-id", "a.txt", new byte[]{1, 2})));
            assertEquals(201, publish(s, p).status());
            var retry = copy(p);
            retry.put("jobId", "ai-new-id"); retry.put("analysisId", "new-analysis-id");
            Js.asObject(Js.asArray(retry.get("files")).get(0)).put("id", "new-file-id");
            assertEquals("ai-retry", job(publish(s, retry)).get("jobId"));
            assertEquals(1, count(s, "analyses")); assertEquals(1, count(s, "files"));
            var changed = copy(p); changed.put("message", "입력이 다릅니다.");
            assertEquals(409, publish(s, changed).status());
            var c = completed(p, TestServer.mockReply("", List.of("a.txt"), false), 1);
            assertEquals(2, revision(job(publish(s, c))));
            assertEquals(2, revision(job(publish(s, c)))); // 완료 게시 응답 유실 후 동일 재전송
            var stale = copy(p); stale.put("expectedRevision", 1); stale.put("status", "running"); stale.put("phase", "analyzing");
            assertEquals(409, publish(s, stale).status());
            stale.put("expectedRevision", 2);
            assertEquals(409, publish(s, stale).status());
            assertEquals("completed", job(publish(s, p)).get("status")); // 접수 재전송도 정본 반환
        }
    }

    @Test
    void validationRejectsInvalidOriginalsRepliesReferencesAndTimestampsAtomically() {
        try (var s = TestServer.start()) {
            var original = publication("invalid", List.of(file("file-i", "a.txt", new byte[]{1})));
            List<Map<String, Object>> invalid = new ArrayList<>();
            var p = copy(original); p.put("unexpected", true); invalid.add(p);
            p = copy(original); p.put("reply", general("미완료 결과")); invalid.add(p);
            p = copy(original); p.put("updatedAt", "2026-02-30T00:00:00Z"); invalid.add(p);
            p = copy(original); p.put("createdAt", "2026-11-14T00:00:00Z"); invalid.add(p);
            p = copy(original); p.put("expectedRevision", -1); invalid.add(p);
            p = copy(original); Js.asObject(Js.asArray(p.get("files")).get(0)).put("size", 2); invalid.add(p);
            p = copy(original); Js.asObject(Js.asArray(p.get("files")).get(0)).put("contentBase64", "bad!"); invalid.add(p);
            p = copy(original); p.put("files", List.of(Js.asArray(p.get("files")).get(0), Js.asArray(p.get("files")).get(0))); invalid.add(p);
            p = completed(original, TestServer.mockReply("", List.of("wrong-name.txt"), false), 0); invalid.add(p);
            p = copy(original); p.put("status", "failed"); invalid.add(p);
            for (var candidate : invalid) assertEquals(400, publish(s, candidate).status(), Json.stringify(candidate));
            assertEquals(0, count(s, "ai_chat_jobs")); assertEquals(0, count(s, "analyses")); assertEquals(0, count(s, "files"));
            var reply = TestServer.mockReply("", List.of("a.txt"), false);
            var activity = Js.asObject(Js.path(reply, "analysis", "activity")); activity.put("id", "missing"); activity.put("match", "existing");
            assertEquals(404, publish(s, completed(original, reply, 0)).status());
            assertEquals(0, count(s, "analyses"));
            assertEquals(400, internal(s, "GET", "/home-context?conversationId=a&conversationId=b", null).status());
            var malformed = s.request("PUT", "/internal/chat-jobs/ai-private", "application/json", "{\"private-source\":",
                    Map.of("Authorization", "Bearer " + TestServer.TOKEN));
            assertEquals(400, malformed.status()); assertNotNull(malformed.map().get("code"));
            assertFalse(malformed.text().contains("private-source"));
        }
    }

    @Test
    void onlyInternalPublicationAcceptsLargeOriginalsAndFileLimitsRemainEnforced() {
        try (var s = TestServer.start()) {
            var p = publication("large", List.of(file("large-file", "a.txt", new byte[1024 * 1024])));
            assertEquals(201, publish(s, p).status());
            assertEquals(413, s.post("/records", p).status()); // 공개 JSON 제한은 그대로 1MiB
            var tooMany = publication("many", Collections.nCopies(11, file("x", "a.txt", new byte[]{1})));
            assertEquals(400, publish(s, tooMany).status());
            var oversized = publication("oversized", List.of(file("oversized-file", "a.txt", new byte[]{1})));
            Js.asObject(Js.asArray(oversized.get("files")).get(0)).put("size", 10 * 1024 * 1024 + 1);
            assertEquals(400, publish(s, oversized).status());
            var unsupported = publication("unsupported", List.of(file("exe", "a.exe", new byte[]{1})));
            assertEquals(400, publish(s, unsupported).status());
            byte[] tenMiB = new byte[10 * 1024 * 1024];
            var totalLimit = publication("total-limit", List.of(file("total-1", "a.txt", tenMiB),
                    file("total-2", "b.txt", tenMiB), file("total-3", "c.txt", new byte[6 * 1024 * 1024])));
            assertEquals(400, publish(s, totalLimit).status());
        }
    }

    @Test
    void contextReflectsSavedAndPendingActivitiesAndExcludesUnfinishedAndOtherConversations() {
        try (var s = TestServer.start()) {
            var p = publication("pending", List.of());
            var reply = TestServer.mockReply("경험", List.of(), false);
            assertEquals(201, publish(s, completed(p, reply, 0)).status());
            assertEquals(201, publish(s, publication("unfinished", List.of())).status());
            var context = internal(s, "GET", "/home-context?conversationId=conversation", null).map();
            assertEquals(true, context.get("activeActivityPending"));
            assertNull(context.get("activeActivityId"));
            assertEquals(2, Js.asArray(context.get("recentMessages")).size());
            assertTrue(Js.asArray(Js.path(context, "context", "records")).isEmpty());
            assertEquals(201, s.post("/records", obj("activityId", "line1-hackathon", "analysisId", p.get("analysisId"))).status());
            context = internal(s, "GET", "/home-context?conversationId=conversation", null).map();
            assertEquals("line1-hackathon", context.get("activeActivityId"));
            assertEquals(false, context.get("activeActivityPending"));
            assertEquals(1, Js.asArray(Js.path(context, "context", "records")).size());
            for (int i = 0; i < 8; i++) {
                var chat = completed(publication("general-" + i, List.of()), general("일반 대화 " + i), 0);
                chat.put("createdAt", "2026-11-13T01:00:0" + i + ".000Z");
                chat.put("updatedAt", chat.get("createdAt"));
                assertEquals(201, publish(s, chat).status());
            }
            context = internal(s, "GET", "/home-context?conversationId=conversation", null).map();
            assertEquals("line1-hackathon", context.get("activeActivityId"));
            assertEquals(12, Js.asArray(context.get("recentMessages")).size());
            var other = internal(s, "GET", "/home-context?conversationId=other", null).map();
            assertTrue(Js.asArray(other.get("recentMessages")).isEmpty());
            assertNull(other.get("activeActivityId"));
        }
    }

    @Test
    void contextLimitsAndUnicodeClippingAreDeterministicAndReadOnly() {
        try (var s = TestServer.start()) {
            s.sql(db -> {
                for (int i = 0; i < 55; i++) db.run("INSERT INTO activities (id, name, updated_at) VALUES (?, ?, ?)", "act-" + i, "Activity " + i, "2026-11-13");
            });
            var p = publication("messages", List.of()); p.put("message", "🙂".repeat(2001));
            publish(s, completed(p, general("🙂".repeat(2001)), 0));
            var first = internal(s, "GET", "/home-context?conversationId=conversation", null);
            assertEquals(first.text(), internal(s, "GET", "/home-context?conversationId=conversation", null).text());
            assertEquals(50, Js.asArray(Js.path(first.map(), "context", "activities")).size());
            assertEquals(true, Js.path(first.map(), "selection", "truncated"));
            String content = (String) Js.get(Js.asArray(first.map().get("recentMessages")).get(0), "content");
            assertEquals(2000, content.codePointCount(0, content.length()));
            assertEquals(0, count(s, "records"));
            s.sql(db -> db.run("UPDATE activities SET summary = ?", "x".repeat(10000)));
            assertEquals(400, internal(s, "GET", "/home-context?conversationId=conversation", null).status());
        }
    }

    @Test
    void directUpdatesAndDeletionAdvanceRevisionAndCannotBeOverwrittenByAi() {
        try (var s = TestServer.start()) {
            var p = publication("update", List.of());
            var action = obj("id", "reply-update", "role", "assistant", "kind", "activity-update", "analysis", null,
                    "content", "역할 수정", "update", obj("activityId", "line1-hackathon", "activityName", "1호선톤",
                            "updates", List.of(obj("field", "role", "value", "발표 담당"))));
            var completed = completed(p, action, 0);
            assertEquals(201, publish(s, completed).status());
            assertEquals(200, s.post("/activities/apply-chat-update", obj("analysisId", p.get("analysisId"))).status());
            var snapshot = job(internal(s, "GET", "/chat-jobs/ai-update", null));
            assertEquals(2, revision(snapshot)); assertEquals("general", Js.path(snapshot, "reply", "kind"));
            completed.put("expectedRevision", 1);
            assertEquals(409, publish(s, completed).status());
            assertEquals(200, s.post("/activities/apply-chat-update", obj("analysisId", p.get("analysisId"))).status());
            assertEquals(2, revision(job(internal(s, "GET", "/chat-jobs/ai-update", null))));
            assertEquals(200, s.send("DELETE", "/archive/activities/line1-hackathon", obj("confirmation", "1호선톤")).status());
            snapshot = job(internal(s, "GET", "/chat-jobs/ai-update", null));
            assertEquals(3, revision(snapshot));
            assertTrue(((String) Js.path(snapshot, "reply", "content")).contains("삭제"));
            assertEquals(409, publish(s, completed).status());
        }
    }

    @Test
    void deletionRetiresOriginalsAndResetKeepsOnlyReplayTombstones() {
        try (var s = TestServer.start()) {
            var p = publication("delete", List.of(file("to-delete", "a.txt", new byte[]{1})));
            var c = completed(p, TestServer.mockReply("", List.of("a.txt"), false), 0);
            publish(s, c);
            s.post("/records", obj("activityId", "line1-hackathon", "analysisId", p.get("analysisId")));
            assertEquals(200, s.send("DELETE", "/archive/activities/line1-hackathon/materials/to-delete", obj()).status());
            var snapshot = job(internal(s, "GET", "/chat-jobs/ai-delete", null));
            assertEquals(2, revision(snapshot)); assertTrue(Js.asArray(snapshot.get("files")).isEmpty());
            c.put("expectedRevision", 1);
            assertEquals(409, publish(s, c).status());
            assertEquals(200, s.post("/settings/reset-data", obj("confirmation", "전체 삭제")).status());
            assertEquals(0, count(s, "analyses")); assertEquals(0, count(s, "files"));
            assertEquals(0, count(s, "internal_chat_publications"));
            assertEquals(404, internal(s, "GET", "/chat-jobs/ai-delete", null).status());
            assertEquals(409, publish(s, p).status()); // 삭제 후 늦은 최초 접수 재전송도 부활 금지
        }
    }

    @Test
    void restartRecoversUnfinishedJobsAndPreservesCompletedJobsAndRevision() throws Exception {
        Path path = Files.createTempDirectory("internal-home-restart-").resolve("db.sqlite");
        var p = publication("restart", List.of());
        try (var s = TestServer.start("oneline.db-path=" + path.toString().replace('\\', '/'))) {
            publish(s, p);
            publish(s, completed(publication("finished", List.of()), general("완료"), 0));
        }
        try (var s = TestServer.start("oneline.db-path=" + path.toString().replace('\\', '/'))) {
            var failed = job(internal(s, "GET", "/chat-jobs/ai-restart", null));
            assertEquals("failed", failed.get("status")); assertEquals(2, revision(failed));
            assertEquals("server_restarted", Js.path(failed, "error", "code"));
            assertEquals("completed", job(internal(s, "GET", "/chat-jobs/ai-finished", null)).get("status"));
            var late = completed(p, general("늦은 완료"), 1);
            assertEquals(409, publish(s, late).status());
        }
    }

    @Test
    void concurrentUpdatesUseOneRevisionAndNeverMixResults() throws Exception {
        try (var s = TestServer.start()) {
            var p = publication("race", List.of()); publish(s, p);
            var first = completed(p, general("첫 결과"), 1);
            var second = completed(p, general("다른 결과"), 1);
            try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
                var latch = new CountDownLatch(1);
                var a = executor.submit(() -> { latch.await(); return publish(s, first).status(); });
                var b = executor.submit(() -> { latch.await(); return publish(s, second).status(); });
                latch.countDown();
                var statuses = new ArrayList<>(List.of(a.get(10, TimeUnit.SECONDS), b.get(10, TimeUnit.SECONDS)));
                Collections.sort(statuses); assertEquals(List.of(200, 409), statuses);
            }
            assertEquals(2, revision(job(internal(s, "GET", "/chat-jobs/ai-race", null))));
        }
    }

    @Test
    void phaseAndFailureStatesAreMonotonicAndPreventLateCompletion() {
        try (var s = TestServer.start()) {
            var p = publication("phases", List.of()); publish(s, p);
            var update = copy(p); update.put("expectedRevision", 1); update.put("status", "running"); update.put("phase", "persisting");
            assertEquals(2, revision(job(publish(s, update))));
            update.put("expectedRevision", 2); update.put("phase", "analyzing");
            assertEquals(409, publish(s, update).status());
            update.put("phase", "persisting"); update.put("status", "failed");
            update.put("error", obj("code", "model_failed", "error", "분석 실패"));
            assertEquals(3, revision(job(publish(s, update))));
            assertEquals(409, publish(s, completed(p, general("늦은 완료"), 3)).status());
            assertEquals(409, s.post("/records", obj("activityId", "line1-hackathon", "analysisId", p.get("analysisId"))).status());
        }
    }

    @Test
    void linkAnalysisPersistsUrlAndRejectsCollidingIdsWithoutPartialWrites() {
        try (var s = TestServer.start()) {
            String url = "https://example.org/note";
            var p = publication("link", List.of());
            p.put("kind", "link"); p.put("sourceUrl", url); p.put("message", url);
            assertEquals(201, publish(s, completed(p, TestServer.mockLinkReply(url), 0)).status());
            assertEquals(201, s.post("/records", obj("activityId", "line1-hackathon", "analysisId", p.get("analysisId"))).status());
            assertEquals(url, Js.path(Json.parse((String) s.row("SELECT reply FROM records").get("reply")), "sourceUrl"));
            var collision = publication("another", List.of()); collision.put("analysisId", p.get("analysisId"));
            assertEquals(409, publish(s, collision).status());
            assertEquals(1, count(s, "analyses"));
            var withFile = publication("file", List.of(file("unique-file", "note.txt", new byte[]{1})));
            assertEquals(201, publish(s, withFile).status());
            var duplicateFile = publication("duplicate-file", List.of(file("unique-file", "note.txt", new byte[]{2})));
            assertEquals(409, publish(s, duplicateFile).status());
            assertEquals(2, count(s, "analyses"));
        }
    }

    @Test
    void homeContextUsesNullForEmptyFileAndLinkMessagesWithoutChangingStoredOrPublicValues() {
        try (var s = TestServer.start()) {
            String activityId = "line1-hackathon";
            String caption = "함께 보낸 파일 설명";
            var file = publication("null-file", List.of(file("null-file-original", "note.txt", new byte[]{1})));
            file.put("message", caption);
            assertEquals(201, publish(s, completed(file, TestServer.mockReply("", List.of("note.txt"), false), 0)).status());
            var savedFile = s.post("/records", obj("activityId", activityId, "analysisId", file.get("analysisId")));
            assertEquals(201, savedFile.status());
            String fileRecordId = (String) savedFile.map().get("id");

            String url = "https://example.org/note";
            var link = publication("null-link", List.of());
            link.put("kind", "link"); link.put("message", url); link.put("sourceUrl", url);
            assertEquals(201, publish(s, completed(link, TestServer.mockLinkReply(url), 0)).status());
            var savedLink = s.post("/records", obj("activityId", activityId, "analysisId", link.get("analysisId")));
            assertEquals(201, savedLink.status());
            String linkRecordId = (String) savedLink.map().get("id");

            String text = "  한글과 이모지🙂\n원문 공백 유지  ";
            var savedText = s.post("/records", obj("activityId", activityId, "message", text,
                    "reply", TestServer.mockReply(text, List.of(), false)));
            assertEquals(201, savedText.status());
            String textRecordId = (String) savedText.map().get("id");
            String fingerprint = s.query(db -> com.oneline.api.service.ActivityMetadata.activitySnapshot(db, activityId).fingerprint());

            var context = internal(s, "GET", "/home-context?conversationId=conversation", null);
            assertEquals(200, context.status(), context.text());
            var records = Js.asArray(Js.path(context.map(), "context", "records"));
            assertEquals(3, records.size());
            for (String id : List.of(fileRecordId, linkRecordId)) {
                var record = Js.asObject(records.stream().filter(r -> id.equals(Js.get(r, "id"))).findFirst().orElseThrow());
                assertTrue(record.containsKey("message"));
                assertNull(record.get("message"));
                assertEquals("", s.row("SELECT message FROM records WHERE id = ?", id).get("message"));
                assertEquals("", s.get("/records/" + id).map().get("message"));
            }
            assertEquals(text, Js.get(records.stream().filter(r -> textRecordId.equals(Js.get(r, "id"))).findFirst().orElseThrow(), "message"));
            assertEquals(text, s.row("SELECT message FROM records WHERE id = ?", textRecordId).get("message"));
            assertEquals(text, s.get("/records/" + textRecordId).map().get("message"));
            assertEquals(caption, job(internal(s, "GET", "/chat-jobs/ai-null-file", null)).get("message"));
            assertEquals(url, job(internal(s, "GET", "/chat-jobs/ai-null-link", null)).get("message"));
            var messages = Js.asArray(context.map().get("recentMessages"));
            assertTrue(messages.stream().anyMatch(m -> "user".equals(Js.get(m, "role")) && caption.equals(Js.get(m, "content"))));
            assertTrue(messages.stream().anyMatch(m -> "user".equals(Js.get(m, "role")) && url.equals(Js.get(m, "content"))));
            assertEquals(context.text(), internal(s, "GET", "/home-context?conversationId=conversation", null).text());
            assertEquals(fingerprint, s.query(db -> com.oneline.api.service.ActivityMetadata.activitySnapshot(db, activityId).fingerprint()));
        }
    }
}
