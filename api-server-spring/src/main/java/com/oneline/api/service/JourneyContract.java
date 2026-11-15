package com.oneline.api.service;

import com.oneline.api.js.Js;
import com.oneline.api.js.Json;
import com.oneline.api.zod.Z;
import java.text.Normalizer;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.regex.Pattern;
import static com.oneline.api.js.Js.*;
import static com.oneline.api.zod.Z.*;

/** Journey v2의 구조 검증. 원문·활동 관계 검증은 Journey가 스냅샷 안에서 수행한다. */
public final class JourneyContract {
    private JourneyContract() { }
    public static final String SCHEMA = "journey-result-v2";
    public static final String CRITERIA = "growth-criteria-v1";
    public static final String PROMPT = "journey-v6";
    public static final List<String> TYPES = List.of("capability_expansion", "performance_improvement",
            "experience_accumulation", "efficiency_improvement", "experience_transfer");

    public static List<Object> typeOptions() {
        return arr(obj("value", "all", "label", "전체"),
                obj("value", TYPES.get(0), "label", "능력 확장"), obj("value", TYPES.get(1), "label", "성과 향상"),
                obj("value", TYPES.get(2), "label", "경험 축적"), obj("value", TYPES.get(3), "label", "효율성"),
                obj("value", TYPES.get(4), "label", "경험 전이"));
    }

    // Java의 UTF-16 길이가 아닌 계약의 유니코드 코드 포인트 수를 사용한다. 원문을 trim하지 않는다.
    static Z.ZString text(int max) {
        return string().refine(v -> !Js.trim((String) v).isEmpty()
                && ((String) v).codePointCount(0, ((String) v).length()) <= max, "문자열 길이가 올바르지 않습니다.");
    }
    static Z.ZString id() { return text(200); }
    static Z.ZString timestamp() {
        return text(80).refine(v -> {
            try { OffsetDateTime.parse((String) v); return true; }
            catch (RuntimeException e) { return false; }
        }, "시간대가 있는 ISO 시각이 필요합니다.");
    }
    static Z.ZArray evidence(int max) {
        return array(object("recordId", id(), "quote", text(800)).strict()).min(1).max(max);
    }
    private static final Z.ZObject COMPARISON = object(
            "before", text(500), "after", text(500), "condition", text(500),
            "beforeEvidence", evidence(10), "afterEvidence", evidence(10)).strict();
    private static final Z.ZObject TRANSFER = object(
            "sourceActivity", object("id", id().nullable(), "name", text(200)).strict(),
            "experience", text(500), "targetActivityId", id(), "application", text(500),
            "sourceEvidence", evidence(10), "applicationEvidence", evidence(10)).strict();
    private static final Z.ZObject ASSESSMENT = object(
            "type", enumOf(TYPES.toArray(String[]::new)), "reason", text(500), "evidence", evidence(10),
            "comparison", COMPARISON.optional(), "transfer", TRANSFER.optional()).strict().superRefine((raw, ctx) -> {
        Map<String, Object> a = asObject(raw);
        String type = (String) a.get("type");
        if (List.of("performance_improvement", "efficiency_improvement").contains(type) && !a.containsKey("comparison"))
            ctx.addIssue("이 유형에는 비교가 필요합니다.");
        if (type.equals("experience_transfer") != a.containsKey("transfer")) ctx.addIssue("경험 전이 정보가 올바르지 않습니다.");
        Set<String> all = evidenceKeys(a.get("evidence"));
        for (String role : List.of("comparison", "transfer")) {
            if (!a.containsKey(role)) continue;
            Map<String, Object> detail = asObject(a.get(role));
            for (String key : role.equals("comparison") ? List.of("beforeEvidence", "afterEvidence")
                    : List.of("sourceEvidence", "applicationEvidence")) {
                if (!all.containsAll(evidenceKeys(detail.get(key)))) ctx.addIssue("역할별 근거가 전체 판단 근거에 없습니다.");
            }
        }
    });
    private static final Z.ZObject EVENT = object(
            "id", id(), "occurredAt", string().regex(Pattern.compile("^(?!0000)\\d{4}-(0[1-9]|1[0-2])\\z"), "YYYY-MM"),
            "activity", object("id", id(), "name", text(200)).strict(), "axis", text(80),
            "title", text(120), "description", text(1000),
            "growthAssessments", array(ASSESSMENT).min(1).max(5)).strict().superRefine((raw, ctx) -> {
        if (!uniqueValues(get(raw, "growthAssessments"), "type")) ctx.addIssue("성장 유형이 중복됐습니다.");
    });

