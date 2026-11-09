package com.oneline.api.web;

/**
 * Object.assign(new Error(message), { status, publicMessage }) 에 대응한다.
 * 500 이상이면서 publicMessage 가 아니면 응답에는 일반 오류 문구를 사용한다.
 */
public class HttpError extends RuntimeException {
    private final int status;
    private final boolean publicMessage;

    public HttpError(int status, String message) {
        this(status, message, false);
    }

    public HttpError(int status, String message, boolean publicMessage) {
        super(message, null, false, false);
        this.status = status;
        this.publicMessage = publicMessage;
    }

    public int status() {
        return status;
    }

    public boolean publicMessage() {
        return publicMessage;
    }

    /** const fail = (status, message) => ... (app.js) */
    public static HttpError fail(int status, String message) {
        return new HttpError(status, message, false);
    }

    /** publicMessage: true 인 fail (archive-delete.js, journey.js) */
    public static HttpError publicFail(int status, String message) {
        return new HttpError(status, message, true);
    }
}
