package com.oneline.api;

import com.oneline.api.js.Js;
import com.oneline.api.js.Json;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

import static com.oneline.api.js.Js.obj;
import static org.junit.jupiter.api.Assertions.*;

/** AI 대역은 전달받은 남은 원본만 읽으며 백엔드 DB를 조회하지 않는다. */
class ExcludeFileRequestTest {
    private static final String ACTIVITY = "line1-hackathon";
    private record Saved(TestServer.Draft draft, String recordId, String reply) {}

    private static Saved save(TestServer s, String... names) {
        var draft = s.draft("conversation", "이전 대화는 모델 입력이 아닙니다.", TestServer.mockReply("old", List.of(names), true), names);
        var response = s.post("/records", obj("activityId", ACTIVITY, "analysisId", draft.analysisId()));
        assertEquals(201, response.status(), response.text());
        String id = (String) response.map().get("id");
        return new Saved(draft, id, (String) s.row("SELECT reply FROM records WHERE id = ?", id).get("reply"));
    }
    private static String path(Saved saved, int index) {
        return "/archive/activities/" + ACTIVITY + "/materials/" + saved.draft().fileIds().get(index);
    }
    private static Map<String, Object> output(Object body) {
        var request = Js.asObject(body);
        var files = Js.asArray(request.get("files"));
        List<String> names = files.stream().map(f -> (String) Js.get(f, "name")).toList();
        // recordReply는 읽거나 모델 입력으로 재사용하지 않고 그대로 돌려준다.
        var reply = TestServer.mockReply("", names, false);
        String content = files.stream().map(f -> Base64.getDecoder().decode((String) Js.get(f, "contentBase64")))
                .map(bytes -> new String(bytes, StandardCharsets.UTF_8)).reduce("", (a, b) -> a + b);
        Js.asObject(reply.get("analysis")).put("summary", "남은 원본만의 요약: " + content);
        return obj("reply", reply, "recordReply", request.get("recordReply"),
                "fileIds", files.stream().map(f -> Js.get(f, "id")).toList());
    }
    private static long fileCount(TestServer s, Saved saved) {
        return ((Number) s.row("SELECT COUNT(*) AS n FROM files WHERE analysis_id = ?", saved.draft().analysisId()).get("n")).longValue();
    }
    private static void setBytes(TestServer s, String id, byte[] content) {
        s.sql(db -> db.run("UPDATE files SET content = ?, size = ? WHERE id = ?", content, content.length, id));
    }

