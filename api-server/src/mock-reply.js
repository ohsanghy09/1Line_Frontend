import { randomUUID } from 'node:crypto'

// 링크는 외부에 접속하지 않는다. 입력한 URL만 보존하고 분석 문구는 목 값으로 제공한다.
export function createMockLinkReply(url) {
  return {
    id: randomUUID(), role: 'assistant', kind: 'link-analysis', sourceUrl: url,
    content: '링크를 정리했어요. 분류를 확인한 뒤 기록해 주세요.',
    analysis: {
      activity: { name: '1호선톤', confidence: null }, materialType: '웹 링크 · 기획 자료', stage: null,
      summary: '활동의 참고 링크로 분류한 목 응답입니다. 실제 페이지를 읽거나 요약한 결과는 아니에요.',
      changes: [], files: [], groups: [], suggestedSaveMode: 'archive',
    },
  }
}

// 실제 내용을 이해한 AI 분석이 아니다. 모드는 요청에서 명시적으로 선택한다.
export function createMockReply(message, files, mode) {
  const changes = mode === 'change' ? [{
    before: '여러 기능을 함께 구현하는 기존 계획 (목 예시)',
    after: '핵심 기능부터 구현하는 계획 (목 예시)',
    category: '기능 범위 변경',
    evidence: files.length ? files.map(file => file.originalname) : ['사용자 직접 기록'],
  }] : []
  const batch = files.length > 1
  return {
    id: randomUUID(), role: 'assistant',
    kind: batch ? 'batch-analysis' : files.length ? (changes.length ? 'file-analysis' : 'no-change') : 'text-analysis',
    content: batch ? `총 ${files.length}개의 자료를 확인 후 일괄 그룹화했어요.` : '입력한 내용을 정리했어요. 기록 전에 분류를 확인해 주세요.',
    analysis: {
      activity: { name: '1호선톤', confidence: null },
      materialType: files.length ? '기타 자료' : '사용자 경험 기록',
      stage: null,
      summary: files.length ? `${files.map(file => file.originalname).join(', ')}에 대한 목 분석입니다. 실제 파일 내용은 분석하지 않았어요.` : `입력한 경험에 대한 목 분석입니다: ${message}`,
      ...(changes.length ? {} : { noChangeMessage: '주요 변화가 없는 목 예시입니다. 자료를 아카이브에 저장할 수 있어요.' }),
      changes,
      files: files.map(file => ({ name: file.originalname, materialType: '기타 자료', previousVersion: null })),
      groups: batch ? [{ materialType: '기타 자료', count: files.length }] : [],
      suggestedSaveMode: changes.length ? 'record-change' : 'archive',
    },
  }
}
