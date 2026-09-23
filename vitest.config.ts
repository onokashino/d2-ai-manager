import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'

const sqliteLoaderPlugin: Plugin = {
  name: 'sqlite-loader',
  enforce: 'pre',
  resolveId(id) {
    if (id === 'sqlite' || id === 'node:sqlite') {
      return '\0node:sqlite:loader'
    }
  },
  load(id) {
    if (id === '\0node:sqlite:loader') {
      return `
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sqlite = require('node:sqlite');
export const DatabaseSync = sqlite.DatabaseSync;
`
    }
  },
}

export default defineConfig({
  plugins: [sqliteLoaderPlugin],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
