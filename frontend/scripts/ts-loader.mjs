/**
 * 轻量 TS ESM loader：仅用于跑 scripts 下的验证脚本。
 * - 解析 '@/...' 别名到 src，以及相对路径无扩展名（TS 风格）导入；
 * - 用 typescript.transpileModule 即时转译，不产出文件。
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const here = dirname(fileURLToPath(import.meta.url))
const srcRoot = resolvePath(here, '..', 'src')

function tryFile(candidate) {
  if (existsSync(candidate)) return candidate
  for (const ext of ['.ts', '.js', '.mjs', '.json']) {
    if (existsSync(`${candidate}${ext}`)) return `${candidate}${ext}`
  }
  for (const file of ['index.ts', 'index.js']) {
    if (existsSync(resolvePath(candidate, file))) return resolvePath(candidate, file)
  }
  return null
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const candidate = tryFile(resolvePath(srcRoot, specifier.slice(2)))
    if (candidate) {
      return { url: pathToFileURL(candidate).href, shortCircuit: true }
    }
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
    const candidate = tryFile(resolvePath(dirname(fileURLToPath(context.parentURL)), specifier))
    if (candidate) {
      return { url: pathToFileURL(candidate).href, shortCircuit: true }
    }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts')) {
    const { source } = await nextLoad(url, { ...context, format: 'module' })
    const { outputText } = ts.transpileModule(String(source), {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2020,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      },
      fileName: fileURLToPath(url),
    })
    return { format: 'module', source: outputText, shortCircuit: true }
  }
  return nextLoad(url, context)
}
