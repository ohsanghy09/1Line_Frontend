package com.oneline.api.service;

import com.oneline.api.js.Js;
import com.oneline.api.js.Json;
import com.oneline.api.validation.Schemas;
import com.oneline.api.zod.Z;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static com.oneline.api.zod.Z.*;
import static com.oneline.api.js.Js.obj;
import static com.oneline.api.web.HttpError.publicFail;

public final class ExcludeFileResult {
    private ExcludeFileResult() {}
    public static final String VERSION = "exclude-file-result-v2";
    private static final Z.ZObject REF = object("fileId", string().min(1).max(20000),
            "quote", string().min(1).max(2000).refine(v -> !((String) v).isBlank(), "빈 근거입니다.")).strict();
    private static final Z.ZObject OUTPUT = object("schemaVersion", literal(VERSION), "reply", Schemas.REPLY,
            "recordReply", string(), "fileIds", array(string().min(1)).min(1).max(10),
            "changeEvidence", array(object("changeIndex", number().integer().min(0).max(99),
                    "before", array(REF).min(1).max(20), "after", array(REF).min(1).max(20)).strict()).max(100)).strict();
    public record Result(Map<String, Object> reply, List<Object> evidence) {}

    private static RuntimeException invalid() { return publicFail(502, "남은 파일의 변화·근거를 확인하지 못해 삭제하지 않았어요."); }
    private static String normalize(String text) { return text.replace("\r\n", "\n").replace('\r', '\n'); }

    private static String text(Map<String, Object> file) {
        String name = String.valueOf(file.get("name"));
        String ext = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        if (!Set.of("txt", "md", "json", "csv", "tsv", "xml", "html", "py", "js", "ts").contains(ext))
            throw publicFail(502, "이 파일 형식의 원문 근거 검증이 아직 준비되지 않아 삭제하지 않았어요.");
        try {
            return normalize(StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap((byte[]) file.get("content"))).toString());
        } catch (java.nio.charset.CharacterCodingException error) { throw invalid(); }
    }

    public static Result validate(Object raw, Object recordReply, List<Map<String, Object>> originals) {
        var parsed = OUTPUT.safeParse(raw);
        if (!parsed.success()) throw invalid();
        var output = Js.asObject(parsed.data());
        if (!Objects.equals(output.get("recordReply"), recordReply)
                || !Js.asArray(output.get("fileIds")).equals(originals.stream().map(f -> f.get("id")).toList())) throw invalid();
        var reply = Js.asObject(output.get("reply"));
        var analysis = Js.asObject(reply.get("analysis"));
        if (reply.containsKey("sourceUrl") || reply.containsKey("deduplication")
                || !Js.asArray(analysis.get("files")).stream().map(f -> Js.get(f, "name")).toList()
                .equals(originals.stream().map(f -> f.get("name")).toList())) throw invalid();
        var changes = Js.asArray(analysis.get("changes"));
        var refs = Js.asArray(output.get("changeEvidence"));
        if (refs.size() != changes.size()) throw invalid();
        Map<Object, Map<String, Object>> files = new HashMap<>();
        for (var file : originals) files.put(file.get("id"), file);
        Map<Object, String> texts = new HashMap<>();
        // 변화 없음도 미지원 추출 형식을 성공으로 오인하지 않도록 원본 전체를 먼저 확인한다.
        for (var file : originals) texts.put(file.get("id"), text(file));
        List<Object> ordered = new ArrayList<>(Collections.nCopies(changes.size(), null));
        for (Object item : refs) {
            int index = ((Number) Js.get(item, "changeIndex")).intValue();
            if (index >= changes.size() || ordered.get(index) != null) throw invalid();
            for (String side : List.of("before", "after")) for (Object ref : Js.asArray(Js.get(item, side))) {
                Object fileId = Js.get(ref, "fileId");
                if (!files.containsKey(fileId)) throw invalid();
                String content = texts.computeIfAbsent(fileId, id -> text(files.get(id)));
                if (!content.contains(normalize((String) Js.get(ref, "quote")))) throw invalid();
            }
            ordered.set(index, obj("before", Js.get(item, "before"), "after", Js.get(item, "after")));
        }
        // 표시 이름 대신 검증한 파일 ID와 인용을 근거 정본으로 보관한다.
        return new Result(reply, ordered);
    }

    public static void saveEvidence(com.oneline.api.db.Database db, Object recordId, List<Object> evidence) {
        var events = db.all("SELECT id FROM timeline_events WHERE record_id = ? ORDER BY rowid", recordId);
        if (events.size() != evidence.size()) throw new IllegalStateException("Event/evidence count mismatch");
        for (int index = 0; index < events.size(); index++)
            db.run("INSERT INTO timeline_event_evidence VALUES (?, ?)", events.get(index).get("id"), Json.stringify(evidence.get(index)));
    }
}
