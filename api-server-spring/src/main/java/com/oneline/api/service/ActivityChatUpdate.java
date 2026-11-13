package com.oneline.api.service;

import com.oneline.api.db.Database;
import com.oneline.api.js.Js;
import com.oneline.api.js.Json;
import com.oneline.api.validation.Schemas;
import com.oneline.api.zod.Z;
import com.oneline.api.zod.Z.ZObject;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

import static com.oneline.api.js.Js.obj;
import static com.oneline.api.validation.Schemas.text;
import static com.oneline.api.web.HttpError.fail;
import static com.oneline.api.zod.Z.array;
import static com.oneline.api.zod.Z.enumOf;
import static com.oneline.api.zod.Z.object;

/** 기존 src/activity-chat-update.js */
public final class ActivityChatUpdate {
    private ActivityChatUpdate() {
    }

    private static final ZObject ACTION = object(
            "activityId", text(),
            "activityName", text(),
            "updates", array(object(
                    "field", enumOf("role", "status", "summary", "startDate", "endDate"),
                    "value", text().nullable()
            ).strict()).min(1).max(5)
    ).strict().superRefine((raw, ctx) -> {
        Map<String, Object> action = Js.asObject(raw);
        List<Object> updates = Js.asArray(action.get("updates"));
        List<Object> fields = new ArrayList<>();
        for (Object item : updates) fields.add(Js.get(item, "field"));
        if (new LinkedHashSet<>(fields).size() != fields.size()) ctx.addIssue("수정 항목이 중복됐어요.");
        for (Object item : updates) {
            Object field = Js.get(item, "field"), value = Js.get(item, "value");
            if (Js.strictEquals(field, "status") && value != null && !List.of("진행 중", "완료").contains(value)) {
                ctx.addIssue("지원하지 않는 상태예요.");
            }
            if ((Js.strictEquals(field, "startDate") || Js.strictEquals(field, "endDate")) && value != null
                    && !Schemas.activityDate().safeParse(value).success()) {
                ctx.addIssue("활동 날짜를 확인해 주세요.");
            }
        }
    });

    public record Result(LinkedHashMap<String, Object> body, boolean changed, Object updatedActivityId) {
    }

    public static boolean validAction(Object value) {
        return ACTION.safeParse(value).success();
    }

    // 완료된 AI 작업의 허용된 필드만 적용한다. 재조회·재요청은 같은 결과를 돌려주며 다시 수정하지 않는다.
    public static Result apply(Database db, Object analysisId) {
        return db.transaction(() -> {
            Map<String, Object> draft = db.get("""
                    SELECT a.*, j.status AS job_status, j.kind AS job_kind FROM analyses a
                          JOIN ai_chat_jobs j ON j.analysis_id = a.id WHERE a.id = ?""", analysisId);
            if (draft == null) throw fail(404, "수정 요청을 찾을 수 없어요.");
            if (!Js.strictEquals(draft.get("job_status"), "completed")) throw fail(409, "요청 해석이 끝난 뒤 다시 확인해 주세요.");
            if (!Js.strictEquals(draft.get("job_kind"), "chat")
                    || db.get("SELECT id FROM files WHERE analysis_id = ? LIMIT 1", analysisId) != null) {
                throw fail(400, "첨부 없는 채팅 요청에서만 활동 정보를 수정할 수 있어요.");
            }
            Object reply = Json.parse((String) draft.get("reply"));
            LinkedHashMap<String, Object> result = obj("analysisId", analysisId, "conversationId", draft.get("conversation_id"), "reply", reply);
            if (Js.strictEquals(Js.get(reply, "kind"), "general") && Js.truthy(Js.get(reply, "updatedActivityId"))) {
                return new Result(result, false, null);
            }
            if (!Js.strictEquals(Js.get(reply, "kind"), "activity-update") || Js.get(reply, "analysis") != null) {
                throw fail(400, "활동 수정 요청이 아니에요.");
            }
            Z.SafeParseResult parsed = ACTION.safeParse(Js.get(reply, "update"));
            if (!parsed.success()) throw fail(400, "수정할 항목과 값을 확인하지 못했어요. 다시 알려 주세요.");
            Map<String, Object> action = Js.asObject(parsed.data());
            Map<String, Object> activity = db.get("SELECT * FROM activities WHERE id = ?", action.get("activityId"));
            if (activity == null) throw fail(404, "수정할 활동이 없어졌어요. 활동명을 다시 알려 주세요.");
            LinkedHashMap<String, Object> updates = new LinkedHashMap<>();
            for (Object item : Js.asArray(action.get("updates"))) updates.put((String) Js.get(item, "field"), Js.get(item, "value"));
            // 날짜 일부만 바꾸는 경우에도 기존 반대쪽 날짜와 함께 검증한다.
            if (updates.containsKey("startDate") || updates.containsKey("endDate")) {
                Z.SafeParseResult checked = Schemas.ACTIVITY_PERIOD.safeParse(obj(
                        "start", updates.containsKey("startDate") ? updates.get("startDate") : activity.get("start_date"),
                        "end", updates.containsKey("endDate") ? updates.get("endDate") : activity.get("end_date")));
                if (!checked.success()) {
                    throw fail(400, "기간을 수정하지 못했어요. 유효한 날짜이며 시작일이 종료일보다 앞서는지 확인해 주세요.");
                }
                Map<String, Object> period = Js.asObject(checked.data());
                Object start = period.get("start"), end = period.get("end");
                db.run("UPDATE activities SET start_date = ?, end_date = ?, period = ? WHERE id = ?", start, end,
                        Js.truthy(start) || Js.truthy(end) ? Js.str(Js.coalesce(start, "미확인")) + " ~ " + Js.str(Js.coalesce(end, "")) : null,
                        activity.get("id"));
            }
            for (String field : List.of("role", "status", "summary")) {
                if (updates.containsKey(field)) db.run("UPDATE activities SET " + field + " = ? WHERE id = ?", updates.get(field), activity.get("id"));
            }
            // 직접 수정 시 이전 자동 분석은 중단한다. 다음 자료 저장의 자동 분석은 그대로 허용한다.
            // 실제 수정이 완료된 시각을 최근 활동 정렬에도 반영한다. 중복 요청은 위에서 반환해 시각을 다시 바꾸지 않는다.
            db.run("UPDATE activities SET metadata_status = 'idle', metadata_error = NULL, updated_at = ? WHERE id = ?",
                    Js.nowIso(), activity.get("id"));
            Map<String, String> labels = Map.of("role", "역할", "status", "상태", "summary", "전체 요약", "startDate", "시작일", "endDate", "종료일");
            List<String> lines = new ArrayList<>();
            for (Object item : Js.asArray(action.get("updates"))) {
                lines.add(labels.get((String) Js.get(item, "field")) + ": " + Js.str(Js.coalesce(Js.get(item, "value"), "미설정")));
            }
            LinkedHashMap<String, Object> completed = obj("id", Js.get(reply, "id"), "role", "assistant", "kind", "general",
                    "analysis", null, "updatedActivityId", activity.get("id"),
                    "content", Js.str(activity.get("name")) + " 활동 정보를 수정했어요.\n" + String.join("\n", lines));
            db.run("UPDATE analyses SET reply = ? WHERE id = ?", Json.stringify(completed), analysisId);
            InternalChatJobs.changed(db, analysisId);
            LinkedHashMap<String, Object> body = new LinkedHashMap<>(result);
            body.put("reply", completed);
            return new Result(body, true, activity.get("id"));
        });
    }
}
