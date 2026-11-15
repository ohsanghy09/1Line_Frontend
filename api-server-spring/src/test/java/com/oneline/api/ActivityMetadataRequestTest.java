package com.oneline.api;

import com.oneline.api.js.Js;
import com.oneline.api.js.Json;
import com.oneline.api.service.ActivityMetadata;
import org.junit.jupiter.api.Test;

import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicReference;

import static com.oneline.api.js.Js.obj;
import static org.junit.jupiter.api.Assertions.*;

/** AI 대역은 백엔드 DB를 읽지 않고 실제 HTTP 본문으로만 분석 응답을 구성한다. */
class ActivityMetadataRequestTest {
    private static final String ID = "line1-hackathon";

    private static Map<String, Object> output(Map<String, Object> request) {
        var first = Js.asObject(Js.asArray(request.get("records")).get(0));
        String message = (String) first.get("message");
        Object quote = message.isBlank() ? first.get("summary") : message;
        var evidence = List.of(obj("recordId", first.get("id"), "quote", quote));
        return obj("sourceFingerprint", request.get("sourceFingerprint"), "recordCount", request.get("recordCount"),
                "model", "test-json-only-model", "promptVersion", "activity-metadata-analysis",
                "metadata", obj("summary", obj("value", "전달된 기록을 종합했습니다.", "evidence", evidence),
                        "status", null, "role", null, "period", obj("start", null, "end", null)));
    }

    private static void seed(TestServer s, String id, String message) {
        s.sql(db -> db.run("INSERT INTO records (id, activity_id, analysis_id, message, reply, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?)",
                id, ID, message, Json.stringify(TestServer.mockReply(message, List.of(), true)),
                "2026-11-13T00:00:00.000Z", "2026-11-13T00:00:00.000Z"));
    }

    private static void previous(TestServer s) {
        s.sql(db -> db.run("UPDATE activities SET category = '개발', summary = '기존 요약', role = '기존 역할', status = '진행 중', start_date = '2026-01', end_date = '2026-06' WHERE id = ?", ID));
    }

    private static void analyze(TestServer s) {
        assertEquals(202, s.postEmpty("/activities/" + ID + "/analyze").status());
    }

    private static void await(TestServer s, String status) {
        TestServer.until(() -> status.equals(s.get("/activities/" + ID + "/analysis").map().get("status")));
    }

    @Test
    void sendsCompleteOrderedSnapshotAndOnlyFileMetadataToAnIndependentAi() {
        try (var ai = new TestServer.FakeAi(); var s = TestServer.start("oneline.ai-base-url=" + ai.url, "oneline.activity-analysis-delay-ms=5")) {
            previous(s);
            seed(s, "z-record", "로그인 API를 구현했습니다.");
            seed(s, "a-record", "최종 발표를 맡았습니다.");
            var draft = s.draft("conversation", "파일 첨부 원문", TestServer.mockReply("", List.of("note.txt"), false), "note.txt");
            assertEquals(201, s.post("/records", obj("activityId", ID, "analysisId", draft.analysisId())).status());
            s.sql(db -> db.run("INSERT INTO records VALUES ('unrelated', 'computer-vision', NULL, '다른 활동 원문', ?, ?, ?)",
                    Json.stringify(TestServer.mockReply("다른 활동", List.of(), false)), Js.nowIso(), Js.nowIso()));
            var captured = new AtomicReference<Map<String, Object>>();
            ai.handler = (path, raw) -> {
                if (!path.equals("/api/analyze/activities/" + ID) || !(raw instanceof Map<?, ?>)) return new Object[]{400, obj("error", "missing JSON")};
                var request = Js.asObject(raw); captured.set(request);
                return new Object[]{200, output(request)};
            };
            String expectedHash = s.query(db -> ActivityMetadata.activitySnapshot(db, ID).fingerprint());
            analyze(s); await(s, "ready");
            var request = captured.get(); assertNotNull(request);
            assertEquals(Set.of("activity", "previous", "records", "files", "recordCount", "sourceFingerprint"), request.keySet());
            assertEquals(obj("id", ID, "name", "1호선톤", "category", "개발"), request.get("activity"));
            assertEquals(obj("summary", "기존 요약", "status", "진행 중", "role", "기존 역할", "start_date", "2026-01", "end_date", "2026-06"), request.get("previous"));
            assertEquals(expectedHash, request.get("sourceFingerprint"));
            assertEquals(3, ((Number) request.get("recordCount")).intValue());
            var records = Js.asArray(request.get("records"));
            var ids = records.stream().map(r -> (String) Js.get(r, "id")).toList();
            assertEquals(ids.stream().sorted().toList(), ids);
            assertFalse(ids.contains("unrelated"));
            for (Object r : records) assertEquals(Set.of("id", "message", "summary", "changes", "savedAt", "updatedAt"), Js.asObject(r).keySet());
            assertFalse(Js.asArray(Js.get(records.stream().filter(r -> "a-record".equals(Js.get(r, "id"))).findFirst().orElseThrow(), "changes")).isEmpty());
            var files = Js.asArray(request.get("files"));
            assertEquals(1, files.size());
            var file = Js.asArray(files.get(0));
            assertEquals(3, file.size()); assertEquals(draft.fileIds().get(0), file.get(1)); assertEquals("note.txt", file.get(2));
            assertFalse(Json.stringify(request).contains("contentBase64"));
            assertFalse(Json.stringify(request).contains("content of note.txt"));
            var row = s.row("SELECT * FROM activities WHERE id = ?", ID);
            assertEquals("전달된 기록을 종합했습니다.", row.get("summary"));
            assertEquals("기존 역할", row.get("role")); assertEquals("진행 중", row.get("status"));
            assertEquals("2026-01", row.get("start_date")); assertEquals("2026-06", row.get("end_date"));
            assertEquals(expectedHash, row.get("metadata_fingerprint")); assertEquals(1, ai.calls);
        }
    }

