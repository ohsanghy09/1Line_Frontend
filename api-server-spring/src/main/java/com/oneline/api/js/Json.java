package com.oneline.api.js;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * JavaScript JSON.parse / JSON.stringify 와 같은 결과를 만드는 구현.
 * - 객체 키 순서(정수 키 우선, 이후 삽입 순서), undefined 생략, 숫자 표기, 문자열 이스케이프를 V8과 같게 맞춘다.
 * - DB에 저장하는 JSON 문자열과 SHA-256 지문이 Node·Python 서버와 동일해야 하므로 Jackson 을 쓰지 않는다.
 */
public final class Json {
    private Json() {
    }

    /** JSON.parse 실패. 메시지는 V8 형식을 따른다. */
    public static final class SyntaxError extends RuntimeException {
        public SyntaxError(String message) {
            super(message);
        }
    }

    // ================================================================ stringify

    /** JSON.stringify(value) — undefined 이면 null 을 반환한다. */
    public static String stringify(Object value) {
        if (value == Js.UNDEFINED) return null;
        StringBuilder out = new StringBuilder();
        write(out, value, null, "");
        return out.toString();
    }

    /** JSON.stringify(value, null, 2) */
    public static String stringifyPretty(Object value) {
        if (value == Js.UNDEFINED) return null;
        StringBuilder out = new StringBuilder();
        write(out, value, "  ", "");
        return out.toString();
    }

    @SuppressWarnings("unchecked")
    private static void write(StringBuilder out, Object value, String gap, String indent) {
        if (value == null || value == Js.UNDEFINED) {
            out.append("null");
        } else if (value instanceof String s) {
            quote(out, s);
        } else if (value instanceof Boolean b) {
            out.append(b);
        } else if (value instanceof Number n) {
            double d = n.doubleValue();
            out.append(Double.isNaN(d) || Double.isInfinite(d) ? "null" : Js.numberToString(d));
        } else if (value instanceof Map<?, ?> map) {
            Map<String, Object> object = (Map<String, Object>) map;
            List<String> keys = new ArrayList<>();
            for (String key : Js.keys(object)) {
                if (object.get(key) != Js.UNDEFINED) keys.add(key);
            }
            if (keys.isEmpty()) {
                out.append("{}");
                return;
            }
            String inner = gap == null ? "" : indent + gap;
            out.append('{');
            boolean first = true;
            for (String key : keys) {
                if (!first) out.append(',');
                first = false;
                if (gap != null) out.append('\n').append(inner);
                quote(out, key);
                out.append(gap == null ? ":" : ": ");
                write(out, object.get(key), gap, inner);
            }
            if (gap != null) out.append('\n').append(indent);
            out.append('}');
        } else if (value instanceof List<?> list) {
            if (list.isEmpty()) {
                out.append("[]");
                return;
            }
            String inner = gap == null ? "" : indent + gap;
            out.append('[');
            for (int i = 0; i < list.size(); i++) {
                if (i > 0) out.append(',');
                if (gap != null) out.append('\n').append(inner);
                write(out, list.get(i), gap, inner);
            }
            if (gap != null) out.append('\n').append(indent);
            out.append(']');
        } else {
            quote(out, value.toString());
        }
    }

