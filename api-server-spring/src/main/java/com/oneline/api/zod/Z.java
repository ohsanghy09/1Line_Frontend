package com.oneline.api.zod;

import com.oneline.api.js.Js;
import com.oneline.api.js.Json;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.function.BiConsumer;
import java.util.function.Predicate;
import java.util.function.Supplier;
import java.util.regex.Pattern;

/**
 * 기존 서버가 사용한 zod 4 (4.6.7) 의 검증 동작을 Java로 옮긴 최소 구현.
 * 파싱 결과(트림·키 순서·알 수 없는 키 제거)와 오류 메시지(JSON 형식의 issue 목록)를 같게 만든다.
 */
public final class Z {
    private Z() {
    }

    // ================================================================ issue / payload / error

    public static final class Issue {
        final LinkedHashMap<String, Object> fields = new LinkedHashMap<>();
        Object input = Js.UNDEFINED;
        Boolean cont;
        String errorMessage;

        Issue put(String key, Object value) {
            fields.put(key, value);
            return this;
        }

        @SuppressWarnings("unchecked")
        void prefix(Object key) {
            if (!fields.containsKey("path") || fields.get("path") == null) fields.put("path", new ArrayList<>());
            ((List<Object>) fields.get("path")).add(0, key);
        }

        Map<String, Object> finalizeIssue() {
            LinkedHashMap<String, Object> full = new LinkedHashMap<>(fields);
            if (!full.containsKey("path")) full.put("path", new ArrayList<>());
            String message = full.get("message") instanceof String s && !s.isEmpty() ? s
                    : errorMessage != null ? errorMessage : localeMessage();
            full.put("message", message);
            return full;
        }

        @SuppressWarnings("unchecked")
        private String localeMessage() {
            String code = (String) fields.get("code");
            switch (code) {
                case "invalid_type": {
                    String expected = String.valueOf(fields.get("expected"));
                    if (expected.equals("nan")) expected = "NaN";
                    String received = parsedType(input);
                    if (received.equals("nan")) received = "NaN";
                    return "Invalid input: expected " + expected + ", received " + received;
                }
                case "invalid_value": {
                    List<Object> values = (List<Object>) fields.get("values");
                    if (values.size() == 1) return "Invalid input: expected " + stringifyPrimitive(values.get(0));
                    return "Invalid option: expected one of " + joinValues(values, "|");
                }
                case "too_big": {
                    String adj = Boolean.TRUE.equals(fields.get("inclusive")) ? "<=" : "<";
                    String origin = String.valueOf(fields.get("origin"));
                    String unit = sizingUnit(origin);
                    String max = Js.str(fields.get("maximum"));
                    if (unit != null) return "Too big: expected " + origin + " to have " + adj + max + " " + unit;
                    return "Too big: expected " + origin + " to be " + adj + max;
                }
                case "too_small": {
                    String adj = Boolean.TRUE.equals(fields.get("inclusive")) ? ">=" : ">";
                    String origin = String.valueOf(fields.get("origin"));
                    String unit = sizingUnit(origin);
                    String min = Js.str(fields.get("minimum"));
                    if (unit != null) return "Too small: expected " + origin + " to have " + adj + min + " " + unit;
                    return "Too small: expected " + origin + " to be " + adj + min;
                }
                case "invalid_format": {
                    Object format = fields.get("format");
                    if ("regex".equals(format)) return "Invalid string: must match pattern " + fields.get("pattern");
                    if ("url".equals(format)) return "Invalid URL";
                    return "Invalid " + format;
                }
                case "unrecognized_keys": {
                    List<Object> keys = (List<Object>) fields.get("keys");
                    return "Unrecognized key" + (keys.size() > 1 ? "s" : "") + ": " + joinValues(keys, ", ");
                }
                default:
                    return "Invalid input";
            }
        }
    }

    private static String sizingUnit(String origin) {
        return switch (origin) {
            case "string" -> "characters";
            case "file" -> "bytes";
            case "array", "set" -> "items";
            case "map" -> "entries";
            default -> null;
        };
    }

