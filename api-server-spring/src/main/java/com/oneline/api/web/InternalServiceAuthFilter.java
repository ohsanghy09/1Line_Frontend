package com.oneline.api.web;

import com.oneline.api.config.InternalServiceAuth;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Locale;
import static com.oneline.api.js.Js.obj;

/** JSON 파싱 전에 내부 경로만 인증한다. 공개 API에는 적용하지 않는다. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public final class InternalServiceAuthFilter extends OncePerRequestFilter {
    private final InternalServiceAuth auth;

    public InternalServiceAuthFilter(InternalServiceAuth auth) {
        this.auth = auth;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !isInternal(request);
    }

    public static boolean isInternal(HttpServletRequest request) {
        // 컨테이너가 디코딩·정규화한 경로 사용. context-path는 포함하지 않는다.
        String path = request.getServletPath().toLowerCase(Locale.ROOT);
        return path.equals("/api/internal") || path.startsWith("/api/internal/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (!auth.matches(request)) {
            response.setHeader("Cache-Control", "no-store");
            ExpressCompatFilter.writeJson(response, 401,
                    obj("error", "서버 간 인증에 실패했습니다.", "code", "internal_unauthorized"));
            return;
        }
        chain.doFilter(request, response);
    }
}
