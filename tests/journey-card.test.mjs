import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createMockJourney } from './fixtures/journey.mjs'
import { loadComponent } from './support/render-component.mjs'

const { default: Card } = await loadComponent('src/components/journey/JourneyEventCard.tsx')
function render(data, expanded = true) {
    return renderToStaticMarkup(createElement(Card, {
        event: data.events[0], axisOptions: data.axisOptions, evidenceSources: data.evidenceSources,
        expanded, onToggle() {},
    }))
}

test('실제 카드 렌더는 판단·비교·전이를 표시하고 근거는 닫힌 추가 펼침에 둔다', () => {
    const data = createMockJourney()
    const html = render(data)
    assert.match(html, /aria-expanded="true"/)
    assert.match(html, /효율성/)
    assert.match(html, /경험 전이/)
    assert.match(html, /Before · 이전/)
    assert.match(html, /After · 이후/)
    assert.match(html, /비교 조건:/)
    assert.match(html, /개인 프로젝트/)
    assert.match(html, /근거 기록 보기 \(1\)/)
    assert.match(html, /<details[^>]*><summary/)
    assert.doesNotMatch(html, /<details[^>]*\bopen(?:=|>)/)
    assert.equal(html.split(data.events[0].growthAssessments[0].evidence[0].quote).length - 1, 1)
    assert.match(html, /기록 ID: record-01/)
    assert.match(html, /출처: Growth AI/)
    assert.equal((html.match(/<button\b/g) ?? []).length, 1)
    assert.ok(html.indexOf('</button>') < html.indexOf('<details'))
    assert.doesNotMatch(html, /<a\b/)
})
test('접힌 카드의 상세 영역은 hidden이며 비교가 없는 판단도 표시한다', () => {
    const data = createMockJourney()
    data.events = [data.events.find(event => event.id === 'interview')]
    const collapsed = render(data, false)
    assert.match(collapsed, /aria-expanded="false"/)
    assert.match(collapsed, /hidden=""/)
    const expanded = render(data)
    assert.match(expanded, /능력 확장/)
    assert.match(expanded, /경험 축적/)
    assert.doesNotMatch(expanded, /Before · 이전/)
    assert.match(expanded, /근거 기록 보기 \(1\)/)
})
test('원문은 HTML로 실행하지 않고 공백과 줄바꿈을 보존해 출력한다', () => {
    const data = createMockJourney()
    const event = data.events[0]
    const quote = '  <script>alert(1)</script>\n원문  '
    for (const a of event.growthAssessments) {
        a.evidence.forEach(e => { e.quote = quote })
        if (a.comparison) for (const refs of [a.comparison.beforeEvidence, a.comparison.afterEvidence]) refs.forEach(e => { e.quote = quote })
        if (a.transfer) for (const refs of [a.transfer.sourceEvidence, a.transfer.applicationEvidence]) refs.forEach(e => { e.quote = quote })
    }
    const html = render(data)
    assert.doesNotMatch(html, /<script>/)
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
    assert.match(html, /whitespace-pre-wrap/)
    assert.match(html, /\n원문  <\/blockquote>/)
})