    public static final Z.ZObject RESULT = object(
            "schemaVersion", literal(SCHEMA), "criteriaVersion", literal(CRITERIA), "source", literal("api"),
            "summary", object("title", text(120), "description", text(2000), "evidence", evidence(20)).strict(),
            "badges", array(object("id", id(), "label", text(80), "icon", text(16), "evidence", evidence(5)).strict()).max(10),
            "typeOptions", array(object("value", text(80), "label", text(40)).strict()).min(6).max(6),
            "axisOptions", array(object("value", text(80), "label", text(40)).strict()).min(1).max(9),
            "events", array(EVENT).max(20)).strict().superRefine((raw, ctx) -> {
        Map<String, Object> data = asObject(raw);
        if (!Json.stringify(data.get("typeOptions")).equals(Json.stringify(typeOptions()))) ctx.addIssue("고정 성장 유형이 다릅니다.");
        List<Object> axes = asArray(data.get("axisOptions"));
        if (!axes.getFirst().equals(obj("value", "all", "label", "전체 분야"))
                || !uniqueValues(axes, "value") || !uniqueValues(data.get("events"), "id")
                || !uniqueValues(data.get("badges"), "id")) ctx.addIssue("선택지 또는 ID가 중복됐습니다.");
        Set<String> labels = new HashSet<>();
        Set<String> axisValues = new HashSet<>();
        for (Object option : axes.subList(1, axes.size())) {
            String label = Js.toLowerCase(Js.collapseWhitespace(Js.trim(Normalizer.normalize((String) get(option, "label"), Normalizer.Form.NFKC))));
            String value = (String) get(option, "value");
            if (value.equals("all") || List.of("전체", "전체 분야", "전체분야").contains(label) || !labels.add(label))
                ctx.addIssue("분야가 중복됐습니다.");
            axisValues.add(value);
        }
        Set<String> used = new HashSet<>();
        for (Object event : asArray(data.get("events"))) used.add((String) get(event, "axis"));
        if (!used.equals(axisValues)) ctx.addIssue("성장 분야와 이벤트가 일치하지 않습니다.");
        if (asArray(data.get("events")).isEmpty() && !asArray(data.get("badges")).isEmpty())
            ctx.addIssue("성장 판단 유보에는 배지를 생성하지 않습니다.");
    });

    public static final Z.ZObject PROVIDER = object(
            "schemaVersion", literal(SCHEMA), "criteriaVersion", literal(CRITERIA),
            "sourceFingerprint", string().regex(Pattern.compile("^[a-f0-9]{64}\\z"), "SHA-256"),
            "recordCount", number().integer().min(1).max(100), "model", text(200),
            "promptVersion", literal(PROMPT), "result", RESULT).strict();

    public static final Z.ZObject STORED = RESULT.extend(
            "summary", object("title", text(120), "description", text(2000), "evidence", evidence(20).optional()).strict(),
            "evidenceSources", array(object("recordId", id(), "activityId", id(), "activityName", text(200)).strict()).max(100));

    static Set<String> evidenceKeys(Object refs) {
        Set<String> keys = new HashSet<>();
        for (Object ref : asArray(refs)) keys.add(Json.stringify(arr(get(ref, "recordId"), get(ref, "quote"))));
        return keys;
    }
    private static boolean uniqueValues(Object items, String field) {
        Set<Object> seen = new HashSet<>();
        for (Object item : asArray(items)) if (!seen.add(get(item, field))) return false;
        return true;
    }
}
