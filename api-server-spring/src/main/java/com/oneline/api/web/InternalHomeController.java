package com.oneline.api.web;

import com.oneline.api.db.Database;
import com.oneline.api.service.HomeContext;
import com.oneline.api.service.InternalChatJobs;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import static com.oneline.api.js.Js.obj;

/** 인증은 InternalServiceAuthFilter, 직렬 처리는 ExpressCompatFilter가 담당한다. */
@RestController
public final class InternalHomeController {
    private final Database db;
    public InternalHomeController(Database db) { this.db = db; }

    private static ResponseEntity<byte[]> response(int status, Object value) {
        var result = ApiController.json(status, value);
        return ResponseEntity.status(status).headers(result.getHeaders()).header("Cache-Control", "no-store").body(result.getBody());
    }

    @GetMapping("/api/internal/home-context")
    public ResponseEntity<byte[]> context(HttpServletRequest request) {
        var query = QueryString.parse(request.getQueryString());
        if (!query.keySet().equals(java.util.Set.of("conversationId"))) throw new InternalChatJobs.Failure(400, "internal_invalid_input");
        return response(200, db.transaction(() -> HomeContext.read(db, InternalChatJobs.identifier(query.get("conversationId")))));
    }

    @PutMapping("/api/internal/chat-jobs/{jobId}")
    public ResponseEntity<byte[]> publish(@PathVariable String jobId, HttpServletRequest request) {
        var result = InternalChatJobs.publish(db, jobId, ExpressCompatFilter.body(request));
        return response(result.status(), obj("job", result.job()));
    }

    @GetMapping("/api/internal/chat-jobs/{jobId}")
    public ResponseEntity<byte[]> job(@PathVariable String jobId) {
        return response(200, obj("job", db.transaction(() -> InternalChatJobs.snapshot(db, jobId))));
    }

    @ExceptionHandler(InternalChatJobs.Failure.class)
    public ResponseEntity<byte[]> invalid(InternalChatJobs.Failure error) {
        return response(error.status, obj("error", error.getMessage(), "code", error.code));
    }

    @ExceptionHandler(Database.DatabaseError.class)
    public ResponseEntity<byte[]> storage(Database.DatabaseError error) {
        boolean busy = error.getCause() instanceof java.sql.SQLException sql && (sql.getErrorCode() == 5 || sql.getErrorCode() == 6);
        return response(busy ? 409 : 500, obj("error", "내부 작업의 저장을 확인하지 못했습니다.", "code", busy ? "internal_storage_conflict" : "internal_storage_error"));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<byte[]> unexpected(Exception ignored) {
        // 사용자 입력·원본을 포함할 수 있는 예외 전문은 응답과 로그에 남기지 않는다.
        return response(500, obj("error", "내부 작업 처리에 실패했습니다.", "code", "internal_processing_error"));
    }
}