    @Test
    void sendsOnlyRemainingBinaryOriginalsAndReplacesTheResultBeforeFinalFileDeletion() {
        try (var ai = new TestServer.FakeAi(); var s = TestServer.start("oneline.ai-base-url=" + ai.url)) {
            var saved = save(s, "a.txt", "b.txt", "c.txt");
            var unrelated = save(s, "unrelated.txt");
            byte[] a = "DELETED_A_ORIGINAL".getBytes(StandardCharsets.UTF_8), b = new byte[]{0, -1, -128, 10}, c = "남은 C 원본".getBytes(StandardCharsets.UTF_8);
            setBytes(s, saved.draft().fileIds().get(0), a); setBytes(s, saved.draft().fileIds().get(1), b); setBytes(s, saved.draft().fileIds().get(2), c);
            var captured = new CopyOnWriteArrayList<Map<String, Object>>();
            ai.handler = (url, body) -> {
                if (!url.equals("/api/analyze/records/" + saved.recordId() + "/exclude-file")) return new Object[]{400, obj("error", "wrong record")};
                captured.add(Js.asObject(body)); return new Object[]{200, output(body)};
            };
            assertEquals(200, s.send("DELETE", path(saved, 0), obj()).status());
            var request = captured.get(0);
            assertEquals(Set.of("fileId", "recordReply", "activity", "files"), request.keySet());
            assertEquals(saved.draft().fileIds().get(0), request.get("fileId"));
            assertEquals(saved.reply(), request.get("recordReply"));
            assertEquals(obj("id", ACTIVITY, "name", "1호선톤", "category", null), request.get("activity"));
            var files = Js.asArray(request.get("files"));
            assertEquals(List.of(saved.draft().fileIds().get(1), saved.draft().fileIds().get(2)), files.stream().map(f -> Js.get(f, "id")).toList());
            for (Object f : files) assertEquals(Set.of("id", "name", "mimeType", "size", "contentBase64"), Js.asObject(f).keySet());
            assertEquals("text/plain", Js.get(files.get(0), "mimeType"));
            assertEquals(b.length, ((Number) Js.get(files.get(0), "size")).intValue());
            assertArrayEquals(b, Base64.getDecoder().decode((String) Js.get(files.get(0), "contentBase64")));
            assertArrayEquals(c, Base64.getDecoder().decode((String) Js.get(files.get(1), "contentBase64")));
            assertFalse(Json.stringify(request).contains(Base64.getEncoder().encodeToString(a)));
            assertFalse(Json.stringify(request).contains("content of unrelated.txt"));
            assertEquals(404, s.get("/files/" + saved.draft().fileIds().get(0)).status());
            var record = s.get("/records/" + saved.recordId()).map();
            assertEquals(List.of("b.txt", "c.txt"), Js.asArray(Js.path(record, "reply", "analysis", "files")).stream().map(f -> Js.get(f, "name")).toList());
            assertEquals(List.of(), Js.path(record, "reply", "analysis", "changes"));
            assertEquals(ACTIVITY, record.get("activityId"));
            assertEquals(200, s.send("DELETE", path(saved, 1), obj()).status());
            assertEquals(1, Js.asArray(captured.get(1).get("files")).size());
            assertEquals(200, s.send("DELETE", path(saved, 2), obj()).status());
            assertEquals(2, ai.calls); // 마지막 파일은 재분석하지 않는다.
            assertEquals(404, s.get("/records/" + saved.recordId()).status());
            assertEquals(200, s.get("/files/" + unrelated.draft().fileIds().get(0)).status());
        }
    }

    @Test
    void malformedOrInconsistentAiOutputPreservesAllOriginalsDraftAndMetadata() {
        try (var ai = new TestServer.FakeAi(); var s = TestServer.start("oneline.ai-base-url=" + ai.url)) {
            var saved = save(s, "a.txt", "b.txt", "c.txt");
            s.sql(db -> db.run("UPDATE activities SET summary = '보존할 요약', role = '보존할 역할' WHERE id = ?", ACTIVITY));
            String draftReply = (String) s.row("SELECT reply FROM analyses WHERE id = ?", saved.draft().analysisId()).get("reply");
            for (String invalid : List.of("http", "recordReply", "ids", "names", "changes", "sourceUrl", "general")) {
                ai.handler = (url, body) -> {
                    var response = output(body);
                    switch (invalid) {
                        case "http" -> { return new Object[]{503, obj("error", "unavailable")}; }
                        case "recordReply" -> response.put("recordReply", Json.stringifyPretty(Json.parse((String) response.get("recordReply"))));
                        case "ids" -> response.put("fileIds", List.of("wrong-id"));
                        case "names" -> Js.asObject(Js.asArray(Js.path(response, "reply", "analysis", "files")).get(0)).put("name", "wrong.txt");
                        case "changes" -> Js.asObject(Js.path(response, "reply", "analysis")).put("changes", List.of(obj("before", "이전", "after", "이후", "category", "변화", "evidence", List.of("b.txt"))));
                        case "sourceUrl" -> Js.asObject(response.get("reply")).put("sourceUrl", "https://example.org");
                        case "general" -> response.put("reply", obj("id", "general", "role", "assistant", "kind", "general", "analysis", null, "content", "무시"));
                    }
                    return new Object[]{200, response};
                };
                assertEquals(502, s.send("DELETE", path(saved, 0), obj()).status(), invalid);
                assertEquals(3, fileCount(s, saved));
                assertEquals(saved.reply(), s.row("SELECT reply FROM records WHERE id = ?", saved.recordId()).get("reply"));
                assertEquals(draftReply, s.row("SELECT reply FROM analyses WHERE id = ?", saved.draft().analysisId()).get("reply"));
                assertEquals("보존할 요약", s.row("SELECT summary FROM activities WHERE id = ?", ACTIVITY).get("summary"));
            }
        }
    }

