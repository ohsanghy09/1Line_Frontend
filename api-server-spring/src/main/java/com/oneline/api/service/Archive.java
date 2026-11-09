package com.oneline.api.service;

import com.oneline.api.db.Database;
import com.oneline.api.js.Js;
import com.oneline.api.js.Json;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

import static com.oneline.api.js.Js.obj;

/** 기존 src/archive.js */
public final class Archive {
    private Archive() {
    }

    private static final List<String> STATUSES = List.of("진행 중", "완료");

    // 확정 기록만 읽는다. 미저장 분석 초안과 원본 파일은 아카이브에 노출하지 않는다.
    public static LinkedHashMap<String, Object> readArchive(Database db, Object activityId) {
        Map<String, Object> activity = db.get("SELECT * FROM activities WHERE id = ?", activityId);
        if (activity == null) return null;
        List<Map<String, Object>> records = db.all("SELECT * FROM records WHERE activity_id = ? ORDER BY created_at, rowid", activityId);
        List<Map<String, Object>> materials = new ArrayList<>();
        Map<Object, List<Map<String, Object>>> materialsByRecord = new HashMap<>();
        for (Map<String, Object> record : records) {
            Object reply = Json.parse((String) record.get("reply"));
            Object analysis = Js.get(reply, "analysis");
            Object analysisId = record.get("analysis_id");
            Object uploadedAt = Js.UNDEFINED;
            List<Map<String, Object>> originals = List.of();
            if (Js.truthy(analysisId)) {
                Map<String, Object> row = db.get("SELECT created_at FROM analyses WHERE id = ?", analysisId);
                uploadedAt = row == null ? Js.UNDEFINED : row.get("created_at");
                originals = db.all("SELECT id, name FROM files WHERE analysis_id = ? ORDER BY rowid", analysisId);
            } else {
                uploadedAt = null;
            }
            // 자료 목록은 실제 첨부 원본과 명시적으로 저장한 링크만 사용한다. 입력한 채팅을 자료로 만들지 않는다.
            List<LinkedHashMap<String, Object>> entries = new ArrayList<>();
            if (!originals.isEmpty()) {
                Object analysisFiles = Js.get(analysis, "files");
                for (int index = 0; index < originals.size(); index++) {
                    Map<String, Object> file = originals.get(index);
                    Object fileType = Js.opt(Js.get(analysisFiles, Js.str((double) index)), "materialType");
                    entries.add(obj(
                            "id", file.get("id"), "name", file.get("name"),
                            "type", Js.coalesce(fileType, Js.get(analysis, "materialType")),
                            "kind", "file", "originalFileId", file.get("id")));
                }
            } else if (Js.truthy(Js.get(reply, "sourceUrl"))) {
                entries.add(obj(
                        "id", "record:" + Js.str(record.get("id")), "name", Js.get(reply, "sourceUrl"),
                        "type", Js.get(analysis, "materialType"), "kind", "link", "originalFileId", null));
            }
            List<Map<String, Object>> files = new ArrayList<>();
            for (int position = 0; position < entries.size(); position++) {
                LinkedHashMap<String, Object> file = new LinkedHashMap<>(entries.get(position));
                file.put("recordId", record.get("id"));
                file.put("recordPosition", (double) position);
                file.put("savedAt", record.get("created_at"));
                file.put("uploadedAt", Js.coalesce(uploadedAt, record.get("created_at")));
                file.put("updatedAt", record.get("updated_at"));
                file.put("summary", Js.get(analysis, "summary"));
                file.put("sourceUrl", Js.coalesce(Js.get(reply, "sourceUrl"), null));
                // 현재 계약은 기록 단위 요약이다. 다중 파일의 개별 내용 분석으로 간주하지 않는다.
                file.put("summaryScope", "record");
                files.add(file);
            }
            materials.addAll(files);
            materialsByRecord.put(record.get("id"), files);
        }

        List<Map<String, Object>> rows = db.all("""
                SELECT e.* FROM timeline_events e JOIN records r ON e.record_id = r.id
                    WHERE r.activity_id = ? ORDER BY e.created_at, e.rowid""", activityId);
        List<Object> timeline = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            Object change = Json.parse((String) row.get("change_json"));
            List<Map<String, Object>> files = materialsByRecord.getOrDefault(row.get("record_id"), List.of());
            List<Object> evidenceFileIds = new ArrayList<>(), evidenceLabels = new ArrayList<>();
            // 이전 계약의 근거는 이름 문자열이다. 동일 기록 안에서 유일한 경우에만 ID로 연결한다.
            for (Object label : Js.iterate(Js.get(change, "evidence"))) {
                List<Map<String, Object>> matches = new ArrayList<>();
                for (Map<String, Object> file : files) {
                    if (Js.strictEquals(file.get("name"), label)) matches.add(file);
                }
                boolean textEvidence = files.size() == 1 && !Js.strictEquals(files.get(0).get("kind"), "file")
                        && Js.sameValueZero(files.get(0).get("sourceUrl"), label);
                Map<String, Object> target = matches.size() == 1 ? matches.get(0) : textEvidence ? files.get(0) : null;
                if (target != null) evidenceFileIds.add(target.get("id"));
                else evidenceLabels.add(label);
            }
            List<Object> uniqueIds = new ArrayList<>();
            LinkedHashSet<Object> seen = new LinkedHashSet<>();
            for (Object id : evidenceFileIds) {
                if (seen.add(Js.setKey(id))) uniqueIds.add(id);
            }
            LinkedHashMap<String, Object> base = obj(
                    "id", row.get("id"), "occurredAt", row.get("created_at"), "title", Js.get(change, "category"),
                    "evidenceFileIds", uniqueIds, "evidenceLabels", evidenceLabels,
                    "change", obj("before", Js.get(change, "before"), "after", Js.get(change, "after")));
            if (Js.truthy(row.get("is_turning_point"))) {
                base.put("isTurningPoint", true);
                base.put("before", Js.get(change, "before"));
                base.put("after", Js.get(change, "after"));
                base.put("reason", Js.coalesce(Js.get(change, "reason"), "변화 이유가 저장되지 않았습니다."));
            } else {
                base.put("isTurningPoint", false);
                base.put("description", Js.get(change, "category"));
            }
            timeline.add(base);
        }

