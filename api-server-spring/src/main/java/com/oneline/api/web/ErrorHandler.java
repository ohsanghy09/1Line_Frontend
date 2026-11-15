package com.oneline.api.web;

import com.oneline.api.zod.Z;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import static com.oneline.api.js.Js.obj;

/**
 * app.use((_req, res) => 404) 와 Express 오류 처리기.
 * ZodError → 400, status 가 있는 오류 → 해당 상태, 그 외 → 500.
 * 500 이상이면서 공개 메시지가 아니면 내부 내용을 숨긴다.
 */
@RestControllerAdvice
public class ErrorHandler {
    private static final Logger log = LoggerFactory.getLogger(ErrorHandler.class);

    @ExceptionHandler(com.oneline.api.service.FileDuplicates.Problem.class)
    public ResponseEntity<byte[]> duplicateProblem(com.oneline.api.service.FileDuplicates.Problem problem) {
        return ApiController.json(problem.status, problem.body());
    }

    @ExceptionHandler({NoHandlerFoundException.class, NoResourceFoundException.class, HttpRequestMethodNotSupportedException.class})
    public ResponseEntity<byte[]> notFound(Exception ignored) {
        return ApiController.json(404, obj("error", "API를 찾을 수 없습니다."));
    }

    @ExceptionHandler(Throwable.class)
    public ResponseEntity<byte[]> handle(Throwable error) {
        int status;
        boolean publicMessage = false;
        if (error instanceof Z.ZodError) {
            status = 400;
        } else if (error instanceof HttpError httpError) {
            status = httpError.status();
            publicMessage = httpError.publicMessage();
        } else {
            status = 500;
        }
        if (status >= 500) log.error("요청 처리 중 오류", error);
        String message = status >= 500 && !publicMessage ? "서버 처리 중 오류가 발생했습니다." : error.getMessage();
        return ApiController.json(status, obj("error", message));
    }
}
