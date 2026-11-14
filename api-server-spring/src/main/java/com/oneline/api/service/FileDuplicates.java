package com.oneline.api.service;

import com.oneline.api.db.Database;
import com.oneline.api.js.Js;
import com.oneline.api.js.Json;
import java.security.MessageDigest;
import java.util.*;
import static com.oneline.api.js.Js.obj;

/** 기존 단일 데이터셋의 확정 자료만 조회한다. 사용자 ID를 요청으로 받지 않는다. */
public final class FileDuplicates {
    private FileDuplicates() {}
    public static final String VERSION = "file-dedup-v1";

    public static final class Problem extends RuntimeException {
        public final int status;
        public final String code;
        public final List<Object> duplicates;
        public Problem(int status, String code, String message, List<Object> duplicates) {
            super(message, null, false, false);
            this.status = status; this.code = code; this.duplicates = duplicates;
        }
        public Map<String, Object> body() {
            var body = obj("code", code, "error", getMessage());
            if (code.equals("duplicate_files")) body.put("duplicates", duplicates);
            return body;
        }
    }
    private static Problem invalid() { return new Problem(400, "duplicate_invalid_input", "중복 조회 입력을 확인해 주세요.", List.of()); }
    public static String hash(byte[] bytes) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (java.security.NoSuchAlgorithmException error) { throw new IllegalStateException(error); }
    }
    public static String originalHash(Map<String, Object> file) {
        if (!(file.get("content") instanceof byte[] bytes) || bytes.length == 0 || bytes.length > 10 * 1024 * 1024
                || !(file.get("size") instanceof Number size) || size.doubleValue() != bytes.length)
            throw new Problem(503, "duplicate_lookup_unavailable", "보관된 원본을 확인하지 못했어요.", List.of());
        return hash(bytes);
    }

    private static void indexSavedFiles(Database db, Object activityId) {
        for (var file : db.all("""
                SELECT f.* FROM files f JOIN records r ON r.analysis_id = f.analysis_id
                LEFT JOIN file_hashes h ON h.file_id = f.id WHERE h.file_id IS NULL
                AND (? IS NULL OR r.activity_id = ?)""", activityId, activityId)) {
            String hash = originalHash(file);
            db.run("INSERT INTO file_hashes (file_id, sha256, size) VALUES (?, ?, ?)", file.get("id"), hash, file.get("size"));
        }
    }

    private static List<Object> matches(Database db, Object activityId, String hash, long size, Object excludedAnalysis) {
        List<Object> matches = new ArrayList<>();
        for (var row : db.all("""
                SELECT r.activity_id, r.id AS record_id, f.id AS file_id FROM file_hashes h
                JOIN files f ON f.id = h.file_id JOIN records r ON r.analysis_id = f.analysis_id
                WHERE h.sha256 = ? AND h.size = ? AND (? IS NULL OR r.activity_id = ?)
                  AND (? IS NULL OR f.analysis_id != ?)
                ORDER BY r.activity_id, r.id, f.id LIMIT 21""", hash, size, activityId, activityId, excludedAnalysis, excludedAnalysis)) {
            matches.add(obj("activityId", row.get("activity_id"), "recordId", row.get("record_id"), "fileId", row.get("file_id")));
        }
        if (matches.size() > 20) throw new Problem(422, "duplicate_lookup_limit", "일치 자료가 조회 한도를 초과했어요.", List.of());
        return matches;
    }

    public static Map<String, Object> check(Database db, Object raw) {
        if (!(raw instanceof Map<?, ?>)) throw invalid();
        var input = Js.asObject(raw);
        if (!input.keySet().equals(Set.of("schemaVersion", "activityId", "files"))) throw invalid();
        if (!VERSION.equals(input.get("schemaVersion"))) throw new Problem(422, "unsupported_schema_version", "지원하지 않는 중복 조회 버전이에요.", List.of());
        Object activityId = input.get("activityId");
        if (activityId != null) {
            if (!(activityId instanceof String id) || id.isBlank() || id.length() > 20000) throw invalid();
            if (db.get("SELECT id FROM activities WHERE id = ?", activityId) == null)
                throw new Problem(404, "duplicate_activity_missing", "활동을 찾을 수 없어요.", List.of());
        }
        if (!(input.get("files") instanceof List<?> files) || files.isEmpty() || files.size() > 10) throw invalid();
        Set<Integer> seen = new HashSet<>();
        for (Object value : files) {
            if (!(value instanceof Map<?, ?>)) throw invalid();
            var file = Js.asObject(value);
            if (!file.keySet().equals(Set.of("inputIndex", "sha256", "size"))
                    || !(file.get("inputIndex") instanceof Number index) || index.doubleValue() != index.intValue()
                    || index.intValue() < 0 || index.intValue() > 9 || !seen.add(index.intValue())
                    || !(file.get("sha256") instanceof String hash) || !hash.matches("[0-9a-f]{64}")
                    || !(file.get("size") instanceof Number size) || size.doubleValue() != size.longValue()
                    || size.longValue() < 1 || size.longValue() > 10 * 1024 * 1024) throw invalid();
        }
        try {
            indexSavedFiles(db, activityId);
            List<Object> results = new ArrayList<>();
            for (Object rawFile : files) {
                var file = Js.asObject(rawFile);
                var found = matches(db, activityId, (String) file.get("sha256"), ((Number) file.get("size")).longValue(), null);
                results.add(obj("inputIndex", file.get("inputIndex"), "status", activityId == null ? "pending" : found.isEmpty() ? "new" : "duplicate", "matches", found));
            }
            return obj("schemaVersion", VERSION, "activityId", activityId, "files", results);
        } catch (Database.DatabaseError error) {
            throw new Problem(503, "duplicate_lookup_unavailable", "중복 자료를 조회하지 못했어요.", List.of());
        }
    }

    /** 저장 트랜잭션 안에서 실제 원본으로 검사한다. AI 플래그는 저장 허가로 사용하지 않는다. */
    public static void guardSave(Database db, Object analysisId, Object activityId) {
        var originals = db.all("SELECT * FROM files WHERE analysis_id = ? ORDER BY rowid", analysisId);
        if (originals.isEmpty()) return;
        long total = 0;
        for (var original : originals) {
            if (!(original.get("content") instanceof byte[] bytes))
                throw new Problem(503, "duplicate_lookup_unavailable", "보관된 원본을 확인하지 못했어요.", List.of());
            total += bytes.length;
        }
        if (originals.size() > 10 || total > 25 * 1024 * 1024)
            throw new Problem(503, "duplicate_lookup_unavailable", "보관된 원본의 개수·용량을 확인하지 못했어요.", List.of());
        indexSavedFiles(db, activityId);
        List<Object> duplicates = new ArrayList<>();
        Map<String, Integer> first = new HashMap<>();
        for (int i = 0; i < originals.size(); i++) {
            var file = originals.get(i);
            String hash = originalHash(file);
            long size = ((Number) file.get("size")).longValue();
            Integer previous = first.putIfAbsent(hash + ":" + size, i);
            List<Object> found = new ArrayList<>();
            if (previous == null) for (Object match : matches(db, activityId, hash, size, analysisId)) {
                var saved = db.get("SELECT * FROM files WHERE id = ?", Js.get(match, "fileId"));
                if (saved == null || !hash.equals(originalHash(saved)))
                    throw new Problem(503, "duplicate_lookup_unavailable", "기존 자료의 원본을 확인하지 못했어요.", List.of());
                if (Arrays.equals((byte[]) saved.get("content"), (byte[]) file.get("content"))) found.add(match);
            }
            if (previous != null || !found.isEmpty()) {
                var duplicate = obj("inputIndex", i, "matches", found);
                if (previous != null) duplicate.put("duplicateOfInputIndex", previous);
                duplicates.add(duplicate);
            }
            db.run("INSERT INTO file_hashes VALUES (?, ?, ?) ON CONFLICT(file_id) DO UPDATE SET sha256=excluded.sha256, size=excluded.size",
                    file.get("id"), hash, size);
        }
        if (!duplicates.isEmpty()) throw new Problem(409, "duplicate_files",
                "이미 저장되었거나 중복 첨부된 자료가 있어요. 중복 파일을 제외하고 다시 보내 주세요.", duplicates);
    }

    public static String signature(Database db, Object analysisId) {
        List<Object> files = new ArrayList<>();
        for (var file : db.all("SELECT * FROM files WHERE analysis_id = ? ORDER BY rowid", analysisId))
            files.add(List.of(file.get("id"), file.get("name"), file.get("size"), originalHash(file)));
        return Js.sha256Hex(Json.stringify(files));
    }

    public static Map<String, Object> verifiedNew(Object activityId, int count) {
        List<Object> files = new ArrayList<>();
        for (int i = 0; i < count; i++) files.add(obj("inputIndex", i, "status", "new", "matches", List.of()));
        return obj("schemaVersion", VERSION, "activityId", activityId, "files", files, "saveBlocked", false);
    }
}
