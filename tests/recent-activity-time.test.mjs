import assert from 'node:assert/strict'
import test from 'node:test'
import { formatRecentActivityTime } from '../src/utils/recentActivityTime.ts'

test('오늘은 오전/오후 시각, 어제는 접두어, 이전 날짜는 연월일만 표시한다', () => {
    const now = new Date(2026, 10, 4, 18).getTime()
    assert.equal(formatRecentActivityTime(new Date(2026, 10, 4, 11, 34).toISOString(), now), '오전 11:34')
    assert.equal(formatRecentActivityTime(new Date(2026, 10, 3, 15, 34).toISOString(), now), '어제 오후 3:34')
    assert.equal(formatRecentActivityTime(new Date(2026, 10, 2, 15, 34).toISOString(), now), '2026.11.02')
})

test('24시간 차이가 아니라 현지 달력 날짜로 어제를 판별하고 연도 경계도 처리한다', () => {
    const now = new Date(2027, 0, 1, 0, 5).getTime()
    assert.equal(formatRecentActivityTime(new Date(2026, 11, 31, 23, 59).toISOString(), now), '어제 오후 11:59')
    assert.equal(formatRecentActivityTime(new Date(2026, 11, 30, 23, 59).toISOString(), now), '2026.12.30')
    assert.equal(formatRecentActivityTime(new Date(2027, 0, 1, 0, 0).toISOString(), now), '오전 12:00')
})

test('현재 날짜가 바뀌면 같은 원본 시각의 표시가 오늘에서 어제로 바뀐다', () => {
    const original = new Date(2026, 10, 4, 11, 34).toISOString()
    assert.equal(formatRecentActivityTime(original, new Date(2026, 10, 4, 12).getTime()), '오전 11:34')
    assert.equal(formatRecentActivityTime(original, new Date(2026, 10, 5, 0).getTime()), '어제 오전 11:34')
    assert.equal(formatRecentActivityTime('', Date.now()), '날짜 확인 불가')
})
