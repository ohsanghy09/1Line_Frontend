package com.oneline.api;

import com.oneline.api.js.Js;
import com.oneline.api.js.Json;
import com.oneline.api.service.ActivityMetadata;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static com.oneline.api.TestServer.mockLinkReply;
import static com.oneline.api.TestServer.mockReply;
import static com.oneline.api.js.Js.arr;
import static com.oneline.api.js.Js.obj;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 기존 api-server/test/*.test.js 의 주요 시나리오를 Spring 서버에 대해 다시 검증한다. */
class ApiTest {

    private static Object at(Object value, Object... path) {
        Object current = value;
        for (Object key : path) current = Js.get(current, key instanceof Integer i ? String.valueOf(i) : (String) key);
        return current;
    }

    private static double count(TestServer server, String table) {
        return ((Number) server.row("SELECT COUNT(*) AS n FROM " + table).get("n")).doubleValue();
    }

    @Test
    void 원본_대화_보관_기록_중복방지_수정_Timeline() {
        try (TestServer s = TestServer.start()) {
            var draft = s.draft("test-conversation", "회의 자료입니다.", mockReply("회의 자료입니다.", List.of("회의록.txt"), false), "회의록.txt");
            assertEquals("content of 회의록.txt", s.get("/files/" + draft.fileIds().get(0)).text());
            assertEquals("attachment; filename=\"download\"; filename*=UTF-8''%ED%9A%8C%EC%9D%98%EB%A1%9D.txt",
                    s.get("/files/" + draft.fileIds().get(0)).header("Content-Disposition"));
            assertEquals(1, s.get("/conversations/test-conversation/messages").list().size());
            assertEquals(List.of(), s.get("/activities/line1-hackathon/records").list());

            var save = obj("activityId", "line1-hackathon", "analysisId", draft.analysisId());
            var savedResponse = s.post("/records", save);
            assertEquals(201, savedResponse.status());
            var saved = savedResponse.map();
            assertEquals("", saved.get("message"));
            assertEquals("existing", at(saved, "reply", "analysis", "activity", "match"));
            assertEquals(false, at(saved, "reply", "activityCreated"));
            assertEquals("회의 자료입니다.", s.row("SELECT message FROM analyses WHERE id = ?", draft.analysisId()).get("message"));
            assertEquals(409, s.post("/records", save).status());
            assertEquals(List.of(), s.get("/activities/line1-hackathon/timeline").list());

            var change = obj("before", "이전", "after", "이후", "category", "범위 변경", "evidence", arr("회의 자료"));
            var patched = s.send("PATCH", "/records/" + saved.get("id"), obj("activityId", "computer-vision", "materialType", "회의록", "changes", arr(change)));
            assertEquals(200, patched.status());
            var events = s.get("/activities/computer-vision/timeline").list();
            assertEquals(1, events.size());
            assertEquals(false, at(events.get(0), "isTurningPoint"));
            assertEquals(List.of(), s.get("/activities/line1-hackathon/records").list());
            assertEquals(404, s.send("PATCH", "/records/" + saved.get("id"), obj("activityId", "missing")).status());

            var invalid = s.post("/records", obj("activityId", "line1-hackathon", "reply", obj()));
            assertEquals(400, invalid.status());
            assertTrue(((String) invalid.map().get("error")).startsWith("[\n  {\n    \"expected\": \"string\",\n    \"code\": \"invalid_type\",\n    \"path\": [\n      \"reply\",\n      \"id\"\n    ],\n    \"message\": \"Invalid input: expected string, received undefined\"\n  },"),
                    (String) invalid.map().get("error"));

            var previewReply = new LinkedHashMap<>(draft.reply());
            var previewAnalysis = new LinkedHashMap<>(Js.asObject(previewReply.get("analysis")));
            previewAnalysis.put("changes", arr(change));
            previewReply.put("analysis", previewAnalysis);
            assertEquals(201, s.post("/records", obj("activityId", "line1-hackathon", "reply", previewReply)).status());
            assertEquals(1, s.get("/activities/line1-hackathon/timeline").list().size());
            s.send("PATCH", "/records/" + saved.get("id"), obj("changes", arr()));
            assertEquals(List.of(), s.get("/activities/computer-vision/timeline").list());
            assertEquals(2.0, count(s, "records"));
        }
    }

