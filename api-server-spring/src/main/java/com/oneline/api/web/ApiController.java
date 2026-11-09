package com.oneline.api.web;

import com.oneline.api.config.ServerOptions;
import com.oneline.api.db.Database;
import com.oneline.api.js.Js;
import com.oneline.api.js.Json;
import com.oneline.api.service.Activities;
import com.oneline.api.service.ActivityChatUpdate;
import com.oneline.api.service.ActivityMetadata;
import com.oneline.api.service.ActivityMetadataQueue;
import com.oneline.api.service.Archive;
import com.oneline.api.service.ArchiveDelete;
import com.oneline.api.service.ArchiveSearch;
import com.oneline.api.service.Home;
import com.oneline.api.service.Journey;
import com.oneline.api.support.EventLoop;
import com.oneline.api.validation.Schemas;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static com.oneline.api.js.Js.obj;
import static com.oneline.api.web.HttpError.fail;

/** 기존 src/app.js 의 라우트 */
@RestController
public class ApiController {
    private final Database db;
    private final EventLoop loop;
    private final ActivityMetadataQueue activityMetadata;
    private final ServerOptions options;
    // 조회는 저장 결과만 반환한다. 실제 모델은 사용자의 분석 요청에서만 호출한다.
    private boolean journeyRunning = false;
    private final Set<Object> deletingRecords = new HashSet<>();

    public ApiController(Database db, EventLoop loop, ActivityMetadataQueue activityMetadata, ServerOptions options) {
        this.db = db;
        this.loop = loop;
        this.activityMetadata = activityMetadata;
        this.options = options;
    }

    // ---------------------------------------------------------------- 도우미

    static ResponseEntity<byte[]> json(int status, Object value) {
        return ResponseEntity.status(status)
                .header("Content-Type", "application/json; charset=utf-8")
                .body(Json.stringify(value).getBytes(StandardCharsets.UTF_8));
    }

    static ResponseEntity<byte[]> json(Object value) {
        return json(200, value);
    }

    private Map<String, Object> activity(Object id) {
        Map<String, Object> row = db.get("SELECT * FROM activities WHERE id = ?", id);
        if (row == null) throw fail(404, "활동을 찾을 수 없습니다.");
        return row;
    }

    private LinkedHashMap<String, Object> record(Object id) {
        Map<String, Object> row = db.get("SELECT * FROM records WHERE id = ?", id);
        if (row == null) throw fail(404, "기록을 찾을 수 없습니다.");
        return obj("id", row.get("id"), "activityId", row.get("activity_id"), "analysisId", row.get("analysis_id"),
                "message", row.get("message"), "reply", Json.parse((String) row.get("reply")),
                "createdAt", row.get("created_at"), "updatedAt", row.get("updated_at"));
    }

    private void syncEvents(Object id, Object reply, String now) {
        db.run("DELETE FROM timeline_events WHERE record_id = ?", id);
        // 주요 변화와 Turning Point는 구분한다. 목 응답만으로 전환점을 확정하지 않는다.
        for (Object change : Js.iterate(Js.path(reply, "analysis", "changes"))) {
            db.run("INSERT INTO timeline_events VALUES (?, ?, ?, 0, ?)", Js.randomUUID(), id, Json.stringify(change), now);
        }
    }

    private static Object body(HttpServletRequest request) {
        return ExpressCompatFilter.body(request);
    }

    // ---------------------------------------------------------------- 상태·홈

    @GetMapping("/api/health")
    public ResponseEntity<byte[]> health() {
        return json(obj("status", "ready", "label", "기록 저장·조회 준비됨", "analysisProvider", "external"));
    }

    // 홈 분석 접수와 진행 조회는 FastAPI에서만 처리한다.
    @PostMapping("/api/chat")
    public ResponseEntity<byte[]> chat() {
        return json(410, obj("error", "분석 요청은 FastAPI AI 서버로 전송해 주세요."));
    }

    @PostMapping("/api/chat/links")
    public ResponseEntity<byte[]> chatLinks() {
        return json(410, obj("error", "분석 요청은 FastAPI AI 서버로 전송해 주세요."));
    }

    @GetMapping("/api/chat/jobs/{id}")
    public ResponseEntity<byte[]> chatJob(@PathVariable String id) {
        return json(410, obj("error", "분석 진행은 FastAPI AI 서버에서 조회해 주세요."));
    }

