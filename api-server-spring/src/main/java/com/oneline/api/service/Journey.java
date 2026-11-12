package com.oneline.api.service;

import com.oneline.api.db.Database;
import com.oneline.api.js.Js;
import com.oneline.api.js.Json;
import com.oneline.api.support.EventLoop;
import com.oneline.api.support.Fetch;
import com.oneline.api.zod.Z;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.*;
import static com.oneline.api.js.Js.*;
import static com.oneline.api.web.HttpError.publicFail;
import static com.oneline.api.zod.Z.*;

/** 저장 기록의 성장 분석. 원본 기록·Timeline은 변경하지 않고 분석 스냅샷만 저장한다. */
public final class Journey {
    private Journey() { }

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


    private static final Z.ZObject INPUT_RECORD = object(
            "id", JourneyContract.id(), "activityId", JourneyContract.id(), "activityName", JourneyContract.text(200),
            "message", string(), "summary", JourneyContract.text(250000),
            "changes", array(object("before", string(), "after", string(), "category", string(),
                    "evidence", array(string())).strict()).max(100),
            "savedAt", JourneyContract.timestamp(), "updatedAt", JourneyContract.timestamp(),
            "activity", object("category", string().nullable(), "role", string().nullable(),
                    "summary", string().nullable(), "startDate", string().nullable(), "endDate", string().nullable()).strict(),
            "files", array(object("id", JourneyContract.id(), "name", string()).strict())).strict();

    /** 레거시 호환 데이터가 아니라 미분석·삭제 무효화 상태에 사용하는 새 계약의 빈 결과. */
    public static LinkedHashMap<String, Object> emptyResult(String title, String description) {
        return obj("schemaVersion", JourneyContract.SCHEMA, "criteriaVersion", JourneyContract.CRITERIA,
                "source", "api", "summary", obj("title", title, "description", description),
                "badges", arr(), "typeOptions", JourneyContract.typeOptions(),
                "axisOptions", arr(obj("value", "all", "label", "전체 분야")), "events", arr(), "evidenceSources", arr());
    }

    public static LinkedHashMap<String, Object> readJourney(Database db) {
        return db.transaction(() -> {
            Snapshot snapshot = journeySnapshot(db);
            Map<String, Object> saved = db.get("SELECT * FROM journey_analyses ORDER BY created_at DESC, rowid DESC LIMIT 1");
            LinkedHashMap<String, Object> data;
            if (saved == null) {
                data = emptyResult("아직 성장 분석이 없어요.", "홈에서 기록을 저장한 뒤 성장 분석을 실행해 주세요.");
            } else {
                Z.SafeParseResult parsed = JourneyContract.STORED.safeParse(Json.parse((String) saved.get("result_json")));
                if (!parsed.success() || !JourneyContract.CRITERIA.equals(saved.get("criteria_version")))
                    throw publicFail(500, "저장된 성장 분석의 계약 버전을 확인해 주세요.");
                data = new LinkedHashMap<>(asObject(parsed.data()));
                if (!((String) saved.get("source_fingerprint")).startsWith("deleted:")
                        && !asObject(data.get("summary")).containsKey("evidence"))
                    throw publicFail(500, "저장된 성장 분석의 근거가 없어요.");
            }
            data.put("analysis", obj(
                    "id", saved == null ? null : saved.get("id"),
                    "generatedAt", saved == null ? null : saved.get("created_at"),
                    "stale", saved != null && !snapshot.fingerprint().equals(saved.get("source_fingerprint")),
                    "recordCount", saved == null ? 0.0 : saved.get("record_count"),
                    "currentRecordCount", (double) snapshot.records().size(),
                    "model", saved == null ? null : saved.get("model"),
                    "promptVersion", saved == null ? null : saved.get("prompt_version")));
            return data;
        });
    }

    /** 한 스냅샷에서 요청을 구성한다. 해시용 열·직렬화는 기존 규칙을 보존한다. */
    static Map<String, Object> requestBody(Snapshot snapshot) {
        if (snapshot.records().isEmpty() || snapshot.records().size() > 100)
            throw publicFail(422, "성장 분석에는 저장 기록 1~100개가 필요해요.");
        List<Object> records = new ArrayList<>();
        for (Object raw : snapshot.records()) {
            List<Object> row = asArray(raw);
            Object analysis = get(Json.parse((String) row.get(4)), "analysis");
            List<Object> files = new ArrayList<>();
            for (Object f : snapshot.files()) {
                List<Object> file = asArray(f);
                if (row.getFirst().equals(file.getFirst())) files.add(obj("id", file.get(1), "name", file.get(2)));
            }
            Map<String, Object> record = obj("id", row.get(0), "activityId", row.get(1), "activityName", row.get(2),
                    "message", row.get(3), "summary", get(analysis, "summary"), "changes", get(analysis, "changes"),
                    "savedAt", row.get(5), "updatedAt", row.get(6),
                    "activity", obj("category", row.get(7), "role", row.get(8), "summary", row.get(9),
                            "startDate", row.get(10), "endDate", row.get(11)), "files", files);
            if (!INPUT_RECORD.safeParse(record).success())
                throw publicFail(422, "저장 기록의 성장 분석 입력 형식을 확인해 주세요.");
            records.add(record);
        }
        Map<String, Object> body = obj("schemaVersion", JourneyContract.SCHEMA, "criteriaVersion", JourneyContract.CRITERIA,
                "sourceFingerprint", snapshot.fingerprint(), "recordCount", (double) records.size(), "records", records);
        String json = Json.stringify(body);
        if (json.codePointCount(0, json.length()) > 250000) throw publicFail(422, "성장 분석 입력 크기 한도를 초과했어요.");
        return body;
    }

