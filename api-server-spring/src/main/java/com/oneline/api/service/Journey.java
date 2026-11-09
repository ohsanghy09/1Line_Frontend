package com.oneline.api.service;

import com.oneline.api.db.Database;
import com.oneline.api.js.Js;
import com.oneline.api.js.Json;
import com.oneline.api.support.EventLoop;
import com.oneline.api.support.Fetch;
import com.oneline.api.zod.Z;
import com.oneline.api.zod.Z.ZObject;
import com.oneline.api.zod.Z.ZString;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import static com.oneline.api.js.Js.arr;
import static com.oneline.api.js.Js.obj;
import static com.oneline.api.web.HttpError.publicFail;
import static com.oneline.api.zod.Z.array;
import static com.oneline.api.zod.Z.bool;
import static com.oneline.api.zod.Z.literal;
import static com.oneline.api.zod.Z.number;
import static com.oneline.api.zod.Z.object;
import static com.oneline.api.zod.Z.string;

/** 기존 src/journey.js 와 src/journey-context.js */
public final class Journey {
    private Journey() {
    }

    // ---------------------------------------------------------------- journey-context.js

    public record Snapshot(List<Object> records, List<Object> files, String fingerprint) {
    }

    // Python의 journey_context와 같은 열·정렬·JSON 직렬화를 사용한다.
    // 빈 활동과 저장 전 분석 초안은 포함하지 않는다. 파일 본문 BLOB도 읽지 않는다.
    public static Snapshot journeySnapshot(Database db) {
        List<Object> records = new ArrayList<>();
        for (Map<String, Object> row : db.all("""
                SELECT r.id, r.activity_id, a.name, r.message, r.reply,
                    r.created_at, r.updated_at, a.category, a.role, a.summary, a.start_date, a.end_date
                    FROM records r JOIN activities a ON a.id = r.activity_id ORDER BY r.id""")) {
            records.add(new ArrayList<>(row.values()));
        }
        List<Object> files = new ArrayList<>();
        for (Map<String, Object> row : db.all("""
                SELECT r.id AS record_id, f.id, f.name FROM files f
                    JOIN records r ON r.analysis_id = f.analysis_id ORDER BY r.id, f.id""")) {
            files.add(new ArrayList<>(row.values()));
        }
        return new Snapshot(records, files, Js.sha256Hex(Json.stringify(arr(records, files))));
    }

    // ---------------------------------------------------------------- journey.js

    private static ZString text() {
        return string().trim().min(1);
    }

    private static ZString icon() {
        return string().trim().min(1).max(16);
    }

    // 이전 저장 결과에는 icon이 없을 수 있다. 새 분석의 아이콘은 공급자 경계에서 필수 검사한다.
    private static Z.ZArray options() {
        return array(object("value", text(), "label", text(), "icon", icon().optional()));
    }

    private static Z.ZArray evidence() {
        return array(object("recordId", text(), "quote", text())).min(1).max(20);
    }

    private static List<Object> values(Object options, String key) {
        List<Object> result = new ArrayList<>();
        for (Object option : Js.iterate(options)) result.add(Js.get(option, key));
        return result;
    }

    private static boolean includes(List<Object> list, Object value) {
        for (Object item : list) {
            if (Js.sameValueZero(item, value)) return true;
        }
        return false;
    }