    @GetMapping("/api/activities")
    public ResponseEntity<byte[]> activities() {
        return json(Activities.contextActivities(db));
    }

    @PostMapping("/api/activities/apply-chat-update")
    public ResponseEntity<byte[]> applyChatUpdate(HttpServletRequest request) {
        Map<String, Object> input = Js.asObject(Schemas.CHAT_UPDATE_REQUEST.parse(body(request)));
        ActivityChatUpdate.Result result = ActivityChatUpdate.apply(db, input.get("analysisId"));
        if (result.changed()) activityMetadata.cancelPending(result.updatedActivityId());
        return json(result.body());
    }

    @GetMapping("/api/home/recent")
    public ResponseEntity<byte[]> homeRecent() {
        return json(Home.readHomeRecent(db));
    }

    // 진행 중 분석의 결과가 삭제 직후 다시 저장되지 않도록 같은 트랜잭션에서 검사한다.
    @PostMapping("/api/settings/reset-data")
    public ResponseEntity<byte[]> resetData(HttpServletRequest request) {
        if (!Js.strictEquals(Js.opt(body(request), "confirmation"), "전체 삭제")) throw fail(400, "확인 문구를 정확히 입력해 주세요.");
        db.transaction(() -> {
            if (journeyRunning || activityMetadata.hasActive()
                    || db.get("SELECT id FROM ai_chat_jobs WHERE status IN ('queued', 'running') LIMIT 1") != null) {
                throw fail(409, "AI 분석이 진행 중이에요. 분석이 끝난 뒤 다시 삭제해 주세요.");
            }
            for (String table : List.of("timeline_events", "records", "files", "analysis_jobs", "ai_chat_jobs", "journey_analyses", "analyses", "activities")) {
                db.exec("DELETE FROM " + table);
            }
        });
        return json(obj("deleted", true));
    }

    // ---------------------------------------------------------------- Journey·활동 분석

    @GetMapping("/api/journey")
    public ResponseEntity<byte[]> journey() {
        return json(Journey.readJourney(db));
    }

    @GetMapping("/api/activities/{id}/analysis")
    public ResponseEntity<byte[]> activityAnalysis(@PathVariable String id) {
        activity(id);
        return json(ActivityMetadata.readActivityAnalysis(db, id));
    }

    @PostMapping("/api/activities/{id}/analyze")
    public ResponseEntity<byte[]> analyzeActivity(@PathVariable String id) {
        activity(id);
        if (db.get("SELECT id FROM records WHERE activity_id = ? LIMIT 1", id) == null) {
            throw fail(422, "저장된 자료가 있는 활동만 분석할 수 있어요.");
        }
        Map<String, Object> state = ActivityMetadata.readActivityAnalysis(db, id);
        Object status = state.get("status");
        if (!(Js.strictEquals(status, "queued") || Js.strictEquals(status, "running")) && !activityMetadata.schedule(id)) {
            throw fail(503, "활동 정보 분석을 접수하지 못했어요. 잠시 후 다시 시도해 주세요.");
        }
        return json(202, ActivityMetadata.readActivityAnalysis(db, id));
    }

    @PostMapping("/api/journey/analyze")
    public ResponseEntity<byte[]> analyzeJourney() {
        if (journeyRunning) throw fail(409, "성장 분석이 진행 중이에요. 잠시 후 다시 조회해 주세요.");
        if (db.get("SELECT id FROM records LIMIT 1") == null) throw fail(422, "홈에서 기록을 저장한 뒤 성장 분석을 실행해 주세요.");
        journeyRunning = true;
        try {
            return json(Journey.generateJourney(db, loop, options.aiBaseUrl()));
        } finally {
            journeyRunning = false;
        }
    }

    // ---------------------------------------------------------------- 아카이브

    // 기존 활동 선택 API와 분리해 아카이브 화면에 필요한 DB 조회 계약을 제공한다.
    @GetMapping("/api/archive/activities")
    public ResponseEntity<byte[]> archiveActivities(HttpServletRequest request) {
        Object query = Schemas.ARCHIVE_QUERY.parse(QueryString.parse(request.getQueryString()));
        return json(ArchiveSearch.searchArchive(db, Js.asObject(query)));
    }

    @GetMapping("/api/archive/activities/{id}")
    public ResponseEntity<byte[]> archiveActivity(@PathVariable String id) {
        LinkedHashMap<String, Object> result = Archive.readArchive(db, id);
        if (result == null) throw fail(404, "활동을 찾을 수 없습니다.");
        return json(result);
    }

