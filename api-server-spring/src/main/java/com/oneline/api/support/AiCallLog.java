package com.oneline.api.support;

import com.oneline.api.js.Js;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.UUID;

/** URL·토큰·본문·공급자 오류 원문 없이 HTTP 결과와 최종 반영 여부를 기록한다. */
public final class AiCallLog implements AutoCloseable {
    private static final Logger log = LoggerFactory.getLogger(AiCallLog.class);
    private final String operation;
    private final String targetRef;
    private final String requestId = UUID.randomUUID().toString();
    private final long started = System.nanoTime();
    private int httpStatus;
    private String outcome = "not_sent_or_transport_failed";

    public AiCallLog(String operation, Object target) {
        if (!java.util.Set.of("exclude_file", "activity_metadata", "journey").contains(operation))
            throw new IllegalArgumentException("Unknown AI operation");
        this.operation = operation;
        this.targetRef = Js.sha256Hex(String.valueOf(target)).substring(0, 16);
    }

    public void received(int status) {
        httpStatus = status;
        outcome = status >= 200 && status < 300 ? "validation_or_apply_failed" : "http_error";
    }

    public void transportFailed(Fetch.FetchError error) {
        outcome = error.timeout ? "timeout" : error.aborted ? "cancelled" : "connection_failed";
    }

    public void applied() { outcome = "applied"; }
    public void cancelled() { outcome = "cancelled"; }

    @Override public void close() {
        long durationMs = (System.nanoTime() - started) / 1_000_000;
        if ("applied".equals(outcome)) {
            log.info("AI call operation={} request_id={} target_ref={} http_status={} outcome={} duration_ms={}",
                    operation, requestId, targetRef, httpStatus, outcome, durationMs);
        } else {
            log.warn("AI call operation={} request_id={} target_ref={} http_status={} outcome={} duration_ms={}",
                    operation, requestId, targetRef, httpStatus, outcome, durationMs);
        }
    }
}
