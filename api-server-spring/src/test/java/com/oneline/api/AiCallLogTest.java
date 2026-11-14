package com.oneline.api;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.oneline.api.config.InternalServiceAuth;
import com.oneline.api.js.Json;
import com.oneline.api.support.AiCallLog;
import com.oneline.api.support.EventLoop;
import com.oneline.api.support.Fetch;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

import static com.oneline.api.js.Js.obj;
import static org.junit.jupiter.api.Assertions.*;

class AiCallLogTest {
    @Test void recordsHttpAndApplicationOutcomesWithoutTokensTargetsOrBodies() throws Exception {
        Logger logger = (Logger) LoggerFactory.getLogger(AiCallLog.class);
        Level previous = logger.getLevel();
        var events = new ListAppender<ILoggingEvent>();
        events.start(); logger.addAppender(events); logger.setLevel(Level.INFO);
        String secret = "private-input-must-never-be-logged";
        String input = Json.stringify(obj("input", secret));
        try (var ai = new TestServer.FakeAi()) {
            ai.handler = (path, raw) -> new Object[]{200, obj("error", secret)};
            var loop = new EventLoop();
            try (var call = new AiCallLog("exclude_file", secret)) {
                assertEquals(200, Fetch.post(loop, ai.url + "/api/analyze/test", input, 5000, null,
                        new InternalServiceAuth(TestServer.TOKEN), call).status());
                call.applied();
            }
            // HTTP 200이더라도 검증·반영 성공을 명시하지 않으면 성공으로 기록하지 않는다.
            try (var call = new AiCallLog("journey", secret)) {
                Fetch.post(loop, ai.url + "/api/analyze/test", input, 5000, null,
                        new InternalServiceAuth(TestServer.TOKEN), call);
            }
            ai.handler = (path, raw) -> new Object[]{503, obj("error", secret)};
            try (var call = new AiCallLog("activity_metadata", secret)) {
                Fetch.post(loop, ai.url + "/api/analyze/test", input, 5000, null,
                        new InternalServiceAuth(TestServer.TOKEN), call);
            }
            assertEquals(3, events.list.size());
            assertTrue(events.list.get(0).getFormattedMessage().contains("outcome=applied"));
            assertTrue(events.list.get(1).getFormattedMessage().contains("outcome=validation_or_apply_failed"));
            assertTrue(events.list.get(2).getFormattedMessage().contains("http_status=503 outcome=http_error"));
            for (var event : events.list) {
                String message = event.getFormattedMessage();
                assertTrue(message.contains("request_id="));
                assertTrue(message.contains("target_ref="));
                assertTrue(message.matches(".*duration_ms=[0-9]+$"));
                assertFalse(message.contains(secret));
                assertFalse(message.contains(TestServer.TOKEN));
                assertFalse(message.contains(ai.url));
                assertNull(event.getThrowableProxy());
            }
        } finally {
            logger.detachAppender(events); logger.setLevel(previous); events.stop();
        }
    }
}
