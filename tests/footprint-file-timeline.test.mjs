import assert from 'node:assert/strict'
import test from 'node:test'
import { loadFrontend, expectRequests } from './support/frontend.mjs'
import { activity, file, event, timestamp } from './fixtures/archive.mjs'

const service = await loadFrontend('src/services/footprints.ts')
const records = await loadFrontend('src/services/records.ts')
const home = await loadFrontend('src/services/home.ts')
const { mockTextAnalysisReply } = await loadFrontend('tests/fixtures/chat.ts')
const activityPath = '/api/archive/activities/activity%2F1'
const filePath = `${activityPath}/materials/file%2F1`

test('활동·폴더·자료·Timeline과 근거 ID를 보존하며 날짜를 표시용으로 변환한다', async t => {
    const turning = event({ id: 'turning', isTurningPoint: true, before: '이전', after: '이후', reason: '이유' })
    const detail = activity({ materialsCount: 1, updatedAt: timestamp, folders: [{ id: 'folder-1', name: '회의록', materialsCount: 1, files: [file()] }], timeline: [event(), turning] })
    expectRequests(t, [
        { path: activityPath, data: detail },
        { path: filePath, data: { activityId: 'activity/1', file: file(), events: [event(), turning], versionHistory: [{ fileId: 'previous', version: 'v1' }] } },
    ])
    const result = await service.getFootprintActivity('activity/1')
    assert.equal(result.updatedAt, timestamp)
    assert.ok(result.updatedAtLabel)
    assert.equal(result.folders[0].files[0].name, '내 자료.txt')
    assert.ok(result.folders[0].files[0].uploadedAtLabel)
    assert.deepEqual(result.timeline[1].evidenceFileIds, ['file/1'])
    assert.equal(result.timeline[1].reason, '이유')
    const material = await service.getFootprintFile('activity/1', 'file/1')
    assert.equal(material.file.summaryScope, 'record')
    assert.equal(material.events[0].id, result.timeline[0].id)
    assert.ok(material.events[0].dateLabel)
    assert.deepEqual(material.versionHistory, [{ fileId: 'previous', version: 'v1' }])
})

test('404만 없음으로 변환하며 빈 ID는 요청하지 않는다', async t => {
    expectRequests(t, [activityPath, filePath].map(path => ({ path, data: { error: '없음' }, status: 404 })))
    assert.equal(await service.getFootprintActivity('activity/1'), null)
    assert.equal(await service.getFootprintFile('activity/1', 'file/1'), null)
    assert.equal(await service.getFootprintActivity(''), null)
    assert.equal(await service.getFootprintFile('', 'file/1'), null)
})

test('잘못된 활동·자료·Timeline 응답과 서버 오류를 거절한다', async t => {
    expectRequests(t, [
        { path: activityPath, data: activity({ id: 'different', folders: [], timeline: [] }) },
        { path: activityPath, data: activity({ folders: [], timeline: [event({ evidenceFileIds: null })] }) },
        { path: filePath, data: { activityId: 'other', file: file(), events: [], versionHistory: [] } },
        { path: filePath, data: { activityId: 'activity/1', file: file({ id: 'other' }), events: [], versionHistory: [] } },
        { path: activityPath, status: 500, data: { error: '서버 오류' } },
        { path: activityPath, error: new TypeError('offline') },
    ])
    for (let i = 0; i < 2; i++) await assert.rejects(service.getFootprintActivity('activity/1'), /응답 형식/)
    for (let i = 0; i < 2; i++) await assert.rejects(service.getFootprintFile('activity/1', 'file/1'), /응답 형식/)
    await assert.rejects(service.getFootprintActivity('activity/1'), /서버 오류/)
    await assert.rejects(service.getFootprintActivity('activity/1'), /연결하지 못했어요/)
})

test('최근 활동·자료의 ID와 저장 시각을 유지하며 빈 목록과 오류를 처리한다', async t => {
    const recentRecord = { id: 'file/1', recordId: 'record-1', activityId: 'activity/1', activityName: '테스트 활동', title: '내 자료.txt', materialType: '회의록', kind: 'file', savedAt: timestamp }
    expectRequests(t, [
        { path: '/api/home/recent', data: { activities: [activity({ updatedAt: timestamp })], records: [recentRecord] } },
        { path: '/api/home/recent', data: { activities: [], records: [] } },
        { path: '/api/home/recent', data: { activities: [], records: [{ ...recentRecord, savedAt: 'invalid' }] } },
        { path: '/api/home/recent', error: new TypeError('offline') },
    ])
    const recent = await home.getHomeRecent()
    assert.equal(recent.records[0].activityId, recent.activities[0].id)
    assert.equal(recent.records[0].savedAt, timestamp)
    assert.ok(recent.records[0].savedAtLabel)
    assert.deepEqual(await home.getHomeRecent(), { activities: [], records: [] })
    await assert.rejects(home.getHomeRecent(), /응답 형식/)
    await assert.rejects(home.getHomeRecent(), /연결하지 못했어요/)
})

test('저장·수정·삭제 성공 때만 갱신 이벤트를 알리고 재조회 결과를 읽는다', async t => {
    const originalWindow = globalThis.window
    globalThis.window = new EventTarget()
    t.after(() => { if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow })
    const notifications = []
    for (const name of ['1line:activities-changed', '1line:records-changed']) window.addEventListener(name, event => notifications.push(event.type))
    const saved = { id: 'record/1', activityId: 'activity/1', reply: mockTextAnalysisReply }
    expectRequests(t, [
        { path: '/api/records', method: 'POST', data: saved, check: init => assert.deepEqual(JSON.parse(init.body), { activityId: 'activity/1', analysisId: 'analysis-1', classification: { materialType: '사용자 경험 기록' } }) },
        { path: '/api/records/record%2F1', method: 'PATCH', data: saved, check: init => assert.deepEqual(JSON.parse(init.body), { activityId: 'activity/1', materialType: '회의록', activityUpdates: { role: '연구' } }) },
        { path: filePath, method: 'DELETE', data: { deleted: true }, check: init => assert.deepEqual(JSON.parse(init.body), {}) },
        { path: filePath, status: 404, data: { error: '없음' } },
        { path: activityPath, method: 'DELETE', status: 400, data: { error: '활동명 불일치' } },
        { path: activityPath, method: 'DELETE', data: { deleted: true }, check: init => assert.deepEqual(JSON.parse(init.body), { confirmation: '테스트 활동' }) },
        { path: activityPath, method: 'DELETE', data: { deleted: false } },
    ])
    await records.saveRecord({ ...mockTextAnalysisReply, analysisId: 'analysis-1' }, 'activity/1')
    await records.updateRecord('record/1', 'activity/1', '회의록', { role: '연구' })
    await service.deleteFootprintMaterial('activity/1', 'file/1')
    assert.equal(await service.getFootprintFile('activity/1', 'file/1'), null)
    assert.equal(notifications.length, 6)
    await assert.rejects(service.deleteFootprintActivity('activity/1', '틀린 이름'), /활동명/)
    assert.equal(notifications.length, 6)
    await service.deleteFootprintActivity('activity/1', '테스트 활동')
    assert.equal(notifications.length, 8)
    await assert.rejects(service.deleteFootprintActivity('activity/1', '테스트 활동'), /삭제 결과/)
    assert.equal(notifications.length, 8)
})
