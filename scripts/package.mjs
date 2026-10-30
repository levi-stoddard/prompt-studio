// Packages the built app (dist/ + package.json only, no node_modules) into a Windows app folder,
// flips Electron fuses to disable debugging/Node entry points, and installs it to <home>\app (see scripts/home.mjs).
import { packager } from '@electron/packager';
import { flipFuses, FuseV1Options, FuseVersion } from '@electron/fuses';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDir } from './home.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Always package a fresh build of the current source, never a stale dist/.
execSync('node scripts/build.mjs', { cwd: root, stdio: 'inherit' });
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const exeName = 'Prompt Studio.exe';

const [outDir] = await packager({
  dir: root,
  out: join(root, 'out'),
  overwrite: true,
  platform: 'win32',
  arch: 'x64',
  asar: true,
  prune: true,
  icon: join(root, 'assets', 'icon.ico'),
  name: 'Prompt Studio',
  executableName: 'Prompt Studio',
  appVersion: pkg.version,
  appCopyright: `© ${new Date().getFullYear()} ${pkg.author}`,
  win32metadata: { CompanyName: pkg.author, ProductName: 'Prompt Studio', FileDescription: 'Prompt Studio', InternalName: 'PromptStudio', OriginalFilename: exeName },
  ignore: (p) => !(p === '' || p === '/package.json' || p === '/dist' || p.startsWith('/dist/')),
});

await flipFuses(join(outDir, exeName), {
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: process.env.PS_ASAR_INTEGRITY !== '0',
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
});
// Keep only the English UI resources for Chromium (saves ~47 MB).
const locales = join(outDir, 'locales');
for (const f of readdirSync(locales)) if (f !== 'en-US.pak') rmSync(join(locales, f));
console.log(`Packaged: ${outDir}`);

if (process.env.PS_NO_INSTALL === '1') process.exit(0);

// Refuse to replace files while the installed app is running.
const running = execSync('tasklist /FI "IMAGENAME eq Prompt Studio.exe" /NH', { encoding: 'utf8' });
if (running.includes('Prompt Studio.exe')) {
  console.error('Prompt Studio is running. Close it and run the packaging again.');
  process.exit(1);
}
// The install folder only ever contains packaged build output; data lives in <home>\data.
if (existsSync(installDir)) {
  const marker = join(installDir, exeName);
  if (readdirSync(installDir).length > 0 && !existsSync(marker)) {
    console.error(`${installDir} exists and does not look like a Prompt Studio install. Not touching it.`);
    process.exit(1);
  }
  rmSync(installDir, { recursive: true, force: true });
}
mkdirSync(installDir, { recursive: true });
cpSync(outDir, installDir, { recursive: true });
console.log(`Installed to ${installDir}`);

// Every install must pass verification, including the byte-for-byte check that the installed
// files are the build just made. A failure here fails the install.
try {
  execSync('node scripts/verify-security.mjs', { cwd: root, stdio: 'inherit', env: { ...process.env, PROMPTSTUDIO_INSTALL_DIR: installDir } });
} catch {
  console.error('\nINSTALL VERIFICATION FAILED. Do not use this install for acceptance.');
  process.exit(1);
}
