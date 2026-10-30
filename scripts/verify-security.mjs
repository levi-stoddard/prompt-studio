// Inspects the installed build: Electron fuses and the contents of app.asar.
import { getCurrentFuseWire, FuseV1Options } from '@electron/fuses';
import { listPackage, extractFile } from '@electron/asar';
import { dirname, join, sep } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { installDir } from './home.mjs';

const exe = join(installDir, 'Prompt Studio.exe');
const asar = join(installDir, 'resources', 'app.asar');
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const wire = await getCurrentFuseWire(exe);
const fuse = (opt) => wire[opt] === '1'.charCodeAt(0) || wire[opt] === 49;
check('Fuse RunAsNode disabled', !fuse(FuseV1Options.RunAsNode));
check('Fuse NODE_OPTIONS disabled', !fuse(FuseV1Options.EnableNodeOptionsEnvironmentVariable));
check('Fuse --inspect arguments disabled', !fuse(FuseV1Options.EnableNodeCliInspectArguments));
check('Fuse cookie encryption enabled', fuse(FuseV1Options.EnableCookieEncryption));
check('Fuse only-load-from-asar enabled', fuse(FuseV1Options.OnlyLoadAppFromAsar));
check('Fuse file:// extra privileges disabled', !fuse(FuseV1Options.GrantFileProtocolExtraPrivileges));
console.log(`INFO  Fuse asar integrity validation: ${fuse(FuseV1Options.EnableEmbeddedAsarIntegrityValidation) ? 'enabled' : 'disabled'}`);

const raw = listPackage(asar);
const files = raw.map((f) => f.replace(/\\/g, '/'));
check('No node_modules in package', !files.some((f) => f.includes('/node_modules')));
check('No TypeScript sources or source maps', !files.some((f) => /\.(ts|tsx|map)$/.test(f)));
check('No .env or key files', !files.some((f) => /(^|\/)\.env|\.(pem|key|dpapi)$/i.test(f)));
check('Contains main, preload and renderer', ['/dist/main/main.js', '/dist/preload/preload.js', '/dist/renderer/index.html'].every((f) => files.includes(f)));
const patterns = [/AIza[0-9A-Za-z_-]{35}/, /sk-ant-[A-Za-z0-9_-]{20,}/, /ghp_[A-Za-z0-9]{30,}/];
const hits = raw.filter((f) => /\.(js|html|css|json)$/.test(f)).filter((f) => {
  const text = extractFile(asar, f.replace(/^[\\/]/, '')).toString('utf8');
  return patterns.some((p) => p.test(text));
});
check('No API keys embedded in packaged files', hits.length === 0, hits.join(', '));
const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
// Byte-for-byte comparison of every built file against the installed package (catches stale installs).
const builtFiles = readdirSync(join(sourceRoot, 'dist'), { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile())
  .map((e) => join(e.parentPath, e.name).slice(sourceRoot.length + 1).replace(/\\/g, '/'));
const installedFiles = files.filter((f) => f.startsWith('/dist/') && !raw[files.indexOf(f)].endsWith(sep)).map((f) => f.slice(1));
const mismatched = builtFiles.filter((f) => {
  try {
    return Buffer.compare(extractFile(asar, f.replace(/\//g, '\\')), readFileSync(join(sourceRoot, f))) !== 0;
  } catch {
    return true;
  }
});
const extra = installedFiles.filter((f) => /\.[a-z0-9]+$/i.test(f) && !builtFiles.includes(f));
check(`Installed files are byte-identical to the current build (${builtFiles.length} files)`, builtFiles.length > 0 && mismatched.length === 0 && extra.length === 0, [...mismatched, ...extra].join(', '));
const digest = createHash('sha256');
for (const f of builtFiles.sort()) digest.update(f).update(readFileSync(join(sourceRoot, f)));
console.log(`INFO  Build fingerprint (sha256 of dist/): ${digest.digest('hex').slice(0, 16)}`);
console.log(failures ? `\n${failures} check(s) failed.` : '\nAll packaged-build checks passed.');
process.exit(failures ? 1 : 0);