    @Test
    void automaticAnalysisAfterSaveUsesTheSameJsonContractAndNullablePreviousValues() {
        try (var ai = new TestServer.FakeAi(); var s = TestServer.start("oneline.ai-base-url=" + ai.url,
                "oneline.auto-activity-analysis=true", "oneline.activity-analysis-delay-ms=5")) {
            var captured = new AtomicReference<Map<String, Object>>();
            ai.handler = (path, raw) -> {
                var request = Js.asObject(raw); captured.set(request);
                return new Object[]{200, output(request)};
            };
            assertEquals(201, s.post("/records", obj("activityId", ID, "message", "실제 작업 경험",
                    "reply", TestServer.mockReply("실제 작업 경험", List.of(), false))).status());
            await(s, "ready");
            var prior = Js.asObject(captured.get().get("previous"));
            assertEquals(Set.of("summary", "status", "role", "start_date", "end_date"), prior.keySet());
            assertTrue(prior.values().stream().allMatch(Objects::isNull));
            assertNull(Js.path(captured.get(), "activity", "category"));
            assertEquals(1, ai.calls);
        }
    }

    @Test
    void refusesRecordAndJsonLimitsBeforeHttpAndPreservesExistingInformation() {
        try (var ai = new TestServer.FakeAi(); var s = TestServer.start("oneline.ai-base-url=" + ai.url, "oneline.activity-analysis-delay-ms=5")) {
            previous(s);
            for (int i = 0; i < 101; i++) seed(s, "record-" + i, "원문");
            analyze(s); await(s, "failed");
            assertEquals(0, ai.calls);
            assertEquals("기존 요약", s.row("SELECT summary FROM activities WHERE id = ?", ID).get("summary"));
            s.sql(db -> db.exec("DELETE FROM records"));
            for (int i = 0; i < 14; i++) seed(s, "large-" + i, "x".repeat(19000));
            analyze(s); await(s, "failed");
            assertEquals(0, ai.calls);
            assertEquals("기존 역할", s.row("SELECT role FROM activities WHERE id = ?", ID).get("role"));
        }
    }