    @Test
    void 저장_검증과_새_활동_생성() {
        try (TestServer s = TestServer.start()) {
            var reply = mockReply("경험", List.of(), false);
            var both = s.post("/records", obj("activityId", "line1-hackathon", "analysisId", "x", "reply", reply));
            assertEquals(400, both.status());
            assertEquals("[\n  {\n    \"code\": \"custom\",\n    \"path\": [],\n    \"message\": \"analysisId 또는 reply 중 하나를 보내주세요.\"\n  }\n]", both.map().get("error"));
            var unknown = s.post("/records", obj("activityId", "line1-hackathon", "reply", reply, "extra", 1));
            assertEquals("[\n  {\n    \"code\": \"unrecognized_keys\",\n    \"keys\": [\n      \"extra\"\n    ],\n    \"path\": [],\n    \"message\": \"Unrecognized key: \\\"extra\\\"\"\n  }\n]", unknown.map().get("error"));

            var created = s.post("/records", obj("newActivity", obj("name", "  새 활동  ", "category", "프로젝트", "status", "진행 중",
                    "role", null, "period", obj("start", "2026-01", "end", null), "summary", null), "reply", reply));
            assertEquals(201, created.status());
            assertEquals(true, at(created.json(), "reply", "activityCreated"));
            assertEquals("새 활동 활동에 자료를 기록했어요.", at(created.json(), "reply", "content"));
            var activity = s.row("SELECT * FROM activities WHERE name = ?", "새 활동");
            assertEquals("프로젝트", activity.get("category"));
            assertEquals("2026-01 ~ ", activity.get("period"));
            assertEquals(409, s.post("/records", obj("newActivity", obj("name", "새 활동", "category", null, "status", null,
                    "role", null, "period", null, "summary", null), "reply", reply)).status());

            var badDate = s.post("/records", obj("activityId", "line1-hackathon", "reply", reply,
                    "activityUpdates", obj("category", null, "status", null, "role", null, "period", obj("start", "2026-02-30", "end", null), "summary", null)));
            assertEquals(400, badDate.status());
            assertTrue(((String) badDate.map().get("error")).contains("유효한 날짜를 입력해 주세요."));

            var link = s.post("/records", obj("activityId", "line1-hackathon", "reply", mockLinkReply("ftp://example.com")));
            assertEquals(400, link.status());
            assertTrue(((String) link.map().get("error")).contains("HTTP 또는 HTTPS 링크를 입력해 주세요."));
            var linkOk = s.post("/records", obj("activityId", "line1-hackathon", "message", "링크 설명", "reply", mockLinkReply("  https://example.com/a  ")));
            assertEquals(201, linkOk.status());
            assertEquals("https://example.com/a", at(linkOk.json(), "reply", "sourceUrl"));
            assertEquals("", at(linkOk.json(), "message"));

            var classified = s.post("/records", obj("activityId", "line1-hackathon", "reply", mockReply("x", List.of("a.txt", "b.txt"), false),
                    "classification", obj("materialType", "회의록")));
            assertEquals("회의록", at(classified.json(), "reply", "analysis", "files", 1, "materialType"));
            assertEquals(Json.stringify(arr(obj("materialType", "회의록", "count", 2.0))), Json.stringify(at(classified.json(), "reply", "analysis", "groups")));
        }
    }

