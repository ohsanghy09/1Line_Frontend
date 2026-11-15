import { request } from './chat'

// 성공 응답을 확인한 뒤에만 브라우저의 이전 대화를 정리한다.
export async function deleteAllData(confirmation: string): Promise<void> {
    const data = await request('/settings/reset-data', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation }),
    })
    if (!data || typeof data !== 'object' || !('deleted' in data) || data.deleted !== true) {
        throw new Error('삭제 결과를 확인하지 못했어요. 다시 확인해 주세요.')
    }
}