    static String parsedType(Object data) {
        if (data == Js.UNDEFINED) return "undefined";
        if (data == null) return "null";
        if (data instanceof String) return "string";
        if (data instanceof Number n) return Double.isNaN(n.doubleValue()) ? "nan" : "number";
        if (data instanceof Boolean) return "boolean";
        if (data instanceof List) return "array";
        return "object";
    }

    static String stringifyPrimitive(Object value) {
        if (value instanceof String s) return "\"" + s + "\"";
        return Js.str(value);
    }

    static String joinValues(List<Object> values, String separator) {
        List<String> parts = new ArrayList<>();
        for (Object value : values) parts.add(stringifyPrimitive(value));
        return String.join(separator, parts);
    }

    public static final class Payload {
        public Object value;
        public final List<Issue> issues = new ArrayList<>();

        Payload(Object value) {
            this.value = value;
        }

        boolean aborted(int start) {
            for (int i = start; i < issues.size(); i++) {
                if (!Boolean.TRUE.equals(issues.get(i).cont)) return true;
            }
            return false;
        }

        boolean explicitlyAborted() {
            for (Issue issue : issues) {
                if (Boolean.FALSE.equals(issue.cont)) return true;
            }
            return false;
        }

        /** superRefine 의 ctx.addIssue({ code: 'custom', message }) */
        public void addIssue(String message) {
            Issue issue = new Issue().put("code", "custom").put("message", message);
            issue.input = value;
            issue.cont = true;
            issues.add(issue);
        }
    }

    /** ZodError: name === 'ZodError' → HTTP 400, message 는 JSON.stringify(issues, null, 2) */
    public static final class ZodError extends RuntimeException {
        private final List<Issue> issues;

        ZodError(List<Issue> issues) {
            super(null, null, false, false);
            this.issues = issues;
        }

        @Override
        public String getMessage() {
            List<Object> finalized = new ArrayList<>();
            for (Issue issue : issues) finalized.add(issue.finalizeIssue());
            return Json.stringifyPretty(finalized);
        }
    }

    public record SafeParseResult(boolean success, Object data, ZodError error) {
    }

    // ================================================================ schema 기본

    record Check(Predicate<Payload> when, java.util.function.Consumer<Payload> fn) {
    }

    public abstract static class Schema {
        String optin;
        String optout;
        final List<Check> checks = new ArrayList<>();

        abstract void parseValue(Payload payload);

        Payload run(Payload payload) {
            parseValue(payload);
            if (checks.isEmpty()) return payload;
            boolean isAborted = payload.aborted(0);
            for (Check check : checks) {
                if (check.when() != null) {
                    if (payload.explicitlyAborted()) continue;
                    if (!check.when().test(payload)) continue;
                } else if (isAborted) {
                    continue;
                }
                int before = payload.issues.size();
                check.fn().accept(payload);
                if (payload.issues.size() == before) continue;
                if (!isAborted) isAborted = payload.aborted(before);
            }
            return payload;
        }

        public Object parse(Object value) {
            Payload result = run(new Payload(value));
            if (!result.issues.isEmpty()) throw new ZodError(result.issues);
            return result.value;
        }

        public SafeParseResult safeParse(Object value) {
            Payload result = run(new Payload(value));
            if (!result.issues.isEmpty()) return new SafeParseResult(false, null, new ZodError(result.issues));
            return new SafeParseResult(true, result.value, null);
        }

        public Schema optional() {
            return new Optional(this);
        }

        public Schema nullable() {
            return new Nullable(this);
        }

        /** .refine(fn, message) — message 가 null 이면 'Invalid input' */
        public Schema refine(Predicate<Object> fn, String message) {
            checks.add(new Check(null, payload -> {
                if (!fn.test(payload.value)) {
                    Issue issue = new Issue().put("code", "custom").put("path", new ArrayList<>());
                    issue.input = payload.value;
                    issue.cont = true;
                    issue.errorMessage = message;
                    payload.issues.add(issue);
                }
            }));
            return this;
        }

