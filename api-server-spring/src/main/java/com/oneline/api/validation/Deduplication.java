package com.oneline.api.validation;

import com.oneline.api.js.Js;
import com.oneline.api.zod.Z;
import java.util.*;
import static com.oneline.api.zod.Z.*;

public final class Deduplication {
    private Deduplication() {}
    private static Z.ZString id() { return string().min(1).max(20000).refine(v -> !((String) v).isBlank(), "빈 ID입니다."); }
    public static final Z.ZObject MATCH = object("activityId", id(), "recordId", id(), "fileId", id()).strict();
    public static final Z.ZObject SCHEMA = object(
            "schemaVersion", literal("file-dedup-v1"), "activityId", id().nullable(),
            "files", array(object("inputIndex", number().integer().min(0).max(9),
                    "status", enumOf("new", "duplicate", "pending"), "matches", array(MATCH).max(20),
                    "duplicateOfInputIndex", number().integer().min(0).max(9).optional()).strict()).min(1).max(10),
            "saveBlocked", bool()).strict().superRefine((raw, ctx) -> {
        Map<String, Object> value = Js.asObject(raw);
        boolean blocked = false;
        var files = Js.asArray(value.get("files"));
        for (int index = 0; index < files.size(); index++) {
            var file = Js.asObject(files.get(index));
            if (((Number) file.get("inputIndex")).intValue() != index) { ctx.addIssue("파일 순서가 일치하지 않습니다."); continue; }
            var matches = Js.asArray(file.get("matches"));
            boolean repeated = file.containsKey("duplicateOfInputIndex");
            String status = (String) file.get("status");
            if (repeated && (((Number) file.get("duplicateOfInputIndex")).intValue() >= index || !matches.isEmpty() || !status.equals("duplicate")))
                ctx.addIssue("중복 첨부 참조가 올바르지 않습니다.");
            if (status.equals("new") && (value.get("activityId") == null || !matches.isEmpty())
                    || status.equals("pending") && value.get("activityId") != null
                    || status.equals("duplicate") && !repeated && (value.get("activityId") == null || matches.isEmpty()))
                ctx.addIssue("중복 판정 범위가 올바르지 않습니다.");
            Set<Object> ids = new HashSet<>();
            for (Object match : matches) {
                if (!ids.add(Js.get(match, "fileId")) || value.get("activityId") != null && !Objects.equals(value.get("activityId"), Js.get(match, "activityId")))
                    ctx.addIssue("중복 자료 참조가 올바르지 않습니다.");
            }
            blocked |= status.equals("duplicate");
        }
        if (!Objects.equals(value.get("saveBlocked"), blocked)) ctx.addIssue("저장 차단 상태가 일치하지 않습니다.");
    });
}
