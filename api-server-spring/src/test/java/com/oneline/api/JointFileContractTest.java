package com.oneline.api;

import com.oneline.api.js.Js;
import com.oneline.api.js.Json;
import com.oneline.api.service.FileDuplicates;
import org.junit.jupiter.api.Test;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import static com.oneline.api.js.Js.obj;
import static org.junit.jupiter.api.Assertions.*;

class JointFileContractTest {
    private static final String ACTIVITY = "line1-hackathon";
    private static final byte[] BEFORE = "before: 30\r\n".getBytes(StandardCharsets.UTF_8);
    private static final byte[] AFTER = "after: 8\n".getBytes(StandardCharsets.UTF_8);

    private static TestServer.Draft draft(TestServer s, String... names) {
        return s.draft("joint", "", TestServer.mockReply("", List.of(names), true), names);
    }
    private static void bytes(TestServer s, String id, byte[] bytes) {
        s.sql(db -> db.run("UPDATE files SET content = ?, size = ? WHERE id = ?", bytes, bytes.length, id));
    }
    private static TestServer.Response save(TestServer s, TestServer.Draft d, String activity) {
        return s.post("/records", obj("analysisId", d.analysisId(), "activityId", activity));
    }
    private static String deletePath(TestServer.Draft d, int index) {
        return "/archive/activities/" + ACTIVITY + "/materials/" + d.fileIds().get(index);
    }
    private static TestServer.Response internal(TestServer s, String route, Object input) {
        return s.request("POST", "/internal" + route, "application/json", Json.stringify(input), Map.of("Authorization", "Bearer " + TestServer.TOKEN));
    }
    private static Object checkInput(Object activity, byte[] content) {
        return obj("schemaVersion", "file-dedup-v1", "activityId", activity,
                "files", List.of(obj("inputIndex", 0, "sha256", FileDuplicates.hash(content), "size", content.length)));
    }
    private static Map<String, Object> result(Object raw, boolean change) {
        var files = Js.asArray(Js.get(raw, "files"));
        var reply = TestServer.mockReply("", files.stream().map(f -> (String) Js.get(f, "name")).toList(), change);
        var refs = change ? List.of(obj("changeIndex", 0,
                "before", List.of(obj("fileId", Js.get(files.get(0), "id"), "quote", "before: 30\n")),
                "after", List.of(obj("fileId", Js.get(files.get(1), "id"), "quote", "after: 8")))) : List.of();
        return obj("schemaVersion", "exclude-file-result-v2", "recordReply", Js.get(raw, "recordReply"),
                "fileIds", files.stream().map(f -> Js.get(f, "id")).toList(), "reply", reply, "changeEvidence", refs);
    }
    private static TestServer.Draft savedTriple(TestServer s) {
        var d = draft(s, "A.txt", "same.txt", "same.txt");
        bytes(s, d.fileIds().get(1), BEFORE); bytes(s, d.fileIds().get(2), AFTER);
        assertEquals(201, save(s, d, ACTIVITY).status());
        return d;
    }

    @Test void v2StoresChangesAndIdBasedEvidenceEvenWithDuplicateNames() {
        try (var ai = new TestServer.FakeAi(); var s = TestServer.start("oneline.ai-base-url=" + ai.url)) {
            var d = savedTriple(s);
            ai.handler = (url, raw) -> new Object[]{200, result(raw, true)};
            assertEquals(200, s.send("DELETE", deletePath(d, 0), obj()).status());
            var archive = s.get("/archive/activities/" + ACTIVITY).map();
            var events = Js.asArray(archive.get("timeline"));
            assertEquals(1, events.size());
            assertEquals(List.of(d.fileIds().get(1), d.fileIds().get(2)), Js.get(events.getFirst(), "evidenceFileIds"));
            assertEquals("before: 30\n", Js.path(events.getFirst(), "changeEvidence", "before", "0", "quote"));
            for (int index : List.of(1, 2)) {
                var file = s.get(deletePath(d, index)).map();
                assertEquals(1, Js.asArray(file.get("events")).size());
            }
            assertEquals(404, s.get("/files/" + d.fileIds().getFirst()).status());
            ai.handler = (url, raw) -> new Object[]{200, result(raw, false)};
            assertEquals(200, s.send("DELETE", deletePath(d, 1), obj()).status());
            assertNull(s.row("SELECT event_id FROM timeline_event_evidence"));
        }
    }

