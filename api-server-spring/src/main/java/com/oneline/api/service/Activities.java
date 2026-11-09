package com.oneline.api.service;

import com.oneline.api.db.Database;
import com.oneline.api.js.Js;
import com.oneline.api.validation.Schemas;
import com.oneline.api.web.HttpError;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

import static com.oneline.api.js.Js.obj;

/** 기존 src/activities.js */
public final class Activities {
    private Activities() {
    }

    private static final List<String> STATUSES = List.of("진행 중", "완료");

    // AI 요청 시 넘길 기존 활동 문맥과 저장 응답에 사용할 공통 구조다.
    public static LinkedHashMap<String, Object> activityInformation(Map<String, Object> row) {
        Object startDate = row.get("start_date"), endDate = row.get("end_date");
        return obj(
                "id", row.get("id"),
                "name", row.get("name"),
                "category", Js.coalesce(row.get("category"), null),
                "status", row.get("status") instanceof String s && STATUSES.contains(s) ? s : null,
                "role", Js.coalesce(row.get("role"), null),
                "summary", Js.coalesce(row.get("summary"), null),
                "period", Js.truthy(startDate) || Js.truthy(endDate)
                        ? obj("start", Js.coalesce(startDate, null), "end", Js.coalesce(endDate, null))
                        : null);
    }

    public static List<Object> contextActivities(Database db) {
        List<Object> activities = new ArrayList<>();
        for (Map<String, Object> row : db.all("SELECT * FROM activities ORDER BY rowid")) activities.add(activityInformation(row));
        return activities;
    }

    // 반드시 기록 저장 트랜잭션 안에서 호출한다. AI 후보만으로는 DB를 변경하지 않는다.
    public static Map<String, Object> resolveActivity(Database db, Object newActivity, Object activityId, Object activityUpdates,
                                                      Function<Object, Map<String, Object>> findActivity) {
        if (Js.truthy(newActivity)) {
            Map<String, Object> candidate = Js.asObject(newActivity);
            if (db.get("SELECT id FROM activities WHERE name = ?", candidate.get("name")) != null) {
                throw HttpError.fail(409, "같은 이름의 활동이 있습니다. 기존 활동을 선택해 주세요.");
            }
            String id = Js.randomUUID();
            db.run("INSERT INTO activities (id, name) VALUES (?, ?)", id, candidate.get("name"));
            applyActivityMetadata(db, id, candidate);
            return findActivity.apply(id);
        }
        Map<String, Object> target = findActivity.apply(activityId);
        if (Js.truthy(activityUpdates)) applyActivityMetadata(db, target.get("id"), Js.asObject(activityUpdates));
        return findActivity.apply(target.get("id"));
    }

    public static void applyActivityMetadata(Database db, Object id, Map<String, Object> metadata) {
        // null은 미확인 값이다. 기존 값을 지우거나 덮어쓰지 않는다.
        for (String field : List.of("category", "status", "role", "summary")) {
            Object value = metadata.getOrDefault(field, Js.UNDEFINED);
            if (!Js.nullish(value)) db.run("UPDATE activities SET " + field + " = ? WHERE id = ?", value, id);
        }
        Object period = metadata.getOrDefault("period", Js.UNDEFINED);
        if (Js.truthy(Js.opt(period, "start")) || Js.truthy(Js.opt(period, "end"))) {
            Map<String, Object> current = db.get("SELECT start_date, end_date FROM activities WHERE id = ?", id);
            Map<String, Object> parsed = Js.asObject(Schemas.ACTIVITY_PERIOD.parse(obj(
                    "start", Js.coalesce(Js.get(period, "start"), current.get("start_date")),
                    "end", Js.coalesce(Js.get(period, "end"), current.get("end_date")))));
            Object start = parsed.get("start"), end = parsed.get("end");
            db.run("UPDATE activities SET start_date = ?, end_date = ?, period = ? WHERE id = ?",
                    start, end, Js.str(Js.coalesce(start, "미확인")) + " ~ " + Js.str(Js.coalesce(end, "")), id);
        }
    }

    // 저장·수정과 같은 트랜잭션에서 호출한다. 기록 이동은 출발/도착 활동 모두 변경된다.
    public static void touchActivities(Database db, List<Object> ids, String now) {
        LinkedHashSet<Object> unique = new LinkedHashSet<>(ids);
        for (Object id : unique) db.run("UPDATE activities SET updated_at = ? WHERE id = ?", now, id);
    }
}
