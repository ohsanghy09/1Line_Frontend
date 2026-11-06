// 서버 시간으로 재현하는 목 진행이다. 파일 내용 분석이나 실제 AI 처리 단계는 아니다.
export const MOCK_STAGE_MS = 700
const stages = [
  ['파일을 확인하고 있어요...', '파일 확인 중...', '파일 확인 완료'],
  ['기존 활동과 비교하고 있어요...', '기존 활동 비교 중...', '기존 활동 비교 완료'],
  ['자료 유형을 정리하고 있어요...', '자료 유형 분석 중...', '자료 유형 분석 완료'],
  ['이전 기록과 비교하고 있어요...', '이전 기록과 비교 중...', '이전 기록 비교 완료'],
]

const linkStages = [
  ['링크를 확인하고 있어요...', '링크 확인 중...', '링크 확인 완료'],
  ['연결할 활동을 정리하고 있어요...', '활동 분류 중...', '활동 분류 완료'],
  ['자료 유형을 정리하고 있어요...', '자료 유형 정리 중...', '자료 유형 정리 완료'],
  ['분석 결과를 준비하고 있어요...', '결과 준비 중...', '결과 준비 완료'],
]

export function jobProgress(startedAt, now = Date.now(), kind = 'file-analysis') {
  const currentStages = kind === 'link-analysis' ? linkStages : stages
  const index = Math.min(currentStages.length, Math.floor(Math.max(0, now - startedAt) / MOCK_STAGE_MS))
  return {
    status: index === currentStages.length ? 'completed' : 'running',
    progress: {
      title: currentStages[index]?.[0] ?? '자료 정리가 끝났어요.',
      steps: currentStages.slice(0, Math.min(index + 1, currentStages.length)).map((stage, i) => ({
        label: i < index ? stage[2] : stage[1], status: i < index ? 'completed' : 'working',
      })),
    },
  }
}