    public static LinkedHashMap<String, Object> generateJourney(Database db, EventLoop loop, String aiBaseUrl) {
        Snapshot sent = db.transaction(() -> journeySnapshot(db));
        String input = Json.stringify(requestBody(sent));
        Fetch.Response response;
        try {
            response = Fetch.post(loop, Fetch.aiBase(aiBaseUrl) + "/api/analyze/journey", input, 135_000, null);
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
        Z.SafeParseResult parsed = JourneyContract.PROVIDER.safeParse(body);
        if (!parsed.success()) throw publicFail(502, "성장 분석 응답 형식을 확인할 수 없어요.");
        Map<String, Object> output = asObject(parsed.data());
        Map<String, Object> result = asObject(output.get("result"));
        db.transaction(() -> {
            Snapshot current = journeySnapshot(db);
            if (!sent.fingerprint().equals(output.get("sourceFingerprint"))
                    || !sent.fingerprint().equals(current.fingerprint())
                    || sent.records().size() != ((Number) output.get("recordCount")).doubleValue())
                throw publicFail(409, "분석 중 기록이 변경됐어요. 최신 기록으로 다시 분석해 주세요.");
            Map<String, List<Object>> records = new LinkedHashMap<>();
            for (Object raw : current.records()) {
                List<Object> row = asArray(raw);
                records.put((String) row.getFirst(), row);
            }
            Map<String, Object> sources = new LinkedHashMap<>();
            checkEvidence(get(result.get("summary"), "evidence"), records, sources);
            for (Object badge : asArray(result.get("badges")))
                checkEvidence(get(badge, "evidence"), records, sources);
            for (Object event : asArray(result.get("events"))) validateEvent(event, records, sources);
            result.put("evidenceSources", new ArrayList<>(sources.values()));
            for (Object event : asArray(result.get("events"))) set(event, "id", Js.randomUUID());
            for (Object badge : asArray(result.get("badges"))) set(badge, "id", Js.randomUUID());
            db.run("""
                    INSERT INTO journey_analyses
                    (id, source_fingerprint, record_count, result_json, model, prompt_version, created_at, criteria_version)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    Js.randomUUID(), sent.fingerprint(), output.get("recordCount"), Json.stringify(result),
                    output.get("model"), output.get("promptVersion"), Js.nowIso(), JourneyContract.CRITERIA);
        });
        return readJourney(db);
    }

    private static void checkEvidence(Object refs, Map<String, List<Object>> records, Map<String, Object> sources) {
        for (Object ref : asArray(refs)) {
            String id = (String) get(ref, "recordId");
            String quote = (String) get(ref, "quote");
            List<Object> row = records.get(id);
            if (row == null || !(((String) row.get(3)).contains(quote)
                    || ((String) path(Json.parse((String) row.get(4)), "analysis", "summary")).contains(quote)))
                throw publicFail(502, "성장 분석의 근거가 실제 기록과 일치하지 않아요.");
            sources.putIfAbsent(id, obj("recordId", id, "activityId", row.get(1), "activityName", row.get(2)));
        }
    }

    private static boolean hasActivity(Object refs, Object activityId, Map<String, List<Object>> records) {
        for (Object ref : asArray(refs))
            if (records.get(get(ref, "recordId")).get(1).equals(activityId)) return true;
        return false;
    }

    private static void validateEvent(Object event, Map<String, List<Object>> records, Map<String, Object> sources) {
        Object activityId = get(get(event, "activity"), "id");
        List<Object> refs = new ArrayList<>();
        for (Object assessment : asArray(get(event, "growthAssessments"))) {
            Object evidence = get(assessment, "evidence");
            checkEvidence(evidence, records, sources);
            refs.addAll(asArray(evidence));
            Object comparison = opt(assessment, "comparison");
            if (comparison instanceof Map) {
                checkEvidence(get(comparison, "beforeEvidence"), records, sources);
                checkEvidence(get(comparison, "afterEvidence"), records, sources);
            }
            Object transfer = opt(assessment, "transfer");
            if (transfer instanceof Map) {
                Object source = get(transfer, "sourceActivity");
                Object sourceId = get(source, "id");
                Object sourceRefs = get(transfer, "sourceEvidence");
                Object applicationRefs = get(transfer, "applicationEvidence");
                checkEvidence(sourceRefs, records, sources);
                checkEvidence(applicationRefs, records, sources);
                if (!activityId.equals(get(transfer, "targetActivityId")) || !hasActivity(applicationRefs, activityId, records)
                        || sourceId != null && (sourceId.equals(activityId) || !hasActivity(sourceRefs, sourceId, records)))
                    throw publicFail(502, "경험 전이의 출발·적용 활동 근거가 일치하지 않아요.");
                if (sourceId != null) {
                    for (Object ref : asArray(sourceRefs)) {
                        List<Object> row = records.get(get(ref, "recordId"));
                        if (row.get(1).equals(sourceId)) { set(source, "name", row.get(2)); break; }
                    }
                }
            }
        }
        if (!hasActivity(refs, activityId, records)) throw publicFail(502, "성장 이벤트의 활동 근거가 일치하지 않아요.");
        OffsetDateTime latest = null;
        for (Object ref : refs) {
            List<Object> row = records.get(get(ref, "recordId"));
            OffsetDateTime time = OffsetDateTime.parse((String) row.get(5));
            if (latest == null || time.toInstant().isAfter(latest.toInstant())) latest = time;
            if (row.get(1).equals(activityId)) set(get(event, "activity"), "name", row.get(2));
        }
        String month = latest.withOffsetSameInstant(ZoneOffset.UTC).toLocalDate().toString().substring(0, 7);
        if (!month.equals(get(event, "occurredAt"))) throw publicFail(502, "성장 이벤트의 날짜가 근거 기록과 일치하지 않아요.");
    }
}