    @Test void wrongVersionMissingReferencesAndAlteredQuotesNeverDeleteOriginals() {
        try (var ai = new TestServer.FakeAi(); var s = TestServer.start("oneline.ai-base-url=" + ai.url)) {
            var d = savedTriple(s);
            for (String invalid : List.of("version", "missing", "count", "unknown", "quote", "duplicate-index", "spaces")) {
                ai.handler = (url, raw) -> {
                    var output = result(raw, true);
                    var refs = Js.asArray(output.get("changeEvidence"));
                    var before = Js.asObject(Js.asArray(Js.get(refs.getFirst(), "before")).getFirst());
                    switch (invalid) {
                        case "version" -> output.remove("schemaVersion");
                        case "missing" -> output.remove("changeEvidence");
                        case "count" -> output.put("changeEvidence", List.of());
                        case "unknown" -> before.put("fileId", d.fileIds().getFirst());
                        case "quote" -> before.put("quote", "invented quote");
                        case "spaces" -> before.put("quote", "before:  30");
                        case "duplicate-index" -> output.put("changeEvidence", List.of(refs.getFirst(), refs.getFirst()));
                    }
                    return new Object[]{200, output};
                };
                assertEquals(502, s.send("DELETE", deletePath(d, 0), obj()).status(), invalid);
                assertEquals(200, s.get("/files/" + d.fileIds().getFirst()).status());
            }
        }
    }

    @Test void changedBytesAndEvidenceStorageFailureRollbackDeletion() {
        try (var ai = new TestServer.FakeAi(); var s = TestServer.start("oneline.ai-base-url=" + ai.url)) {
            var d = savedTriple(s);
            ai.handler = (url, raw) -> {
                bytes(s, d.fileIds().get(1), "before: 99\r\n".getBytes(StandardCharsets.UTF_8));
                return new Object[]{200, result(raw, true)};
            };
            assertEquals(409, s.send("DELETE", deletePath(d, 0), obj()).status());
            bytes(s, d.fileIds().get(1), BEFORE);
            s.sql(db -> db.execStatement("CREATE TRIGGER evidence_failure BEFORE INSERT ON timeline_event_evidence BEGIN SELECT RAISE(ABORT, 'test'); END"));
            ai.handler = (url, raw) -> new Object[]{200, result(raw, true)};
            assertEquals(500, s.send("DELETE", deletePath(d, 0), obj()).status());
            assertEquals(200, s.get("/files/" + d.fileIds().getFirst()).status());
            assertNull(s.row("SELECT event_id FROM timeline_event_evidence"));
        }
    }

    @Test void featureDisabledAndUnsupportedQuoteExtractorDoNotFallBackToEmptyChanges() {
        try (var ai = new TestServer.FakeAi(); var s = TestServer.start("oneline.ai-base-url=" + ai.url, "oneline.exclude-file-v2-enabled=false")) {
            var d = savedTriple(s);
            assertEquals(503, s.send("DELETE", deletePath(d, 0), obj()).status()); assertEquals(0, ai.calls);
        }
        try (var ai = new TestServer.FakeAi(); var s = TestServer.start("oneline.ai-base-url=" + ai.url)) {
            var d = draft(s, "A.txt", "B.pdf", "C.txt");
            bytes(s, d.fileIds().get(1), BEFORE); bytes(s, d.fileIds().get(2), AFTER);
            assertEquals(201, save(s, d, ACTIVITY).status());
            ai.handler = (url, raw) -> new Object[]{200, result(raw, true)};
            assertEquals(502, s.send("DELETE", deletePath(d, 0), obj()).status());
            assertEquals(200, s.get("/files/" + d.fileIds().getFirst()).status());
        }
    }

    @Test void duplicateLookupUsesSavedOriginalsAndDetectsSameSizeByteChanges() {
        try (var s = TestServer.start("oneline.file-dedup-enabled=true")) {
            var d = draft(s, "first.txt"); bytes(s, d.fileIds().getFirst(), BEFORE);
            assertEquals(201, save(s, d, ACTIVITY).status());
            assertEquals(401, s.post("/internal/file-duplicates/check", checkInput(ACTIVITY, BEFORE)).status());
            var response = internal(s, "/file-duplicates/check", checkInput(ACTIVITY, BEFORE));
            assertEquals(200, response.status()); assertEquals("duplicate", Js.path(response.map(), "files", "0", "status"));
            assertEquals("pending", Js.path(internal(s, "/file-duplicates/check", checkInput(null, BEFORE)).map(), "files", "0", "status"));
            assertEquals("new", Js.path(internal(s, "/file-duplicates/check", checkInput("computer-vision", BEFORE)).map(), "files", "0", "status"));
            bytes(s, d.fileIds().getFirst(), "before: 99\r\n".getBytes(StandardCharsets.UTF_8));
            assertEquals("new", Js.path(internal(s, "/file-duplicates/check", checkInput(ACTIVITY, BEFORE)).map(), "files", "0", "status"));
            var invalid = Js.asObject(checkInput(ACTIVITY, BEFORE)); invalid.put("userId", "spoofed");
            assertEquals(400, internal(s, "/file-duplicates/check", invalid).status());
            invalid.remove("userId"); invalid.put("schemaVersion", "bad");
            assertEquals(422, internal(s, "/file-duplicates/check", invalid).status());
        }
    }