    @Test
    void 아카이브_집계와_자료_상세() {
        try (TestServer s = TestServer.start()) {
            var listing = s.get("/archive/activities").map();
            assertEquals(5.0, listing.get("total"));
            for (Object item : Js.asArray(listing.get("items"))) {
                assertEquals(0.0, at(item, "materialsCount"));
                assertNull(at(item, "updatedAt"));
                assertEquals("미설정", at(item, "status"));
            }
            s.sql(db -> db.run("UPDATE activities SET category = ?, status = ?, role = ?, period = ?, summary = ? WHERE id = ?",
                    "프로젝트", "진행 중", "개발", "2026.11 ~", "저장된 활동 요약", "line1-hackathon"));
            var draft = s.draft("c1", "실제 입력한 자료 설명", mockReply("x", List.of("실제 기획.txt", "두번째.txt"), true), "실제 기획.txt", "두번째.txt");
            var saved = s.post("/records", obj("activityId", "line1-hackathon", "analysisId", draft.analysisId())).map();
            var detail = s.get("/archive/activities/line1-hackathon").map();
            assertEquals(2.0, detail.get("materialsCount"));
            assertEquals("저장된 활동 요약", detail.get("summary"));
            assertEquals(1, Js.asArray(detail.get("timeline")).size());
            assertEquals(saved.get("updatedAt"), detail.get("updatedAt"));
            assertEquals("line1-hackathon:%EA%B8%B0%ED%83%80%20%EC%9E%90%EB%A3%8C", at(detail, "folders", 0, "id"));
            assertEquals(new ArrayList<Object>(draft.fileIds()), at(detail, "timeline", 0, "evidenceFileIds"));
            var file = s.get("/archive/activities/line1-hackathon/materials/" + draft.fileIds().get(0)).map();
            assertEquals("실제 기획.txt", at(file, "file", "name"));
            assertEquals("record", at(file, "file", "summaryScope"));
            assertEquals(1, Js.asArray(file.get("events")).size());
            assertEquals(404, s.get("/archive/activities/computer-vision/materials/" + draft.fileIds().get(0)).status());
            assertEquals(404, s.get("/archive/activities/unknown").status());

            s.send("PATCH", "/records/" + saved.get("id"), obj("activityId", "computer-vision", "materialType", "회의록", "summary", "수정된 기록 요약"));
            assertEquals(0.0, s.get("/archive/activities/line1-hackathon").map().get("materialsCount"));
            var moved = s.get("/archive/activities/computer-vision").map();
            assertEquals("회의록", at(moved, "folders", 0, "name"));
            assertEquals("수정된 기록 요약", at(moved, "folders", 0, "files", 0, "summary"));

            var recent = s.get("/home/recent").map();
            assertEquals(2, Js.asArray(recent.get("records")).size());
            assertEquals("computer-vision", at(recent, "activities", 0, "id"));
            assertFalse(Js.asObject(at(recent, "activities", 0)).containsKey("folders"));
        }
    }

    @Test
    void 검색_필터_정렬과_쿼리_검증() {
        try (TestServer s = TestServer.start()) {
            s.sql(db -> {
                db.run("UPDATE activities SET category = ?, status = ?, summary = ? WHERE id = ?", "프로젝트", "진행 중", "활동 전체 전용 요약", "line1-hackathon");
                db.run("UPDATE activities SET category = ?, status = ? WHERE id = ?", "전공수업", "완료", "computer-vision");
            });
            var draft = s.draft("c", "입력 전용 사용자 인터뷰", mockReply("x", List.of("Research & Notes.pdf", "다른 자료.pdf"), false),
                    "Research & Notes.pdf", "다른 자료.pdf");
            assertEquals(List.of(), s.get("/archive/activities?q=Research").map().get("items"));
            s.post("/records", obj("activityId", "line1-hackathon", "analysisId", draft.analysisId()));
            var reply = mockReply("기록", List.of(), false);
            Js.asObject(reply.get("analysis")).put("summary", "저장 요약 전용 문구");
            s.post("/records", obj("activityId", "computer-vision", "message", "독립 텍스트", "reply", reply));

            for (String q : List.of("1호선톤", "%ED%99%9C%EB%8F%99%20%EC%A0%84%EC%B2%B4", "++rEsEaRcH+++%26+++NOTES.pdf+")) {
                var result = s.get("/archive/activities?q=" + q).map();
                assertEquals(1, Js.asArray(result.get("items")).size(), q);
                assertEquals("line1-hackathon", at(result, "items", 0, "id"));
                assertEquals(5.0, result.get("total"));
            }
            assertEquals(List.of(), s.get("/archive/activities?q=%EC%9E%85%EB%A0%A5%20%EC%A0%84%EC%9A%A9").map().get("items"));
            assertEquals("computer-vision", at(s.get("/archive/activities?q=%EB%8F%85%EB%A6%BD").json(), "items", 0, "id"));
            assertEquals(List.of("전공수업", "프로젝트", "미분류").size(), Js.asArray(s.get("/archive/activities").map().get("categories")).size());
            assertEquals(List.of("미분류", "전공수업", "프로젝트"), s.get("/archive/activities").map().get("categories"));
            assertEquals("line1-hackathon", at(s.get("/archive/activities?sort=materials").json(), "items", 0, "id"));
            for (String query : List.of("sort=invalid", "status=invalid", "q=a&q=b", "q=" + "a".repeat(501), "unknown=1", "category=")) {
                assertEquals(400, s.get("/archive/activities?" + query).status(), query);
            }
            assertEquals("[\n  {\n    \"code\": \"invalid_value\",\n    \"values\": [\n      \"recent\",\n      \"materials\",\n      \"oldest\"\n    ],\n    \"path\": [\n      \"sort\"\n    ],\n    \"message\": \"Invalid option: expected one of \\\"recent\\\"|\\\"materials\\\"|\\\"oldest\\\"\"\n  }\n]",
                    s.get("/archive/activities?sort=invalid").map().get("error"));
        }
    }

