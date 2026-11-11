package com.oneline.api.js;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * 기존 Node(Express) 서버의 JavaScript 값 의미를 그대로 재현하기 위한 도구 모음.
 * JSON 값은 Map(LinkedHashMap)/List/String/Double/Boolean/null 로 표현하고,
 * 존재하지 않는 값(undefined)은 {@link #UNDEFINED} 로 표현한다.
 */
public final class Js {
    private Js() {
    }

    public static final Object UNDEFINED = new Object() {
        @Override
        public String toString() {
            return "undefined";
        }
    };

    /** JavaScript TypeError 에 대응한다. 처리되지 않으면 500으로 응답한다. */
    public static final class TypeError extends RuntimeException {
        public TypeError(String message) {
            super(message);
        }
    }

    // ---------------------------------------------------------------- 값 판별

    public static boolean isUndefined(Object value) {
        return value == UNDEFINED;
    }

    public static boolean nullish(Object value) {
        return value == null || value == UNDEFINED;
    }

    public static boolean truthy(Object value) {
        if (nullish(value)) return false;
        if (value instanceof Boolean b) return b;
        if (value instanceof String s) return !s.isEmpty();
        if (value instanceof Number n) {
            double d = n.doubleValue();
            return d != 0 && !Double.isNaN(d);
        }
        return true;
    }

    /** a ?? b */
    public static Object coalesce(Object value, Object fallback) {
        return nullish(value) ? fallback : value;
    }

    /** 객체 여부(typeof === 'object' && !== null && !Array.isArray) */
    public static boolean isObject(Object value) {
        return value instanceof Map;
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> asObject(Object value) {
        return (Map<String, Object>) value;
    }

    @SuppressWarnings("unchecked")
    public static List<Object> asArray(Object value) {
        return (List<Object>) value;
    }

    /** === */
    public static boolean strictEquals(Object a, Object b) {
        if (a == b) return true;
        if (a == null || b == null || a == UNDEFINED || b == UNDEFINED) return false;
        if (a instanceof Number x && b instanceof Number y) return x.doubleValue() == y.doubleValue();
        if (a instanceof String || a instanceof Boolean) return a.equals(b);
        return false;
    }

    /** SameValueZero (Array.prototype.includes, Set, Map) */
    public static boolean sameValueZero(Object a, Object b) {
        if (a instanceof Number x && b instanceof Number y) {
            double p = x.doubleValue(), q = y.doubleValue();
            return p == q || (Double.isNaN(p) && Double.isNaN(q));
        }
        return strictEquals(a, b);
    }

    /** Set/Map 키로 쓸 수 있도록 SameValueZero 기준으로 정규화한다. */
    public static Object setKey(Object value) {
        if (value instanceof Number n) {
            double d = n.doubleValue();
            return d == 0 ? 0.0 : d;
        }
        if (value instanceof Map || value instanceof List) return new IdentityKey(value);
        return value;
    }

    private record IdentityKey(Object value) {
        @Override
        public boolean equals(Object other) {
            return other instanceof IdentityKey key && key.value == value;
        }

        @Override
        public int hashCode() {
            return System.identityHashCode(value);
        }
    }

    // ---------------------------------------------------------------- 속성 접근

    /** obj.key — obj 가 null/undefined 면 TypeError */
    public static Object get(Object target, String key) {
        if (nullish(target)) {
            throw new TypeError("Cannot read properties of " + target + " (reading '" + key + "')");
        }
        if (target instanceof Map<?, ?> map) {
            return map.containsKey(key) ? map.get(key) : UNDEFINED;
        }
        if (target instanceof List<?> list) {
            if (key.equals("length")) return (double) list.size();
            int index = arrayIndex(key);
            return index >= 0 && index < list.size() ? list.get(index) : UNDEFINED;
        }
        if (target instanceof String s) {
            if (key.equals("length")) return (double) s.length();
            int index = arrayIndex(key);
            return index >= 0 && index < s.length() ? String.valueOf(s.charAt(index)) : UNDEFINED;
        }
        return UNDEFINED;
    }

    /** obj?.key */
    public static Object opt(Object target, String key) {
        return nullish(target) ? UNDEFINED : get(target, key);
    }

    /** obj.a.b.c */
    public static Object path(Object target, String... keys) {
        Object current = target;
        for (String key : keys) current = get(current, key);
        return current;
    }

    /** obj.key = value — 원시값/nullish 에 대입하면 TypeError(strict mode) */
    public static void set(Object target, String key, Object value) {
        if (target instanceof Map<?, ?>) {
            asObject(target).put(key, value);
            return;
        }
        if (target instanceof List<?>) return;
        if (nullish(target)) {
            throw new TypeError("Cannot set properties of " + target + " (setting '" + key + "')");
        }
        throw new TypeError("Cannot create property '" + key + "' on " + typeOf(target));
    }

    /** 'key' in obj */
    public static boolean has(Object target, String key) {
        if (target instanceof Map<?, ?> map) return map.containsKey(key);
        if (target instanceof List<?> list) {
            if (key.equals("length")) return true;
            int index = arrayIndex(key);
            return index >= 0 && index < list.size();
        }
        throw new TypeError("Cannot use 'in' operator to search for '" + key + "' in " + target);
    }

    public static String typeOf(Object value) {
        if (value == UNDEFINED) return "undefined";
        if (value == null) return "object";
        if (value instanceof String) return "string";
        if (value instanceof Number) return "number";
        if (value instanceof Boolean) return "boolean";
        return "object";
    }

    /** 배열 인덱스로 쓰이는 정수형 키면 그 값, 아니면 -1 */
    public static int arrayIndex(String key) {
        if (key.isEmpty() || key.length() > 10) return -1;
        if (key.length() > 1 && key.charAt(0) == '0') return -1;
        long value = 0;
        for (int i = 0; i < key.length(); i++) {
            char c = key.charAt(i);
            if (c < '0' || c > '9') return -1;
            value = value * 10 + (c - '0');
        }
        return value <= 4294967294L && value <= Integer.MAX_VALUE ? (int) value : -1;
    }

    /** JavaScript 객체 속성 열거 순서(정수 키 오름차순 → 나머지는 삽입 순서) */
    public static List<String> keys(Map<String, ?> map) {
        List<String> integers = null;
        List<String> others = new ArrayList<>(map.size());
        for (String key : map.keySet()) {
            if (arrayIndexKey(key)) {
                if (integers == null) integers = new ArrayList<>();
                integers.add(key);
            } else {
                others.add(key);
            }
        }
        if (integers == null) return others;
        integers.sort((a, b) -> Long.compare(Long.parseLong(a), Long.parseLong(b)));
        integers.addAll(others);
        return integers;
    }

    private static boolean arrayIndexKey(String key) {
        if (key.isEmpty() || key.length() > 10) return false;
        if (key.length() > 1 && key.charAt(0) == '0') return false;
        for (int i = 0; i < key.length(); i++) {
            char c = key.charAt(i);
            if (c < '0' || c > '9') return false;
        }
        return Long.parseLong(key) <= 4294967294L;
    }

    /** { ...source } — 열거 순서를 유지한 얕은 복사 */
    public static LinkedHashMap<String, Object> spread(Map<String, Object> source) {
        LinkedHashMap<String, Object> copy = new LinkedHashMap<>();
        for (String key : keys(source)) copy.put(key, source.get(key));
        return copy;
    }

    /** for (const x of value) */
    public static List<Object> iterate(Object value) {
        if (value instanceof List<?> list) return new ArrayList<>(list);
        if (value instanceof String s) {
            List<Object> chars = new ArrayList<>();
            s.codePoints().forEach(cp -> chars.add(new String(Character.toChars(cp))));
            return chars;
        }
        throw new TypeError(value + " is not iterable");
    }

    // ---------------------------------------------------------------- 문자열

    /** String(value) / 템플릿 리터럴 변환 */
    public static String str(Object value) {
        if (value == UNDEFINED) return "undefined";
        if (value == null) return "null";
        if (value instanceof String s) return s;
        if (value instanceof Number n) return numberToString(n.doubleValue());
        if (value instanceof Boolean b) return b.toString();
        if (value instanceof List<?> list) {
            StringBuilder out = new StringBuilder();
            for (int i = 0; i < list.size(); i++) {
                if (i > 0) out.append(',');
                Object item = list.get(i);
                if (!nullish(item)) out.append(str(item));
            }
            return out.toString();
        }
        return "[object Object]";
    }

    /** 문자열 메서드를 호출하기 위한 검사. 문자열이 아니면 TypeError */
    public static String requireString(Object value, String method) {
        if (value instanceof String s) return s;
        if (nullish(value)) throw new TypeError("Cannot read properties of " + value + " (reading '" + method + "')");
        throw new TypeError("value." + method + " is not a function");
    }

    public static boolean isJsWhitespace(char c) {
        return switch (c) {
            case '\t', '\n', '\u000B', '\f', '\r', ' ', ' ', ' ', ' ', ' ', ' ', ' ',
                 '　', '﻿' -> true;
            default -> c >= ' ' && c <= ' ';
        };
    }

    /** String.prototype.trim */
    public static String trim(String value) {
        int start = 0, end = value.length();
        while (start < end && isJsWhitespace(value.charAt(start))) start++;
        while (end > start && isJsWhitespace(value.charAt(end - 1))) end--;
        return value.substring(start, end);
    }

    /** value.replace(/\s+/g, ' ') */
    public static String collapseWhitespace(String value) {
        StringBuilder out = new StringBuilder(value.length());
        boolean inSpace = false;
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (isJsWhitespace(c)) {
                if (!inSpace) out.append(' ');
                inSpace = true;
            } else {
                out.append(c);
                inSpace = false;
            }
        }
        return out.toString();
    }

    /** String.prototype.toLowerCase (로케일 비의존) */
    public static String toLowerCase(String value) {
        return value.toLowerCase(java.util.Locale.ROOT);
    }

    /** String.prototype.replaceAll(문자열, 문자열) — 치환 문자열의 $ 패턴까지 동일하게 처리한다. */
    public static String replaceAll(String value, String search, String replacement) {
        List<Integer> positions = new ArrayList<>();
        int advance = Math.max(1, search.length());
        int position = value.indexOf(search);
        while (position != -1) {
            positions.add(position);
            position = position + advance > value.length() ? -1 : value.indexOf(search, position + advance);
        }
        int endOfLastMatch = 0;
        StringBuilder result = new StringBuilder();
        for (int p : positions) {
            result.append(value, endOfLastMatch, p);
            result.append(substitution(value, search, p, replacement));
            endOfLastMatch = p + search.length();
        }
        if (endOfLastMatch < value.length()) result.append(value.substring(endOfLastMatch));
        return result.toString();
    }

    /** GetSubstitution (캡처 그룹 없음) */
    private static String substitution(String value, String matched, int position, String replacement) {
        if (replacement.indexOf('$') < 0) return replacement;
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < replacement.length(); i++) {
            char c = replacement.charAt(i);
            if (c != '$' || i + 1 >= replacement.length()) {
                out.append(c);
                continue;
            }
            char next = replacement.charAt(i + 1);
            switch (next) {
                case '$' -> {
                    out.append('$');
                    i++;
                }
                case '&' -> {
                    out.append(matched);
                    i++;
                }
                case '`' -> {
                    out.append(value, 0, position);
                    i++;
                }
                case '\'' -> {
                    int tail = Math.min(position + matched.length(), value.length());
                    out.append(value.substring(tail));
                    i++;
                }
                default -> out.append(c);
            }
        }
        return out.toString();
    }

    /** String.prototype.includes */
    public static boolean includes(Object target, Object search) {
        return requireString(target, "includes").contains(str(search));
    }

    /** encodeURIComponent */
    public static String encodeURIComponent(String value) {
        StringBuilder out = new StringBuilder(value.length());
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
                    || "-_.!~*'()".indexOf(c) >= 0) {
                out.append(c);
                continue;
            }
            int codePoint;
            if (Character.isHighSurrogate(c)) {
                if (i + 1 >= value.length() || !Character.isLowSurrogate(value.charAt(i + 1))) {
                    throw new UriError("URI malformed");
                }
                codePoint = Character.toCodePoint(c, value.charAt(++i));
            } else if (Character.isLowSurrogate(c)) {
                throw new UriError("URI malformed");
            } else {
                codePoint = c;
            }
            for (byte b : new String(Character.toChars(codePoint)).getBytes(StandardCharsets.UTF_8)) {
                out.append('%').append(Character.toUpperCase(Character.forDigit((b >> 4) & 0xF, 16)))
                        .append(Character.toUpperCase(Character.forDigit(b & 0xF, 16)));
            }
        }
        return out.toString();
    }

    public static final class UriError extends RuntimeException {
        public UriError(String message) {
            super(message);
        }
    }

    /** 기본 Array.prototype.sort() — 문자열 변환 후 UTF-16 코드 단위 비교, undefined 는 뒤로 */
    public static List<Object> defaultSort(List<Object> values) {
        List<Object> defined = new ArrayList<>();
        int undefinedCount = 0;
        for (Object value : values) {
            if (value == UNDEFINED) undefinedCount++;
            else defined.add(value);
        }
        defined.sort((a, b) -> str(a).compareTo(str(b)));
        for (int i = 0; i < undefinedCount; i++) defined.add(UNDEFINED);
        return defined;
    }

    /** String.prototype.slice(start, end) — 음수 미지원 범위만 사용한다. */
    public static String slice(String value, int start, int end) {
        int from = Math.min(Math.max(start, 0), value.length());
        int to = Math.min(Math.max(end, 0), value.length());
        return from >= to ? "" : value.substring(from, to);
    }

    // ---------------------------------------------------------------- 숫자

    /** Number.prototype.toString() */
    public static String numberToString(double value) {
        if (Double.isNaN(value)) return "NaN";
        if (Double.isInfinite(value)) return value > 0 ? "Infinity" : "-Infinity";
        if (value == 0) return "0";
        if (value < 0) return "-" + numberToString(-value);
        BigDecimal decimal = new BigDecimal(Double.toString(value)).stripTrailingZeros();
        String digits = decimal.unscaledValue().toString();
        int k = digits.length();
        int n = k - decimal.scale();
        if (k <= n && n <= 21) return digits + "0".repeat(n - k);
        if (0 < n && n <= 21) return digits.substring(0, n) + "." + digits.substring(n);
        if (-6 < n && n <= 0) return "0." + "0".repeat(-n) + digits;
        int exponent = n - 1;
        String sign = exponent < 0 ? "-" : "+";
        String mantissa = k == 1 ? digits : digits.charAt(0) + "." + digits.substring(1);
        return mantissa + "e" + sign + Math.abs(exponent);
    }

    public static boolean isInteger(Object value) {
        if (!(value instanceof Number n)) return false;
        double d = n.doubleValue();
        return !Double.isNaN(d) && !Double.isInfinite(d) && Math.floor(d) == d;
    }

    // ---------------------------------------------------------------- 시간·ID·해시

    private static final DateTimeFormatter ISO = DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'")
            .withZone(ZoneOffset.UTC);

    /** new Date().toISOString() */
    public static String nowIso() {
        return ISO.format(Instant.ofEpochMilli(System.currentTimeMillis()));
    }

    /** Date.now() */
    public static double now() {
        return System.currentTimeMillis();
    }

    /** Date.parse(value) — 실패 시 NaN */
    public static double parseDate(Object value) {
        if (!(value instanceof String text)) return Double.NaN;
        String s = text.trim();
        try {
            return Instant.parse(s).toEpochMilli();
        } catch (Exception ignored) {
        }
        try {
            return OffsetDateTime.parse(s).toInstant().toEpochMilli();
        } catch (Exception ignored) {
        }
        try {
            if (s.length() == 10) return LocalDate.parse(s).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli();
        } catch (Exception ignored) {
        }
        try {
            if (s.length() == 7) return LocalDate.parse(s + "-01").atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli();
        } catch (Exception ignored) {
        }
        try {
            if (s.length() == 4) return LocalDate.parse(s + "-01-01").atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli();
        } catch (Exception ignored) {
        }
        try {
            // 오프셋 없는 날짜·시각은 로컬 시각으로 해석한다.
            return LocalDateTime.parse(s).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
        } catch (Exception ignored) {
        }
        return Double.NaN;
    }

    /** crypto.randomUUID() */
    public static String randomUUID() {
        return UUID.randomUUID().toString();
    }

    public static String sha256Hex(String text) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    // ---------------------------------------------------------------- 객체 생성 도우미

    /** 순서를 보존하는 객체 리터럴. obj("a", 1, "b", 2) */
    public static LinkedHashMap<String, Object> obj(Object... pairs) {
        LinkedHashMap<String, Object> map = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) map.put((String) pairs[i], pairs[i + 1]);
        return map;
    }

    /** 배열 리터럴 */
    public static List<Object> arr(Object... values) {
        List<Object> list = new ArrayList<>(values.length);
        for (Object value : values) list.add(value);
        return list;
    }

    /** new Set(values).size === values.length */
    public static boolean unique(List<?> values) {
        java.util.HashSet<Object> seen = new java.util.HashSet<>();
        for (Object value : values) {
            if (!seen.add(setKey(value))) return false;
        }
        return true;
    }

    public static boolean equalsJson(Object a, Object b) {
        return Objects.equals(Json.stringify(a), Json.stringify(b));
    }
}
