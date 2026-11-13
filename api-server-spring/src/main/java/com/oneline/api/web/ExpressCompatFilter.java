package com.oneline.api.web;

import com.oneline.api.config.ServerOptions;
import com.oneline.api.js.Js;
import com.oneline.api.js.Json;
import com.oneline.api.support.EventLoop;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.ContentCachingResponseWrapper;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;
import java.util.zip.InflaterInputStream;

import static com.oneline.api.js.Js.obj;

/**
 * Express 미들웨어 체인을 재현한다.
 * app.use(cors({ origin })) → app.use(express.json({ limit: '1mb' })) → 라우트, 그리고 res.send 의 ETag/304 처리.
 * 요청 처리는 EventLoop 잠금 안에서 한 번에 하나씩 실행한다.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 1)
public class ExpressCompatFilter extends OncePerRequestFilter {
    public static final String BODY_ATTRIBUTE = ExpressCompatFilter.class.getName() + ".body";
    private static final int LIMIT = 1024 * 1024;

    private final ServerOptions options;
    private final EventLoop loop;

    public ExpressCompatFilter(ServerOptions options, EventLoop loop) {
        this.options = options;
        this.loop = loop;
    }

    /** req.body (express.json 이 처리하지 않았으면 undefined) */
    public static Object body(HttpServletRequest request) {
        Object body = request.getAttribute(BODY_ATTRIBUTE);
        return body == null ? Js.UNDEFINED : body == NULL_BODY ? null : body;
    }

    private static final Object NULL_BODY = new Object();

    @Override
    protected boolean shouldNotFilterAsyncDispatch() {
        return true;
    }

    @Override
    protected boolean shouldNotFilterErrorDispatch() {
        return true;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        response.setHeader("X-Powered-By", "Express");
        // cors({ origin }) — 고정 origin 과 Vary: Origin
        response.setHeader("Access-Control-Allow-Origin", options.origin());
        response.setHeader("Vary", "Origin");
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            response.setHeader("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE");
            response.setHeader("Vary", "Origin, Access-Control-Request-Headers");
            String requested = request.getHeader("Access-Control-Request-Headers");
            if (requested != null && !requested.isEmpty()) response.setHeader("Access-Control-Allow-Headers", requested);
            response.setStatus(204);
            response.setHeader("Content-Length", "0");
            return;
        }

        ContentCachingResponseWrapper wrapper = new ContentCachingResponseWrapper(response);
        HttpError bodyError = null;
        try {
            Object body = parseJsonBody(request);
            if (body != Js.UNDEFINED) request.setAttribute(BODY_ATTRIBUTE, body == null ? NULL_BODY : body);
        } catch (HttpError error) {
            bodyError = error;
        }

        loop.enter();
        try {
            if (bodyError != null) {
                writeJson(wrapper, bodyError.status(), obj("error", bodyError.getMessage()));
            } else {
                chain.doFilter(request, wrapper);
            }
            finish(request, wrapper);
        } finally {
            loop.exit();
        }
    }

    static void writeJson(HttpServletResponse response, int status, Object value) throws IOException {
        response.setStatus(status);
        response.setContentType("application/json; charset=utf-8");
        response.getOutputStream().write(Json.stringify(value).getBytes(StandardCharsets.UTF_8));
    }

    /** res.send: ETag 생성과 req.fresh 에 따른 304 */
    private static void finish(HttpServletRequest request, ContentCachingResponseWrapper wrapper) throws IOException {
        byte[] content = wrapper.getContentAsByteArray();
        int status = wrapper.getStatus();
        if (wrapper.getHeader("ETag") == null) wrapper.setHeader("ETag", weakEtag(content));
        String method = request.getMethod().toUpperCase(Locale.ROOT);
        boolean cacheable = (method.equals("GET") || method.equals("HEAD")) && ((status >= 200 && status < 300) || status == 304);
        if (cacheable && fresh(request, wrapper.getHeader("ETag"))) {
            wrapper.resetBuffer();
            wrapper.setStatus(304);
            wrapper.setHeader("Content-Type", null);
            wrapper.setHeader("Content-Length", null);
            wrapper.setHeader("Transfer-Encoding", null);
            wrapper.copyBodyToResponse();
            return;
        }
        wrapper.copyBodyToResponse();
    }

    private static String weakEtag(byte[] content) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-1").digest(content);
            String base64 = Base64.getEncoder().encodeToString(hash).substring(0, 27);
            return "W/\"" + Integer.toHexString(content.length) + "-" + base64 + "\"";
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static final Pattern NO_CACHE = Pattern.compile("(?:^|,)\\s*?no-cache\\s*?(?:,|$)");

    /** fresh(reqHeaders, resHeaders) */
    private static boolean fresh(HttpServletRequest request, String etag) {
        String modifiedSince = request.getHeader("If-Modified-Since");
        String noneMatch = request.getHeader("If-None-Match");
        if ((modifiedSince == null || modifiedSince.isEmpty()) && (noneMatch == null || noneMatch.isEmpty())) return false;
        String cacheControl = request.getHeader("Cache-Control");
        if (cacheControl != null && NO_CACHE.matcher(cacheControl).find()) return false;
        if (noneMatch != null && !noneMatch.isEmpty()) {
            if (noneMatch.equals("*")) return true;
            if (etag == null) return false;
            boolean matched = false;
            for (String token : noneMatch.split(",")) {
                String match = token.trim();
                if (match.equals(etag) || match.equals("W/" + etag) || ("W/" + match).equals(etag)) {
                    matched = true;
                    break;
                }
            }
            if (!matched) return false;
        }
        // Last-Modified 를 보내지 않으므로 If-Modified-Since 가 있으면 신선하지 않다.
        return modifiedSince == null || modifiedSince.isEmpty();
    }

    // ---------------------------------------------------------------- express.json({ limit: '1mb' })

    private static final Pattern CHARSET = Pattern.compile(";\\s*charset\\s*=\\s*(\"[^\"]*\"|[^;\\s]*)", Pattern.CASE_INSENSITIVE);

    /** 처리하지 않으면 UNDEFINED, 오류면 HttpError */
    private static Object parseJsonBody(HttpServletRequest request) throws IOException {
        String transferEncoding = request.getHeader("Transfer-Encoding");
        String contentLength = request.getHeader("Content-Length");
        boolean hasBody = transferEncoding != null || (contentLength != null && isNumeric(contentLength));
        if (!hasBody) return Js.UNDEFINED;
        String contentType = request.getHeader("Content-Type");
        if (contentType == null || !isJsonType(contentType)) return Js.UNDEFINED;

        String charset = "utf-8";
        Matcher matcher = CHARSET.matcher(contentType);
        if (matcher.find()) {
            String value = matcher.group(1);
            if (value.startsWith("\"") && value.endsWith("\"") && value.length() >= 2) value = value.substring(1, value.length() - 1);
            charset = value.toLowerCase(Locale.ROOT);
        }
        if (!charset.startsWith("utf-")) {
            throw new HttpError(415, "unsupported charset \"" + charset.toUpperCase(Locale.ROOT) + "\"");
        }
        Charset decoder;
        try {
            decoder = Charset.forName(charset);
        } catch (Exception e) {
            throw new HttpError(415, "unsupported charset \"" + charset.toUpperCase(Locale.ROOT) + "\"");
        }

        String encoding = request.getHeader("Content-Encoding");
        encoding = encoding == null ? "identity" : encoding.toLowerCase(Locale.ROOT);
        if (encoding.equals("identity") && contentLength != null && isNumeric(contentLength)
                && Long.parseLong(contentLength.trim()) > LIMIT) {
            throw new HttpError(413, "request entity too large");
        }
        InputStream stream = request.getInputStream();
        switch (encoding) {
            case "identity" -> {
            }
            case "gzip" -> stream = new GZIPInputStream(stream);
            case "deflate" -> stream = new InflaterInputStream(stream);
            default -> throw new HttpError(415, "unsupported content encoding \"" + encoding + "\"");
        }
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int read;
        while ((read = stream.read(chunk)) != -1) {
            buffer.write(chunk, 0, read);
            if (buffer.size() > LIMIT) throw new HttpError(413, "request entity too large");
        }
        String text = buffer.toString(decoder);
        if (text.startsWith("\uFEFF")) text = text.substring(1);
        if (text.isEmpty()) return obj();

        int first = 0;
        while (first < text.length() && " \t\n\r".indexOf(text.charAt(first)) >= 0) first++;
        if (first < text.length()) {
            char c = text.charAt(first);
            if (c != '{' && c != '[') throw new HttpError(400, strictSyntaxError(text, c));
        }
        try {
            return Json.parse(text);
        } catch (Json.SyntaxError e) {
            throw new HttpError(400, e.getMessage());
        }
    }

    /** body-parser createStrictSyntaxError */
    private static String strictSyntaxError(String text, char c) {
        int index = text.indexOf(c);
        String partial = index == -1 ? "" : text.substring(0, index) + "#".repeat(text.length() - index);
        String message;
        try {
            Json.parse(partial);
            message = "strict violation";
        } catch (Json.SyntaxError e) {
            message = e.getMessage();
        }
        Matcher matcher = Pattern.compile("#+").matcher(message);
        StringBuilder out = new StringBuilder();
        while (matcher.find()) {
            int length = matcher.group().length();
            String replacement = index < 0 ? "" : text.substring(index, Math.min(text.length(), index + length));
            matcher.appendReplacement(out, Matcher.quoteReplacement(replacement));
        }
        matcher.appendTail(out);
        return out.toString();
    }

    private static boolean isNumeric(String value) {
        String trimmed = value.trim();
        if (trimmed.isEmpty()) return false;
        try {
            Double.parseDouble(trimmed);
            return true;
        } catch (NumberFormatException e) {
            return false;
        }
    }

    private static boolean isJsonType(String contentType) {
        String type = contentType.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        return type.equals("application/json");
    }
}