    @Test
    void rejectsWrongHashCountEvidenceAndDateAndPreservesRecordsAndMetadata() {
        try (var ai = new TestServer.FakeAi(); var s = TestServer.start("oneline.ai-base-url=" + ai.url, "oneline.activity-analysis-delay-ms=5")) {
            previous(s); seed(s, "record", "실제 기록 원문");
            for (String invalid : List.of("hash", "count", "evidence", "date", "http")) {
                ai.handler = (path, raw) -> {
                    var response = output(Js.asObject(raw));
                    switch (invalid) {
                        case "hash" -> response.put("sourceFingerprint", "0".repeat(64));
                        case "count" -> response.put("recordCount", 2);
                        case "evidence" -> Js.asObject(Js.path(response, "metadata", "summary")).put("evidence", List.of(obj("recordId", "record", "quote", "없는 인용문")));
                        case "date" -> Js.asObject(Js.path(response, "metadata", "period")).put("start", obj("value", "2026-02-30", "evidence", Js.path(response, "metadata", "summary", "evidence")));
                        case "http" -> { return new Object[]{503, obj("error", "unavailable")}; }
                    }
                    return new Object[]{200, response};
                };
                analyze(s); await(s, "failed");
                assertEquals("기존 요약", s.row("SELECT summary FROM activities WHERE id = ?", ID).get("summary"), invalid);
                assertEquals("실제 기록 원문", s.row("SELECT message FROM records WHERE id = 'record'").get("message"));
            }
            assertEquals(5, ai.calls);
        }
    }

    @Test
    void changedRecordRejectsTheOldResultAndReschedulesWithTheNewBody() {
        try (var ai = new TestServer.FakeAi(); var s = TestServer.start("oneline.ai-base-url=" + ai.url, "oneline.activity-analysis-delay-ms=5")) {
            seed(s, "record", "이전 원문");
            var captured = new CopyOnWriteArrayList<Map<String, Object>>();
            ai.handler = (path, raw) -> {
                var request = Js.asObject(raw); captured.add(request);
                if (captured.size() == 1) s.sql(db -> db.run("UPDATE records SET message = '변경된 원문', updated_at = '2026-11-13T01:00:00.000Z' WHERE id = 'record'"));
                return new Object[]{200, output(request)};
            };
            analyze(s); await(s, "ready");
            assertEquals(2, captured.size());
            assertEquals("이전 원문", Js.get(Js.asArray(captured.get(0).get("records")).get(0), "message"));
            assertEquals("변경된 원문", Js.get(Js.asArray(captured.get(1).get("records")).get(0), "message"));
            assertNotEquals(captured.get(0).get("sourceFingerprint"), captured.get(1).get("sourceFingerprint"));
            assertEquals(captured.get(1).get("sourceFingerprint"), s.row("SELECT metadata_fingerprint FROM activities WHERE id = ?", ID).get("metadata_fingerprint"));
        }
    }

    @Test
    void rejectsOtherPromptVersionsWithoutReplacingSavedMetadata() {
        try (var ai = new TestServer.FakeAi(); var s = TestServer.start("oneline.ai-base-url=" + ai.url, "oneline.activity-analysis-delay-ms=5")) {
            previous(s); seed(s, "record", "실제 기록 원문");
            ai.handler = (path, raw) -> new Object[]{200, output(Js.asObject(raw))};
            analyze(s); await(s, "ready");
            var saved = s.row("SELECT summary, role, status, start_date, end_date, metadata_fingerprint, metadata_model, metadata_updated_at FROM activities WHERE id = ?", ID);
            assertEquals("전달된 기록을 종합했습니다.", saved.get("summary"));
            for (String version : Arrays.asList("activity-metadata-v1", "journey-v6", "", null, "__missing__")) {
                ai.handler = (path, raw) -> {
                    var response = output(Js.asObject(raw));
                    if ("__missing__".equals(version)) response.remove("promptVersion");
                    else response.put("promptVersion", version);
                    return new Object[]{200, response};
                };
                analyze(s); await(s, "failed");
                assertEquals(saved, s.row("SELECT summary, role, status, start_date, end_date, metadata_fingerprint, metadata_model, metadata_updated_at FROM activities WHERE id = ?", ID), String.valueOf(version));
                assertEquals("실제 기록 원문", s.row("SELECT message FROM records WHERE id = 'record'").get("message"));
            }
            assertEquals(6, ai.calls);
        }
    }
}
