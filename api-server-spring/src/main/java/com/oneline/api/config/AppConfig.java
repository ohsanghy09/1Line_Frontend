package com.oneline.api.config;

import com.oneline.api.db.Database;
import com.oneline.api.service.ActivityMetadataQueue;
import com.oneline.api.support.EventLoop;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.event.EventListener;
import org.springframework.web.filter.UrlHandlerFilter;
import org.springframework.web.servlet.config.annotation.PathMatchConfigurer;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.util.pattern.PathPatternParser;

import java.nio.file.Path;

/**
 * 기존 server.js / createApp 옵션과 같은 설정.
 * - DB_PATH (기본: ../api-server/data/1line.db — 기존 Node 서버·AI 서버가 쓰는 같은 파일)
 * - FRONTEND_ORIGIN (기본: http://localhost:5173)
 * - AI_API_BASE_URL (기본: http://127.0.0.1:8000)
 */
@Configuration
public class AppConfig implements WebMvcConfigurer {
    private static final Logger log = LoggerFactory.getLogger(AppConfig.class);

    @Bean(destroyMethod = "")
    public Database database(@Value("${oneline.db-path:#{null}}") String configuredPath) {
        String path = configuredPath;
        if (path == null) path = System.getenv("DB_PATH");
        if (path == null) path = defaultDatabasePath();
        return Database.open(path);
    }

    /** 기존 서버와 같은 DB 파일(api-server/data/1line.db)을 기본으로 사용한다. */
    static String defaultDatabasePath() {
        Path workingDir = Path.of(System.getProperty("user.dir")).toAbsolutePath();
        Path apiServer = workingDir.getFileName() != null && workingDir.getFileName().toString().equals("api-server")
                ? workingDir
                : workingDir.resolveSibling("api-server");
        if (workingDir.resolve("api-server").toFile().isDirectory()) apiServer = workingDir.resolve("api-server");
        return apiServer.resolve("data").resolve("1line.db").normalize().toString();
    }

    @Bean
    public EventLoop eventLoop() {
        return new EventLoop();
    }

    @Bean
    public ServerOptions serverOptions(
            @Value("${oneline.frontend-origin:#{null}}") String origin,
            @Value("${oneline.ai-base-url:#{null}}") String aiBaseUrl,
            @Value("${oneline.auto-activity-analysis:true}") boolean autoActivityAnalysis,
            @Value("${oneline.activity-analysis-delay-ms:500}") long activityAnalysisDelayMs) {
        String frontendOrigin = origin != null ? origin : System.getenv("FRONTEND_ORIGIN");
        if (frontendOrigin == null) frontendOrigin = "http://localhost:5173";
        return new ServerOptions(frontendOrigin, aiBaseUrl, autoActivityAnalysis, activityAnalysisDelayMs);
    }

    @Bean(destroyMethod = "")
    public ActivityMetadataQueue activityMetadataQueue(Database database, EventLoop eventLoop, ServerOptions options) {
        return new ActivityMetadataQueue(database, eventLoop, options.aiBaseUrl(), options.activityAnalysisDelayMs());
    }

    @Bean
    public ShutdownHook shutdownHook(ActivityMetadataQueue queue, Database database) {
        return new ShutdownHook(queue, database);
    }

    /** SIGINT/SIGTERM: 대기 중 분석을 정리한 뒤 DB를 닫는다. */
    public record ShutdownHook(ActivityMetadataQueue queue, Database database) implements org.springframework.beans.factory.DisposableBean {
        @Override
        public void destroy() {
            queue.close();
            database.close();
        }
    }

    /** Express 라우터와 같이 경로 대소문자를 구분하지 않는다. */
    @Override
    public void configurePathMatch(PathMatchConfigurer configurer) {
        PathPatternParser parser = new PathPatternParser();
        parser.setCaseSensitive(false);
        configurer.setPatternParser(parser);
    }

    /** Express(strict: false)와 같이 끝의 '/' 를 허용한다. */
    @Bean
    public UrlHandlerFilter trailingSlashFilter() {
        return UrlHandlerFilter.trailingSlashHandler("/**").wrapRequest().build();
    }

    @EventListener
    public void onReady(ApplicationReadyEvent event) {
        if (event.getApplicationContext() instanceof WebServerApplicationContext context) {
            log.info("1Line API: http://127.0.0.1:{}", context.getWebServer().getPort());
        }
    }
}
