package com.oneline.api.service;

import com.oneline.api.db.Database;
import com.oneline.api.js.Js;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static com.oneline.api.js.Js.obj;

/** 기존 src/home.js */
public final class Home {
    private Home() {
    }

    // 홈과 나의 발자국이 같은 활동 집계·자료 ID를 사용한다. 미저장 초안은 포함하지 않는다.
    public static LinkedHashMap<String, Object> readHomeRecent(Database db) {
        Map<Object, LinkedHashMap<String, Object>> cache = new HashMap<>();
        java.util.function.Function<Object, LinkedHashMap<String, Object>> archive = id -> {
            if (!cache.containsKey(id)) cache.put(id, Archive.readArchive(db, id));
            return cache.get(id);
        };
        List<Object> activities = new ArrayList<>();
        for (Map<String, Object> row : db.all("SELECT id FROM activities WHERE updated_at IS NOT NULL ORDER BY updated_at DESC, rowid DESC LIMIT 3")) {
            LinkedHashMap<String, Object> summary = new LinkedHashMap<>(archive.apply(row.get("id")));
            summary.remove("folders");
            summary.remove("timeline");
            activities.add(summary);
        }

        List<Object> records = new ArrayList<>();
        // 최초 확정 저장 시각으로 정렬한다. 수정·활동 이동은 추가 시각을 바꾸지 않는다.
        for (Map<String, Object> row : db.all("SELECT id, activity_id FROM records ORDER BY created_at DESC, rowid DESC")) {
            LinkedHashMap<String, Object> activity = archive.apply(row.get("activity_id"));
            if (activity == null) throw new Js.TypeError("Cannot read properties of null (reading 'folders')");
            List<Map<String, Object>> files = new ArrayList<>();
            for (Map<String, Object> file : Archive.allFiles(activity)) {
                if (Js.strictEquals(file.get("recordId"), row.get("id"))) files.add(file);
            }
            files.sort((a, b) -> Double.compare(((Number) a.get("recordPosition")).doubleValue(), ((Number) b.get("recordPosition")).doubleValue()));
            for (Map<String, Object> file : files) {
                records.add(obj("id", file.get("id"), "recordId", row.get("id"), "activityId", activity.get("id"),
                        "activityName", activity.get("title"), "title", file.get("name"), "materialType", file.get("type"),
                        "kind", file.get("kind"), "savedAt", file.get("savedAt")));
                if (records.size() == 3) return obj("activities", activities, "records", records);
            }
        }
        return obj("activities", activities, "records", records);
    }
}
