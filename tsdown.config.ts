/**
 * Build config: the node half (lib/index.js + lib/tools/index.js) and the
 * browser half (lib/client.js). tsc only type-checks and emits declarations
 * into lib/types; tsdown bundles from src directly.
 */
import { defineConfig } from 'tsdown'

/** Official packages stay external at runtime (provided by the host / profile). */
const NEVER_BUNDLE = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-agent-presets',
  '@deepseek-ai/dsh-client-modules',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-commands',
  '@deepseek-ai/dsh-fs',
  '@deepseek-ai/dsh-home-paths',
  '@deepseek-ai/dsh-host-webserver',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-sandbox',
  '@deepseek-ai/dsh-sandbox-policy',
  '@deepseek-ai/dsh-schemastery',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-subprocess',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-tool-fs-search',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-user-approval',
]

const host = {
  name: 'dsh-no-workspace',
  entry: {
    index: 'src/index.ts',
    'tools/index': 'src/tools/index.ts',
  },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  dts: false,
  clean: false,
  fixedExtension: false,
  deps: { neverBundle: NEVER_BUNDLE },
}

const client = {
  name: 'dsh-no-workspace/client',
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-client-runtime/client'],
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-no-workspace", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default defineConfig([host, client])