    @Test void saveRejectsSameBytesAndMixedRequestsButAllowsOtherActivitiesAndDifferentBytes() {
        try (var s = TestServer.start("oneline.file-dedup-enabled=true")) {
            var first = draft(s, "report.txt"); bytes(s, first.fileIds().getFirst(), BEFORE);
            var saved = save(s, first, ACTIVITY); assertEquals(201, saved.status());
            assertEquals(200, save(s, first, ACTIVITY).status());
            assertEquals(saved.map().get("id"), save(s, first, ACTIVITY).map().get("id"));
            var second = draft(s, "renamed.txt"); bytes(s, second.fileIds().getFirst(), BEFORE);
            var rejected = save(s, second, ACTIVITY);
            assertEquals(409, rejected.status()); assertEquals("duplicate_files", rejected.map().get("code"));
            assertEquals(201, save(s, second, "computer-vision").status());
            assertEquals(409, s.send("PATCH", "/records/" + save(s, second, "computer-vision").map().get("id"), obj("activityId", ACTIVITY)).status());
            var different = draft(s, "report.txt"); bytes(s, different.fileIds().getFirst(), AFTER);
            assertEquals(201, save(s, different, ACTIVITY).status());
            var mixed = draft(s, "copy.txt", "new.txt"); bytes(s, mixed.fileIds().getFirst(), BEFORE);
            assertEquals(409, save(s, mixed, ACTIVITY).status());
            assertNull(s.row("SELECT id FROM records WHERE analysis_id = ?", mixed.analysisId()));
            assertNotNull(s.row("SELECT id FROM files WHERE id = ?", mixed.fileIds().get(1)));
        }
    }

    @Test void repeatedFilesRollbackNewActivityAndConcurrentSavesHaveOneWinner() throws Exception {
        try (var s = TestServer.start("oneline.file-dedup-enabled=true"); var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var repeated = draft(s, "a.txt", "b.txt");
            for (var id : repeated.fileIds()) bytes(s, id, BEFORE);
            var newActivity = obj("name", "must-rollback", "category", null, "status", null, "role", null, "period", null, "summary", null);
            var response = s.post("/records", obj("analysisId", repeated.analysisId(), "newActivity", newActivity));
            assertEquals(409, response.status()); assertEquals(0.0, Js.path(response.map(), "duplicates", "0", "duplicateOfInputIndex"));
            assertNull(s.row("SELECT id FROM activities WHERE name = 'must-rollback'"));
            var a = draft(s, "one.txt"); var b = draft(s, "two.txt");
            bytes(s, a.fileIds().getFirst(), BEFORE); bytes(s, b.fileIds().getFirst(), BEFORE);
            var start = new CountDownLatch(1);
            var x = executor.submit(() -> { start.await(); return save(s, a, ACTIVITY).status(); });
            var y = executor.submit(() -> { start.await(); return save(s, b, ACTIVITY).status(); });
            start.countDown();
            var statuses = new ArrayList<>(List.of(x.get(10, TimeUnit.SECONDS), y.get(10, TimeUnit.SECONDS)));
            Collections.sort(statuses); assertEquals(List.of(201, 409), statuses);
        }
    }