    @Test
    void 활동_삭제와_자료_삭제() {
        try (TestServer.FakeAi ai = new TestServer.FakeAi();
             TestServer s = TestServer.start("oneline.ai-base-url=" + ai.url)) {
            ai.handler = (path, body) -> {
                String recordId = path.split("/")[4];
                Map<String, Object> record = s.query(db -> db.get("SELECT * FROM records WHERE id = ?", recordId));
                List<Map<String, Object>> remaining = s.query(db -> db.all("SELECT id, name FROM files WHERE analysis_id = ? AND id != ? ORDER BY rowid",
                        record.get("analysis_id"), Js.get(body, "fileId")));
                Map<String, Object> reply = Js.asObject(Json.parse((String) record.get("reply")));
                Map<String, Object> analysis = Js.asObject(reply.get("analysis"));
                analysis.put("summary", "남은 자료만의 새 요약");
                analysis.put("changes", new ArrayList<>());
                List<Object> files = new ArrayList<>(), ids = new ArrayList<>();
                for (Map<String, Object> f : remaining) {
                    files.add(obj("name", f.get("name"), "materialType", analysis.get("materialType"), "previousVersion", null));
                    ids.add(f.get("id"));
                }
                analysis.put("files", files);
                analysis.put("groups", arr(obj("materialType", analysis.get("materialType"), "count", (double) remaining.size())));
                return new Object[]{200, obj("recordReply", record.get("reply"), "fileIds", ids, "reply", reply)};
            };
            var target = s.draft("conv-1", "실제 경험 설명", mockReply("x", List.of("a.txt", "b.txt"), true), "a.txt", "b.txt");
            var targetRecord = s.post("/records", obj("analysisId", target.analysisId(), "activityId", "line1-hackathon")).map();
            var other = s.draft("conv-2", "다른 설명", mockReply("x", List.of("other.txt"), true), "other.txt");
            s.post("/records", obj("analysisId", other.analysisId(), "activityId", "computer-vision"));

            // 다중 파일 중 하나 삭제 → AI 재분석 결과로 교체
            var path = "/archive/activities/line1-hackathon/materials/" + target.fileIds().get(0);
            assertEquals(404, s.send("DELETE", path.replace("line1-hackathon", "computer-vision"), obj()).status());
            assertEquals(200, s.send("DELETE", path, obj()).status());
            assertEquals(1, ai.calls);
            var activity = s.get("/archive/activities/line1-hackathon").map();
            assertEquals(1.0, activity.get("materialsCount"));
            assertEquals("남은 자료만의 새 요약", at(activity, "folders", 0, "files", 0, "summary"));
            assertEquals(List.of(), activity.get("timeline"));
            assertEquals("general", at(s.get("/conversations/conv-1/messages").json(), 0, "reply", "kind"));

            s.sql(db -> db.run("INSERT INTO journey_analyses (id, source_fingerprint, record_count, result_json, model, prompt_version, created_at, criteria_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", "j1", "old", 3.0, Json.stringify(obj(
                    "source", "api", "summary", obj("title", "삭제할 근거", "description", "기존 요약"), "badges", arr(), "events", arr(),
                    "typeOptions", arr(obj("value", "all", "label", "전체")), "axisOptions", arr(obj("value", "all", "label", "전체 분야")))),
                    "test", "journey-v6", Js.nowIso(), "growth-criteria-v1"));
            assertEquals(400, s.send("DELETE", "/archive/activities/line1-hackathon", obj("confirmation", "잘못된 이름")).status());
            assertEquals(200, s.send("DELETE", "/archive/activities/line1-hackathon", obj("confirmation", "1호선톤")).status());
            assertEquals(404, s.get("/archive/activities/line1-hackathon").status());
            assertEquals(404, s.get("/records/" + targetRecord.get("id")).status());
            assertEquals(404, s.get("/files/" + target.fileIds().get(1)).status());
            assertEquals(200, s.get("/files/" + other.fileIds().get(0)).status());
            assertEquals(400, s.post("/records", obj("analysisId", target.analysisId(), "activityId", "computer-vision")).status());
            var journey = s.get("/journey").map();
            assertEquals(true, at(journey, "analysis", "stale"));
            assertTrue(((String) at(journey, "summary", "description")).contains("갱신"));

            // 마지막 파일 삭제 → 기록 삭제, 메타정보 초기화
            s.sql(db -> db.run("UPDATE activities SET summary = '이전 요약', role = '개발', status = '완료' WHERE id = 'computer-vision'"));
            assertEquals(200, s.send("DELETE", "/archive/activities/computer-vision/materials/" + other.fileIds().get(0), obj()).status());
            var cv = s.get("/archive/activities/computer-vision").map();
            assertEquals(0.0, cv.get("recordsCount"));
            assertEquals("미설정", cv.get("role"));
            assertEquals("idle", at(cv, "metadataAnalysis", "status"));

            // 링크 기록 삭제
            var link = s.post("/records", obj("activityId", "computer-vision", "reply", mockLinkReply("https://example.com"))).map();
            assertEquals(200, s.send("DELETE", "/archive/activities/computer-vision/materials/" + Js.encodeURIComponent("record:" + link.get("id")), obj()).status());
            assertEquals(0.0, s.get("/archive/activities/computer-vision").map().get("recordsCount"));
        }
    }

