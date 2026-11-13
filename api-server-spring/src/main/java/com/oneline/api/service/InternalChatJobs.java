package com.oneline.api.service;

import com.oneline.api.db.Database;
import com.oneline.api.js.Js;
import com.oneline.api.js.Json;
import com.oneline.api.validation.Schemas;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;

import static com.oneline.api.js.Js.obj;

/** 분리 AI가 게시하는 홈 작업의 영속 정본. 호출은 EventLoop 안에서 수행한다. */
public final class InternalChatJobs {
    private InternalChatJobs() {}
    private static final Set<String> FIELDS = Set.of("jobId", "analysisId", "conversationId", "requestId",
            "requestFingerprint", "kind", "status", "phase", "message", "sourceUrl", "reply", "files",
            "error", "createdAt", "updatedAt", "expectedRevision");
    private static final List<String> PHASES = List.of("preparing", "analyzing", "persisting", "completed");
    private static final Set<String> EXTENSIONS = Set.of("txt", "md", "json", "csv", "tsv", "html", "xml", "py", "js", "ts",
            "pdf", "doc", "docx", "rtf", "odt", "ppt", "pptx", "xls", "xlsx", "png", "jpg", "jpeg", "webp", "gif");
    public static final int BODY_LIMIT = 40 * 1024 * 1024;