        /** .superRefine((value, ctx) => ...) */
        public Schema superRefine(BiConsumer<Object, Payload> fn) {
            checks.add(new Check(null, payload -> fn.accept(payload.value, payload)));
            return this;
        }

        abstract Schema copy();

        void copyChecksTo(Schema target) {
            target.checks.addAll(checks);
        }
    }

    // ================================================================ 원시 타입

    private static Issue invalidType(String expected, Object input) {
        Issue issue = new Issue().put("expected", expected).put("code", "invalid_type");
        issue.input = input;
        return issue;
    }

    private static final Predicate<Payload> HAS_LENGTH = payload -> {
        Object value = payload.value;
        if (Js.nullish(value)) return false;
        if (value instanceof String || value instanceof List) return true;
        return value instanceof Map<?, ?> map && map.containsKey("length") && map.get("length") != Js.UNDEFINED;
    };

    private static double lengthOf(Object value) {
        if (value instanceof String s) return s.length();
        if (value instanceof List<?> list) return list.size();
        Object length = ((Map<?, ?>) value).get("length");
        return length instanceof Number n ? n.doubleValue() : Double.NaN;
    }

    private static String lengthableOrigin(Object value) {
        if (value instanceof List) return "array";
        if (value instanceof String) return "string";
        return "unknown";
    }

    private static int codePointLength(String s) {
        return s.codePointCount(0, s.length());
    }

    public static final class ZString extends Schema {
        @Override
        void parseValue(Payload payload) {
            if (!(payload.value instanceof String)) payload.issues.add(invalidType("string", payload.value));
        }

        public ZString trim() {
            checks.add(new Check(null, payload -> payload.value = Js.trim(Js.requireString(payload.value, "trim"))));
            return this;
        }

        public ZString min(int minimum) {
            checks.add(new Check(HAS_LENGTH, payload -> {
                Object input = payload.value;
                double units = lengthOf(input);
                double length = input instanceof String s && units >= minimum && units < minimum * 2.0 ? codePointLength(s) : units;
                if (length >= minimum) return;
                Issue issue = new Issue().put("origin", lengthableOrigin(input)).put("code", "too_small")
                        .put("minimum", (double) minimum).put("inclusive", true);
                issue.input = input;
                issue.cont = true;
                payload.issues.add(issue);
            }));
            return this;
        }

        public ZString max(int maximum) {
            checks.add(new Check(HAS_LENGTH, payload -> {
                Object input = payload.value;
                double units = lengthOf(input);
                double length = input instanceof String s && units > maximum ? codePointLength(s) : units;
                if (length <= maximum) return;
                Issue issue = new Issue().put("origin", lengthableOrigin(input)).put("code", "too_big")
                        .put("maximum", (double) maximum).put("inclusive", true);
                issue.input = input;
                issue.cont = true;
                payload.issues.add(issue);
            }));
            return this;
        }

        /** .regex(pattern) — jsSource 는 JavaScript 정규식 리터럴 표기(/.../) */
        public ZString regex(Pattern pattern, String jsSource) {
            checks.add(new Check(null, payload -> {
                if (pattern.matcher((String) payload.value).find()) return;
                Issue issue = new Issue().put("origin", "string").put("code", "invalid_format").put("format", "regex")
                        .put("pattern", jsSource);
                issue.input = payload.value;
                issue.cont = true;
                payload.issues.add(issue);
            }));
            return this;
        }

        /** .url() — WHATWG URL 로 파싱할 수 있는지 검사하고, 탭/개행 문자를 제거한 값을 출력한다. */
        public ZString url() {
            checks.add(new Check(null, payload -> {
                String trimmed = Js.trim((String) payload.value);
                if (WhatwgUrl.parse(trimmed) == null) {
                    Issue issue = new Issue().put("code", "invalid_format").put("format", "url");
                    issue.input = payload.value;
                    issue.cont = true;
                    payload.issues.add(issue);
                    return;
                }
                payload.value = trimmed.replaceAll("[\\t\\n\\r]", "");
            }));
            return this;
        }

