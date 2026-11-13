package com.oneline.api.service;

import com.oneline.api.db.Database;
import com.oneline.api.config.InternalServiceAuth;
import com.oneline.api.js.Js;
import com.oneline.api.js.Json;
import com.oneline.api.support.EventLoop;
import com.oneline.api.support.Fetch;
import com.oneline.api.validation.Schemas;
import com.oneline.api.zod.Z;

import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.function.BiConsumer;

import static com.oneline.api.js.Js.arr;
import static com.oneline.api.js.Js.obj;
import static com.oneline.api.web.HttpError.publicFail;

/** 기존 src/archive-delete.js */
public final class ArchiveDelete {
    private ArchiveDelete() {
    }

    // 대화는 남기되 삭제된 자료를 다시 저장하거나 활동 링크를 여는 카드로 복원하지 않는다.
    private static void retireDraft(Database db, Object analysisId, String content) {
        if (!Js.truthy(analysisId)) return;
        Map<String, Object> row = db.get("SELECT reply FROM analyses WHERE id = ?", analysisId);
        if (row == null) return;
        Object reply = Json.parse((String) row.get("reply"));
        db.run("UPDATE analyses SET reply = ? WHERE id = ?", Json.stringify(obj(
                "id", Js.get(reply, "id"), "role", "assistant", "kind", "general", "analysis", null,
                "content", Js.str(Js.get(reply, "content")) + "\n\n" + content)), analysisId);
        InternalChatJobs.changed(db, analysisId);
    }

    private static void retireDraft(Database db, Object analysisId) {
        retireDraft(db, analysisId, "이 기록의 자료는 삭제했어요.");
    }

    private static void clearMetadata(Database db, Object id) {
        db.run("""
                UPDATE activities SET summary = NULL, role = NULL, status = NULL,
                    start_date = NULL, end_date = NULL, period = NULL, metadata_status = 'idle',
                    metadata_fingerprint = NULL, metadata_error = NULL, metadata_model = NULL, metadata_updated_at = NULL,
                    updated_at = ? WHERE id = ?""", Js.nowIso(), id);
    }

    // 삭제된 근거를 포함한 전체 요약/배지를 부분적으로 신뢰할 수 없으므로 스냅샷 전체를 비운다.
    private static void invalidateJourney(Database db) {
        for (Map<String, Object> row : db.all("SELECT id, result_json FROM journey_analyses")) {
            Object result = Journey.emptyResult("기록이 삭제됐어요.", "남은 기록으로 성장 분석을 갱신해 주세요.");
            db.run("UPDATE journey_analyses SET source_fingerprint = ?, result_json = ? WHERE id = ?",
                    "deleted:" + Js.randomUUID(), Json.stringify(result), row.get("id"));
        }
    }

    public static void deleteActivity(Database db, Object id, Object confirmation) {
        db.transaction(() -> {
            Map<String, Object> activity = db.get("SELECT * FROM activities WHERE id = ?", id);
            if (activity == null) throw publicFail(404, "활동을 찾을 수 없어요.");
            if (!Js.strictEquals(confirmation, activity.get("name"))) throw publicFail(400, "활동명을 정확히 입력해 주세요.");
            for (Map<String, Object> record : db.all("SELECT analysis_id FROM records WHERE activity_id = ?", id)) {
                Object analysisId = record.get("analysis_id");
                if (Js.truthy(analysisId)) db.run("DELETE FROM files WHERE analysis_id = ?", analysisId);
                retireDraft(db, analysisId, "이 기록의 활동은 삭제했어요.");
            }
            db.run("DELETE FROM records WHERE activity_id = ?", id);
            // 미확정 제안/직접 수정 응답도 삭제한 활동으로 연결하지 않는다.
            for (Map<String, Object> row : db.all("SELECT id, reply FROM analyses")) {
                Object reply = Json.parse((String) row.get("reply"));
                if (Js.strictEquals(Js.opt(Js.opt(Js.get(reply, "analysis"), "activity"), "id"), id)
                        || Js.strictEquals(Js.get(reply, "updatedActivityId"), id)
                        || Js.strictEquals(Js.opt(Js.get(reply, "update"), "activityId"), id)) {
                    retireDraft(db, row.get("id"), "연결된 활동은 삭제했어요.");
                }
            }
            db.run("DELETE FROM activities WHERE id = ?", id);
            invalidateJourney(db);
        });
    }

