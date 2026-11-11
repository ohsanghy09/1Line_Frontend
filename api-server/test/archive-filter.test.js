import assert from 'node:assert/strict'
import test from 'node:test'
import { selectArchiveActivities } from '../src/archive-search.js'

// 순서를 일부러 섞고 동률을 포함해, 표시 예시에 의존하지 않고 조회 규칙을 확인한다.
const activities = Object.freeze([
    Object.freeze({ id: 'old', title: 'Scent Orbit', summary: '향수 추천', category: '프로젝트', status: '완료', materialsCount: 18, updatedAt: '2025-06-30T00:00:00+09:00' }),
    Object.freeze({ id: 'new', title: 'AI 기획', summary: '개인 성장 아카이브', category: '해커톤', status: '진행 중', materialsCount: 14, updatedAt: '2026-11-04T14:32:00+09:00' }),
    Object.freeze({ id: 'tie', title: '학습', summary: 'AI  기획 실습', category: '전공수업', status: '진행 중', materialsCount: 14, updatedAt: '2026-11-04T14:32:00+09:00' }),
    Object.freeze({ id: 'other', title: '개인 공부', summary: '논문 스터디', category: '자격증 / 개인학습', status: '진행 중', materialsCount: 3, updatedAt: '2026-10-28T00:00:00+09:00' }),
])
const defaults = { search: '', category: 'all', status: 'all', sort: 'recent' }
const ids = filters => selectArchiveActivities(activities, { ...defaults, ...filters }).map(activity => activity.id)

test('활동명·요약 검색의 공백·대소문자·한글 정규화를 적용한다', () => {
    assert.deepEqual(ids({ search: '  sCeNt   ORBIT  ' }), ['old'])
    assert.deepEqual(ids({ search: ' AI   기획 ' }), ['new', 'tie'])
    assert.deepEqual(ids({ search: '개인 성장'.normalize('NFD') }), ['new'])
})

test('검색·유형·상태는 AND 조건으로 적용한다', () => {
    assert.deepEqual(ids({ search: 'AI', category: '해커톤', status: '진행 중' }), ['new'])
    assert.deepEqual(ids({ search: 'AI', category: '해커톤', status: '완료' }), [])
    assert.deepEqual(ids({ category: '전공수업' }), ['tie'])
})

test('세 정렬은 업데이트 날짜 또는 자료 수를 사용하고 동률은 기존 순서다', () => {
    assert.deepEqual(ids({}), ['new', 'tie', 'other', 'old'])
    assert.deepEqual(ids({ sort: 'oldest' }), ['old', 'other', 'new', 'tie'])
    assert.deepEqual(ids({ sort: 'materials' }), ['old', 'new', 'tie', 'other'])
})

test('전체에서 별도 필터가 없는 유형도 조회하고 공백 검색어는 무시한다', () => {
    assert.deepEqual(ids({ search: '   ' }), ['new', 'tie', 'other', 'old'])
})

test('필터 결과 없음과 빈 원본을 처리한다', () => {
    assert.deepEqual(ids({ search: '존재하지 않는 활동' }), [])
    assert.deepEqual(selectArchiveActivities([], defaults), [])
})

test('조건 변경과 정렬 이후에도 원본 순서와 값은 그대로다', () => {
    const before = JSON.stringify(activities)
    ids({ sort: 'materials' })
    ids({ status: '완료', sort: 'oldest' })
    assert.equal(JSON.stringify(activities), before)
    assert.deepEqual(activities.map(activity => activity.id), ['old', 'new', 'tie', 'other'])
})