        @Override
        public ZString refine(Predicate<Object> fn, String message) {
            super.refine(fn, message);
            return this;
        }

        @Override
        Schema copy() {
            ZString copy = new ZString();
            copyChecksTo(copy);
            return copy;
        }
    }

    public static final class ZNumber extends Schema {
        @Override
        void parseValue(Payload payload) {
            Object input = payload.value;
            if (input instanceof Number n && !Double.isNaN(n.doubleValue()) && !Double.isInfinite(n.doubleValue())) return;
            payload.issues.add(invalidType("number", input));
        }

        public ZNumber integer() {
            checks.add(new Check(null, payload -> {
                Object input = payload.value;
                if (!Js.isInteger(input)) {
                    Issue issue = new Issue().put("expected", "int").put("format", "safeint").put("code", "invalid_type");
                    issue.cont = false;
                    issue.input = input;
                    payload.issues.add(issue);
                    return;
                }
                double value = ((Number) input).doubleValue();
                double maxSafe = 9007199254740991d;
                if (Math.abs(value) > maxSafe) {
                    Issue issue = value > 0
                            ? new Issue().put("code", "too_big").put("maximum", maxSafe)
                            : new Issue().put("code", "too_small").put("minimum", -maxSafe);
                    issue.put("note", "Integers must be within the safe integer range.").put("origin", "int").put("inclusive", true);
                    issue.input = input;
                    issue.cont = true;
                    payload.issues.add(issue);
                }
            }));
            return this;
        }

        private ZNumber bound(boolean lower, double limit, boolean inclusive) {
            checks.add(new Check(null, payload -> {
                double value = ((Number) payload.value).doubleValue();
                boolean ok = lower ? (inclusive ? value >= limit : value > limit) : (inclusive ? value <= limit : value < limit);
                if (ok) return;
                Issue issue = new Issue().put("origin", "number").put("code", lower ? "too_small" : "too_big")
                        .put(lower ? "minimum" : "maximum", limit).put("inclusive", inclusive);
                issue.input = payload.value;
                issue.cont = true;
                payload.issues.add(issue);
            }));
            return this;
        }

        public ZNumber positive() {
            return bound(true, 0, false);
        }

        public ZNumber nonnegative() {
            return bound(true, 0, true);
        }

        public ZNumber min(double value) {
            return bound(true, value, true);
        }

        public ZNumber max(double value) {
            return bound(false, value, true);
        }

        @Override
        Schema copy() {
            ZNumber copy = new ZNumber();
            copyChecksTo(copy);
            return copy;
        }
    }

    public static final class ZBoolean extends Schema {
        @Override
        void parseValue(Payload payload) {
            if (!(payload.value instanceof Boolean)) payload.issues.add(invalidType("boolean", payload.value));
        }

        @Override
        Schema copy() {
            ZBoolean copy = new ZBoolean();
            copyChecksTo(copy);
            return copy;
        }
    }

    /** z.enum([...]) 과 z.literal(x) */
    public static final class ZValues extends Schema {
        private final List<Object> values;

        ZValues(List<Object> values) {
            this.values = values;
        }

        @Override
        void parseValue(Payload payload) {
            for (Object value : values) {
                if (Js.sameValueZero(value, payload.value)) return;
            }
            Issue issue = new Issue().put("code", "invalid_value").put("values", new ArrayList<>(values));
            issue.input = payload.value;
            payload.issues.add(issue);
        }

        @Override
        Schema copy() {
            ZValues copy = new ZValues(values);
            copyChecksTo(copy);
            return copy;
        }
    }

    // ================================================================ 래퍼

    public static final class Optional extends Schema {
        final Schema inner;

        Optional(Schema inner) {
            this.inner = inner;
            this.optin = "defaulted".equals(inner.optin) ? "defaulted" : "optional";
            this.optout = "optional";
        }

        @Override
        void parseValue(Payload payload) {
            if (payload.value == Js.UNDEFINED) {
                if (!"defaulted".equals(inner.optin)) return;
                Payload result = inner.run(new Payload(payload.value));
                payload.value = result.value;
                payload.issues.addAll(result.issues);
                return;
            }
            Payload result = inner.run(payload);
            payload.value = result.value;
        }