    public static void deleteMaterial(Database db, EventLoop loop, Object activityId, Object fileId, String aiBaseUrl, InternalServiceAuth auth,
                                      BiConsumer<Object, Map<String, Object>> syncEvents) {
        Map<String, Object> detail = Archive.readArchiveFile(db, activityId, fileId);
        if (detail == null) throw publicFail(404, "이 활동에서 자료를 찾을 수 없어요.");
        Map<String, Object> file = Js.asObject(detail.get("file"));
        Map<String, Object> original = db.get("SELECT * FROM records WHERE id = ?", file.get("recordId"));
        ActivityMetadata.Snapshot snapshot = ActivityMetadata.activitySnapshot(db, activityId);
        Object analysisId = original.get("analysis_id");
        List<Map<String, Object>> remaining = Js.truthy(analysisId)
                ? db.all("SELECT id, name, mime_type, size, content FROM files WHERE analysis_id = ? AND id != ? ORDER BY rowid", analysisId, fileId)
                : List.of();
        Map<String, Object> nextReply = null;
        if (Js.strictEquals(file.get("kind"), "file") && !remaining.isEmpty()) {
            Fetch.Response response;
            try {
                String base = Fetch.aiBase(aiBaseUrl);
                List<Object> originals = new ArrayList<>();
                long totalBytes = 0;
                for (Map<String, Object> item : remaining) {
                    Object raw = item.get("content");
                    if (!(raw instanceof byte[] bytes) || bytes.length == 0 || bytes.length > 10 * 1024 * 1024
                            || !(item.get("size") instanceof Number size) || size.doubleValue() != bytes.length) {
                        throw new IllegalStateException("보관된 원본을 확인하지 못했습니다.");
                    }
                    totalBytes += bytes.length;
                    originals.add(obj("id", item.get("id"), "name", item.get("name"), "mimeType", item.get("mime_type"),
                            "size", bytes.length, "contentBase64", Base64.getEncoder().encodeToString(bytes)));
                }
                if (originals.size() > 10 || totalBytes > 25 * 1024 * 1024) {
                    throw new IllegalStateException("남은 원본이 분석 한도를 초과했습니다.");
                }
                Map<String, Object> activity = db.get("SELECT id, name, category FROM activities WHERE id = ?", activityId);
                String input = Json.stringify(obj("fileId", fileId, "recordReply", original.get("reply"),
                        "activity", activity, "files", originals));
                response = Fetch.post(loop, base + "/api/analyze/records/" + Js.encodeURIComponent(Js.str(original.get("id"))) + "/exclude-file",
                        input, 150000, null, auth);
            } catch (Fetch.FetchError | RuntimeException e) {
                throw publicFail(502, "남은 파일을 재분석하지 못해 삭제하지 않았어요. AI 서버를 확인하고 다시 시도해 주세요.");
            }
            Object body = response.jsonOrNull();
            Z.SafeParseResult parsed = Schemas.REPLY.safeParse(Js.opt(body, "reply"));
            List<Object> remainingIds = new ArrayList<>(), remainingNames = new ArrayList<>();
            for (Map<String, Object> item : remaining) {
                remainingIds.add(item.get("id"));
                remainingNames.add(item.get("name"));
            }
            if (!response.ok() || !parsed.success() || !Js.strictEquals(Js.get(body, "recordReply"), original.get("reply"))
                    || !java.util.Objects.equals(Json.stringify(Js.get(body, "fileIds")), Json.stringify(remainingIds))) {
                throw publicFail(502, "남은 파일의 분석 결과를 확인하지 못해 삭제하지 않았어요. 다시 시도해 주세요.");
            }
            nextReply = Js.asObject(parsed.data());
            Object nextAnalysis = nextReply.get("analysis");
            List<Object> nextNames = new ArrayList<>();
            for (Object item : Js.asArray(Js.get(nextAnalysis, "files"))) nextNames.add(Js.get(item, "name"));
            if (Js.truthy(nextReply.getOrDefault("sourceUrl", Js.UNDEFINED)) || !Js.asArray(Js.get(nextAnalysis, "changes")).isEmpty()
                    || !java.util.Objects.equals(Json.stringify(nextNames), Json.stringify(remainingNames))) {
                throw publicFail(502, "남은 파일의 분석 대상이 일치하지 않아 삭제하지 않았어요. 다시 시도해 주세요.");
            }
            Object oldReply = Json.parse((String) original.get("reply"));
            Js.set(nextAnalysis, "activity", Js.get(Js.get(oldReply, "analysis"), "activity"));
            nextReply.put("activityCreated", Js.get(oldReply, "activityCreated"));
        }
        Map<String, Object> finalReply = nextReply;
        db.transaction(() -> {
            ActivityMetadata.Snapshot current = ActivityMetadata.activitySnapshot(db, activityId);
            if (current == null || !current.fingerprint().equals(snapshot.fingerprint())) {
                throw publicFail(409, "삭제 중 활동 기록이 변경됐어요. 새로고침 후 다시 시도해 주세요.");
            }
            if (Js.strictEquals(file.get("kind"), "file")) db.run("DELETE FROM files WHERE id = ?", fileId);
            retireDraft(db, analysisId);
            if (finalReply != null) {
                db.run("UPDATE records SET message = '', reply = ?, updated_at = ? WHERE id = ?",
                        Json.stringify(finalReply), Js.nowIso(), original.get("id"));
                syncEvents.accept(original.get("id"), finalReply);
            } else {
                db.run("DELETE FROM records WHERE id = ?", original.get("id"));
            }
            clearMetadata(db, activityId);
            invalidateJourney(db);
        });
    }
}
