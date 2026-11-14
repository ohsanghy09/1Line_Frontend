package com.oneline.api.support;

import com.oneline.api.js.Json;
import com.oneline.api.config.InternalServiceAuth;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CancellationException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/** 기존 서버의 fetch(url, { method: 'POST', signal: AbortSignal.timeout(ms) }) 호출을 대신한다. */
public final class Fetch {
    private Fetch() {
    }

    private static final HttpClient CLIENT = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();

    public record Response(int status, byte[] body) {
        public boolean ok() {
            return status >= 200 && status <= 299;
        }

        /** await response.json().catch(() => null) */
        public Object jsonOrNull() {
            String text = new String(body, StandardCharsets.UTF_8);
            if (text.startsWith("﻿")) text = text.substring(1);
            return Json.parseOrNull(text);
        }
    }

    /** fetch 실패. timeout 이면 TimeoutError, aborted 면 AbortError, 그 외는 네트워크 오류(TypeError). */
    public static final class FetchError extends Exception {
        public final boolean timeout;
        public final boolean aborted;

        FetchError(boolean timeout, boolean aborted, Throwable cause) {
            super(timeout ? "TimeoutError" : aborted ? "AbortError" : "fetch failed", cause);
            this.timeout = timeout;
            this.aborted = aborted;
        }
    }

    /** AbortController 대응 */
    public static final class Controller {
        private volatile CompletableFuture<?> pending;
        private volatile boolean aborted;

        public void abort() {
            aborted = true;
            CompletableFuture<?> future = pending;
            if (future != null) future.cancel(true);
        }

        boolean attach(CompletableFuture<?> future) {
            pending = future;
            return !aborted;
        }
    }

    /**
     * POST 요청. jsonBody 가 null 이면 본문 없이 보낸다.
     * 호출 스레드는 이벤트 루프 잠금을 풀고 기다린다.
     */
    public static Response post(EventLoop loop, String url, String jsonBody, long timeoutMs, Controller controller, InternalServiceAuth auth) throws FetchError {
        return post(loop, url, jsonBody, timeoutMs, controller, auth, null);
    }

    public static Response post(EventLoop loop, String url, String jsonBody, long timeoutMs, Controller controller, InternalServiceAuth auth, AiCallLog call) throws FetchError {
        try {
            Response response = loop.await(() -> send(url, jsonBody, timeoutMs, controller, auth));
            if (call != null) call.received(response.status());
            return response;
        } catch (FetchError e) {
            if (call != null) call.transportFailed(e);
            throw e;
        } catch (Exception e) {
            FetchError error = new FetchError(false, false, e);
            if (call != null) call.transportFailed(error);
            throw error;
        }
    }

    private static Response send(String url, String jsonBody, long timeoutMs, Controller controller, InternalServiceAuth auth) throws FetchError {
        HttpRequest request;
        try {
            HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(url))
                    .header("Authorization", auth.authorizationHeader());
            if (jsonBody == null) {
                builder.POST(HttpRequest.BodyPublishers.noBody());
            } else {
                builder.header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(jsonBody, StandardCharsets.UTF_8));
            }
            request = builder.build();
        } catch (RuntimeException e) {
            throw new FetchError(false, false, e);
        }
        CompletableFuture<HttpResponse<byte[]>> future = CLIENT.sendAsync(request, HttpResponse.BodyHandlers.ofByteArray());
        if (controller != null && !controller.attach(future)) {
            future.cancel(true);
            throw new FetchError(false, true, null);
        }
        try {
            HttpResponse<byte[]> response = future.get(timeoutMs, TimeUnit.MILLISECONDS);
            return new Response(response.statusCode(), response.body());
        } catch (TimeoutException e) {
            future.cancel(true);
            throw new FetchError(true, false, e);
        } catch (CancellationException e) {
            throw new FetchError(false, true, e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new FetchError(false, true, e);
        } catch (ExecutionException e) {
            throw new FetchError(false, controller != null && controller.aborted, e.getCause());
        }
    }

    /** (aiBaseUrl ?? process.env.AI_API_BASE_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '') */
    public static String aiBase(String configured) {
        String base = configured;
        if (base == null) base = System.getenv("AI_API_BASE_URL");
        if (base == null) base = "http://127.0.0.1:8000";
        return base.endsWith("/") ? base.substring(0, base.length() - 1) : base;
    }
}