    // 실제 공급자 응답과 저장 결과를 같은 계약으로 검증한다.
    public static final ZObject JOURNEY = object(
            "source", literal("api"),
            "summary", object("title", text(), "description", text(), "evidence", evidence().optional()),
            "badges", array(object("id", text(), "label", text(), "icon", icon().optional(), "evidence", evidence().optional())).max(10),
            "typeOptions", options(),
            "axisOptions", options(),
            "events", array(object(
                    "id", text(),
                    "occurredAt", string().regex(Pattern.compile("^(?!0000)\\d{4}-(0[1-9]|1[0-2])\\z"), "/^(?!0000)\\d{4}-(0[1-9]|1[0-2])$/"),
                    "activity", object("id", text().nullable(), "name", text()),
                    "type", text().refine(value -> !Js.strictEquals(value, "all"), null),
                    "axis", text().refine(value -> !Js.strictEquals(value, "all"), null),
                    "title", text(), "description", text(),
                    "comparison", object("before", text(), "after", text(), "evidence", array(text())).optional(),
                    "evidence", evidence().optional()
            )).max(20),
            "analysis", object(
                    "id", text().nullable(), "generatedAt", text().nullable(), "stale", bool(),
                    "recordCount", number().integer().nonnegative(), "currentRecordCount", number().integer().nonnegative(),
                    "model", text().nullable(), "promptVersion", text().nullable()
            ).optional()
    ).superRefine((raw, ctx) -> {
        Map<String, Object> data = Js.asObject(raw);
        List<Object> types = values(data.get("typeOptions"), "value");
        List<Object> axes = values(data.get("axisOptions"), "value");
        boolean invalidEvent = false;
        for (Object event : Js.iterate(data.get("events"))) {
            if (!includes(types, Js.get(event, "type")) || !includes(axes, Js.get(event, "axis"))) {
                invalidEvent = true;
                break;
            }
        }
        if (!includes(types, "all") || !includes(axes, "all") || !Js.unique(types) || !Js.unique(axes)
                || !Js.unique(values(data.get("events"), "id")) || !Js.unique(values(data.get("badges"), "id"))
                || invalidEvent) {
            ctx.addIssue("성장 이벤트 ID 또는 분류 선택지가 올바르지 않습니다.");
        }
    });

    public static LinkedHashMap<String, Object> readJourney(Database db) {
        return db.transaction(() -> {
            Snapshot snapshot = journeySnapshot(db);
            Map<String, Object> saved = db.get("SELECT * FROM journey_analyses ORDER BY created_at DESC, rowid DESC LIMIT 1");
            LinkedHashMap<String, Object> data = saved != null
                    ? new LinkedHashMap<>(Js.asObject(JOURNEY.parse(Json.parse((String) saved.get("result_json")))))
                    : obj("source", "api",
                    "summary", obj("title", "아직 성장 분석이 없어요.", "description", "홈에서 기록을 저장한 뒤 성장 분석을 실행해 주세요."),
                    "badges", new ArrayList<>(),
                    "typeOptions", arr(obj("value", "all", "label", "전체")),
                    "axisOptions", arr(obj("value", "all", "label", "전체 분야")),
                    "events", new ArrayList<>());
            data.put("analysis", obj(
                    "id", saved != null ? Js.coalesce(saved.get("id"), null) : null,
                    "generatedAt", saved != null ? Js.coalesce(saved.get("created_at"), null) : null,
                    "stale", saved != null && !Js.strictEquals(saved.get("source_fingerprint"), snapshot.fingerprint()),
                    "recordCount", saved != null ? Js.coalesce(saved.get("record_count"), 0.0) : 0.0,
                    "currentRecordCount", (double) snapshot.records().size(),
                    "model", saved != null ? Js.coalesce(saved.get("model"), null) : null,
                    "promptVersion", saved != null ? Js.coalesce(saved.get("prompt_version"), null) : null));
            return data;
        });
    }

    private static String nfkcLabel(Object label, boolean collapse) {
        String value = Js.trim(Normalizer.normalize(Js.requireString(label, "normalize"), Normalizer.Form.NFKC));
        if (collapse) value = Js.collapseWhitespace(value);
        return Js.toLowerCase(value);
    }