    @Test
    void 자료_삭제_재분석_실패와_동시_수정은_보존() {
        try (TestServer.FakeAi ai = new TestServer.FakeAi();
             TestServer s = TestServer.start("oneline.ai-base-url=" + ai.url)) {
            ai.handler = (path, body) -> new Object[]{503, obj("error", "test")};
            var draft = s.draft("c", "설명", mockReply("x", List.of("a.txt", "b.txt"), true), "a.txt", "b.txt");
            var record = s.post("/records", obj("analysisId", draft.analysisId(), "activityId", "line1-hackathon")).map();
            var path = "/archive/activities/line1-hackathon/materials/" + draft.fileIds().get(0);
            var failed = s.send("DELETE", path, obj());
            assertEquals(502, failed.status());
            assertEquals("남은 파일의 분석 결과를 확인하지 못해 삭제하지 않았어요. 다시 시도해 주세요.", failed.map().get("error"));
            assertEquals(2.0, s.get("/archive/activities/line1-hackathon").map().get("materialsCount"));

            ai.handler = (p, body) -> {
                Map<String, Object> row = s.query(db -> db.get("SELECT * FROM records WHERE id = ?", record.get("id")));
                Map<String, Object> reply = Js.asObject(Json.parse((String) row.get("reply")));
                Map<String, Object> analysis = Js.asObject(reply.get("analysis"));
                analysis.put("files", new ArrayList<>(Js.asArray(analysis.get("files")).subList(1, 2)));
                analysis.put("changes", new ArrayList<>());
                s.sql(db -> db.run("UPDATE records SET updated_at = ? WHERE id = ?", "changed", record.get("id")));
                return new Object[]{200, obj("recordReply", row.get("reply"), "fileIds", arr(draft.fileIds().get(1)), "reply", reply)};
            };
            assertEquals(409, s.send("DELETE", path, obj()).status());
            assertEquals(2.0, s.get("/archive/activities/line1-hackathon").map().get("materialsCount"));

            s.sql(db -> db.execStatement("CREATE TRIGGER reject_activity_delete BEFORE DELETE ON activities BEGIN SELECT RAISE(ABORT, 'test rollback'); END"));
            var error = s.send("DELETE", "/archive/activities/line1-hackathon", obj("confirmation", "1호선톤"));
            assertEquals(500, error.status());
            assertEquals("서버 처리 중 오류가 발생했습니다.", error.map().get("error"));
            assertEquals(2.0, ((Number) s.row("SELECT count(*) AS n FROM files WHERE analysis_id = ?", draft.analysisId()).get("n")).doubleValue());
            assertNotEquals("general", Js.get(Json.parse((String) s.row("SELECT reply FROM analyses WHERE id = ?", draft.analysisId()).get("reply")), "kind"));
        }
    }

