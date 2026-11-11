package com.oneline.api.validation;

import com.oneline.api.js.Js;
import com.oneline.api.zod.WhatwgUrl;
import com.oneline.api.zod.Z;
import com.oneline.api.zod.Z.Schema;
import com.oneline.api.zod.Z.ZObject;
import com.oneline.api.zod.Z.ZString;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import static com.oneline.api.zod.Z.array;
import static com.oneline.api.zod.Z.bool;
import static com.oneline.api.zod.Z.enumOf;
import static com.oneline.api.zod.Z.literal;
import static com.oneline.api.zod.Z.number;
import static com.oneline.api.zod.Z.object;
import static com.oneline.api.zod.Z.string;
import static com.oneline.api.zod.Z.withDefault;

/** 기존 src/validation.js 의 스키마 정의 */
public final class Schemas {
    private Schemas() {
    }

    /** z.string().trim().min(1).max(20000) */
    public static ZString text() {
        return string().trim().min(1).max(20000);
    }

    public static final ZObject ARCHIVE_QUERY = object(
            "q", withDefault(string().max(500), ""),
            "category", withDefault(string().trim().min(1).max(200), "all"),
            "status", withDefault(enumOf("all", "진행 중", "완료"), "all"),
            "sort", withDefault(enumOf("recent", "materials", "oldest"), "recent")
    ).strict();