    public static final class Failure extends RuntimeException {
        public final int status;
        public final String code;
        public Failure(int status, String code) {
            super("내부 작업 요청을 처리하지 못했습니다.", null, false, false);
            this.status = status;
            this.code = code;
        }
    }
    private static void require(boolean valid) {
        if (!valid) throw new Failure(400, "internal_invalid_input");
    }
    public static String identifier(Object value) { return text(value, 200, false); }
    private static String text(Object value, int max, boolean empty) {
        require(value instanceof String);
        String result = (String) value;
        require(result.codePointCount(0, result.length()) <= max && (empty || !result.isBlank()));
        return result;
    }
    private static long integer(Object value, long max) {
        require(value instanceof Number);
        double n = ((Number) value).doubleValue();
        require(Double.isFinite(n) && n >= 0 && n <= max && n == Math.floor(n));
        return (long) n;
    }
    private static Map<String, Object> object(Object value, Set<String> keys) {
        require(value instanceof Map<?, ?>);
        Map<String, Object> result = Js.asObject(value);
        require(result.keySet().equals(keys));
        return result;
    }
    private static Instant timestamp(Object value) {
        String date = text(value, 100, false);
        try {
            require(date.endsWith("Z"));
            return Instant.parse(date);
        } catch (java.time.DateTimeException e) {
            throw new Failure(400, "internal_invalid_input");
        }
    }
    private static Object canonical(Object value) {
        if (value instanceof Map<?, ?>) {
            var sorted = new TreeMap<String, Object>();
            Js.asObject(value).forEach((key, v) -> sorted.put(key, canonical(v)));
            return sorted;
        }
        if (value instanceof List<?>) return Js.asArray(value).stream().map(InternalChatJobs::canonical).toList();
        return value;
    }
    private static String hash(Object value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(Json.stringify(canonical(value)).getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    private record Original(Map<String, Object> value, byte[] bytes) {}
    private record Publication(Map<String, Object> value, List<Original> files, long expected,
                               String inputSignature, String signature) {}

    private static Publication validate(String jobId, Object raw) {
        identifier(jobId);
        require(jobId.startsWith("ai-") && jobId.length() > 3);
        var input = new LinkedHashMap<>(object(raw, FIELDS));
        require(jobId.equals(input.get("jobId")));
        for (String key : List.of("analysisId", "conversationId", "requestId")) identifier(input.get(key));
        text(input.get("requestFingerprint"), 20000, false);
        require(List.of("chat", "link").contains(input.get("kind")));
        require(List.of("queued", "running", "completed", "failed").contains(input.get("status")));
        require(PHASES.contains(input.get("phase")));
        String message = text(input.get("message"), 20000, true);
        Object url = input.get("sourceUrl");
        require(url == null || Schemas.linkUrl().safeParse(url).success());
        Instant created = timestamp(input.get("createdAt")), updated = timestamp(input.get("updatedAt"));
        require(!updated.isBefore(created));
        var utc = new java.time.format.DateTimeFormatterBuilder().appendInstant(3).toFormatter();
        input.put("createdAt", utc.format(created)); input.put("updatedAt", utc.format(updated));
        long expected = integer(input.get("expectedRevision"), 9_007_199_254_740_990L);
        require(input.get("files") instanceof List<?>);
        List<Object> rawFiles = Js.asArray(input.get("files"));
        require(rawFiles.size() <= 10);
        List<Original> files = new ArrayList<>();
        List<Object> fingerprintFiles = new ArrayList<>();
        Set<String> ids = new HashSet<>();
        long total = 0;
        for (Object item : rawFiles) {
            var f = object(item, Set.of("id", "name", "mimeType", "size", "contentBase64"));
            require(ids.add(identifier(f.get("id"))));
            String name = text(f.get("name"), 20000, false);
            require(EXTENSIONS.contains(name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT)));
            text(f.get("mimeType"), 20000, false);
            long size = integer(f.get("size"), 10 * 1024 * 1024);
            require(size > 0);
            String encoded = text(f.get("contentBase64"), 4 * ((10 * 1024 * 1024 + 2) / 3), true);
            byte[] bytes;
            try { bytes = Base64.getDecoder().decode(encoded); }
            catch (IllegalArgumentException e) { throw new Failure(400, "internal_invalid_original"); }
            require(bytes.length == size && Base64.getEncoder().encodeToString(bytes).equals(encoded));
            total += size;
            require(total <= 25 * 1024 * 1024);
            files.add(new Original(f, bytes));
            fingerprintFiles.add(obj("name", f.get("name"), "mimeType", f.get("mimeType"), "content", encoded));
        }
        boolean link = "link".equals(input.get("kind"));
        require(link ? url != null && files.isEmpty() && message.equals(url) : url == null && (!message.isBlank() || !files.isEmpty()));
        Object reply = input.get("reply"), error = input.get("error");
        String status = (String) input.get("status");
        if (status.equals("completed")) {
            require("completed".equals(input.get("phase")) && error == null);
            input.put("reply", validateReply(reply, link, url, files));
        } else {
            require(reply == null);
            if (status.equals("failed")) {
                var failure = object(error, Set.of("code", "error"));
                text(failure.get("code"), 20000, false);
                text(failure.get("error"), 20000, true);
            } else {
                require(error == null && !"completed".equals(input.get("phase")));
                require(!status.equals("queued") || "preparing".equals(input.get("phase")));
            }
        }
        var identity = obj("message", message, "sourceUrl", url, "conversationId", input.get("conversationId"),
                "kind", input.get("kind"), "files", fingerprintFiles);
        input.remove("expectedRevision");
        return new Publication(input, files, expected, hash(identity), hash(input));
    }

    private static Object validateReply(Object raw, boolean link, Object url, List<Original> files) {
        require(raw instanceof Map<?, ?>);
        var reply = Js.asObject(raw);
        for (String key : List.of("id", "kind", "content")) text(reply.get(key), 20000, false);
        require("assistant".equals(reply.get("role")) && reply.containsKey("analysis"));
        String kind = (String) reply.get("kind");
        if (kind.equals("general")) {
            require(reply.get("analysis") == null && !reply.containsKey("update"));
            if (reply.containsKey("updatedActivityId")) text(reply.get("updatedActivityId"), 20000, false);
        } else if (kind.equals("activity-update")) {
            require(!link && files.isEmpty() && reply.get("analysis") == null);
            require(ActivityChatUpdate.validAction(reply.get("update")));
        } else {
            var parsed = Schemas.REPLY.safeParse(reply);
            require(parsed.success());
            reply = Js.asObject(parsed.data());
            require(link == kind.equals("link-analysis"));
            require(link ? Objects.equals(reply.get("sourceUrl"), url) : !reply.containsKey("sourceUrl"));
            List<Object> names = Js.asArray(Js.get(reply.get("analysis"), "files")).stream().map(f -> Js.get(f, "name")).toList();
            require(names.equals(files.stream().map(f -> f.value().get("name")).toList()));
        }
        // 선택 필드 외에 원본 bytes 등 임의 필드를 정본 reply에 넣지 않는다.
        require(Set.of("id", "role", "kind", "content", "analysis", "update", "sourceUrl", "activityCreated", "updatedActivityId")
                .containsAll(reply.keySet()));
        if (reply.containsKey("sourceUrl")) require(Schemas.linkUrl().safeParse(reply.get("sourceUrl")).success());
        if (reply.containsKey("activityCreated")) require(reply.get("activityCreated") instanceof Boolean);
        return reply;
    }

    public record Result(int status, Map<String, Object> job) {}

    public static Result publish(Database db, String jobId, Object raw) {
        Publication p = validate(jobId, raw);
        Map<String, Object> in = p.value();
        return db.transaction(() -> {
            if (db.get("SELECT job_id FROM internal_job_tombstones WHERE job_id = ? OR request_id = ? OR analysis_id = ?",
                    hash(jobId), hash(in.get("requestId")), hash(in.get("analysisId"))) != null) throw new Failure(409, "internal_job_retired");
            Map<String, Object> existing = db.get("""
                    SELECT j.*, p.revision, p.input_signature, p.publish_signature FROM ai_chat_jobs j
                    LEFT JOIN internal_chat_publications p ON p.job_id = j.id WHERE j.request_key = ?""", in.get("requestId"));
            if (existing != null) {
                if (!Objects.equals(existing.get("fingerprint"), in.get("requestFingerprint"))
                        || !Objects.equals(existing.get("input_signature"), p.inputSignature())) throw new Failure(409, "internal_input_conflict");
                if (p.expected() == 0) return new Result(200, snapshot(db, (String) existing.get("id")));
                if (!jobId.equals(existing.get("id")) || !in.get("analysisId").equals(existing.get("analysis_id")))
                    throw new Failure(409, "internal_identity_conflict");
                Map<String, Object> current = snapshot(db, jobId);
                if (!Objects.equals(current.get("createdAt"), in.get("createdAt"))
                        || !Objects.equals(hash(current.get("files")), hash(in.get("files")))) throw new Failure(409, "internal_input_conflict");
                if (Objects.equals(existing.get("publish_signature"), p.signature())) return new Result(200, current);
                if (((Number) existing.get("revision")).longValue() != p.expected()) throw new Failure(409, "internal_revision_conflict");
                String before = (String) existing.get("status"), after = (String) in.get("status");
                if (List.of("completed", "failed").contains(before)
                        || (before.equals("running") && after.equals("queued"))
                        || PHASES.indexOf((String) in.get("phase")) < PHASES.indexOf((String) existing.get("phase"))
                        || timestamp(in.get("updatedAt")).isBefore(timestamp(current.get("updatedAt"))))
                    throw new Failure(409, "internal_state_conflict");
                validateReferences(db, in.get("reply"));
                db.run("UPDATE analyses SET reply = ? WHERE id = ?", Json.stringify(in.get("reply")), in.get("analysisId"));
                var metadata = metadata(in);
                db.run("UPDATE ai_chat_jobs SET status = ?, phase = ?, error = ?, input_json = ?, updated_at = ? WHERE id = ?",
                        in.get("status"), in.get("phase"), Json.stringify(in.get("error")), Json.stringify(metadata), in.get("updatedAt"), jobId);
                db.run("UPDATE internal_chat_publications SET revision = revision + 1, publish_signature = ? WHERE job_id = ?", p.signature(), jobId);
                return new Result(200, snapshot(db, jobId));
            }
            if (p.expected() != 0) throw new Failure(409, "internal_revision_conflict");
            if (db.get("SELECT id FROM analyses WHERE id = ?", in.get("analysisId")) != null
                    || db.get("SELECT id FROM ai_chat_jobs WHERE id = ?", jobId) != null) throw new Failure(409, "internal_identity_conflict");
            for (Original f : p.files()) if (db.get("SELECT id FROM files WHERE id = ?", f.value().get("id")) != null)
                throw new Failure(409, "internal_original_conflict");
            validateReferences(db, in.get("reply"));
            db.run("INSERT INTO analyses (id, conversation_id, message, reply, created_at) VALUES (?, ?, ?, ?, ?)",
                    in.get("analysisId"), in.get("conversationId"), in.get("message"), Json.stringify(in.get("reply")), in.get("createdAt"));
            for (Original f : p.files()) db.run("INSERT INTO files (id, analysis_id, name, mime_type, size, content) VALUES (?, ?, ?, ?, ?, ?)",
                    f.value().get("id"), in.get("analysisId"), f.value().get("name"), f.value().get("mimeType"), f.value().get("size"), f.bytes());
            db.run("""
                    INSERT INTO ai_chat_jobs (id, request_key, fingerprint, analysis_id, kind, status, phase, error, input_json, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", jobId, in.get("requestId"), in.get("requestFingerprint"), in.get("analysisId"),
                    in.get("kind"), in.get("status"), in.get("phase"), Json.stringify(in.get("error")), Json.stringify(metadata(in)), in.get("createdAt"), in.get("updatedAt"));
            db.run("INSERT INTO internal_chat_publications (job_id, revision, input_signature, publish_signature) VALUES (?, 1, ?, ?)", jobId, p.inputSignature(), p.signature());
            return new Result(201, snapshot(db, jobId));
        });
    }
    private static Map<String, Object> metadata(Map<String, Object> in) {
        var copy = new LinkedHashMap<>(in);
        copy.remove("files"); copy.remove("reply");
        return copy;
    }
    private static void validateReferences(Database db, Object reply) {
        if (reply == null) return;
        Object activityId = Js.opt(Js.opt(Js.get(reply, "analysis"), "activity"), "id");
        if ("activity-update".equals(Js.get(reply, "kind"))) activityId = Js.path(reply, "update", "activityId");
        if (Js.truthy(Js.get(reply, "updatedActivityId"))) activityId = Js.get(reply, "updatedActivityId");
        if (!Js.nullish(activityId) && db.get("SELECT id FROM activities WHERE id = ?", activityId) == null)
            throw new Failure(404, "internal_activity_missing");
    }

    public static Map<String, Object> snapshot(Database db, String jobId) {
        identifier(jobId);
        Map<String, Object> row = db.get("""
                SELECT j.*, p.revision, a.message, a.reply, a.conversation_id FROM ai_chat_jobs j
                JOIN internal_chat_publications p ON p.job_id = j.id JOIN analyses a ON a.id = j.analysis_id WHERE j.id = ?""", jobId);
        if (row == null) throw new Failure(404, "internal_job_missing");
        var result = Js.asObject(Json.parse((String) row.get("input_json")));
        result.put("message", row.get("message"));
        result.put("reply", Json.parse((String) row.get("reply")));
        result.put("status", row.get("status")); result.put("phase", row.get("phase"));
        result.put("error", row.get("error") == null ? null : Json.parse((String) row.get("error")));
        result.put("updatedAt", row.get("updated_at"));
        List<Object> files = new ArrayList<>();
        for (var f : db.all("SELECT * FROM files WHERE analysis_id = ? ORDER BY rowid", row.get("analysis_id")))
            files.add(obj("id", f.get("id"), "name", f.get("name"), "mimeType", f.get("mime_type"), "size", f.get("size"),
                    "contentBase64", Base64.getEncoder().encodeToString((byte[]) f.get("content"))));
        result.put("files", files); result.put("revision", row.get("revision"));
        return result;
    }

    /** 정본 reply/원본 변경과 같은 트랜잭션에서 호출한다. */
    public static void changed(Database db, Object analysisId) {
        db.run("""
                UPDATE internal_chat_publications SET revision = revision + 1, publish_signature = NULL
                WHERE job_id IN (SELECT id FROM ai_chat_jobs WHERE analysis_id = ?)""", analysisId);
        db.run("UPDATE ai_chat_jobs SET updated_at = ? WHERE analysis_id = ? AND id IN (SELECT job_id FROM internal_chat_publications)", Js.nowIso(), analysisId);
    }

    public static void rememberReset(Database db) {
        for (var row : db.all("""
                SELECT j.id, j.request_key, j.analysis_id FROM ai_chat_jobs j JOIN internal_chat_publications p ON p.job_id = j.id"""))
            db.run("INSERT OR IGNORE INTO internal_job_tombstones (job_id, request_id, analysis_id) VALUES (?, ?, ?)",
                    hash(row.get("id")), hash(row.get("request_key")), hash(row.get("analysis_id")));
    }

    public static void recover(Database db) {
        db.transaction(() -> {
            for (var row : db.all("""
                    SELECT j.id FROM ai_chat_jobs j JOIN internal_chat_publications p ON p.job_id = j.id
                    WHERE j.status IN ('queued', 'running')""")) {
                db.run("UPDATE ai_chat_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?",
                        Json.stringify(obj("code", "server_restarted", "error", "서버가 재시작되어 분석이 중단됐어요. 새 요청으로 다시 전송해 주세요.")), Js.nowIso(), row.get("id"));
                db.run("UPDATE internal_chat_publications SET revision = revision + 1, publish_signature = NULL WHERE job_id = ?", row.get("id"));
            }
        });
    }
}
