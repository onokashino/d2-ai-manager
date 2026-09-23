import { mkdir, copyFile, access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'vendor', 'grammars')

// Имя языка -> путь к wasm внутри установленного пакета.
const SOURCES = {
  typescript: ['tree-sitter-typescript', 'tree-sitter-typescript.wasm'],
  tsx: ['tree-sitter-typescript', 'tree-sitter-tsx.wasm'],
  javascript: ['tree-sitter-javascript', 'tree-sitter-javascript.wasm'],
  python: ['tree-sitter-python', 'tree-sitter-python.wasm'],
  rust: ['tree-sitter-rust', 'tree-sitter-rust.wasm'],
}

await mkdir(outDir, { recursive: true })

for (const [lang, [pkg, file]] of Object.entries(SOURCES)) {
  try {
    const pkgDir = dirname(require.resolve(`${pkg}/package.json`))
    const src = join(pkgDir, file)
    await access(src)
    await copyFile(src, join(outDir, `tree-sitter-${lang}.wasm`))
    console.log(`ok ${lang}`)
  } catch {
    // Отсутствие грамматики не ломает установку: язык уйдёт в фолбэк.
    console.log(`skip ${lang}`)
  }
}