    @Test void publishedDeduplicationIsRequiredValidatedAndPreservedByTheRealEndpoint() throws Exception {
        var exchange = Js.asObject(Json.parse(java.nio.file.Files.readString(java.nio.file.Path.of("../docs/integration-test-fixes/examples/joint-file-exchange.json"))));
        var original = Js.asObject(exchange.get("publication"));
        try (var s = TestServer.start("oneline.file-dedup-enabled=true")) {
            for (String bad : List.of("missing", "count", "extra", "index", "blocked", "false-repeated")) {
                var request = Js.asObject(Json.parse(Json.stringify(original)));
                var reply = Js.asObject(request.get("reply"));
                var dedup = Js.asObject(reply.get("deduplication"));
                var files = Js.asArray(dedup.get("files"));
                switch (bad) {
                    case "missing" -> reply.remove("deduplication");
                    case "count" -> dedup.put("files", List.of(files.getFirst()));
                    case "extra" -> dedup.put("sha256", "must-not-be-public");
                    case "index" -> Js.asObject(files.getFirst()).put("inputIndex", 1);
                    case "blocked" -> dedup.put("saveBlocked", true);
                    case "false-repeated" -> {
                        Js.asObject(files.get(1)).put("status", "duplicate");
                        Js.asObject(files.get(1)).put("duplicateOfInputIndex", 0);
                        dedup.put("saveBlocked", true);
                    }
                }
                var response = s.request("PUT", "/internal/chat-jobs/" + request.get("jobId"), "application/json", Json.stringify(request),
                        Map.of("Authorization", "Bearer " + TestServer.TOKEN));
                assertEquals(400, response.status(), bad + ": " + response.text());
            }
            var response = s.request("PUT", "/internal/chat-jobs/" + original.get("jobId"), "application/json", Json.stringify(original),
                    Map.of("Authorization", "Bearer " + TestServer.TOKEN));
            assertEquals(201, response.status(), response.text());
            assertEquals(Json.stringify(Js.path(original, "reply", "deduplication")),
                    Json.stringify(Js.path(response.map(), "job", "reply", "deduplication")));
        }
        var request = Js.asObject(Js.path(exchange, "excludeFile", "request"));
        var files = Js.asArray(request.get("files")).stream().map(raw -> {
            var file = new LinkedHashMap<>(Js.asObject(raw));
            file.put("content", Base64.getDecoder().decode((String) file.get("contentBase64")));
            return (Map<String, Object>) file;
        }).toList();
        assertEquals(1, com.oneline.api.service.ExcludeFileResult.validate(
                Js.path(exchange, "excludeFile", "response"), request.get("recordReply"), files).evidence().size());
    }

    @Test void lookupFailsOnInvalidStoredBytesAndOnTooManyMatchesWithoutReturningNew() {
        try (var s = TestServer.start()) {
            var first = draft(s, "bad.txt"); assertEquals(201, save(s, first, ACTIVITY).status());
            s.sql(db -> db.run("UPDATE files SET size = size + 1 WHERE id = ?", first.fileIds().getFirst()));
            var response = internal(s, "/file-duplicates/check", checkInput(ACTIVITY, BEFORE));
            assertEquals(503, response.status()); assertEquals("duplicate_lookup_unavailable", response.map().get("code"));
            assertEquals(200, internal(s, "/file-duplicates/check", checkInput("computer-vision", BEFORE)).status());
        }
        try (var s = TestServer.start()) {
            for (int i = 0; i < 21; i++) {
                var d = draft(s, "copy-" + i + ".txt"); bytes(s, d.fileIds().getFirst(), BEFORE);
                assertEquals(201, save(s, d, ACTIVITY).status());
            }
            var response = internal(s, "/file-duplicates/check", checkInput(ACTIVITY, BEFORE));
            assertEquals(422, response.status()); assertEquals("duplicate_lookup_limit", response.map().get("code"));
        }
    }

    @Test void sameNewActivityRetryReturnsSavedResultAndChangedSelectionIsRejected() {
        try (var s = TestServer.start("oneline.file-dedup-enabled=true")) {
            var d = draft(s, "once.txt");
            var input = obj("analysisId", d.analysisId(), "newActivity", obj("name", "Created once", "category", null,
                    "status", null, "role", null, "period", null, "summary", null));
            var first = s.post("/records", input); assertEquals(201, first.status());
            var retry = s.post("/records", input); assertEquals(200, retry.status()); assertEquals(first.map().get("id"), retry.map().get("id"));
            assertEquals(409, save(s, d, ACTIVITY).status());
            assertEquals(1.0, s.row("SELECT COUNT(*) AS n FROM records WHERE analysis_id = ?", d.analysisId()).get("n"));
        }
    }

    @Test void existingLegacyDuplicatesDoNotBlockMetadataEditsWithoutAnActivityMove() {
        try (var s = TestServer.start("oneline.file-dedup-enabled=true")) {
            var first = draft(s, "first.txt"); bytes(s, first.fileIds().getFirst(), BEFORE);
            var saved = save(s, first, ACTIVITY); assertEquals(201, saved.status());
            var legacy = draft(s, "legacy.txt"); bytes(s, legacy.fileIds().getFirst(), BEFORE);
            s.sql(db -> db.run("INSERT INTO records VALUES (?, ?, ?, '', ?, ?, ?)", "legacy-record", ACTIVITY,
                    legacy.analysisId(), Json.stringify(legacy.reply()), Js.nowIso(), Js.nowIso()));
            assertEquals(200, s.send("PATCH", "/records/" + saved.map().get("id"), obj("materialType", "수정된 분류")).status());
        }
    }
}