    @Test
    void concurrentChangeRejectsTheOldResultAndDuplicateDeletionIsBlocked() throws Exception {
        try (var ai = new TestServer.FakeAi(); var s = TestServer.start("oneline.ai-base-url=" + ai.url);
             var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var saved = save(s, "a.txt", "b.txt", "c.txt");
            var entered = new CountDownLatch(1); var release = new CountDownLatch(1);
            ai.handler = (url, body) -> {
                entered.countDown();
                try { if (!release.await(5, TimeUnit.SECONDS)) return new Object[]{503, obj("error", "timed out")}; }
                catch (InterruptedException e) { Thread.currentThread().interrupt(); return new Object[]{503, obj("error", "interrupted")}; }
                return new Object[]{200, output(body)};
            };
            var first = executor.submit(() -> s.send("DELETE", path(saved, 0), obj()));
            try {
                assertTrue(entered.await(5, TimeUnit.SECONDS));
                assertEquals(409, s.send("DELETE", path(saved, 1), obj()).status());
                s.sql(db -> db.run("UPDATE records SET updated_at = 'changed' WHERE id = ?", saved.recordId()));
            } finally { release.countDown(); }
            assertEquals(409, first.get(10, TimeUnit.SECONDS).status());
            assertEquals(3, fileCount(s, saved));
            ai.handler = (url, body) -> new Object[]{200, output(body)};
            assertEquals(200, s.send("DELETE", path(saved, 0), obj()).status()); // 충돌 뒤 잠금 해제
            assertEquals(2, ai.calls);
        }
    }

    @Test
    void invalidStoredOriginalFailsBeforeAiWithoutDeletingAnything() {
        try (var ai = new TestServer.FakeAi(); var s = TestServer.start("oneline.ai-base-url=" + ai.url)) {
            var saved = save(s, "a.txt", "b.txt");
            s.sql(db -> db.run("UPDATE files SET size = size + 1 WHERE id = ?", saved.draft().fileIds().get(1)));
            assertEquals(502, s.send("DELETE", path(saved, 0), obj()).status());
            assertEquals(0, ai.calls); assertEquals(2, fileCount(s, saved));
            s.sql(db -> db.run("UPDATE files SET size = length(content) + 0.5 WHERE id = ?", saved.draft().fileIds().get(1)));
            assertEquals(502, s.send("DELETE", path(saved, 0), obj()).status());
            assertEquals(0, ai.calls); assertEquals(2, fileCount(s, saved));
            setBytes(s, saved.draft().fileIds().get(1), new byte[0]);
            assertEquals(502, s.send("DELETE", path(saved, 0), obj()).status());
            assertEquals(0, ai.calls); assertEquals(2, fileCount(s, saved));
            assertEquals(saved.reply(), s.row("SELECT reply FROM records WHERE id = ?", saved.recordId()).get("reply"));
        }
    }

    @Test
    void databaseFailureRollsBackDeletionAndDraftRetirementAfterSuccessfulAi() {
        try (var ai = new TestServer.FakeAi(); var s = TestServer.start("oneline.ai-base-url=" + ai.url)) {
            var saved = save(s, "a.txt", "b.txt");
            String draft = (String) s.row("SELECT reply FROM analyses WHERE id = ?", saved.draft().analysisId()).get("reply");
            ai.handler = (url, body) -> new Object[]{200, output(body)};
            s.sql(db -> db.execStatement("CREATE TRIGGER fail_record_update BEFORE UPDATE ON records BEGIN SELECT RAISE(ABORT, 'rollback test'); END"));
            assertEquals(500, s.send("DELETE", path(saved, 0), obj()).status());
            assertEquals(2, fileCount(s, saved));
            assertEquals(saved.reply(), s.row("SELECT reply FROM records WHERE id = ?", saved.recordId()).get("reply"));
            assertEquals(draft, s.row("SELECT reply FROM analyses WHERE id = ?", saved.draft().analysisId()).get("reply"));
        }
    }
}