        @Override
        Schema copy() {
            Optional copy = new Optional(inner);
            copyChecksTo(copy);
            return copy;
        }
    }

    public static final class Nullable extends Schema {
        final Schema inner;

        Nullable(Schema inner) {
            this.inner = inner;
            this.optin = inner.optin;
            this.optout = inner.optout;
        }

        @Override
        void parseValue(Payload payload) {
            if (payload.value == null) return;
            inner.run(payload);
        }

        @Override
        Schema copy() {
            Nullable copy = new Nullable(inner);
            copyChecksTo(copy);
            return copy;
        }
    }

    public static final class Default extends Schema {
        final Schema inner;
        final Supplier<Object> defaultValue;

        Default(Schema inner, Supplier<Object> defaultValue) {
            this.inner = inner;
            this.defaultValue = defaultValue;
            this.optin = "defaulted";
        }

        @Override
        void parseValue(Payload payload) {
            if (payload.value == Js.UNDEFINED) {
                payload.value = defaultValue.get();
                return;
            }
            inner.run(payload);
            if (payload.value == Js.UNDEFINED) payload.value = defaultValue.get();
        }

        @Override
        Schema copy() {
            Default copy = new Default(inner, defaultValue);
            copyChecksTo(copy);
            return copy;
        }
    }

    // ================================================================ 배열

    public static final class ZArray extends Schema {
        final Schema element;

        ZArray(Schema element) {
            this.element = element;
        }

        @Override
        void parseValue(Payload payload) {
            Object input = payload.value;
            if (!(input instanceof List<?> list)) {
                payload.issues.add(invalidType("array", input));
                return;
            }
            List<Object> output = new ArrayList<>(list.size());
            for (int i = 0; i < list.size(); i++) {
                Payload result = element.run(new Payload(list.get(i)));
                for (Issue issue : result.issues) issue.prefix((double) i);
                payload.issues.addAll(result.issues);
                output.add(result.value);
            }
            payload.value = output;
        }

        private ZArray size(boolean lower, int limit) {
            checks.add(new Check(HAS_LENGTH, payload -> {
                Object input = payload.value;
                double length = lengthOf(input);
                if (lower ? length >= limit : length <= limit) return;
                Issue issue = new Issue().put("origin", lengthableOrigin(input)).put("code", lower ? "too_small" : "too_big")
                        .put(lower ? "minimum" : "maximum", (double) limit).put("inclusive", true);
                issue.input = input;
                issue.cont = true;
                payload.issues.add(issue);
            }));
            return this;
        }

        public ZArray min(int minimum) {
            return size(true, minimum);
        }

        public ZArray max(int maximum) {
            return size(false, maximum);
        }

        @Override
        Schema copy() {
            ZArray copy = new ZArray(element);
            copyChecksTo(copy);
            return copy;
        }
    }

    // ================================================================ 객체

    public static final class ZObject extends Schema {
        final LinkedHashMap<String, Schema> shape;
        boolean strict;

        ZObject(LinkedHashMap<String, Schema> shape) {
            this.shape = shape;
        }

        @Override
        void parseValue(Payload payload) {
            Object input = payload.value;
            if (!(input instanceof Map<?, ?>)) {
                payload.issues.add(invalidType("object", input));
                return;
            }
            Map<String, Object> source = Js.asObject(input);
            LinkedHashMap<String, Object> output = new LinkedHashMap<>();
            payload.value = output;
            for (Map.Entry<String, Schema> entry : shape.entrySet()) {
                String key = entry.getKey();
                if (key.equals("__proto__")) continue;
                Schema schema = entry.getValue();
                boolean present = source.containsKey(key);
                Payload result = schema.run(new Payload(present ? source.get(key) : Js.UNDEFINED));
                handleProperty(result, payload, output, key, present, schema.optin, schema.optout);
            }
            if (!strict) return;
            List<Object> unrecognized = new ArrayList<>();
            for (String key : Js.keys(source)) {
                if (!shape.containsKey(key)) unrecognized.add(key);
            }
            if (!unrecognized.isEmpty()) {
                Issue issue = new Issue().put("code", "unrecognized_keys").put("keys", unrecognized);
                issue.input = input;
                issue.cont = true;
                payload.issues.add(issue);
            }
        }

