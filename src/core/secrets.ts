// Detects credentials and sensitive files so they are never sent to Gemini, logged or exported.

const PATTERNS: { type: string; re: RegExp }[] = [
  { type: 'Google API key', re: /AIza[0-9A-Za-z_-]{35}/g },
  { type: 'OpenAI key', re: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { type: 'Anthropic key', re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { type: 'GitHub token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}/g },
  { type: 'AWS access key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { type: 'Stripe key', re: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { type: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { type: 'Private key', re: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/g },
  { type: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { type: 'Connection string with password', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]{3,}@[^\s]+/gi },
  { type: 'Password assignment', re: /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret)\b["']?\s*[:=]\s*["']?[^\s"',;]{6,}/gi },
];

export interface SecretFinding {
  type: string;
  index: number;
}

export function scanSecrets(text: string): SecretFinding[] {
  const out: SecretFinding[] = [];
  for (const { type, re } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      out.push({ type, index: m.index });
      if (out.length > 50) return out;
    }
  }
  return out;
}

export function redactSecrets(text: string): string {
  let t = text;
  for (const { type, re } of PATTERNS) t = t.replace(re, `[REDACTED ${type}]`);
  return t;
}

const DENY_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'out', '.venv', 'venv', '__pycache__', '.cache', '.idea', '.vs', 'bin', 'obj', '.terraform', '.ssh', '.gnupg', '.aws', '.azure']);

const DENY_FILE = [
  /^\.env(\..*)?$/i,
  /\.(pem|key|pfx|p12|crt|cer|der|keystore|jks|kdbx|ppk|gpg|asc)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)/i,
  /credential/i,
  /secret/i,
  /password/i,
  /token/i,
  /^\.npmrc$|^\.pypirc$|^\.netrc$|^\.git-credentials$/i,
  /\.(db|sqlite|sqlite3|dpapi)$/i,
];

const TEXT_EXT = new Set([
  'md', 'markdown', 'txt', 'rst', 'adoc', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'csv', 'tsv', 'xml', 'html', 'htm', 'css', 'scss',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'cs', 'java', 'kt', 'go', 'rs', 'rb', 'php', 'swift', 'c', 'h', 'cpp', 'hpp', 'sql', 'sh', 'ps1', 'bat', 'graphql', 'proto', 'tex',
]);

export function isDeniedDir(name: string): boolean {
  return DENY_DIRS.has(name.toLowerCase());
}

/** Why a file may not be read for context, or null if it may (content is still scanned). */
export function fileRestriction(name: string): string | null {
  if (DENY_FILE.some((re) => re.test(name))) return 'Sensitive file name (credentials, keys or databases)';
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  if (!TEXT_EXT.has(ext)) return 'Not a supported text document';
  return null;
}
