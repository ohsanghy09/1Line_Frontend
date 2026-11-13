package com.oneline.api.config;

/** createApp(db, { origin, aiBaseUrl, autoActivityAnalysis, activityAnalysisOptions }) */
public record ServerOptions(String origin, String aiBaseUrl, boolean autoActivityAnalysis, long activityAnalysisDelayMs, InternalServiceAuth internalServiceAuth) {
}