    /** QuoteJSONString (well-formed JSON.stringify) */
    public static void quote(StringBuilder out, String s) {
        out.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\b' -> out.append("\\b");
                case '\f' -> out.append("\\f");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                default -> {
                    if (c < 0x20) {
                        unicodeEscape(out, c);
                    } else if (Character.isHighSurrogate(c)) {
                        if (i + 1 < s.length() && Character.isLowSurrogate(s.charAt(i + 1))) {
                            out.append(c).append(s.charAt(++i));
                        } else {
                            unicodeEscape(out, c);
                        }
                    } else if (Character.isLowSurrogate(c)) {
                        unicodeEscape(out, c);
                    } else {
                        out.append(c);
                    }
                }
            }
        }
        out.append('"');
    }

    private static void unicodeEscape(StringBuilder out, char c) {
        String hex = Integer.toHexString(c);
        out.append("\\u").append("0".repeat(4 - hex.length())).append(hex);
    }

    // ================================================================ parse

    /** JSON.parse(text) */
    public static Object parse(String text) {
        return new Parser(text).parseTop();
    }

    /** JSON.parse 실패 시 null 대신 예외를 던지지 않는 형태: response.json().catch(() => null) */
    public static Object parseOrNull(String text) {
        try {
            return parse(text);
        } catch (SyntaxError e) {
            return null;
        }
    }

    private static final class Parser {
        private static final int MAX_CONTEXT = 10;
        private static final int MIN_LENGTH_FOR_CONTEXT = MAX_CONTEXT * 2 + 1;
        private final String s;
        private int i;

        Parser(String s) {
            this.s = s;
        }

        Object parseTop() {
            skipWs();
            Object value = parseValue();
            skipWs();
            if (i < s.length()) throw positioned("Unexpected non-whitespace character after JSON", i);
            return value;
        }

        private void skipWs() {
            while (i < s.length()) {
                char c = s.charAt(i);
                if (c == ' ' || c == '\t' || c == '\n' || c == '\r') i++;
                else break;
            }
        }

        private Object parseValue() {
            if (i >= s.length()) throw new SyntaxError("Unexpected end of JSON input");
            char c = s.charAt(i);
            return switch (c) {
                case '{' -> parseObject();
                case '[' -> parseArray();
                case '"' -> parseString();
                case 't' -> literal("true", Boolean.TRUE);
                case 'f' -> literal("false", Boolean.FALSE);
                case 'n' -> literal("null", null);
                default -> {
                    if (c == '-' || (c >= '0' && c <= '9')) yield parseNumber();
                    throw unexpectedToken(i);
                }
            };
        }

        private Object literal(String word, Object value) {
            for (int k = 0; k < word.length(); k++) {
                if (i + k >= s.length()) throw new SyntaxError("Unexpected end of JSON input");
                if (s.charAt(i + k) != word.charAt(k)) throw unexpectedToken(i + k);
            }
            i += word.length();
            return value;
        }

        private Map<String, Object> parseObject() {
            LinkedHashMap<String, Object> map = new LinkedHashMap<>();
            i++;
            skipWs();
            if (i >= s.length()) throw new SyntaxError("Unexpected end of JSON input");
            if (s.charAt(i) == '}') {
                i++;
                return map;
            }
            boolean first = true;
            while (true) {
                if (i >= s.length()) throw new SyntaxError("Unexpected end of JSON input");
                if (s.charAt(i) != '"') {
                    throw positioned(first ? "Expected property name or '}'" : "Expected double-quoted property name", i);
                }
                String key = parseString();
                skipWs();
                if (i >= s.length()) throw new SyntaxError("Unexpected end of JSON input");
                if (s.charAt(i) != ':') throw positioned("Expected ':' after property name", i);
                i++;
                skipWs();
                Object value = parseValue();
                map.put(key, value);
                skipWs();
                if (i >= s.length()) throw new SyntaxError("Unexpected end of JSON input");
                char c = s.charAt(i);
                if (c == ',') {
                    i++;
                    skipWs();
                    first = false;
                    continue;
                }
                if (c == '}') {
                    i++;
                    return map;
                }
                throw positioned("Expected ',' or '}' after property value", i);
            }
        }

        private List<Object> parseArray() {
            List<Object> list = new ArrayList<>();
            i++;
            skipWs();
            if (i >= s.length()) throw new SyntaxError("Unexpected end of JSON input");
            if (s.charAt(i) == ']') {
                i++;
                return list;
            }
            while (true) {
                skipWs();
                list.add(parseValue());
                skipWs();
                if (i >= s.length()) throw new SyntaxError("Unexpected end of JSON input");
                char c = s.charAt(i);
                if (c == ',') {
                    i++;
                    skipWs();
                    continue;
                }
                if (c == ']') {
                    i++;
                    return list;
                }
                throw positioned("Expected ',' or ']' after array element", i);
            }
        }

        private String parseString() {
            i++;
            StringBuilder out = new StringBuilder();
            while (true) {
                if (i >= s.length()) throw positioned("Unterminated string", i);
                char c = s.charAt(i);
                if (c == '"') {
                    i++;
                    return out.toString();
                }
                if (c < 0x20) throw positioned("Bad control character in string literal", i);
                if (c != '\\') {
                    out.append(c);
                    i++;
                    continue;
                }
                if (i + 1 >= s.length()) throw positioned("Unterminated string", i + 1);
                char e = s.charAt(i + 1);
                switch (e) {
                    case '"' -> out.append('"');
                    case '\\' -> out.append('\\');
                    case '/' -> out.append('/');
                    case 'b' -> out.append('\b');
                    case 'f' -> out.append('\f');
                    case 'n' -> out.append('\n');
                    case 'r' -> out.append('\r');
                    case 't' -> out.append('\t');
                    case 'u' -> {
                        int code = 0;
                        for (int k = 0; k < 4; k++) {
                            int p = i + 2 + k;
                            if (p >= s.length()) throw positioned("Bad Unicode escape", p);
                            int digit = Character.digit(s.charAt(p), 16);
                            if (digit < 0) throw positioned("Bad Unicode escape", p);
                            code = code * 16 + digit;
                        }
                        out.append((char) code);
                        i += 4;
                    }
                    default -> throw positioned("Bad escaped character", i + 1);
                }
                i += 2;
            }
        }

        private Double parseNumber() {
            int start = i;
            if (s.charAt(i) == '-') {
                i++;
                if (i >= s.length() || !isDigit(s.charAt(i))) throw positioned("No number after minus sign", i);
            }
            if (s.charAt(i) == '0') {
                i++;
            } else {
                while (i < s.length() && isDigit(s.charAt(i))) i++;
            }
            if (i < s.length() && s.charAt(i) == '.') {
                i++;
                if (i >= s.length() || !isDigit(s.charAt(i))) throw positioned("Unterminated fractional number", i);
                while (i < s.length() && isDigit(s.charAt(i))) i++;
            }
            if (i < s.length() && (s.charAt(i) == 'e' || s.charAt(i) == 'E')) {
                i++;
                if (i < s.length() && (s.charAt(i) == '+' || s.charAt(i) == '-')) i++;
                if (i >= s.length() || !isDigit(s.charAt(i))) throw positioned("Exponent part is missing a number", i);
                while (i < s.length() && isDigit(s.charAt(i))) i++;
            }
            return Double.parseDouble(s.substring(start, i));
        }

        private static boolean isDigit(char c) {
            return c >= '0' && c <= '9';
        }

        private SyntaxError positioned(String message, int position) {
            int line = 1, column = 1;
            for (int k = 0; k < position && k < s.length(); k++) {
                if (s.charAt(k) == '\n') {
                    line++;
                    column = 1;
                } else {
                    column++;
                }
            }
            return new SyntaxError(message + " in JSON at position " + position + " (line " + line + " column " + column + ")");
        }

        private SyntaxError unexpectedToken(int position) {
            if (position >= s.length()) return new SyntaxError("Unexpected end of JSON input");
            String token = String.valueOf(s.charAt(position));
            int length = s.length();
            if (length < MIN_LENGTH_FOR_CONTEXT) {
                return new SyntaxError("Unexpected token '" + token + "', \"" + s + "\" is not valid JSON");
            }
            if (position < MAX_CONTEXT) {
                return new SyntaxError("Unexpected token '" + token + "', \"" + s.substring(0, position + MAX_CONTEXT)
                        + "\"... is not valid JSON");
            }
            if (position < length - MAX_CONTEXT) {
                return new SyntaxError("Unexpected token '" + token + "', ...\""
                        + s.substring(position - MAX_CONTEXT, position + MAX_CONTEXT) + "\"... is not valid JSON");
            }
            return new SyntaxError("Unexpected token '" + token + "', ...\"" + s.substring(position - MAX_CONTEXT)
                    + "\" is not valid JSON");
        }
    }
}
