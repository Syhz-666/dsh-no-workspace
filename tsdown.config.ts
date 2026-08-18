/**
 * Client bundle for the browser half: emits a closure-factory artifact the
 * DSH module loader can serve at /plugins/dsh-no-workspace/client.js. The
 * bundle only imports platform modules (cordis, client-runtime) plus the
 * patch-provided window registry; everything else inlines.
 */
import { defineConfig } from 'tsdown'

export default defineConfig({
  name: 'dsh-no-workspace/client',
  entry: { client: 'lib/client/index.js' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  external: [
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-client-runtime/client',
  ],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  noExternal: (id: string) => (id.startsWith('@deepseek-ai/') ? undefined : true),
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-no-workspace", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
