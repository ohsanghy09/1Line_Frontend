package com.oneline.api.support;

import java.util.concurrent.Callable;
import java.util.concurrent.locks.ReentrantLock;

/**
 * Node 서버는 한 번에 하나의 핸들러만 실행하고, await(외부 AI 호출) 동안에만 다른 요청을 처리한다.
 * 이 동작(진행 중 플래그·DB 트랜잭션 순서)을 그대로 유지하기 위해 모든 요청·타이머 작업을 이 잠금 안에서 실행하고,
 * 외부 호출 중에만 잠금을 풀어 준다.
 */
public final class EventLoop {
    private final ReentrantLock lock = new ReentrantLock(true);

    public void enter() {
        lock.lock();
    }

    public void exit() {
        if (lock.isHeldByCurrentThread()) lock.unlock();
    }

    public void run(Runnable work) {
        lock.lock();
        try {
            work.run();
        } finally {
            lock.unlock();
        }
    }

    /** await: 작업 동안 잠금을 풀고 끝나면 다시 잡는다. */
    public <T> T await(Callable<T> io) throws Exception {
        int holds = lock.getHoldCount();
        for (int i = 0; i < holds; i++) lock.unlock();
        try {
            return io.call();
        } finally {
            for (int i = 0; i < holds; i++) lock.lock();
        }
    }
}
