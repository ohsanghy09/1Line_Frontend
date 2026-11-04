import type { AnalyzedFile, ChatReply } from '../../types/chat'

// 파일명으로만 자료 분류와 버전 연결을 흉내 내는 목 분석기.
// 실제 내용 분석은 하지 않으며 API 연결 시 이 규칙은 사용하지 않는다.
function getMaterialType(name: string): string {
    if (/wireframe|와이어프레임/i.test(name)) return '와이어프레임'
    if (/meeting|회의록|회의/i.test(name)) return '회의록'
    if (/idea|proposal|기획|제안/i.test(name)) return '기획안'
    if (/presentation|발표/i.test(name)) return '발표자료'
    return '기타 자료'
}


// 기본 이름과 확장자가 같은 v1, v2, final 파일만 버전 후보로 묶는다.
function getVersionInfo(name: string) {
    const match = name.match(/^(.*?)[_\-\s](?:v(\d+)|final)(\.[^.]+)$/i)
    if (!match) return null

    return {
        family: `${match[1]}${match[3]}`.toLowerCase(),
        order: match[2] ? Number(match[2]) : Number.POSITIVE_INFINITY,
    }
}


// 첨부 개수나 선택 순서가 바뀌어도 실제 파일 목록에 맞는 API 형태의 응답을 만든다.
export function createMockBatchAnalysis(files: Pick<File, 'name'>[]): ChatReply {
    const versionedFiles = files.map((file) => ({ name: file.name, version: getVersionInfo(file.name) }))

    const analyzedFiles: AnalyzedFile[] = versionedFiles.map((file) => {
        const version = file.version
        const previous = version ? versionedFiles
            .filter((candidate) => candidate.version?.family === version.family && candidate.version.order < version.order)
            .sort((a, b) => b.version!.order - a.version!.order)[0] : undefined

        return {
            name: file.name,
            materialType: getMaterialType(file.name),
            previousVersion: previous?.name ?? null,
        }
    })

    // 유형별 합계는 첨부 총 개수와 일치한다. 알 수 없는 유형은 기타 자료로 분류한다.
    const counts = new Map<string, number>()
    for (const file of analyzedFiles) {
        counts.set(file.materialType, (counts.get(file.materialType) ?? 0) + 1)
    }

    const versionCount = analyzedFiles.filter((file) => file.previousVersion !== null).length
    const matchesReferenceVersions = analyzedFiles.some((file) => file.name === 'idea_final.pdf' && file.previousVersion === 'idea_v1.pdf')
        && analyzedFiles.some((file) => file.name === 'wireframe_v2.pdf' && file.previousVersion === 'wireframe_v1.pdf')

    // 원본의 파일 조합이면 안내 문구까지 일치시킨다. 다른 조합은 발견한 관계 개수로 안내한다.
    const summary = matchesReferenceVersions
        ? '기획안과 와이어프레임에서 각각 버전(v1 → v2/final) 연관 관계를 자동으로 연동했습니다.'
        : versionCount > 0
            ? `자료에서 ${versionCount}개의 버전 연관 관계를 자동으로 연동했습니다.`
            : '자료 유형별로 자동 분류했습니다. 연결할 수 있는 버전 연관 관계는 발견되지 않았습니다.'

    return {
        id: crypto.randomUUID(),
        role: 'assistant',
        kind: 'batch-analysis',
        content: `총 ${files.length}개의 자료를 확인 후 일괄 그룹화했어요.`,
        analysis: {
            // 원본 시나리오의 예시 활동. 실제 API는 사용자의 활동 목록으로 판단한다.
            activity: { name: '1호선톤', confidence: null },
            materialType: '여러 자료',
            stage: null,
            summary,
            // 버전 관계만으로 중요한 경험 변화가 있었다고 판단하지 않는다.
            changes: [],
            files: analyzedFiles,
            groups: Array.from(counts, ([materialType, count]) => ({ materialType, count })),
            suggestedSaveMode: 'archive',
        },
    }
}
