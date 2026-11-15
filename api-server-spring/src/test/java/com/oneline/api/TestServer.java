package com.oneline.api;

import com.oneline.api.db.Database;
import com.oneline.api.js.Js;
import com.oneline.api.js.Json;
import com.oneline.api.support.EventLoop;
import com.sun.net.httpserver.HttpServer;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BiFunction;
import java.util.function.Consumer;
import java.util.function.Function;

import static com.oneline.api.js.Js.arr;
import static com.oneline.api.js.Js.obj;

/** 테스트용 서버 (기존 test-support/app.js, database.js, mock-reply.js 대응) */
public final class TestServer implements AutoCloseable {
    public static final String TOKEN = "test-only-internal-token-not-for-deployment";
    public final ConfigurableApplicationContext context;
    public final String base;
    public final Database db;
    public final EventLoop loop;
    public final Path directory;
    private final HttpClient client = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build();

    private TestServer(ConfigurableApplicationContext context, Path directory) {
        this.context = context;
        this.directory = directory;
        int port = ((WebServerApplicationContext) context).getWebServer().getPort();
        this.base = "http://127.0.0.1:" + port + "/api";
        this.db = context.getBean(Database.class);
        this.loop = context.getBean(EventLoop.class);
    }

    public static TestServer start(String... properties) {
        try {
            Path directory = Files.createTempDirectory("1line-spring-test-");
            List<String> props = new ArrayList<>(List.of(
                    "server.port=0",
                    "INTERNAL_SERVICE_TOKEN=" + TOKEN,
                    "oneline.db-path=" + directory.resolve("test.db").toString().replace('\\', '/'),
                    "oneline.auto-activity-analysis=false",
                    "oneline.exclude-file-v2-enabled=true",
                    "logging.level.root=ERROR"));
            props.addAll(List.of(properties));
            ConfigurableApplicationContext context = new SpringApplicationBuilder(Application.class)
                    .properties(props.toArray(String[]::new)).run();
            TestServer server = new TestServer(context, directory);
            server.sql(db -> {
                for (String[] pair : new String[][]{{"line1-hackathon", "1호선톤"}, {"computer-vision", "컴퓨터비전"},
                        {"scent-orbit", "Scent Orbit"}, {"data-vis", "데이터분석과시각화"}, {"ai-contest", "AI 분석 공모전"}}) {
                    db.run("INSERT OR IGNORE INTO activities (id, name) VALUES (?, ?)", pair[0], pair[1]);
                }
            });
            return server;
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    @Override
    public void close() {
        context.close();
    }

    /** 이벤트 루프 잠금 안에서 DB 를 직접 조작한다. */
    public void sql(Consumer<Database> work) {
        loop.run(() -> work.accept(db));
    }

    public <T> T query(Function<Database, T> work) {
        Object[] holder = new Object[1];
        loop.run(() -> holder[0] = work.apply(db));
        @SuppressWarnings("unchecked") T result = (T) holder[0];
        return result;
    }

    public Map<String, Object> row(String sql, Object... params) {
        return query(db -> db.get(sql, params));
    }

    // ---------------------------------------------------------------- HTTP

    public record Response(int status, HttpResponse<byte[]> raw) {
        public String text() {
            return new String(raw.body(), StandardCharsets.UTF_8);
        }

        public Object json() {
            return Json.parse(text());
        }

        public Map<String, Object> map() {
            return Js.asObject(json());
        }

        public List<Object> list() {
            return Js.asArray(json());
        }

        public String header(String name) {
            return raw.headers().firstValue(name).orElse(null);
        }
    }

    public Response request(String method, String path, String contentType, String body, Map<String, String> headers) {
        try {
            HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(base + path));
            if (contentType != null) builder.header("Content-Type", contentType);
            headers.forEach(builder::header);
            builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                    : HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
            HttpResponse<byte[]> response = client.send(builder.build(), HttpResponse.BodyHandlers.ofByteArray());
            return new Response(response.statusCode(), response);
        } catch (IOException | InterruptedException e) {
            throw new IllegalStateException(e);
        }
    }

    public Response get(String path) {
        return request("GET", path, null, null, Map.of());
    }

    public Response send(String method, String path, Object body) {
        return request(method, path, "application/json", Json.stringify(body), Map.of());
    }

    public Response post(String path, Object body) {
        return send("POST", path, body);
    }

    /** fetch(url, { method: 'POST' }) — 본문 없음 */
    public Response postEmpty(String path) {
        return request("POST", path, null, null, Map.of());
    }

    // ---------------------------------------------------------------- 초안 (AI 서버가 게시하는 analyses/files)

    public record Draft(String analysisId, String conversationId, Map<String, Object> reply, List<String> fileIds) {
    }

    public Draft draft(String conversationId, String message, Map<String, Object> reply, String... fileNames) {
        String id = Js.randomUUID();
        List<String> fileIds = new ArrayList<>();
        sql(db -> {
            db.run("INSERT INTO analyses VALUES (?, ?, ?, ?, ?)", id, conversationId, message, Json.stringify(reply), Js.nowIso());
            for (String name : fileNames) {
                String fileId = Js.randomUUID();
                byte[] content = ("content of " + name).getBytes(StandardCharsets.UTF_8);
                db.run("INSERT INTO files VALUES (?, ?, ?, ?, ?, ?)", fileId, id, name, "text/plain", (double) content.length, content);
                fileIds.add(fileId);
            }
        });
        return new Draft(id, conversationId, reply, fileIds);
    }

    // 기존 test-support/mock-reply.js
    public static LinkedHashMap<String, Object> mockActivity() {
        return obj("name", "1호선톤", "confidence", null, "id", null, "match", "unresolved",
                "category", null, "status", null, "role", null, "period", null, "summary", null);
    }

    public static LinkedHashMap<String, Object> mockLinkReply(String url) {
        return obj("id", Js.randomUUID(), "role", "assistant", "kind", "link-analysis", "sourceUrl", url,
                "content", "링크를 정리했어요. 분류를 확인한 뒤 기록해 주세요.",
                "analysis", obj("activity", mockActivity(), "materialType", "웹 링크 · 기획 자료", "stage", null,
                        "summary", "활동의 참고 링크로 분류한 목 응답입니다. 실제 페이지를 읽거나 요약한 결과는 아니에요.",
                        "changes", new ArrayList<>(), "files", new ArrayList<>(), "groups", new ArrayList<>(), "suggestedSaveMode", "archive"));
    }

    public static LinkedHashMap<String, Object> mockReply(String message, List<String> files, boolean change) {
        List<Object> changes = new ArrayList<>();
        if (change) {
            List<Object> evidence = new ArrayList<>(files.isEmpty() ? List.of("사용자 직접 기록") : files);
            changes.add(obj("before", "여러 기능을 함께 구현하는 기존 계획 (목 예시)", "after", "핵심 기능부터 구현하는 계획 (목 예시)",
                    "category", "기능 범위 변경", "evidence", evidence));
        }
        boolean batch = files.size() > 1;
        LinkedHashMap<String, Object> analysis = obj("activity", mockActivity(),
                "materialType", files.isEmpty() ? "사용자 경험 기록" : "기타 자료", "stage", null,
                "summary", files.isEmpty() ? "입력한 경험에 대한 목 분석입니다: " + message
                        : String.join(", ", files) + "에 대한 목 분석입니다. 실제 파일 내용은 분석하지 않았어요.");
        if (changes.isEmpty()) analysis.put("noChangeMessage", "주요 변화가 없는 목 예시입니다. 자료를 아카이브에 저장할 수 있어요.");
        List<Object> fileEntries = new ArrayList<>();
        for (String name : files) fileEntries.add(obj("name", name, "materialType", "기타 자료", "previousVersion", null));
        analysis.put("changes", changes);
        analysis.put("files", fileEntries);
        analysis.put("groups", batch ? arr(obj("materialType", "기타 자료", "count", (double) files.size())) : new ArrayList<>());
        analysis.put("suggestedSaveMode", changes.isEmpty() ? "archive" : "record-change");
        return obj("id", Js.randomUUID(), "role", "assistant",
                "kind", batch ? "batch-analysis" : !files.isEmpty() ? (changes.isEmpty() ? "no-change" : "file-analysis") : "text-analysis",
                "content", batch ? "총 " + files.size() + "개의 자료를 확인 후 일괄 그룹화했어요." : "입력한 내용을 정리했어요. 기록 전에 분류를 확인해 주세요.",
                "analysis", analysis);
    }

    // ---------------------------------------------------------------- 가짜 AI 서버

    public static final class FakeAi implements AutoCloseable {
        public final HttpServer server;
        public final String url;
        public volatile BiFunction<String, Object, Object[]> handler = (path, body) -> new Object[]{404, obj("error", "none")};
        public volatile int calls;

        public FakeAi() {
            try {
                server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            } catch (IOException e) {
                throw new IllegalStateException(e);
            }
            server.setExecutor(java.util.concurrent.Executors.newCachedThreadPool());
            server.createContext("/", exchange -> {
                if (!("Bearer " + TOKEN).equals(exchange.getRequestHeaders().getFirst("Authorization"))) {
                    exchange.sendResponseHeaders(401, -1);
                    exchange.close();
                    return;
                }
                calls++;
                String text = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                Object body = text.isEmpty() ? null : Json.parse(text);
                Object[] result;
                try {
                    result = handler.apply(exchange.getRequestURI().getRawPath(), body);
                } catch (RuntimeException e) {
                    result = new Object[]{500, obj("error", String.valueOf(e))};
                }
                byte[] bytes = Json.stringify(result[1]).getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders((Integer) result[0], bytes.length);
                exchange.getResponseBody().write(bytes);
                exchange.close();
            });
            server.start();
            url = "http://127.0.0.1:" + server.getAddress().getPort();
        }

        @Override
        public void close() {
            server.stop(0);
        }
    }

    public static void until(java.util.function.BooleanSupplier check) {
        for (int i = 0; i < 300; i++) {
            if (check.getAsBoolean()) return;
            try {
                Thread.sleep(10);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
        }
        throw new AssertionError("대기 시간 초과");
    }
}
