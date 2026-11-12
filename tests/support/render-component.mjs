import { readFile } from 'node:fs/promises'
import { transformWithOxc } from 'vite'

const root = new URL('../../', import.meta.url)
const modules = new Map()

// 실제 TSX와 상대 모듈을 변환해 React 서버 렌더러로 검사한다. 브라우저/DOM 검사는 아니다.
async function moduleUrl(file) {
    if (modules.has(file.href)) return modules.get(file.href)
    const task = (async () => {
        const { code } = await transformWithOxc(await readFile(file, 'utf8'), file.pathname)
        const imports = [...code.matchAll(/from ["']([^"']+)["']/g)]
        const replacements = await Promise.all(imports.map(async ([, specifier]) => {
            const target = specifier.startsWith('.')
                ? await moduleUrl(new URL(`${specifier}.ts`, file))
                : import.meta.resolve(specifier)
            return [specifier, target]
        }))
        const targets = new Map(replacements)
        const output = code.replace(/from ["']([^"']+)["']/g, (_match, specifier) => `from '${targets.get(specifier)}'`)
        return `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`
    })()
    modules.set(file.href, task)
    return task
}

export const loadComponent = async path => import(await moduleUrl(new URL(path, root)))
