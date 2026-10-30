import { promises as fs } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileRestriction, isDeniedDir, scanSecrets, type SecretFinding } from '../core/secrets';

// Read-only access to user-authorized project folders.
// This module intentionally imports no write, rename, copy or delete APIs.

export interface FileEntry {
  rel: string;
  size: number;
  restricted: string | null;
}

const MAX_FILES = 4000;
const MAX_DEPTH = 10;
const MAX_READ_BYTES = 512 * 1024;

function inside(root: string, p: string): boolean {
  const r = relative(root, p);
  return r === '' || (!r.startsWith('..') && !isAbsolute(r));
}

/** Resolve a relative path inside an authorized root, refusing traversal and symlink/junction escapes. */
export async function resolveInside(root: string, rel: string): Promise<string> {
  const rootReal = await fs.realpath(root);
  const candidate = resolve(rootReal, rel);
  if (!inside(rootReal, candidate)) throw new Error('Path is outside the authorized folder.');
  const real = await fs.realpath(candidate);
  if (!inside(rootReal, real)) throw new Error('Path resolves outside the authorized folder.');
  return real;
}

export async function listFiles(root: string): Promise<FileEntry[]> {
  const rootReal = await fs.realpath(root);
  const out: FileEntry[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      const full = join(dir, e.name);
      if (e.isSymbolicLink()) continue; // never follow links out of the authorized tree
      if (e.isDirectory()) {
        if (!isDeniedDir(e.name)) await walk(full, depth + 1);
      } else if (e.isFile()) {
        let size = 0;
        try {
          size = (await fs.stat(full)).size;
        } catch {
          continue;
        }
        out.push({ rel: relative(rootReal, full).split(sep).join('/'), size, restricted: fileRestriction(e.name) });
      }
    }
  }
  await walk(rootReal, 0);
  return out;
}

export interface Excerpt {
  text: string;
  truncated: boolean;
  findings: SecretFinding[];
}

export async function readExcerpt(root: string, rel: string, charLimit: number): Promise<Excerpt> {
  const name = rel.split('/').pop() ?? rel;
  const restriction = fileRestriction(name);
  if (restriction) throw new Error(`${rel}: ${restriction}.`);
  for (const part of rel.split('/').slice(0, -1)) if (isDeniedDir(part)) throw new Error(`${rel}: inside an excluded folder.`);
  const file = await resolveInside(root, rel);
  const handle = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(MAX_READ_BYTES);
    const { bytesRead } = await handle.read(buf, 0, MAX_READ_BYTES, 0);
    const full = buf.subarray(0, bytesRead).toString('utf8');
    if (full.includes('\u0000')) throw new Error(`${rel}: appears to be a binary file.`);
    const text = full.slice(0, charLimit);
    return { text, truncated: full.length > charLimit, findings: scanSecrets(text) };
  } finally {
    await handle.close();
  }
}
