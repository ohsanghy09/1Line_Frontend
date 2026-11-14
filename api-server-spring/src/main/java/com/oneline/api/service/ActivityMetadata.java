package com.oneline.api.service;

import com.oneline.api.db.Database;
import com.oneline.api.js.Js;
import com.oneline.api.js.Json;
import com.oneline.api.validation.Schemas;
import com.oneline.api.zod.Z;
import com.oneline.api.zod.Z.ZObject;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static com.oneline.api.js.Js.arr;
import static com.oneline.api.js.Js.obj;
import static com.oneline.api.validation.Schemas.text;
import static com.oneline.api.zod.Z.array;
import static com.oneline.api.zod.Z.enumOf;
import static com.oneline.api.zod.Z.literal;
import static com.oneline.api.zod.Z.number;
import static com.oneline.api.zod.Z.object;

/** 기존 src/activity-metadata.js 의 스냅샷·상태 조회·출력 검증 */
public final class ActivityMetadata {
    private ActivityMetadata() {
    }

    public record Snapshot(String fingerprint, List<Object> records, List<Object> files) {
    }

    // 입력 해시는 Python과 같은 배열·정렬·JSON 직렬화로 만든다. AI 출력 자체는 입력에 포함하지 않는다.
    public static Snapshot activitySnapshot(Database db, Object id) {
        Map<String, Object> activity = db.get("SELECT id, name, category FROM activities WHERE id = ?", id);
        if (activity == null) return null;
        List<Object> records = new ArrayList<>();
        for (Map<String, Object> row : db.all("SELECT id, message, reply, created_at, updated_at FROM records WHERE activity_id = ? ORDER BY id", id)) {
            records.add(arr(row.get("id"), row.get("message"), row.get("reply"), row.get("created_at"), row.get("updated_at")));
        }
        List<Object> files = new ArrayList<>();
        for (Map<String, Object> row : db.all("""
                SELECT r.id AS record_id, f.id, f.name FROM files f JOIN records r ON r.analysis_id = f.analysis_id
                    WHERE r.activity_id = ? ORDER BY r.id, f.id""", id)) {
            files.add(arr(row.get("record_id"), row.get("id"), row.get("name")));
        }
        String fingerprint = Js.sha256Hex(Json.stringify(arr(
                arr(activity.get("id"), activity.get("name"), activity.get("category")), records, files)));
        return new Snapshot(fingerprint, records, files);
    }

    /** 분리 AI에 전달할 문맥. 기존 스냅샷의 정렬과 해시는 그대로 사용한다. */
    public static LinkedHashMap<String, Object> requestBody(Map<String, Object> activity, Snapshot snapshot) {
        List<Object> records = new ArrayList<>();
        for (Object raw : snapshot.records()) {
            List<Object> row = Js.asArray(raw);
            Object analysis = Js.get(Json.parse((String) row.get(2)), "analysis");
            records.add(obj("id", row.get(0), "message", row.get(1), "summary", Js.get(analysis, "summary"),
                    "changes", Js.get(analysis, "changes"), "savedAt", row.get(3), "updatedAt", row.get(4)));
        }
        return obj("activity", obj("id", activity.get("id"), "name", activity.get("name"), "category", activity.get("category")),
                "previous", obj("summary", activity.get("summary"), "status", activity.get("status"), "role", activity.get("role"),
                        "start_date", activity.get("start_date"), "end_date", activity.get("end_date")),
                "records", records, "files", snapshot.files(), "recordCount", records.size(), "sourceFingerprint", snapshot.fingerprint());
    }

    public static String requestJson(Map<String, Object> activity, Snapshot snapshot) {
        if (snapshot.records().isEmpty() || snapshot.records().size() > 100) {
            throw new IllegalStateException("활동 정보 분석은 저장된 기록 1~100개를 대상으로 합니다.");
        }
        String json = Json.stringify(requestBody(activity, snapshot));
        if (json.codePointCount(0, json.length()) > 250000) {
            throw new IllegalStateException("활동 정보 분석 문맥이 허용 범위를 초과했습니다.");
        }
        return json;
    }

    private static Z.ZArray evidence() {
        return array(object("recordId", text(), "quote", text()).strict()).min(1).max(10);
    }

    private static ZObject fact() {
        return object("value", text(), "evidence", evidence()).strict();
    }

    private static ZObject dateFact() {
        return object("value", Z.string(), "evidence", evidence()).strict();
    }

    public static final ZObject OUTPUT = object(
            "sourceFingerprint", text(),
            "recordCount", number().integer().positive(),
            "model", text(),
            "promptVersion", literal("activity-metadata-analysis"),
            "metadata", object(
                    "summary", fact(),
                    "role", fact().nullable(),
                    "status", object("value", enumOf("진행 중", "완료"), "evidence", evidence()).strict().nullable(),
                    "period", object("start", dateFact().nullable(), "end", dateFact().nullable()).strict()
            ).strict()
    ).strict();

    public static LinkedHashMap<String, Object> readActivityAnalysis(Database db, Object id) {
        Map<String, Object> row = db.get("SELECT * FROM activities WHERE id = ?", id);
        if (row == null) return null;
        Snapshot snapshot = activitySnapshot(db, id);
        boolean review = !reviewFields(row).isEmpty();
        return obj(
                "status", Js.coalesce(row.get("metadata_status"), "idle"),
                "error", Js.coalesce(row.get("metadata_error"), review
                        ? "자료 삭제 전의 일부 활동 정보를 임시로 유지하고 있어요. 남은 자료로 재분석하거나 대화로 값을 확인해 주세요." : null),
                "updatedAt", Js.coalesce(row.get("metadata_updated_at"), null),
                "stale", review || !snapshot.records().isEmpty() && !Js.strictEquals(row.get("metadata_fingerprint"), snapshot.fingerprint()));
    }

    public static List<String> reviewFields(Map<String, Object> activity) {
        Object raw = activity.get("metadata_review_fields");
        if (!(raw instanceof String text)) return new ArrayList<>();
        Object parsed = Json.parseOrNull(text);
        List<String> result = new ArrayList<>();
        if (!(parsed instanceof List<?>)) return result;
        for (Object field : Js.asArray(parsed)) {
            if (field instanceof String name && List.of("status", "role", "start_date", "end_date", "period").contains(name)) result.add(name);
        }
        return result;
    }

    /** 사용자가 명시적으로 수정한 항목은 재확인 대상으로 남기지 않는다. */
    public static void confirmFields(Database db, Object id, java.util.Collection<String> fields) {
        Map<String, Object> activity = db.get("SELECT metadata_review_fields FROM activities WHERE id = ?", id);
        if (activity == null) return;
        List<String> review = reviewFields(activity);
        review.removeAll(fields);
        db.run("UPDATE activities SET metadata_review_fields = ? WHERE id = ?", Json.stringify(review), id);
    }

    static Map<String, Object> periodParse(Object start, Object end) {
        return Js.asObject(Schemas.ACTIVITY_PERIOD.parse(obj("start", start, "end", end)));
    }
}
