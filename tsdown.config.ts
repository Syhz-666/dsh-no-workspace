/**
 * Build config: the node half only (lib/index.js + lib/tools/index.js).
 * tsc only type-checks and emits declarations into lib/types; tsdown bundles
 * from src directly. There is no browser half.
 */
import { defineConfig } from 'tsdown'

/** Official packages stay external at runtime (provided by the host / profile). */
const NEVER_BUNDLE = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-agent-presets',
  '@deepseek-ai/dsh-commands',
  '@deepseek-ai/dsh-fs',
  '@deepseek-ai/dsh-home-paths',
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

export default defineConfig([host])
