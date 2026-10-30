// Builds the main process, preload and renderer into dist/. The packaged app needs no node_modules.
import { build as esbuild } from 'esbuild';
import { build as vite } from 'vite';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
rmSync(resolve(root, 'dist'), { recursive: true, force: true });

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'], logLevel: 'warning', legalComments: 'none' };

await esbuild({ ...common, entryPoints: [resolve(root, 'src/main/main.ts')], outfile: resolve(root, 'dist/main/main.js') });
await esbuild({ ...common, entryPoints: [resolve(root, 'src/preload/preload.ts')], outfile: resolve(root, 'dist/preload/preload.js') });
await vite({ configFile: resolve(root, 'vite.config.mts'), logLevel: 'warn' });

console.log('Build complete: dist/main, dist/preload, dist/renderer');
