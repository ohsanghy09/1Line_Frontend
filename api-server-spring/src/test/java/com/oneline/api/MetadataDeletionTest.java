package com.oneline.api;

import com.oneline.api.js.Js;
import com.oneline.api.js.Json;
import org.junit.jupiter.api.Test;

import java.util.List;

import static com.oneline.api.js.Js.obj;
import static org.junit.jupiter.api.Assertions.*;

class MetadataDeletionTest {
    private static final String ID = "line1-hackathon";
    private static final String REMAINING = "상태 완료, 역할 API 개발, 기간 2026-09 ~ 2026-11, 남은 원본 요약";

    private static TestServer.Draft save(TestServer s) {
        var draft = s.draft("conversation", "", TestServer.mockReply("", List.of("A.txt", "B.txt", "C.txt"), true), "A.txt", "B.txt", "C.txt");
        assertEquals(201, s.post("/records", obj("activityId", ID, "analysisId", draft.analysisId())).status());
        s.sql(db -> db.run("""
                UPDATE activities SET summary = '삭제 전 요약', status = '진행 중', role = '기존 역할',
                    start_date = '2026-01', end_date = '2026-06', period = '2026-01 ~ 2026-06',
                    metadata_status = 'ready', metadata_model = 'old-model' WHERE id = ?""", ID));
        return draft;
    }

    private static String path(String fileId) { return "/archive/activities/" + ID + "/materials/" + fileId; }

    private static Object remaining(Object raw) {
        var files = Js.asArray(Js.get(raw, "files"));
        var names = files.stream().map(f -> (String) Js.get(f, "name")).toList();
        var reply = TestServer.mockReply("", names, false);
        Js.asObject(reply.get("analysis")).put("summary", REMAINING);
        return obj("reply", reply, "recordReply", Js.get(raw, "recordReply"), "fileIds", files.stream().map(f -> Js.get(f, "id")).toList());
    }

    private static Object metadata(Object raw, boolean confirmed) {
        var record = Js.asArray(Js.get(raw, "records")).getFirst();
        var evidence = List.of(obj("recordId", Js.get(record, "id"), "quote", REMAINING));
        return obj("sourceFingerprint", Js.get(raw, "sourceFingerprint"), "recordCount", Js.get(raw, "recordCount"),
                "model", "test-model", "promptVersion", "activity-metadata-analysis",
                "metadata", obj("summary", obj("value", REMAINING, "evidence", evidence),
                        "role", confirmed ? obj("value", "API 개발", "evidence", evidence) : null,
                        "status", confirmed ? obj("value", "완료", "evidence", evidence) : null,
                        "period", obj("start", confirmed ? obj("value", "2026-09", "evidence", evidence) : null,
                                "end", confirmed ? obj("value", "2026-11", "evidence", evidence) : null)));
    }

    @Test void partialDeletionPreservesValuesAsUnverifiedButLastRecordDeletionClearsThem() {
        try (var ai = new TestServer.FakeAi(); var s = TestServer.start("oneline.ai-base-url=" + ai.url)) {
            var draft = save(s);
            ai.handler = (url, raw) -> new Object[]{200, remaining(raw)};
            assertEquals(200, s.send("DELETE", path(draft.fileIds().getFirst()), obj()).status());
            var activity = s.row("SELECT * FROM activities WHERE id = ?", ID);
            assertNull(activity.get("summary"));
            assertEquals("진행 중", activity.get("status"));
            assertEquals("기존 역할", activity.get("role"));
            assertEquals("2026-01 ~ 2026-06", activity.get("period"));
            var analysis = s.get("/activities/" + ID + "/analysis").map();
            assertEquals(true, analysis.get("stale"));
            assertTrue(((String) analysis.get("error")).contains("임시로 유지"));
            assertEquals(200, s.send("DELETE", path(draft.fileIds().get(1)), obj()).status());
            assertEquals(200, s.send("DELETE", path(draft.fileIds().get(2)), obj()).status());
            activity = s.row("SELECT * FROM activities WHERE id = ?", ID);
            for (String key : List.of("summary", "status", "role", "period", "start_date", "end_date")) assertNull(activity.get(key), key);
            assertEquals(false, s.get("/activities/" + ID + "/analysis").map().get("stale"));
        }
    }

