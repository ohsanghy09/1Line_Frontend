package com.oneline.api;

import com.oneline.api.db.Database;
import com.oneline.api.js.Js;
import com.oneline.api.js.Json;
import com.oneline.api.service.Journey;
import com.oneline.api.service.JourneyContract;
import org.junit.jupiter.api.Test;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;
import static com.oneline.api.js.Js.*;
import static org.junit.jupiter.api.Assertions.*;

/** 실제 AI·개인 DB 없이 HTTP 테스트 대역과 임시 SQLite로 새 계약을 검증한다. */
class JourneyTest {
    private static final String QUOTE = "개인 프로젝트의 EC2 설정을 1호선톤에 적용했고 같은 테스트를 통과하며 배포를 30분에서 5분으로 줄였다.";
    private static final String TIME = "2026-11-06T00:00:00Z";
    private static Object at(Object value, Object... keys) {
        for (Object key : keys) value = get(value, key.toString());
        return value;
    }
    private static void seed(TestServer s) {
        var reply = TestServer.mockReply(QUOTE, List.of(), false);
        s.sql(db -> db.run("INSERT INTO records VALUES (?, ?, NULL, ?, ?, ?, ?)",
                "r1", "line1-hackathon", QUOTE, Json.stringify(reply), TIME, TIME));
    }
    private static List<Object> refs() { return arr(obj("recordId", "r1", "quote", QUOTE)); }
    private static Map<String, Object> output(Object request) {
        return obj("schemaVersion", JourneyContract.SCHEMA, "criteriaVersion", JourneyContract.CRITERIA,
                "sourceFingerprint", get(request, "sourceFingerprint"), "recordCount", get(request, "recordCount"),
                "model", "fake-provider", "promptVersion", JourneyContract.PROMPT,
                "result", obj("schemaVersion", JourneyContract.SCHEMA, "criteriaVersion", JourneyContract.CRITERIA,
                        "source", "api", "summary", obj("title", "성장 흐름", "description", "경험을 활용했다.", "evidence", refs()),
                        "badges", arr(), "typeOptions", JourneyContract.typeOptions(),
                        "axisOptions", arr(obj("value", "all", "label", "전체 분야"), obj("value", "backend", "label", "백엔드 개발")),
                        "events", arr(obj("id", "event-0", "occurredAt", "2026-11", "activity", obj("id", "line1-hackathon", "name", "AI 이름"),
                                "axis", "backend", "title", "배포 경험을 활용했어요.", "description", "같은 테스트를 통과했어요.",
                                "growthAssessments", arr(
                                        obj("type", "efficiency_improvement", "reason", "같은 결과에서 배포 시간을 줄였어요.", "evidence", refs(),
                                                "comparison", obj("before", "30분", "after", "5분", "condition", "같은 테스트 통과",
                                                        "beforeEvidence", refs(), "afterEvidence", refs())),
                                        obj("type", "experience_transfer", "reason", "이전 경험을 적용했어요.", "evidence", refs(),
                                                "transfer", obj("sourceActivity", obj("id", null, "name", "개인 프로젝트"), "experience", "EC2 설정",
                                                        "targetActivityId", "line1-hackathon", "application", "배포에 적용",
                                                        "sourceEvidence", refs(), "applicationEvidence", refs())))))));
    }
    private static Object assessment(Object data, int index) { return at(data, "result", "events", 0, "growthAssessments", index); }
    private static double count(TestServer s) { return ((Number) s.row("SELECT count(*) AS n FROM journey_analyses").get("n")).doubleValue(); }