    @GetMapping("/api/archive/activities/{id}/materials/{fileId}")
    public ResponseEntity<byte[]> archiveMaterial(@PathVariable String id, @PathVariable String fileId) {
        LinkedHashMap<String, Object> result = Archive.readArchiveFile(db, id, fileId);
        if (result == null) throw fail(404, "이 활동에서 자료를 찾을 수 없습니다.");
        return json(result);
    }

    private void checkDeletion() {
        if (db.get("SELECT id FROM ai_chat_jobs WHERE status IN ('queued', 'running') LIMIT 1") != null) {
            throw fail(409, "채팅 분석이 진행 중이에요. 분석이 끝난 뒤 다시 삭제해 주세요.");
        }
    }

    @DeleteMapping("/api/archive/activities/{id}")
    public ResponseEntity<byte[]> deleteActivity(@PathVariable String id, HttpServletRequest request) {
        checkDeletion();
        ArchiveDelete.deleteActivity(db, id, Js.opt(body(request), "confirmation"));
        activityMetadata.cancelPending(id);
        return json(obj("deleted", true));
    }

    @DeleteMapping("/api/archive/activities/{id}/materials/{fileId}")
    public ResponseEntity<byte[]> deleteMaterial(@PathVariable String id, @PathVariable String fileId) {
        checkDeletion();
        Map<String, Object> detail = Archive.readArchiveFile(db, id, fileId);
        if (detail == null) throw fail(404, "이 활동에서 자료를 찾을 수 없어요.");
        Object recordId = Js.asObject(detail.get("file")).get("recordId");
        if (deletingRecords.contains(recordId)) throw fail(409, "이 기록의 자료를 삭제하고 있어요. 잠시 후 다시 확인해 주세요.");
        deletingRecords.add(recordId);
        try {
            ArchiveDelete.deleteMaterial(db, loop, id, fileId, options.aiBaseUrl(),
                    (target, reply) -> syncEvents(target, reply, Js.nowIso()));
            activityMetadata.cancelPending(id);
            if (options.autoActivityAnalysis() && db.get("SELECT id FROM records WHERE activity_id = ? LIMIT 1", id) != null) {
                activityMetadata.schedule(id);
            }
            return json(obj("deleted", true));
        } finally {
            deletingRecords.remove(recordId);
        }
    }

    // ---------------------------------------------------------------- 대화·원본

    @GetMapping("/api/conversations/{id}/messages")
    public ResponseEntity<byte[]> conversationMessages(@PathVariable String id) {
        List<Object> messages = new ArrayList<>();
        for (Map<String, Object> row : db.all("""
                SELECT * FROM analyses WHERE conversation_id = ? AND NOT EXISTS
                      (SELECT 1 FROM ai_chat_jobs WHERE analysis_id = analyses.id AND status != 'completed') ORDER BY created_at, rowid""", id)) {
            messages.add(obj("analysisId", row.get("id"), "message", row.get("message"),
                    "reply", Json.parse((String) row.get("reply")), "createdAt", row.get("created_at"),
                    "attachments", new ArrayList<Object>(db.all("SELECT id, name, size FROM files WHERE analysis_id = ?", row.get("id")))));
        }
        return json(messages);
    }

    @GetMapping("/api/files/{id}")
    public ResponseEntity<byte[]> file(@PathVariable String id) {
        Map<String, Object> file = db.get("SELECT * FROM files WHERE id = ?", id);
        if (file == null) throw fail(404, "파일을 찾을 수 없습니다.");
        Object content = file.get("content");
        byte[] bytes = content instanceof byte[] b ? b : Js.str(content).getBytes(StandardCharsets.UTF_8);
        return ResponseEntity.ok()
                .header("Content-Type", "application/octet-stream")
                .header("Content-Disposition", "attachment; filename=\"download\"; filename*=UTF-8''"
                        + Js.encodeURIComponent(Js.str(file.get("name"))))
                .body(bytes);
    }

    // ---------------------------------------------------------------- 기록