    @Test void missingAiFieldsStayUnverifiedUntilNewEvidenceConfirmsThem() {
        try (var ai = new TestServer.FakeAi(); var s = TestServer.start("oneline.ai-base-url=" + ai.url, "oneline.activity-analysis-delay-ms=5")) {
            var draft = save(s);
            ai.handler = (url, raw) -> new Object[]{200, remaining(raw)};
            assertEquals(200, s.send("DELETE", path(draft.fileIds().getFirst()), obj()).status());
            ai.handler = (url, raw) -> new Object[]{200, metadata(raw, false)};
            assertEquals(202, s.postEmpty("/activities/" + ID + "/analyze").status());
            TestServer.until(() -> "ready".equals(s.get("/activities/" + ID + "/analysis").map().get("status")));
            assertEquals("기존 역할", s.row("SELECT role FROM activities WHERE id = ?", ID).get("role"));
            assertEquals(true, s.get("/activities/" + ID + "/analysis").map().get("stale"));
            ai.handler = (url, raw) -> new Object[]{200, metadata(raw, true)};
            assertEquals(202, s.postEmpty("/activities/" + ID + "/analyze").status());
            TestServer.until(() -> "ready".equals(s.get("/activities/" + ID + "/analysis").map().get("status")));
            var activity = s.row("SELECT * FROM activities WHERE id = ?", ID);
            assertEquals("API 개발", activity.get("role"));
            assertEquals("완료", activity.get("status"));
            assertEquals("2026-09 ~ 2026-11", activity.get("period"));
            assertEquals(false, s.get("/activities/" + ID + "/analysis").map().get("stale"));
        }
    }

    @Test void failedReanalysisPreservesOldValuesAndManualCorrectionConfirmsOnlyEditedFields() {
        try (var ai = new TestServer.FakeAi(); var s = TestServer.start("oneline.ai-base-url=" + ai.url, "oneline.activity-analysis-delay-ms=5")) {
            var draft = save(s);
            ai.handler = (url, raw) -> new Object[]{503, obj("error", "unavailable")};
            assertEquals(502, s.send("DELETE", path(draft.fileIds().getFirst()), obj()).status());
            assertEquals("삭제 전 요약", s.row("SELECT summary FROM activities WHERE id = ?", ID).get("summary"));
            ai.handler = (url, raw) -> new Object[]{200, remaining(raw)};
            assertEquals(200, s.send("DELETE", path(draft.fileIds().getFirst()), obj()).status());
            ai.handler = (url, raw) -> new Object[]{503, obj("error", "unavailable")};
            assertEquals(202, s.postEmpty("/activities/" + ID + "/analyze").status());
            TestServer.until(() -> "failed".equals(s.get("/activities/" + ID + "/analysis").map().get("status")));
            assertEquals("기존 역할", s.row("SELECT role FROM activities WHERE id = ?", ID).get("role"));
            var update = obj("id", "edit", "role", "assistant", "kind", "activity-update", "analysis", null, "content", "수정",
                    "update", obj("activityId", ID, "activityName", "1호선톤", "updates", List.of(obj("field", "role", "value", "직접 수정한 역할"))));
            var edit = s.draft("conversation", "역할 수정", update);
            s.sql(db -> db.run("""
                    INSERT INTO ai_chat_jobs VALUES (?, ?, 'fingerprint', ?, 'chat', 'completed', 'completed', NULL, '{}', ?, ?)
                    """, "job-" + edit.analysisId(), "request-" + edit.analysisId(), edit.analysisId(), Js.nowIso(), Js.nowIso()));
            assertEquals(200, s.post("/activities/apply-chat-update", obj("analysisId", edit.analysisId())).status());
            var fields = Js.asArray(Json.parse((String) s.row("SELECT metadata_review_fields FROM activities WHERE id = ?", ID).get("metadata_review_fields")));
            assertFalse(fields.contains("role"));
            assertTrue(fields.contains("status"));
            assertEquals("직접 수정한 역할", s.row("SELECT role FROM activities WHERE id = ?", ID).get("role"));
        }
    }
}