    @Test void request_roundtrip_single_record_multiple_types_and_sources() {
        try (var ai = new TestServer.FakeAi(); var s = TestServer.start("oneline.ai-base-url=" + ai.url)) {
            var empty = s.get("/journey");
            assertEquals(200, empty.status());
            assertEquals(6, asArray(empty.map().get("typeOptions")).size());
            assertNull(at(empty.json(), "analysis", "id"));
            assertEquals(422, s.postEmpty("/journey/analyze").status());
            assertEquals(0, ai.calls);
            seed(s);
            var draft = s.draft("test", "file message", TestServer.mockReply("file message", List.of("a.txt"), false), "a.txt");
            // 실제 파일 연결 및 원문/메타정보 요청 전달도 확인한다.
            s.sql(db -> db.run("UPDATE records SET analysis_id = ? WHERE id = 'r1'", draft.analysisId()));
            ai.handler = (path, body) -> {
                assertEquals("/api/analyze/journey", path);
                assertEquals(JourneyContract.SCHEMA, get(body, "schemaVersion"));
                assertEquals(JourneyContract.CRITERIA, get(body, "criteriaVersion"));
                assertEquals(QUOTE, at(body, "records", 0, "message"));
                assertEquals("r1", at(body, "records", 0, "id"));
                assertEquals("a.txt", at(body, "records", 0, "files", 0, "name"));
                assertEquals(s.query(Journey::journeySnapshot).fingerprint(), get(body, "sourceFingerprint"));
                assertFalse(Json.stringify(body).contains("content of a.txt"));
                return new Object[]{200, output(body)};
            };
            var result = s.postEmpty("/journey/analyze");
            assertEquals(200, result.status(), result.text());
            assertEquals(2, asArray(at(result.json(), "events", 0, "growthAssessments")).size());
            assertEquals("1호선톤", at(result.json(), "events", 0, "activity", "name"));
            assertEquals("1호선톤", at(result.json(), "evidenceSources", 0, "activityName"));
            assertEquals(1, asArray(result.map().get("evidenceSources")).size());
            assertNotEquals("event-0", at(result.json(), "events", 0, "id"));
            assertNull(at(result.json(), "events", 0, "growthAssessments", 1, "transfer", "sourceActivity", "id"));
            assertEquals(result.text(), s.get("/journey").text());
            assertEquals(1, ai.calls);
            assertEquals(JourneyContract.CRITERIA, s.row("SELECT criteria_version FROM journey_analyses").get("criteria_version"));
            assertEquals(0.0, s.row("SELECT count(*) AS n FROM timeline_events").get("n"));
            assertEquals(QUOTE, s.row("SELECT message FROM records WHERE id='r1'").get("message"));
        }
    }

    @Test void invalid_provider_responses_do_not_replace_saved_result() {
        try (var ai = new TestServer.FakeAi(); var s = TestServer.start("oneline.ai-base-url=" + ai.url)) {
            seed(s);
            ai.handler = (p, b) -> new Object[]{200, output(b)};
            assertEquals(200, s.postEmpty("/journey/analyze").status());
            String previous = s.get("/journey").text();
            List<Consumer<Map<String, Object>>> cases = List.of(
                    d -> set(d, "schemaVersion", "old"),
                    d -> set(d, "criteriaVersion", "old"),
                    d -> set(d, "promptVersion", "journey-v5"),
                    d -> set(d.get("result"), "criteriaVersion", "old"),
                    d -> set(assessment(d, 0), "type", "unknown"),
                    d -> set(assessment(d, 0), "reason", " "),
                    d -> set(assessment(d, 0), "reason", "😀".repeat(501)),
                    d -> asObject(assessment(d, 0)).remove("comparison"),
                    d -> asObject(assessment(d, 1)).remove("transfer"),
                    d -> set(assessment(d, 0), "transfer", get(assessment(d, 1), "transfer")),
                    d -> asArray(at(d, "result", "events", 0, "growthAssessments")).add(assessment(d, 0)),
                    d -> set(get(assessment(d, 0), "comparison"), "beforeEvidence", arr()),
                    d -> set(get(assessment(d, 0), "comparison"), "afterEvidence", arr(obj("recordId", "r1", "quote", "없는 근거"))),
                    d -> set(assessment(d, 0), "evidence", arr(obj("recordId", "missing", "quote", QUOTE))),
                    d -> set(at(d, "result", "summary"), "evidence", arr(obj("recordId", "r1", "quote", "없는 근거"))),
                    d -> set(get(assessment(d, 1), "transfer"), "targetActivityId", "computer-vision"),
                    d -> set(at(assessment(d, 1), "transfer", "sourceActivity"), "id", "line1-hackathon"),
                    d -> set(at(assessment(d, 1), "transfer", "sourceActivity"), "id", "missing"),
                    d -> set(at(d, "result", "events", 0, "activity"), "id", "computer-vision"),
                    d -> set(at(d, "result", "events", 0), "occurredAt", "2020-01"),
                    d -> set(at(d, "result", "events", 0), "type", "legacy"),
                    d -> set(at(d, "result", "events", 0), "evidence", refs()),
                    d -> set(at(d, "result", "events", 0), "axis", "missing"),
                    d -> asArray(at(d, "result", "typeOptions")).removeLast(),
                    d -> asArray(at(d, "result", "axisOptions")).add(obj("value", "unused", "label", "미사용")),
                    d -> set(at(d, "result", "axisOptions", 1), "label", "전체 분야"),
                    d -> set(at(d, "result", "typeOptions", 1), "label", "다른 이름"),
                    d -> set(d.get("result"), "evidenceSources", arr()),
                    d -> set(get(assessment(d, 0), "comparison"), "beforeEvidence", null));
            for (int i = 0; i < cases.size(); i++) {
                var mutate = cases.get(i);
                ai.handler = (p, b) -> { var d = output(b); mutate.accept(d); return new Object[]{200, d}; };
                var response = s.postEmpty("/journey/analyze");
                assertEquals(502, response.status(), "case " + i + ": " + response.text());
                assertEquals(previous, s.get("/journey").text());
                assertEquals(1.0, count(s));
            }
            // 코드 포인트 상한: 이모지 500개는 UTF-16 1000개여도 통과한다.
            ai.handler = (p, b) -> { var d = output(b); set(assessment(d, 0), "reason", "😀".repeat(500)); return new Object[]{200, d}; };
            assertEquals(200, s.postEmpty("/journey/analyze").status());
        }
    }