        // 분류명은 표시용이며 폴더 ID는 활동 ID와 분류명으로 안정적으로 구성한다.
        LinkedHashMap<Object, List<Object>> groups = new LinkedHashMap<>();
        LinkedHashMap<Object, Object> groupNames = new LinkedHashMap<>();
        for (Map<String, Object> file : materials) {
            Object type = file.get("type");
            Object key = Js.setKey(type);
            groups.computeIfAbsent(key, k -> new ArrayList<>()).add(file);
            groupNames.putIfAbsent(key, type);
        }
        List<Object> updatedValues = new ArrayList<>();
        if (Js.truthy(activity.get("updated_at"))) updatedValues.add(activity.get("updated_at"));
        for (Map<String, Object> record : records) {
            if (Js.truthy(record.get("updated_at"))) updatedValues.add(record.get("updated_at"));
        }
        List<Object> sorted = Js.defaultSort(updatedValues);
        Object updatedAt = sorted.isEmpty() ? null : Js.coalesce(sorted.get(sorted.size() - 1), null);

        List<Object> folders = new ArrayList<>();
        for (Map.Entry<Object, List<Object>> entry : groups.entrySet()) {
            Object name = groupNames.get(entry.getKey());
            folders.add(obj(
                    "id", Js.encodeURIComponent(Js.str(activity.get("id"))) + ":" + Js.encodeURIComponent(Js.str(name)),
                    "name", name, "materialsCount", (double) entry.getValue().size(), "files", entry.getValue()));
        }
        Object status = activity.get("status");
        return obj(
                "id", activity.get("id"), "title", activity.get("name"),
                "category", Js.coalesce(activity.get("category"), "미분류"),
                "status", status instanceof String s && STATUSES.contains(s) ? s : "미설정",
                "role", Js.coalesce(activity.get("role"), "미설정"),
                "period", Js.coalesce(activity.get("period"), "미설정"),
                "summary", Js.coalesce(activity.get("summary"), "활동 전체 요약이 아직 없습니다."),
                "updatedAt", updatedAt,
                "materialsCount", (double) materials.size(),
                "recordsCount", (double) records.size(),
                "metadataAnalysis", ActivityMetadata.readActivityAnalysis(db, activityId),
                "folders", folders,
                "timeline", timeline);
    }

    /** activity.folders.flatMap(folder => folder.files) */
    public static List<Map<String, Object>> allFiles(Map<String, Object> archive) {
        List<Map<String, Object>> files = new ArrayList<>();
        for (Object folder : Js.asArray(archive.get("folders"))) {
            for (Object file : Js.asArray(Js.asObject(folder).get("files"))) files.add(Js.asObject(file));
        }
        return files;
    }

    public static LinkedHashMap<String, Object> readArchiveFile(Database db, Object activityId, Object fileId) {
        LinkedHashMap<String, Object> activity = readArchive(db, activityId);
        if (activity == null) return null;
        Map<String, Object> file = null;
        for (Map<String, Object> item : allFiles(activity)) {
            if (Js.strictEquals(item.get("id"), fileId)) {
                file = item;
                break;
            }
        }
        if (file == null) return null;
        // 기존 DB에는 ID 기반 버전 관계가 없으므로 파일명으로 추측하지 않는다.
        List<Object> events = new ArrayList<>();
        for (Object event : Js.asArray(activity.get("timeline"))) {
            for (Object id : Js.asArray(Js.asObject(event).get("evidenceFileIds"))) {
                if (Js.sameValueZero(id, fileId)) {
                    events.add(event);
                    break;
                }
            }
        }
        return obj("activityId", activityId, "file", file, "events", events, "versionHistory", new ArrayList<>());
    }
}