    // 확정 단계: 분석 초안 또는 외부 카드 JSON을 활동 기록으로 저장한다.
    @PostMapping("/api/records")
    public ResponseEntity<byte[]> saveRecord(HttpServletRequest request) {
        Map<String, Object> input = Js.asObject(Schemas.SAVE.parse(body(request)));
        Object analysisId = input.getOrDefault("analysisId", Js.UNDEFINED);
        Object reply = input.getOrDefault("reply", Js.UNDEFINED);
        Object message = input.get("message");
        if (Js.truthy(analysisId)) {
            Map<String, Object> draft = db.get("SELECT * FROM analyses WHERE id = ?", analysisId);
            if (draft == null) throw fail(404, "분석 초안을 찾을 수 없습니다.");
            Map<String, Object> aiJob = db.get("SELECT status FROM ai_chat_jobs WHERE analysis_id = ?", analysisId);
            if (aiJob != null && !Js.strictEquals(aiJob.get("status"), "completed")) throw fail(409, "실제 AI 분석이 완료된 뒤 기록해 주세요.");
            Map<String, Object> job = db.get("SELECT * FROM analysis_jobs WHERE analysis_id = ?", analysisId);
            // 이전 DB의 작업도 기존 완료 대기 시간 전에는 확정 저장하지 않는다.
            if (job != null && (Js.truthy(job.get("error")) || Js.now() < startedAt(job) + 2800)) {
                throw fail(409, "분석이 완료된 뒤 기록해 주세요.");
            }
            if (db.get("SELECT id FROM records WHERE analysis_id = ?", analysisId) != null) throw fail(409, "이미 기록한 분석입니다.");
            reply = Schemas.REPLY.parse(Json.parse((String) draft.get("reply")));
            message = draft.get("message");
        }
        Map<String, Object> replyObject = Js.asObject(reply);
        // 파일·링크 자료의 기록에는 함께 보낸 채팅 본문을 복사하지 않는다. 텍스트 경험 기록은 별도로 보존한다.
        boolean hasMaterial = Js.truthy(replyObject.getOrDefault("sourceUrl", Js.UNDEFINED))
                || Js.truthy(analysisId) && db.get("SELECT id FROM files WHERE analysis_id = ? LIMIT 1", analysisId) != null;
        if (hasMaterial) message = "";
        Map<String, Object> analysis = Js.asObject(replyObject.get("analysis"));
        Object classification = input.getOrDefault("classification", Js.UNDEFINED);
        if (Js.truthy(classification) && !Js.strictEquals(Js.get(classification, "materialType"), analysis.get("materialType"))) {
            applyMaterialType(analysis, Js.get(classification, "materialType"));
        }
        String id = Js.randomUUID(), now = Js.nowIso();
        Object finalMessage = message;
        Object newActivity = input.getOrDefault("newActivity", Js.UNDEFINED);
        db.transaction(() -> {
            Map<String, Object> target = Activities.resolveActivity(db, newActivity, input.getOrDefault("activityId", Js.UNDEFINED),
                    input.getOrDefault("activityUpdates", Js.UNDEFINED), this::activity);
            replyObject.put("content", Js.replaceAll(Js.requireString(replyObject.get("content"), "replaceAll"),
                    Js.str(Js.path(analysis, "activity", "name")), Js.str(target.get("name"))));
            replyObject.put("activityCreated", Js.truthy(newActivity));
            if (Js.truthy(newActivity)) replyObject.put("content", Js.str(target.get("name")) + " 활동에 자료를 기록했어요.");
            LinkedHashMap<String, Object> information = Activities.activityInformation(target);
            information.put("match", "existing");
            information.put("confidence", Js.path(analysis, "activity", "confidence"));
            analysis.put("activity", information);
            db.run("INSERT INTO records VALUES (?, ?, ?, ?, ?, ?, ?)", id, target.get("id"), Js.coalesce(analysisId, null),
                    finalMessage, Json.stringify(replyObject), now, now);
            syncEvents(id, replyObject, now);
            Activities.touchActivities(db, Js.arr(target.get("id")), now);
        });
        LinkedHashMap<String, Object> saved = record(id);
        if (options.autoActivityAnalysis()) activityMetadata.schedule(saved.get("activityId"));
        return json(201, saved);
    }

    private static double startedAt(Map<String, Object> job) {
        Object value = job.get("started_at");
        return value instanceof Number n ? n.doubleValue() : Double.NaN;
    }

