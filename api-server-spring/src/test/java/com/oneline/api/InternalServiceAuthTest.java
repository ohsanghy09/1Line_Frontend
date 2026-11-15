package com.oneline.api;

import com.oneline.api.config.InternalServiceAuth;
import com.oneline.api.support.EventLoop;
import com.oneline.api.support.Fetch;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

class InternalServiceAuthTest {
    @Test
    void applicationRejectsMissingTokenConfiguration() {
        assertThrows(RuntimeException.class, () -> TestServer.start("INTERNAL_SERVICE_TOKEN="));
    }

    @Test
    void invalidConfigurationAndConstantTimeComparison() {
        for (String token : new String[]{null, "", " ", "line\nbreak", "with space", "한글"}) {
            var error = assertThrows(IllegalStateException.class, () -> new InternalServiceAuth(token));
            assertTrue(error.getMessage().contains("INTERNAL_SERVICE_TOKEN"));
        }
        var auth = new InternalServiceAuth(TestServer.TOKEN);
        assertTrue(auth.matches("Bearer " + TestServer.TOKEN));
        assertTrue(auth.matches("bearer " + TestServer.TOKEN));
        assertFalse(auth.matches((String) null));
        assertFalse(auth.matches("Bearer wrong"));
        assertFalse(auth.matches("Basic " + TestServer.TOKEN));
        assertFalse(auth.matches("Bearer " + TestServer.TOKEN + " "));
        assertFalse(auth.toString().contains(TestServer.TOKEN));
    }

    @Test
    void internalPathsRequireAuthenticationAndPublicPathsRemainOpen() {
        try (var server = TestServer.start()) {
            for (String path : new String[]{"/internal", "/internal/", "/internal/home-context",
                    "/INTERNAL/chat-jobs/test", "/internal;v=1/home-context", "/%69nternal/home-context"}) {
                var missing = server.get(path);
                assertEquals(401, missing.status(), path);
                assertEquals("internal_unauthorized", missing.map().get("code"));
                assertEquals("no-store", missing.header("Cache-Control"));
                assertEquals(401, server.request("GET", path, null, null,
                        Map.of("Authorization", "Bearer wrong")).status(), path);
                // home-context는 필수 query 누락 400, 없는 작업/경로는 404.
                int expected = path.toLowerCase(java.util.Locale.ROOT).contains("home-context") ? 400 : 404;
                assertEquals(expected, server.request("GET", path, null, null,
                        Map.of("Authorization", "Bearer " + TestServer.TOKEN)).status(), path);
            }
            assertEquals(401, server.request("PUT", "/internal/chat-jobs/test", "application/json", "{",
                    Map.of()).status());
            assertEquals(401, server.request("OPTIONS", "/internal/home-context", null, null, Map.of()).status());
            assertEquals(200, server.get("/health").status());
            assertEquals(200, server.get("/activities").status());
            assertEquals(404, server.get("/internal-other").status());
            try {
                var request = java.net.http.HttpRequest.newBuilder(java.net.URI.create(server.base + "/internal/home-context"))
                        .header("Authorization", "Bearer " + TestServer.TOKEN)
                        .header("Authorization", "Bearer wrong").GET().build();
                assertEquals(401, java.net.http.HttpClient.newHttpClient().send(request,
                        java.net.http.HttpResponse.BodyHandlers.discarding()).statusCode());
            } catch (Exception e) {
                throw new AssertionError(e);
            }
        }
    }

    @Test
    void authenticationCannotBeBypassedWithContextPath() {
        try (var server = TestServer.start("server.servlet.context-path=/app")) {
            var client = java.net.http.HttpClient.newHttpClient();
            String url = server.base.replace("/api", "/app/api/internal/home-context");
            var request = java.net.http.HttpRequest.newBuilder(java.net.URI.create(url)).GET().build();
            assertEquals(401, client.send(request, java.net.http.HttpResponse.BodyHandlers.discarding()).statusCode());
        } catch (Exception e) {
            throw new AssertionError(e);
        }
    }

    @Test
    void outgoingRequestsCarryTokenAndDoNotFollowRedirects() throws Exception {
        var received = new java.util.concurrent.CopyOnWriteArrayList<String>();
        var redirected = new AtomicInteger();
        var http = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        http.createContext("/analysis", exchange -> {
            received.add(exchange.getRequestHeaders().getFirst("Authorization"));
            exchange.getRequestBody().readAllBytes();
            exchange.getResponseHeaders().set("Location", "/redirected");
            exchange.sendResponseHeaders(307, -1);
            exchange.close();
        });
        http.createContext("/redirected", exchange -> {
            redirected.incrementAndGet();
            exchange.sendResponseHeaders(200, -1);
            exchange.close();
        });
        http.start();
        try {
            var loop = new EventLoop();
            var auth = new InternalServiceAuth(TestServer.TOKEN);
            for (String body : new String[]{null, "{}"}) {
                loop.enter();
                try {
                    assertEquals(307, Fetch.post(loop, "http://127.0.0.1:" + http.getAddress().getPort()
                            + "/analysis", body, 5000, null, auth).status());
                } finally {
                    loop.exit();
                }
            }
            assertEquals(java.util.List.of("Bearer " + TestServer.TOKEN, "Bearer " + TestServer.TOKEN), received);
            assertEquals(0, redirected.get());
        } finally {
            http.stop(0);
        }
    }
}
