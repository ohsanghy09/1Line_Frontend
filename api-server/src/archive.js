import { readActivityAnalysis } from './activity-metadata.js'

// 확정 기록만 읽는다. 미저장 분석 초안과 원본 파일은 아카이브에 노출하지 않는다.
export function readArchive(db, activityId) {
  const activity = db.prepare('SELECT * FROM activities WHERE id = ?').get(activityId)
  if (!activity) return null
  const records = db.prepare('SELECT * FROM records WHERE activity_id = ? ORDER BY created_at, rowid').all(activityId)
  const materials = []
  const materialsByRecord = new Map()
  for (const record of records) {
    const reply = JSON.parse(record.reply)
    const analysis = reply.analysis
    const uploadedAt = record.analysis_id ? db.prepare('SELECT created_at FROM analyses WHERE id = ?').get(record.analysis_id)?.created_at : null
    const originals = record.analysis_id ? db.prepare('SELECT id, name FROM files WHERE analysis_id = ? ORDER BY rowid').all(record.analysis_id) : []
    // 자료 목록은 실제 첨부 원본과 명시적으로 저장한 링크만 사용한다. 입력한 채팅을 자료로 만들지 않는다.
    const entries = originals.length ? originals.map((file, index) => ({
      id: file.id, name: file.name,
      type: analysis.files[index]?.materialType ?? analysis.materialType,
      kind: 'file', originalFileId: file.id,
    })) : reply.sourceUrl ? [{
      id: `record:${record.id}`, name: reply.sourceUrl,
      type: analysis.materialType, kind: 'link', originalFileId: null,
    }] : []
    const files = entries.map((entry, position) => ({ ...entry, recordId: record.id, recordPosition: position, savedAt: record.created_at,
      uploadedAt: uploadedAt ?? record.created_at, updatedAt: record.updated_at,
      summary: analysis.summary, content: record.message, sourceUrl: reply.sourceUrl ?? null,
      // 현재 계약은 기록 단위 요약이다. 다중 파일의 개별 내용 분석으로 간주하지 않는다.
      summaryScope: 'record',
    }))
    materials.push(...files)
    materialsByRecord.set(record.id, files)
  }

  const rows = db.prepare(`SELECT e.* FROM timeline_events e JOIN records r ON e.record_id = r.id
    WHERE r.activity_id = ? ORDER BY e.created_at, e.rowid`).all(activityId)
  const timeline = rows.map(row => {
    const change = JSON.parse(row.change_json)
    const files = materialsByRecord.get(row.record_id) ?? []
    const evidenceFileIds = [], evidenceLabels = []
    // 이전 계약의 근거는 이름 문자열이다. 동일 기록 안에서 유일한 경우에만 ID로 연결한다.
    for (const label of change.evidence) {
      const matches = files.filter(file => file.name === label)
      const textEvidence = files.length === 1 && files[0].kind !== 'file'
        && ['사용자 직접 기록', files[0].content, files[0].sourceUrl].includes(label)
      const target = matches.length === 1 ? matches[0] : textEvidence ? files[0] : null
      if (target) evidenceFileIds.push(target.id)
      else evidenceLabels.push(label)
    }
    const base = { id: row.id, occurredAt: row.created_at, title: change.category,
      evidenceFileIds: [...new Set(evidenceFileIds)], evidenceLabels,
      change: { before: change.before, after: change.after },
    }
    return row.is_turning_point ? { ...base, isTurningPoint: true, before: change.before, after: change.after, reason: change.reason ?? '변화 이유가 저장되지 않았습니다.' }
      : { ...base, isTurningPoint: false, description: change.category }
  })

  // 분류명은 표시용이며 폴더 ID는 활동 ID와 분류명으로 안정적으로 구성한다.
  const groups = new Map()
  for (const file of materials) {
    if (!groups.has(file.type)) groups.set(file.type, [])
    groups.get(file.type).push(file)
  }
  const updatedAt = [activity.updated_at, ...records.map(record => record.updated_at)].filter(Boolean).sort().at(-1) ?? null
  return {
    id: activity.id, title: activity.name, category: activity.category ?? '미분류',
    status: ['진행 중', '완료'].includes(activity.status) ? activity.status : '미설정',
    role: activity.role ?? '미설정', period: activity.period ?? '미설정',
    summary: activity.summary ?? '활동 전체 요약이 아직 없습니다.',
    updatedAt, materialsCount: materials.length,
    recordsCount: records.length,
    metadataAnalysis: readActivityAnalysis(db, activityId),
    folders: [...groups].map(([name, files]) => ({ id: `${encodeURIComponent(activity.id)}:${encodeURIComponent(name)}`, name, materialsCount: files.length, files })),
    timeline,
  }
}

export function readArchiveFile(db, activityId, fileId) {
  const activity = readArchive(db, activityId)
  if (!activity) return null
  const file = activity.folders.flatMap(folder => folder.files).find(item => item.id === fileId)
  if (!file) return null
  // 기존 DB에는 ID 기반 버전 관계가 없으므로 파일명으로 추측하지 않는다.
  return { activityId, file, events: activity.timeline.filter(event => event.evidenceFileIds.includes(fileId)), versionHistory: [] }
}