    @Test void registered_transfer_and_offset_month_are_verified() {
        try (var ai = new TestServer.FakeAi(); var s = TestServer.start("oneline.ai-base-url=" + ai.url)) {
            seed(s);
            s.sql(db -> {
                db.run("INSERT INTO records VALUES ('r2', 'computer-vision', NULL, ?, ?, ?, ?)", QUOTE,
                        Json.stringify(TestServer.mockReply(QUOTE, List.of(), false)), TIME, TIME);
                db.run("UPDATE records SET created_at = '2026-12-01T00:30:00+09:00' WHERE id='r1'");
            });
            ai.handler = (p, b) -> {
                var d = output(b);
                Object transfer = get(assessment(d, 1), "transfer");
                set(transfer, "sourceActivity", obj("id", "computer-vision", "name", "잘못된 이름"));
                var source = obj("recordId", "r2", "quote", QUOTE);
                set(transfer, "sourceEvidence", arr(source));
                asArray(get(assessment(d, 1), "evidence")).add(source);
                return new Object[]{200, d};
            };
            var response = s.postEmpty("/journey/analyze");
            assertEquals(200, response.status(), response.text());
            assertEquals("컴퓨터비전", at(response.json(), "events", 0, "growthAssessments", 1, "transfer", "sourceActivity", "name"));
            assertEquals("2026-11", at(response.json(), "events", 0, "occurredAt"));
            assertEquals(2, asArray(response.map().get("evidenceSources")).size());
        }
    }

    @Test void insufficient_evidence_is_a_normal_saved_result() {
        try (var ai = new TestServer.FakeAi(); var s = TestServer.start("oneline.ai-base-url=" + ai.url)) {
            seed(s);
            ai.handler = (p,b) -> {
                var d = output(b); Object result = d.get("result");
                set(result, "events", arr());
                set(result, "axisOptions", arr(obj("value", "all", "label", "전체 분야")));
                set(get(result, "summary"), "description", "성장 판단 근거가 부족해요.");
                return new Object[]{200, d};
            };
            var response = s.postEmpty("/journey/analyze");
            assertEquals(200, response.status());
            assertEquals(1.0, count(s));
            assertEquals(List.of(), response.map().get("events"));
            assertEquals(6, asArray(response.map().get("typeOptions")).size());
            assertEquals(response.text(), s.get("/journey").text());
        }
    }

    @Test void input_limits_fail_before_calling_ai() {
        try (var ai = new TestServer.FakeAi(); var s = TestServer.start("oneline.ai-base-url=" + ai.url)) {
            seed(s);
            s.sql(db -> db.run("UPDATE records SET message = ?", "가".repeat(250001)));
            assertEquals(422, s.postEmpty("/journey/analyze").status());
            assertEquals(0, ai.calls);
            s.sql(db -> {
                db.run("UPDATE records SET message = ?", QUOTE);
                for (int i=0; i<100; i++) db.run("INSERT INTO records VALUES (?, 'line1-hackathon', NULL, ?, ?, ?, ?)",
                        "extra-"+i, QUOTE, Json.stringify(TestServer.mockReply(QUOTE,List.of(),false)),TIME,TIME);
            });
            assertEquals(422, s.postEmpty("/journey/analyze").status());
            assertEquals(0, ai.calls);
            assertEquals(0.0, count(s));
        }
    }

