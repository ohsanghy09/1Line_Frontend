package com.oneline.api;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/** 1Line 개발용 REST API 서버 (기존 api-server/src/server.js 의 Spring Boot 버전) */
@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