    @Test
    void 전체_삭제는_확인문구_진행작업_원자성() {
        try (TestServer s = TestServer.start()) {
            s.sql(db -> db.exec("""
                    INSERT INTO analyses VALUES ('a', 'c', 'message', '{}', '2026-11-06');
                    INSERT INTO files VALUES ('f', 'a', 'file.txt', 'text/plain', 1, X'61');
                    INSERT INTO records VALUES ('r', 'line1-hackathon', 'a', 'message', '{}', '2026-11-06', '2026-11-06');
                    INSERT INTO timeline_events VALUES ('t', 'r', '{}', 0, '2026-11-06');
                    INSERT INTO analysis_jobs VALUES ('j', 'a', 0, NULL);
                    INSERT INTO ai_chat_jobs VALUES ('ai', 'key', 'fingerprint', 'a', 'text', 'running', 'analyzing', NULL, '{}', '2026-11-06', '2026-11-06');
                    INSERT INTO journey_analyses (id, source_fingerprint, record_count, result_json, model, prompt_version, created_at) VALUES ('g', 'fingerprint', 1, '{}', 'test', 'test', '2026-11-06');"""));
            assertEquals(400, s.post("/settings/reset-data", obj("confirmation", "잘못된 문구")).status());
            assertEquals(409, s.post("/settings/reset-data", obj("confirmation", "전체 삭제")).status());
            assertEquals(1.0, count(s, "records"));
            s.sql(db -> {
                db.exec("UPDATE ai_chat_jobs SET status = 'completed'");
                db.execStatement("CREATE TRIGGER prevent_reset BEFORE DELETE ON activities BEGIN SELECT RAISE(ABORT, 'test rollback'); END");
            });
            assertEquals(500, s.post("/settings/reset-data", obj("confirmation", "전체 삭제")).status());
            assertEquals(1.0, count(s, "records"));
            assertEquals(1.0, count(s, "files"));
            s.sql(db -> db.exec("DROP TRIGGER prevent_reset"));
            var result = s.post("/settings/reset-data", obj("confirmation", "전체 삭제"));
            assertEquals(200, result.status());
            assertEquals("{\"deleted\":true}", result.text());
            for (String table : List.of("activities", "analyses", "files", "records", "timeline_events", "analysis_jobs", "ai_chat_jobs", "journey_analyses")) {
                assertEquals(0.0, count(s, table), table);
            }
            assertEquals("[]", s.get("/activities").text());
        }
    }