    @Test void concurrent_changes_duplicate_request_and_delete_never_restore_old_analysis() throws Exception {
        try (var ai = new TestServer.FakeAi(); var s = TestServer.start("oneline.ai-base-url=" + ai.url)) {
            seed(s);
            ai.handler = (p,b) -> new Object[]{200, output(b)};
            assertEquals(200, s.postEmpty("/journey/analyze").status());
            Object savedId = at(s.get("/journey").json(), "analysis", "id");
            CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
            ai.handler = (p,b) -> {
                entered.countDown();
                try { if (!release.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("test timeout"); }
                catch (InterruptedException e) { throw new IllegalStateException(e); }
                // 현재 해시를 돌려줘도 처음 전송한 스냅샷과 비교해 거절해야 한다.
                var d = output(b);
                set(d,"sourceFingerprint",s.query(Journey::journeySnapshot).fingerprint());
                return new Object[]{200,d};
            };
            var pending = CompletableFuture.supplyAsync(() -> s.postEmpty("/journey/analyze"));
            try {
                assertTrue(entered.await(10, TimeUnit.SECONDS));
                assertEquals(409, s.postEmpty("/journey/analyze").status());
                s.sql(db -> db.run("UPDATE records SET updated_at='2026-11-07T00:00:00Z' WHERE id='r1'"));
            } finally { release.countDown(); }
            assertEquals(409, pending.get(10, TimeUnit.SECONDS).status());
            assertEquals(savedId, at(s.get("/journey").json(), "analysis", "id"));
            assertEquals(true, at(s.get("/journey").json(), "analysis", "stale"));
            ai.handler = (p,b) -> new Object[]{503,obj("error","AI unavailable")};
            assertEquals(503,s.postEmpty("/journey/analyze").status());
            assertEquals(savedId, at(s.get("/journey").json(), "analysis", "id"));
            assertEquals(200,s.send("DELETE","/archive/activities/line1-hackathon",obj("confirmation","1호선톤")).status());
            var invalidated=s.get("/journey");
            assertEquals(200,invalidated.status(),invalidated.text());
            assertEquals(List.of(),invalidated.map().get("events"));
            assertEquals(List.of(),invalidated.map().get("evidenceSources"));
            assertFalse(Json.stringify(invalidated.map().get("summary")).contains(QUOTE));
            assertEquals(6,asArray(invalidated.map().get("typeOptions")).size());
            assertEquals(422,s.postEmpty("/journey/analyze").status());
            assertEquals(invalidated.text(),s.get("/journey").text());
        }
    }

    @Test void empty_legacy_table_migration_is_idempotent_and_preserves_other_data() throws Exception {
        Path file=Files.createTempDirectory("journey-migration-").resolve("test.db");
        try (var c=DriverManager.getConnection("jdbc:sqlite:"+file); var st=c.createStatement()) {
            st.execute("CREATE TABLE journey_analyses (id TEXT PRIMARY KEY, source_fingerprint TEXT NOT NULL, record_count INTEGER NOT NULL, result_json TEXT NOT NULL, model TEXT NOT NULL, prompt_version TEXT NOT NULL, created_at TEXT NOT NULL)");
        }
        try (var db=Database.open(file.toString())) {
            assertEquals(1L,db.all("PRAGMA table_info(journey_analyses)").stream().filter(c -> "criteria_version".equals(c.get("name"))).count());
            db.run("INSERT INTO activities(id,name) VALUES ('preserve','보존할 활동')");
        }
        try (var db=Database.open(file.toString())) {
            assertEquals(1L,db.all("PRAGMA table_info(journey_analyses)").stream().filter(c -> "criteria_version".equals(c.get("name"))).count());
            assertEquals("보존할 활동",db.get("SELECT name FROM activities WHERE id='preserve'").get("name"));
            assertEquals(0.0,db.get("SELECT count(*) AS n FROM journey_analyses").get("n"));
        }
    }

    @Test void deletion_during_analysis_invalidates_saved_and_in_flight_result() {
        try (var ai = new TestServer.FakeAi(); var s = TestServer.start("oneline.ai-base-url=" + ai.url)) {
            seed(s);
            s.sql(db -> db.run("INSERT INTO records VALUES ('remaining', 'computer-vision', NULL, ?, ?, ?, ?)",
                    QUOTE, Json.stringify(TestServer.mockReply(QUOTE,List.of(),false)),TIME,TIME));
            ai.handler = (p,b) -> new Object[]{200,output(b)};
            assertEquals(200,s.postEmpty("/journey/analyze").status());
            ai.handler = (p,b) -> {
                var d=output(b);
                var deleted=s.send("DELETE","/archive/activities/line1-hackathon",obj("confirmation","1호선톤"));
                assertEquals(200,deleted.status());
                return new Object[]{200,d};
            };
            assertEquals(409,s.postEmpty("/journey/analyze").status());
            var result=s.get("/journey");
            assertEquals(200,result.status());
            assertEquals(List.of(),result.map().get("events"));
            assertEquals(List.of(),result.map().get("evidenceSources"));
            assertEquals(1.0,count(s));
            assertFalse(result.text().contains(QUOTE));
            assertEquals(6,asArray(result.map().get("typeOptions")).size());
            ai.handler=(p,b) -> new Object[]{503,obj("error","AI unavailable")};
            assertEquals(503,s.postEmpty("/journey/analyze").status());
            assertEquals(result.text(),s.get("/journey").text());
        }
    }
}