    private static void applyMaterialType(Map<String, Object> analysis, Object materialType) {
        analysis.put("materialType", materialType);
        for (Object file : Js.iterate(analysis.get("files"))) Js.set(file, "materialType", materialType);
        if (Js.truthy(Js.get(analysis.get("groups"), "length"))) {
            analysis.put("groups", Js.arr(obj("materialType", materialType, "count", Js.get(analysis.get("files"), "length"))));
        }
    }

    @GetMapping("/api/records/{id}")
    public ResponseEntity<byte[]> getRecord(@PathVariable String id) {
        return json(record(id));
    }

    @GetMapping("/api/activities/{id}/records")
    public ResponseEntity<byte[]> activityRecords(@PathVariable String id) {
        activity(id);
        List<Object> records = new ArrayList<>();
        for (Map<String, Object> row : db.all("SELECT id FROM records WHERE activity_id = ? ORDER BY created_at, rowid", id)) {
            records.add(record(row.get("id")));
        }
        return json(records);
    }

    @PatchMapping("/api/records/{id}")
    public ResponseEntity<byte[]> editRecord(@PathVariable String id, HttpServletRequest request) {
        Map<String, Object> input = Js.asObject(Schemas.EDIT.parse(body(request)));
        LinkedHashMap<String, Object> current = record(id);
        Object reply = current.get("reply");
        Object analysis = Js.get(reply, "analysis");
        if (input.containsKey("materialType") && input.get("materialType") != Js.UNDEFINED) {
            applyMaterialType(Js.asObject(analysis), input.get("materialType"));
        }
        if (input.containsKey("summary") && input.get("summary") != Js.UNDEFINED) Js.set(analysis, "summary", input.get("summary"));
        if (input.containsKey("content") && input.get("content") != Js.UNDEFINED) Js.set(reply, "content", input.get("content"));
        boolean changesGiven = input.containsKey("changes") && input.get("changes") != Js.UNDEFINED;
        if (changesGiven) {
            List<Object> changes = Js.asArray(input.get("changes"));
            Js.set(analysis, "changes", changes);
            Js.set(analysis, "suggestedSaveMode", changes.isEmpty() ? "archive" : "record-change");
        }
        String now = Js.nowIso();
        Object currentActivityId = current.get("activityId");
        db.transaction(() -> {
            Object activityId = Js.coalesce(input.getOrDefault("activityId", Js.UNDEFINED), currentActivityId);
            Map<String, Object> target = Activities.resolveActivity(db, Js.UNDEFINED, activityId,
                    input.getOrDefault("activityUpdates", Js.UNDEFINED), this::activity);
            Js.set(reply, "content", Js.replaceAll(Js.requireString(Js.get(reply, "content"), "replaceAll"),
                    Js.str(Js.path(analysis, "activity", "name")), Js.str(target.get("name"))));
            if (!Js.strictEquals(target.get("id"), currentActivityId)) Js.set(reply, "activityCreated", false);
            LinkedHashMap<String, Object> information = Activities.activityInformation(target);
            information.put("match", "existing");
            information.put("confidence", Js.path(analysis, "activity", "confidence"));
            Js.set(analysis, "activity", information);
            db.run("UPDATE records SET activity_id = ?, reply = ?, updated_at = ? WHERE id = ?",
                    target.get("id"), Json.stringify(reply), now, current.get("id"));
            if (changesGiven) syncEvents(current.get("id"), reply, now);
            Activities.touchActivities(db, Js.arr(currentActivityId, target.get("id")), now);
        });
        LinkedHashMap<String, Object> saved = record(current.get("id"));
        if (options.autoActivityAnalysis()) {
            for (Object activityId : new LinkedHashSet<>(Js.arr(currentActivityId, saved.get("activityId")))) {
                activityMetadata.schedule(activityId);
            }
        }
        return json(saved);
    }

    @GetMapping("/api/activities/{id}/timeline")
    public ResponseEntity<byte[]> timeline(@PathVariable String id) {
        activity(id);
        List<Object> events = new ArrayList<>();
        for (Map<String, Object> row : db.all("""
                SELECT e.* FROM timeline_events e JOIN records r ON e.record_id = r.id WHERE r.activity_id = ? ORDER BY e.created_at, e.rowid""", id)) {
            events.add(obj("id", row.get("id"), "recordId", row.get("record_id"), "change", Json.parse((String) row.get("change_json")),
                    "isTurningPoint", Js.truthy(row.get("is_turning_point")), "createdAt", row.get("created_at")));
        }
        return json(events);
    }
}