    private static final ZObject PROVIDER = object(
            "sourceFingerprint", string().regex(Pattern.compile("^[a-f0-9]{64}\\z"), "/^[a-f0-9]{64}$/"),
            "recordCount", number().integer().min(1).max(100),
            "model", text(),
            "promptVersion", text(),
            "result", JOURNEY
    ).superRefine((raw, ctx) -> {
        Map<String, Object> result = Js.asObject(Js.get(raw, "result"));
        List<Object> types = new ArrayList<>();
        for (Object option : Js.iterate(result.get("typeOptions"))) {
            if (!Js.strictEquals(Js.get(option, "value"), "all")) types.add(option);
        }
        List<Object> labels = new ArrayList<>();
        for (Object option : types) labels.add(nfkcLabel(Js.get(option, "label"), false));
        Set<Object> used = new HashSet<>();
        for (Object event : Js.iterate(result.get("events"))) used.add(Js.setKey(Js.get(event, "type")));
        List<Object> axes = new ArrayList<>();
        for (Object option : Js.iterate(result.get("axisOptions"))) {
            if (!Js.strictEquals(Js.get(option, "value"), "all")) axes.add(option);
        }
        List<Object> axisLabels = new ArrayList<>();
        for (Object option : axes) axisLabels.add(nfkcLabel(Js.get(option, "label"), true));
        Set<Object> usedAxes = new HashSet<>();
        for (Object event : Js.iterate(result.get("events"))) usedAxes.add(Js.setKey(Js.get(event, "axis")));

        boolean typeProblem = types.size() > 8 || !Js.unique(labels);
        if (!typeProblem) {
            for (Object option : types) {
                if (!Js.truthy(Js.get(option, "icon")) || !used.contains(Js.setKey(Js.get(option, "value")))) {
                    typeProblem = true;
                    break;
                }
            }
        }
        if (!typeProblem) {
            for (Object badge : Js.iterate(result.get("badges"))) {
                if (!Js.truthy(Js.get(badge, "icon"))) {
                    typeProblem = true;
                    break;
                }
            }
        }
        if (typeProblem) ctx.addIssue("분석 분류·아이콘이 누락되거나 중복됐습니다.");

        // 저장 결과 조회는 과거 고정 분야도 허용하고, 새 공급자 결과에만 동적 분야 계약을 적용한다.
        boolean axisProblem = axes.size() > 8 || !Js.unique(axisLabels);
        if (!axisProblem) {
            for (Object label : axisLabels) {
                if (List.of("전체", "전체 분야", "전체분야").contains(label)) {
                    axisProblem = true;
                    break;
                }
            }
        }
        if (!axisProblem) {
            for (Object option : axes) {
                if (Js.requireString(Js.get(option, "label"), "length").length() > 40
                        || !usedAxes.contains(Js.setKey(Js.get(option, "value")))) {
                    axisProblem = true;
                    break;
                }
            }
        }
        if (!axisProblem && usedAxes.size() != axes.size()) axisProblem = true;
        if (axisProblem) ctx.addIssue("성장 분야가 중복되거나 이벤트와 일치하지 않습니다.");
    });

