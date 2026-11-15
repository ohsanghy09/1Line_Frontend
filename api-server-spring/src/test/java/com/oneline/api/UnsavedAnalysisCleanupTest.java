package com.oneline.api;

import com.oneline.api.db.Database;
import com.oneline.api.js.Json;
import com.oneline.api.service.UnsavedAnalysisCleanup;
import com.oneline.api.support.EventLoop;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class UnsavedAnalysisCleanupTest {
    private static final Instant NOW = Instant.parse("2026-11-14T00:00:00Z");
    private static final long RETENTION = 86_400_000;

    private static void seed(Database db, String id, String status, boolean old) {
        db.run("INSERT INTO analyses VALUES (?, 'conversation', '', ?, '2000-01-01T00:00:00Z')",
                id, Json.stringify(TestServer.mockReply("", List.of("file.txt"), false)));
        db.run("INSERT INTO files VALUES (?, ?, 'file.txt', 'text/plain', 3, ?)", "file-" + id, id, new byte[]{1, 2, 3});
        if (status != null) db.run("""
                INSERT INTO ai_chat_jobs VALUES (?, ?, 'fingerprint', ?, 'chat', ?, 'analyzing', NULL, '{}',
                    '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z')""", "job-" + id, "request-" + id, id, status);
        if (old) UnsavedAnalysisCleanup.touch(db, id, NOW.toEpochMilli() - RETENTION);
    }

    @Test void onlyExpiredUnsavedTerminalOriginalsAreRemoved() {
        try (var db = Database.open(":memory:"); var cleanup = new UnsavedAnalysisCleanup(db, new EventLoop(), RETENTION, RETENTION)) {
            seed(db, "failed", "failed", true);
            seed(db, "completed", "completed", true);
            seed(db, "queued", "queued", true);
            seed(db, "running", "running", true);
            seed(db, "recent", "failed", false);
            seed(db, "saved", "completed", true);
            seed(db, "legacy-pending", null, true);
            db.run("INSERT INTO analysis_jobs VALUES ('legacy-job', 'legacy-pending', ?, NULL)", NOW.toEpochMilli());
            db.run("INSERT INTO activities (id, name) VALUES ('activity', 'Activity')");
            db.run("INSERT INTO records VALUES ('record', 'activity', 'saved', '', '{}', 'now', 'now')");
            assertEquals(2, cleanup.scan(NOW));
            for (String id : List.of("failed", "completed")) {
                assertNull(db.get("SELECT id FROM analyses WHERE id = ?", id));
                assertNull(db.get("SELECT id FROM files WHERE analysis_id = ?", id));
                assertNull(db.get("SELECT analysis_id FROM analysis_retention WHERE analysis_id = ?", id));
            }
            for (String id : List.of("queued", "running", "recent", "saved", "legacy-pending")) {
                assertNotNull(db.get("SELECT id FROM analyses WHERE id = ?", id));
                assertArrayEquals(new byte[]{1, 2, 3}, (byte[]) db.get("SELECT content FROM files WHERE analysis_id = ?", id).get("content"));
            }
        }
    }

    @Test void legacyFilesReceiveAFullGracePeriodAndTouchCannotMoveTimeBackwards() {
        try (var db = Database.open(":memory:"); var cleanup = new UnsavedAnalysisCleanup(db, new EventLoop(), RETENTION, RETENTION)) {
            seed(db, "legacy", null, false);
            assertEquals(0, cleanup.scan(NOW));
            assertEquals(0, cleanup.scan(NOW.plusMillis(RETENTION - 1)));
            UnsavedAnalysisCleanup.touch(db, "legacy", NOW.toEpochMilli() - RETENTION);
            assertEquals(NOW.toEpochMilli(), ((Number) db.get("SELECT touched_at_ms FROM analysis_retention").get("touched_at_ms")).longValue());
            assertEquals(1, cleanup.scan(NOW.plusMillis(RETENTION)));
        }
    }

    @Test void savingBeforeCleanupProtectsTheOriginalAndCleanupBeforeSavingLeavesNoPartialRecord() {
        try (var db = Database.open(":memory:"); var cleanup = new UnsavedAnalysisCleanup(db, new EventLoop(), RETENTION, RETENTION)) {
            seed(db, "save-first", null, true);
            seed(db, "cleanup-first", null, true);
            db.run("INSERT INTO activities (id, name) VALUES ('activity', 'Activity')");
            db.transaction(() -> db.run("INSERT INTO records VALUES ('saved', 'activity', 'save-first', '', '{}', 'now', 'now')"));
            assertEquals(1, cleanup.scan(NOW));
            assertNotNull(db.get("SELECT id FROM files WHERE analysis_id = 'save-first'"));
            assertThrows(Database.DatabaseError.class, () -> db.transaction(() ->
                    db.run("INSERT INTO records VALUES ('invalid', 'activity', 'cleanup-first', '', '{}', 'now', 'now')")));
            assertNull(db.get("SELECT id FROM records WHERE id = 'invalid'"));
        }
    }

    @Test void failureRollsBackFilesJobsAndTombstonesTogether() {
        try (var db = Database.open(":memory:"); var cleanup = new UnsavedAnalysisCleanup(db, new EventLoop(), RETENTION, RETENTION)) {
            seed(db, "rollback", "failed", true);
            db.run("INSERT INTO internal_chat_publications (job_id, revision, input_signature) VALUES ('job-rollback', 1, 'signature')");
            db.execStatement("CREATE TRIGGER fail_cleanup BEFORE DELETE ON analyses BEGIN SELECT RAISE(ABORT, 'test rollback'); END");
            assertThrows(Database.DatabaseError.class, () -> cleanup.scan(NOW));
            assertNotNull(db.get("SELECT id FROM files WHERE analysis_id = 'rollback'"));
            assertNotNull(db.get("SELECT id FROM ai_chat_jobs WHERE analysis_id = 'rollback'"));
            assertNotNull(db.get("SELECT job_id FROM internal_chat_publications WHERE job_id = 'job-rollback'"));
            assertNull(db.get("SELECT job_id FROM internal_job_tombstones"));
        }
    }

    @Test void restartKeepsRetentionClockRatherThanGrantingANewPeriod() throws Exception {
        var path = java.nio.file.Files.createTempDirectory("cleanup-restart-").resolve("db.sqlite").toString();
        try (var db = Database.open(path)) { seed(db, "restart", "failed", true); }
        try (var db = Database.open(path); var cleanup = new UnsavedAnalysisCleanup(db, new EventLoop(), RETENTION, RETENTION)) {
            assertEquals(1, cleanup.scan(NOW));
        }
    }

    @Test void configuredSchedulerRemovesExpiredDraftsWithoutAUserRequest() {
        try (var s = TestServer.start("oneline.unsaved-cleanup-interval-ms=25", "oneline.unsaved-retention-ms=60000")) {
            var draft = s.draft("conversation", "", TestServer.mockReply("", List.of("orphan.txt"), false), "orphan.txt");
            s.sql(db -> {
                UnsavedAnalysisCleanup.touch(db, draft.analysisId(), 0);
                db.run("UPDATE analysis_retention SET touched_at_ms = 0 WHERE analysis_id = ?", draft.analysisId());
            });
            TestServer.until(() -> s.row("SELECT id FROM analyses WHERE id = ?", draft.analysisId()) == null);
            assertNull(s.row("SELECT id FROM files WHERE analysis_id = ?", draft.analysisId()));
        }
    }
}