        private static void handleProperty(Payload result, Payload payload, Map<String, Object> output, String key,
                                           boolean present, String optin, String optout) {
            boolean optionalOut = "optional".equals(optout);
            if (!present && optionalOut && "optional".equals(optin)) return;
            if (!result.issues.isEmpty()) {
                if (optin != null && optionalOut && !present) return;
                for (Issue issue : result.issues) issue.prefix(key);
                payload.issues.addAll(result.issues);
            }
            if (!present && optin == null) {
                if (result.issues.isEmpty()) {
                    Issue issue = new Issue().put("code", "invalid_type").put("expected", "nonoptional")
                            .put("path", new ArrayList<>(List.of(key)));
                    payload.issues.add(issue);
                }
                return;
            }
            if (result.value == Js.UNDEFINED) {
                if (present || ("defaulted".equals(optin) && !optionalOut)) output.put(key, Js.UNDEFINED);
            } else {
                output.put(key, result.value);
            }
        }

        /** .strict() */
        public ZObject strict() {
            ZObject copy = (ZObject) copy();
            copy.strict = true;
            return copy;
        }

        /** .partial() — 모든 필드를 optional 로 감싼다. (기존 refine 은 제거) */
        public ZObject partial() {
            LinkedHashMap<String, Schema> next = new LinkedHashMap<>();
            shape.forEach((key, schema) -> next.put(key, schema.optional()));
            ZObject copy = new ZObject(next);
            copy.strict = strict;
            return copy;
        }

        /** .extend({...}) — strict 여부와 검사 유지 */
        public ZObject extend(Object... pairs) {
            LinkedHashMap<String, Schema> next = new LinkedHashMap<>(shape);
            for (int i = 0; i < pairs.length; i += 2) next.put((String) pairs[i], (Schema) pairs[i + 1]);
            ZObject copy = new ZObject(next);
            copy.strict = strict;
            copyChecksTo(copy);
            return copy;
        }

        public Schema field(String key) {
            return shape.get(key);
        }

        @Override
        public ZObject refine(Predicate<Object> fn, String message) {
            super.refine(fn, message);
            return this;
        }

        @Override
        public ZObject superRefine(BiConsumer<Object, Payload> fn) {
            super.superRefine(fn);
            return this;
        }

        @Override
        Schema copy() {
            ZObject copy = new ZObject(new LinkedHashMap<>(shape));
            copy.strict = strict;
            copyChecksTo(copy);
            return copy;
        }
    }

    // ================================================================ 생성 함수

    public static ZString string() {
        return new ZString();
    }

    public static ZNumber number() {
        return new ZNumber();
    }

    public static ZBoolean bool() {
        return new ZBoolean();
    }

    public static ZValues enumOf(String... values) {
        return new ZValues(new ArrayList<>(List.of((Object[]) values)));
    }

    public static ZValues literal(Object value) {
        List<Object> values = new ArrayList<>();
        values.add(value);
        return new ZValues(values);
    }

    public static ZArray array(Schema element) {
        return new ZArray(element);
    }

    /** z.object({ key: schema, ... }) */
    public static ZObject object(Object... pairs) {
        LinkedHashMap<String, Schema> shape = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) shape.put((String) pairs[i], (Schema) pairs[i + 1]);
        return new ZObject(shape);
    }

    public static Schema withDefault(Schema inner, Object value) {
        return new Default(inner, () -> value);
    }

    /** 검사 순서를 유지한 중복 제거 집합 (new Set(values)) */
    public static <T> LinkedHashSet<Object> setOf(List<T> values) {
        LinkedHashSet<Object> set = new LinkedHashSet<>();
        for (T value : values) set.add(Js.setKey(value));
        return set;
    }
}
