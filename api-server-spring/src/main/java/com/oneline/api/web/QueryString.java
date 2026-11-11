package com.oneline.api.web;

import java.io.ByteArrayOutputStream;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Express 5 기본 query parser('simple' = node:querystring.parse) 와 같은 결과를 만든다. */
public final class QueryString {
    private QueryString() {
    }

    private static final int MAX_KEYS = 1000;

    @SuppressWarnings("unchecked")
    public static Map<String, Object> parse(String raw) {
        LinkedHashMap<String, Object> result = new LinkedHashMap<>();
        if (raw == null || raw.isEmpty()) return result;
        String[] pairs = raw.split("&", -1);
        int count = 0;
        for (String pair : pairs) {
            if (count >= MAX_KEYS) break;
            count++;
            if (pair.isEmpty()) continue;
            int eq = pair.indexOf('=');
            String key = decode(eq >= 0 ? pair.substring(0, eq) : pair);
            String value = eq >= 0 ? decode(pair.substring(eq + 1)) : "";
            Object existing = result.get(key);
            if (existing == null) {
                result.put(key, value);
            } else if (existing instanceof List<?> list) {
                ((List<Object>) list).add(value);
            } else {
                List<Object> values = new ArrayList<>();
                values.add(existing);
                values.add(value);
                result.put(key, values);
            }
        }
        return result;
    }

    /** '+' 는 공백, %XX 는 UTF-8 로 해석. 잘못된 시퀀스는 그대로 둔다. */
    private static String decode(String value) {
        String text = value.replace('+', ' ');
        if (text.indexOf('%') < 0) return text;
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] source = text.getBytes(StandardCharsets.UTF_8);
        boolean strict = true;
        for (int i = 0; i < source.length; i++) {
            byte b = source[i];
            if (b == '%') {
                int high = i + 1 < source.length ? Character.digit((char) source[i + 1], 16) : -1;
                int low = i + 2 < source.length ? Character.digit((char) source[i + 2], 16) : -1;
                if (high >= 0 && low >= 0) {
                    bytes.write(high * 16 + low);
                    i += 2;
                    continue;
                }
                strict = false;
            }
            bytes.write(b);
        }
        byte[] decoded = bytes.toByteArray();
        if (strict) {
            try {
                return StandardCharsets.UTF_8.newDecoder()
                        .onMalformedInput(CodingErrorAction.REPORT)
                        .onUnmappableCharacter(CodingErrorAction.REPORT)
                        .decode(ByteBuffer.wrap(decoded)).toString();
            } catch (CharacterCodingException ignored) {
                // decodeURIComponent 실패 시 querystring.unescapeBuffer 결과(UTF-8 대체 문자)를 사용한다.
            }
        }
        return new String(decoded, StandardCharsets.UTF_8);
    }
}