    private static final Pattern ACTIVITY_DATE = Pattern.compile("^\\d{4}-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\\d|3[01]))?\\z");
    private static final Pattern ISO_DAY = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}\\z");

    /** 월 단위/일 단위 날짜를 허용하며 실제 달력 날짜도 검사한다. */
    public static ZString activityDate() {
        return string()
                .regex(ACTIVITY_DATE, "/^\\d{4}-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\\d|3[01]))?$/")
                .refine(value -> {
                    String text = (String) value;
                    String day = text.length() == 7 ? text + "-01" : text;
                    return isCalendarDay(day);
                }, "유효한 날짜를 입력해 주세요.");
    }

    /** new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day */
    static boolean isCalendarDay(String day) {
        if (!ISO_DAY.matcher(day).matches()) return false;
        try {
            LocalDate.parse(day, DateTimeFormatter.ISO_LOCAL_DATE);
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }

    public static ZObject activityPeriod() {
        return object("start", activityDate().nullable(), "end", activityDate().nullable()).strict()
                .refine(raw -> {
                    Map<String, Object> value = Js.asObject(raw);
                    Object start = value.get("start"), end = value.get("end");
                    if (!Js.truthy(start) || !Js.truthy(end)) return true;
                    String s = (String) start, e = (String) end;
                    return Js.slice(s, 0, 7).compareTo(Js.slice(e, 0, 7)) <= 0
                            && (s.length() != 10 || e.length() != 10 || s.compareTo(e) <= 0);
                }, "종료일은 시작일보다 빠를 수 없습니다.");
    }

    public static final ZObject ACTIVITY_PERIOD = activityPeriod();

    public static ZObject activityMetadata() {
        return object(
                "category", string().trim().min(1).max(200)
                        .refine(value -> !List.of("all", "전체").contains(value), "전체는 활동 유형으로 사용할 수 없습니다.")
                        .nullable(),
                "status", enumOf("진행 중", "완료").nullable(),
                "role", text().nullable(),
                "period", activityPeriod().nullable(),
                "summary", text().nullable()
        ).strict();
    }

    private static ZObject activityProposal() {
        return activityMetadata().partial().extend(
                "name", text(),
                "confidence", enumOf("high", "medium", "low").nullable(),
                "id", text().nullable().optional(),
                "match", enumOf("existing", "new", "unresolved").optional()
        ).superRefine((raw, ctx) -> {
            Map<String, Object> value = Js.asObject(raw);
            Object match = value.getOrDefault("match", Js.UNDEFINED);
            Object id = value.getOrDefault("id", Js.UNDEFINED);
            if (Js.strictEquals(match, "existing") && !Js.truthy(id)
                    || (Js.strictEquals(match, "new") || Js.strictEquals(match, "unresolved")) && !Js.nullish(id)) {
                ctx.addIssue("활동 연결 상태와 ID가 일치하지 않습니다.");
            }
        });
    }

    /** linkSchema.shape.url */
    public static ZString linkUrl() {
        return string().trim().min(1).max(4096).url().refine(value -> {
            WhatwgUrl url = WhatwgUrl.parse((String) value);
            return url != null && (url.protocol.equals("http:") || url.protocol.equals("https:"))
                    && url.username.isEmpty() && url.password.isEmpty();
        }, "HTTP 또는 HTTPS 링크를 입력해 주세요.");
    }

    private static ZObject change() {
        return object("before", text(), "after", text(), "category", text(), "evidence", array(text()).max(100));
    }

    /** 외부 JSON은 프론트 TypeScript 타입과 별개로 서버에서 검증한다. */
    public static final ZObject REPLY = object(
            "id", text(),
            "role", literal("assistant"),
            "kind", enumOf("text-analysis", "file-analysis", "no-change", "batch-analysis", "link-analysis"),
            "content", text(),
            "activityCreated", bool().optional(),
            "sourceUrl", linkUrl().optional(),
            "analysis", object(
                    "activity", activityProposal(),
                    "materialType", text(),
                    "stage", text().nullable(),
                    "summary", text(),
                    "noChangeMessage", text().optional(),
                    "changes", array(change()).max(100),
                    "files", array(object("name", text(), "materialType", text(), "previousVersion", text().nullable())).max(100),
                    "groups", array(object("materialType", text(), "count", number().integer().positive())).max(100),
                    "suggestedSaveMode", enumOf("record-change", "version-only", "archive")
            )
    );

    public static final ZObject SAVE = object(
            "activityId", text().optional(),
            "newActivity", activityMetadata().extend("name", text()).optional(),
            "activityUpdates", activityMetadata().optional(),
            "analysisId", text().optional(),
            "reply", REPLY.optional(),
            "message", withDefault(string().max(20000), ""),
            "classification", object("materialType", text()).optional()
    ).strict()
            .refine(raw -> {
                Map<String, Object> v = Js.asObject(raw);
                return Js.truthy(v.getOrDefault("analysisId", Js.UNDEFINED)) != Js.truthy(v.getOrDefault("reply", Js.UNDEFINED));
            }, "analysisId 또는 reply 중 하나를 보내주세요.")
            .refine(raw -> {
                Map<String, Object> v = Js.asObject(raw);
                return Js.truthy(v.getOrDefault("activityId", Js.UNDEFINED)) != Js.truthy(v.getOrDefault("newActivity", Js.UNDEFINED));
            }, "기존 활동 ID 또는 새 활동 정보 중 하나를 보내주세요.")
            .refine(raw -> {
                Map<String, Object> v = Js.asObject(raw);
                return !Js.truthy(v.getOrDefault("activityUpdates", Js.UNDEFINED)) || Js.truthy(v.getOrDefault("activityId", Js.UNDEFINED));
            }, "기존 활동 정보 수정에는 활동 ID가 필요합니다.");

    public static final ZObject EDIT = object(
            "activityId", text().optional(),
            "materialType", text().optional(),
            "summary", text().optional(),
            "content", text().optional(),
            "changes", array(change()).max(100).optional(),
            "activityUpdates", activityMetadata().optional()
    ).strict().refine(raw -> !Js.asObject(raw).isEmpty(), "수정할 값을 보내주세요.");

    public static final ZObject CHAT_UPDATE_REQUEST = object("analysisId", text()).strict();

    public static Schema textSchema() {
        return text();
    }

    public static ZString plainString() {
        return Z.string();
    }
}