    @Test
    void 활동_정보_자동_분석() {
        try (TestServer.FakeAi ai = new TestServer.FakeAi();
             TestServer s = TestServer.start("oneline.ai-base-url=" + ai.url, "oneline.auto-activity-analysis=true",
                     "oneline.activity-analysis-delay-ms=5")) {
            ai.handler = (path, body) -> {
                String id = java.net.URLDecoder.decode(path.substring(path.lastIndexOf('/') + 1), java.nio.charset.StandardCharsets.UTF_8);
                ActivityMetadata.Snapshot snapshot = s.query(db -> ActivityMetadata.activitySnapshot(db, id));
                List<Object> first = Js.asArray(snapshot.records().get(0));
                var ref = arr(obj("recordId", first.get(0), "quote", first.get(1)));
                return new Object[]{200, obj("sourceFingerprint", snapshot.fingerprint(), "recordCount", (double) snapshot.records().size(),
                        "model", "test-model", "promptVersion", "activity-metadata-analysis", "metadata", obj(
                                "summary", obj("value", "자료 " + snapshot.records().size() + "개를 종합했어요.", "evidence", ref),
                                "role", obj("value", "개발", "evidence", ref), "status", obj("value", "진행 중", "evidence", ref),
                                "period", obj("start", obj("value", "2026-01", "evidence", ref), "end", null)))};
            };
            String message = "2026년 1월부터 개발을 담당하며 진행 중이에요.";
            assertEquals(201, s.post("/records", obj("activityId", "line1-hackathon", "message", message, "reply", mockReply(message, List.of(), false))).status());
            TestServer.until(() -> "ready".equals(s.get("/activities/line1-hackathon/analysis").map().get("status")));
            var row = s.row("SELECT * FROM activities WHERE id = 'line1-hackathon'");
            assertEquals("자료 1개를 종합했어요.", row.get("summary"));
            assertEquals("개발", row.get("role"));
            assertEquals("진행 중", row.get("status"));
            assertEquals("2026-01", row.get("start_date"));
            assertNull(row.get("end_date"));
            assertEquals("2026-01 ~ ", row.get("period"));
            assertEquals(false, s.get("/activities/line1-hackathon/analysis").map().get("stale"));
            assertEquals(1, ai.calls);
            assertEquals(404, s.postEmpty("/activities/missing/analyze").status());
            assertEquals(422, s.postEmpty("/activities/computer-vision/analyze").status());

            // 근거 위조 → failed, 기존 정보 보존
            ai.handler = (path, body) -> {
                ActivityMetadata.Snapshot snapshot = s.query(db -> ActivityMetadata.activitySnapshot(db, "line1-hackathon"));
                var ref = arr(obj("recordId", Js.asArray(snapshot.records().get(0)).get(0), "quote", "없는 문장"));
                return new Object[]{200, obj("sourceFingerprint", snapshot.fingerprint(), "recordCount", 1.0, "model", "m",
                        "promptVersion", "activity-metadata-analysis", "metadata", obj("summary", obj("value", "위조", "evidence", ref),
                                "role", null, "status", null, "period", obj("start", null, "end", null)))};
            };
            s.sql(db -> db.run("UPDATE records SET updated_at = ?", "2026-11-08T00:00:00.000Z"));
            assertEquals(202, s.postEmpty("/activities/line1-hackathon/analyze").status());
            TestServer.until(() -> "failed".equals(s.get("/activities/line1-hackathon/analysis").map().get("status")));
            assertEquals("자료 1개를 종합했어요.", s.row("SELECT summary FROM activities WHERE id = 'line1-hackathon'").get("summary"));
            assertEquals(true, s.get("/activities/line1-hackathon/analysis").map().get("stale"));
        }
    }

    @Test
    void 대화로_활동_정보_수정() {
        try (TestServer s = TestServer.start()) {
            java.util.function.BiConsumer<String, List<Object>> command = (id, updates) -> s.sql(db -> {
                String now = Js.nowIso();
                var reply = obj("id", "reply-" + id, "role", "assistant", "kind", "activity-update", "analysis", null,
                        "content", "활동 정보를 수정하고 있어요.", "update", obj("activityId", "line1-hackathon", "activityName", "잘못된 모델 표시명", "updates", updates));
                db.run("INSERT INTO analyses VALUES (?, ?, ?, ?, ?)", id, "chat-edit", "역할을 팀장으로 바꿔줘", Json.stringify(reply), now);
                db.run("INSERT INTO ai_chat_jobs VALUES (?, ?, ?, ?, 'chat', 'completed', 'completed', NULL, '{}', ?, ?)", "job-" + id, id, id, id, now, now);
            });
            command.accept("role-edit", arr(obj("field", "role", "value", "팀장")));
            var result = s.post("/activities/apply-chat-update", obj("analysisId", "role-edit"));
            assertEquals(200, result.status());
            assertEquals("general", at(result.json(), "reply", "kind"));
            assertEquals("1호선톤 활동 정보를 수정했어요.\n역할: 팀장", at(result.json(), "reply", "content"));
            assertFalse(result.map().containsKey("changed"));
            assertEquals("팀장", s.row("SELECT role FROM activities WHERE id = 'line1-hackathon'").get("role"));
            assertEquals(result.text(), s.post("/activities/apply-chat-update", obj("analysisId", "role-edit")).text());

            command.accept("period", arr(obj("field", "startDate", "value", "2026-03"), obj("field", "endDate", "value", "2026-06"), obj("field", "status", "value", "완료")));
            assertEquals(200, s.post("/activities/apply-chat-update", obj("analysisId", "period")).status());
            assertEquals("2026-03 ~ 2026-06", s.row("SELECT period FROM activities WHERE id = 'line1-hackathon'").get("period"));
            command.accept("bad-period", arr(obj("field", "role", "value", "반영되면 안 됨"), obj("field", "startDate", "value", "2027-01")));
            var bad = s.post("/activities/apply-chat-update", obj("analysisId", "bad-period"));
            assertEquals(400, bad.status());
            assertEquals("기간을 수정하지 못했어요. 유효한 날짜이며 시작일이 종료일보다 앞서는지 확인해 주세요.", bad.map().get("error"));
            assertEquals("팀장", s.row("SELECT role FROM activities WHERE id = 'line1-hackathon'").get("role"));
            command.accept("dup", arr(obj("field", "role", "value", "a"), obj("field", "role", "value", "b")));
            assertEquals(400, s.post("/activities/apply-chat-update", obj("analysisId", "dup")).status());
            assertEquals(404, s.post("/activities/apply-chat-update", obj("analysisId", "missing")).status());
        }
    }