    public static LinkedHashMap<String, Object> generateJourney(Database db, EventLoop loop, String aiBaseUrl) {
        Fetch.Response response;
        try {
            response = Fetch.post(loop, Fetch.aiBase(aiBaseUrl) + "/api/analyze/journey", null, 135_000, null);
        } catch (Fetch.FetchError error) {
            throw publicFail(error.timeout ? 504 : 502, error.timeout
                    ? "성장 분석 응답 시간이 초과됐어요. 다시 조회한 뒤 갱신해 주세요." : "AI 서버에 연결하지 못했어요. 실행 상태를 확인해 주세요.");
        }
        Object body = response.jsonOrNull();
        if (!response.ok()) {
            int status = List.of(409, 422, 429, 502, 503, 504).contains(response.status()) ? response.status() : 502;
            Object error = Js.opt(body, "error");
            throw publicFail(status, error instanceof String s ? s : "성장 분석 요청에 실패했어요.");
        }
        Z.SafeParseResult parsed = PROVIDER.safeParse(body);
        if (!parsed.success()) throw publicFail(502, "성장 분석 응답 형식을 확인할 수 없어요.");
        Map<String, Object> output = Js.asObject(parsed.data());
        Map<String, Object> result = Js.asObject(output.get("result"));
        db.transaction(() -> {
            Snapshot snapshot = journeySnapshot(db);
            if (!snapshot.fingerprint().equals(output.get("sourceFingerprint"))
                    || snapshot.records().size() != ((Number) output.get("recordCount")).doubleValue()) {
                throw publicFail(409, "분석 중 기록이 변경됐어요. 최신 기록으로 다시 분석해 주세요.");
            }
            Map<Object, List<Object>> records = new HashMap<>();
            for (Object row : snapshot.records()) records.put(Js.asArray(row).get(0), Js.asArray(row));
            java.util.function.Consumer<Object> check = references -> {
                if (!Js.truthy(Js.opt(references, "length"))) throw publicFail(502, "성장 분석의 근거 기록이 없어요.");
                for (Object item : Js.iterate(references)) {
                    List<Object> row = records.get(Js.get(item, "recordId"));
                    boolean matched = false;
                    if (row != null) {
                        Object quote = Js.get(item, "quote");
                        for (Object value : arr(row.get(3), Js.path(Json.parse((String) row.get(4)), "analysis", "summary"))) {
                            if (value instanceof String s && s.contains(Js.str(quote))) {
                                matched = true;
                                break;
                            }
                        }
                    }
                    if (!matched) throw publicFail(502, "성장 분석의 근거가 실제 기록과 일치하지 않아요.");
                }
            };
            check.accept(Js.get(result.get("summary"), "evidence"));
            for (Object badge : Js.iterate(result.get("badges"))) check.accept(Js.get(badge, "evidence"));
            for (Object event : Js.iterate(result.get("events"))) {
                Object evidence = Js.get(event, "evidence");
                check.accept(evidence);
                List<Object> evidenceRows = new ArrayList<>();
                for (Object item : Js.iterate(evidence)) evidenceRows.add(records.get(Js.get(item, "recordId")));
                List<Object> target = null;
                Object activityId = Js.get(Js.get(event, "activity"), "id");
                for (Object row : evidenceRows) {
                    if (Js.strictEquals(Js.asArray(row).get(1), activityId)) {
                        target = Js.asArray(row);
                        break;
                    }
                }
                List<Object> createdAt = new ArrayList<>();
                for (Object row : evidenceRows) createdAt.add(Js.asArray(row).get(5));
                Set<Object> recordIds = new HashSet<>();
                for (Object item : Js.iterate(evidence)) recordIds.add(Js.setKey(Js.get(item, "recordId")));
                boolean mismatch = target == null;
                if (!mismatch) {
                    List<Object> sorted = Js.defaultSort(createdAt);
                    Object latest = sorted.isEmpty() ? Js.UNDEFINED : sorted.get(sorted.size() - 1);
                    String month = Js.slice(Js.requireString(latest, "slice"), 0, 7);
                    mismatch = !Js.strictEquals(Js.get(event, "occurredAt"), month)
                            || Js.truthy(Js.get(event, "comparison")) && recordIds.size() < 2;
                }
                if (mismatch) throw publicFail(502, "성장 이벤트의 활동·날짜·비교 근거가 실제 기록과 일치하지 않아요.");
                Js.set(Js.get(event, "activity"), "name", target.get(2));
                Object comparison = Js.get(event, "comparison");
                if (Js.truthy(comparison)) {
                    List<Object> quotes = new ArrayList<>();
                    for (Object item : Js.iterate(evidence)) quotes.add(Js.get(item, "quote"));
                    Js.set(comparison, "evidence", quotes);
                }
            }
            String id = Js.randomUUID();
            // 재분석 결과는 별도 스냅샷이며 홈 기록과 Timeline을 수정하지 않는다.
            for (Object event : Js.iterate(result.get("events"))) Js.set(event, "id", Js.randomUUID());
            for (Object badge : Js.iterate(result.get("badges"))) Js.set(badge, "id", Js.randomUUID());
            db.run("INSERT INTO journey_analyses VALUES (?, ?, ?, ?, ?, ?, ?)",
                    id, snapshot.fingerprint(), output.get("recordCount"), Json.stringify(result), output.get("model"),
                    output.get("promptVersion"), Js.nowIso());
        });
        return readJourney(db);
    }
}
