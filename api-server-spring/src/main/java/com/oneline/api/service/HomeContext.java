package com.oneline.api.service;

import com.oneline.api.db.Database;
import com.oneline.api.js.Js;
import com.oneline.api.js.Json;

import java.util.*;
import static com.oneline.api.js.Js.obj;

/** 읽기 전용 홈 분석 문맥. conversationId는 사용자 인증값이 아니다. */
public final class HomeContext {
    private HomeContext() {}

    public static Map<String, Object> read(Database db, String conversationId) {
        InternalChatJobs.identifier(conversationId);
        List<Object> activities = new ArrayList<>(), records = new ArrayList<>();
        Set<Object> activityIds = new HashSet<>();
        for (var row : db.all("SELECT * FROM activities ORDER BY COALESCE(updated_at, '') DESC, id LIMIT 50")) {
            var activity = Activities.activityInformation(row);
            activity.remove("period");
            activity.put("startDate", row.get("start_date")); activity.put("endDate", row.get("end_date"));
            activities.add(activity); activityIds.add(row.get("id"));
        }
        if (!activityIds.isEmpty()) {
            String placeholders = String.join(",", Collections.nCopies(activityIds.size(), "?"));
            for (var row : db.all("SELECT * FROM records WHERE activity_id IN (" + placeholders + ") ORDER BY created_at DESC, id LIMIT 50", activityIds.toArray())) {
                records.add(obj("id", row.get("id"), "activityId", row.get("activity_id"), "message", row.get("message"),
                        "summary", Js.path(Json.parse((String) row.get("reply")), "analysis", "summary")));
            }
        }
        long totalActivities = ((Number) db.get("SELECT COUNT(*) AS n FROM activities").get("n")).longValue();
        long totalRecords = ((Number) db.get("SELECT COUNT(*) AS n FROM records").get("n")).longValue();
        var context = obj("activities", activities, "records", records);
        String json = Json.stringify(context);
        if (json.codePointCount(0, json.length()) > 100000) throw new InternalChatJobs.Failure(400, "internal_context_too_large");

        List<Object> messages = new ArrayList<>();
        Object active = null;
        boolean pending = false;
        var recent = db.all("""
                SELECT a.*, r.activity_id AS saved_activity_id FROM analyses a LEFT JOIN records r ON r.analysis_id = a.id
                WHERE a.conversation_id = ? AND NOT EXISTS
                (SELECT 1 FROM ai_chat_jobs j WHERE j.analysis_id = a.id AND j.status != 'completed')
                ORDER BY a.created_at DESC, a.id DESC LIMIT 6""", conversationId);
        // 일반 대화가 6회를 넘더라도 마지막 활동 문맥은 유지한다.
        var targets = db.all("""
                SELECT a.*, r.activity_id AS saved_activity_id FROM analyses a LEFT JOIN records r ON r.analysis_id = a.id
                WHERE a.conversation_id = ? AND NOT EXISTS
                (SELECT 1 FROM ai_chat_jobs j WHERE j.analysis_id = a.id AND j.status != 'completed')
                AND (r.activity_id IS NOT NULL OR json_extract(a.reply, '$.updatedActivityId') IS NOT NULL
                     OR json_extract(a.reply, '$.analysis.activity') IS NOT NULL)
                ORDER BY a.created_at DESC, a.id DESC LIMIT 1""", conversationId);
        for (var row : targets) {
            Object reply = Json.parse((String) row.get("reply"));
            Object candidate = row.get("saved_activity_id");
            if (candidate == null) candidate = Js.get(reply, "updatedActivityId");
            Object proposal = Js.opt(Js.get(reply, "analysis"), "activity");
            if (Js.nullish(candidate) && "existing".equals(Js.opt(proposal, "match"))) candidate = Js.opt(proposal, "id");
            if (!Js.nullish(candidate)) active = activityIds.contains(candidate) ? candidate : null;
            else if (row.get("saved_activity_id") == null
                    && ("new".equals(Js.opt(proposal, "match")) || "unresolved".equals(Js.opt(proposal, "match")))) {
                pending = true;
            }
        }
        Collections.reverse(recent);
        for (var row : recent) {
            Object reply = Json.parse((String) row.get("reply"));
            messages.add(obj("role", "user", "content", clip((String) row.get("message"))));
            Object content = Js.get(reply, "content");
            messages.add(obj("role", "assistant", "content", clip(content instanceof String s ? s : "")));
        }
        return obj("context", context, "selection", obj("activitiesTotal", totalActivities, "activitiesIncluded", activities.size(),
                "recordsTotal", totalRecords, "recordsIncluded", records.size(),
                "truncated", totalActivities > activities.size() || totalRecords > records.size()),
                "activeActivityId", active, "activeActivityPending", pending, "recentMessages", messages);
    }

    private static String clip(String value) {
        return value.codePointCount(0, value.length()) <= 2000 ? value : value.substring(0, value.offsetByCodePoints(0, 2000));
    }
}