    @Test
    void Express_호환_동작() {
        try (TestServer s = TestServer.start("oneline.frontend-origin=http://localhost:5173")) {
            var health = s.get("/health");
            assertEquals("{\"status\":\"ready\",\"label\":\"기록 저장·조회 준비됨\",\"analysisProvider\":\"external\"}", health.text());
            assertEquals("application/json;charset=utf-8", health.header("Content-Type").toLowerCase());
            assertEquals("http://localhost:5173", health.header("Access-Control-Allow-Origin"));
            assertEquals("Express", health.header("X-Powered-By"));
            String etag = health.header("ETag");
            assertNotNull(etag);
            assertTrue(etag.startsWith("W/\""));
            assertEquals(304, s.request("GET", "/health", null, null, Map.of("If-None-Match", etag)).status());

            var preflight = s.request("OPTIONS", "/records", null, null, Map.of("Origin", "http://localhost:5173",
                    "Access-Control-Request-Method", "POST", "Access-Control-Request-Headers", "content-type"));
            assertEquals(204, preflight.status());
            assertEquals("GET,HEAD,PUT,PATCH,POST,DELETE", preflight.header("Access-Control-Allow-Methods"));
            assertEquals("content-type", preflight.header("Access-Control-Allow-Headers"));

            assertEquals(404, s.get("/missing").status());
            assertEquals("{\"error\":\"API를 찾을 수 없습니다.\"}", s.get("/missing").text());
            assertEquals(404, s.send("PUT", "/health", obj()).status());
            assertEquals(200, s.get("/health/").status());
            assertEquals(200, s.get("/HEALTH").status());
            assertEquals(410, s.post("/chat", obj()).status());
            assertEquals("{\"error\":\"분석 진행은 FastAPI AI 서버에서 조회해 주세요.\"}", s.get("/chat/jobs/x").text());

            var broken = s.request("POST", "/records", "application/json", "{a}", Map.of());
            assertEquals(400, broken.status());
            assertEquals("Expected property name or '}' in JSON at position 1 (line 1 column 2)", broken.map().get("error"));
            var strict = s.request("POST", "/records", "application/json", "\"text\"", Map.of());
            assertEquals(400, strict.status());
            assertEquals("Unexpected token '\"', \"\"text\"\" is not valid JSON", strict.map().get("error"));
            var noJson = s.request("POST", "/records", "text/plain", "{}", Map.of());
            assertEquals("[\n  {\n    \"expected\": \"object\",\n    \"code\": \"invalid_type\",\n    \"path\": [],\n    \"message\": \"Invalid input: expected object, received undefined\"\n  }\n]",
                    noJson.map().get("error"));
            assertEquals(413, s.request("POST", "/records", "application/json", "{\"a\":\"" + "x".repeat(1024 * 1024) + "\"}", Map.of()).status());
            assertEquals(415, s.request("POST", "/records", "application/json; charset=latin1", "{}", Map.of()).status());
        }
    }

    @Test
    void 지문은_Node_Python과_같은_JSON_직렬화를_사용한다() {
        // JSON.stringify / json.dumps(ensure_ascii=False, separators=(",", ":")) 결과와 같은 문자열
        Object value = arr(arr("id", "한글 \"인용\"\n줄바꿈\t탭\u0001", null), arr(), arr(1.0, 2.5, 1e21, 0.000001, 1e-7));
        assertEquals("[[\"id\",\"한글 \\\"인용\\\"\\n줄바꿈\\t탭\\u0001\",null],[],[1,2.5,1e+21,0.000001,1e-7]]", Json.stringify(value));
        assertEquals("a$b", Js.replaceAll("a1b", "1", "$$"));
        assertEquals("x1y", Js.replaceAll("xay", "a", "1"));
    }
}
