package com.oneline.api.config;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Collections;
import jakarta.servlet.http.HttpServletRequest;

/** 서버 전용 인증 설정. 토큰을 toString이나 오류 메시지에 포함하지 않는다. */
public final class InternalServiceAuth {
    private final String authorization;

    public InternalServiceAuth(String token) {
        if (token == null || token.isEmpty() || !token.matches("[A-Za-z0-9._~+/-]+=*")) {
            throw new IllegalStateException("INTERNAL_SERVICE_TOKEN에 유효한 Bearer 토큰을 설정해 주세요.");
        }
        authorization = "Bearer " + token;
    }

    public String authorizationHeader() {
        return authorization;
    }

    public boolean matches(String received) {
        if (received == null || received.length() < 7 || !received.regionMatches(true, 0, "Bearer ", 0, 7)) return false;
        return MessageDigest.isEqual(authorization.substring(7).getBytes(StandardCharsets.UTF_8),
                received.substring(7).getBytes(StandardCharsets.UTF_8));
    }

    public boolean matches(HttpServletRequest request) {
        var headers = Collections.list(request.getHeaders("Authorization"));
        return headers.size() == 1 && matches(headers.get(0));
    }
}
