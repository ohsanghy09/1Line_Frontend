import { readFile } from 'node:fs/promises'
import { transformWithOxc } from 'vite'

// 실제 TSX의 이벤트·Effect를 실행한다. DOM/브라우저 렌더링 검사는 아니다.
export async function componentHarness(file, dependencies, initialProps) {
    const { code } = await transformWithOxc(await readFile(new URL('../../' + file, import.meta.url), 'utf8'), file)
    const name = code.match(/export default function (\w+)/)?.[1] ?? code.match(/export default (\w+);/)?.[1]
    if (!name) throw new Error('Named default component required')
    const source = code.replace(/^import .*;\r?\n/gm, '').replace('export default function', 'function').replace(/^export default \w+;\r?\n/gm, '')
    const slots = [], pending = [], cleanups = new Map()
    let cursor = 0, tree, props = initialProps
    const jsx = (type, props) => ({ type, props })
    const env = {
        ...dependencies, _jsx: jsx, _jsxs: jsx, _Fragment: 'fragment',
        useId: () => `test-${cursor++}`,
        useState: initial => {
            const slot = cursor++
            if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial
            return [slots[slot], next => { slots[slot] = typeof next === 'function' ? next(slots[slot]) : next }]
        },
        useRef: initial => {
            const slot = cursor++
            return slots[slot] ??= { current: initial }
        },
        useEffect: (setup, deps) => {
            const slot = cursor++
            if (!slots[slot] || !deps || deps.some((dep, i) => !Object.is(dep, slots[slot][i]))) {
                slots[slot] = deps
                pending.push(() => { cleanups.get(slot)?.(); cleanups.set(slot, setup()) })
            }
        },
    }
    const Component = new Function(...Object.keys(env), `${source}; return ${name}`)(...Object.values(env))
    function render(nextProps = props) {
        props = nextProps; cursor = 0
        tree = Component(props)
        for (const effect of pending.splice(0)) effect()
        return tree
    }
    return {
        render,
        nodes: () => descendants(tree),
        unmount: () => { for (const cleanup of cleanups.values()) cleanup?.() },
    }
}

function descendants(node) {
    if (Array.isArray(node)) return node.flatMap(descendants)
    if (!node || typeof node !== 'object') return []
    return [node, ...descendants(node.props?.children), ...descendants(node.props?.activityActions)]
}

export function textOf(node) {
    if (Array.isArray(node)) return node.map(textOf).join('')
    if (node == null || typeof node === 'boolean') return ''
    return typeof node === 'object' ? textOf(node.props?.children) : String(node)
}

export const settle = () => new Promise(resolve => setImmediate(resolve))
