// Security checks to run before reporting work as done.
//   node scripts/security-check.mjs repo     tracked files: secrets, credentials, conflict markers
//   node scripts/security-check.mjs bundle   built client assets (.next/static): secrets and server-only data
// Exits non-zero on any finding. Assumes an attacker can read the whole repository.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const mode = process.argv[2] ?? "repo";

const SECRET_PATTERNS = [
  ["Postgres URL with password", /postgres(?:ql)?:\/\/[^\s:/@'"]+:[^\s@'"<>]{6,}@/i],
  ["Anthropic API key", /sk-ant-[A-Za-z0-9_-]{20,}/],
  ["OpenAI-style key", /\bsk-[A-Za-z0-9]{32,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["Private key", /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/],
  ["Neon API key", /\bnapi_[A-Za-z0-9]{30,}\b/],
  ["Assigned secret value", /\b(?:SESSION_SECRET|NEXT_SERVER_ACTIONS_ENCRYPTION_KEY|ANTHROPIC_API_KEY|NEON_AUTH_COOKIE_SECRET)\s*=\s*['"]?[A-Za-z0-9+/_=-]{16,}/],
];
const CONFLICT = /^(<<<<<<<|>>>>>>>)( |$)|^=======$/m;

function findings(text, file, patterns) {
  const out = [];
  for (const [name, re] of patterns) if (re.test(text)) out.push(`${file}: ${name}`);
  return out;
}

let problems = [];

if (mode === "repo") {
  const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root })
    .toString().split("\0").filter(Boolean);
  for (const f of files) {
    if (/\.(png|jpe?g|gif|ico|woff2?|wasm|data)$/i.test(f) || f === "package-lock.json") continue;
    const p = join(root, f);
    if (!existsSync(p) || statSync(p).size > 5_000_000) continue;
    const text = readFileSync(p, "utf8");
    problems.push(...findings(text, f, SECRET_PATTERNS));
    if (CONFLICT.test(text)) problems.push(`${f}: merge conflict marker`);
    if (/^\.env(?!\.example$)/.test(f.split("/").pop() ?? "")) problems.push(`${f}: env file is tracked`);
  }
} else if (mode === "bundle") {
  const dir = join(root, ".next", "static");
  if (!existsSync(dir)) {
    console.error("No .next/static directory. Run `npm run build` first.");
    process.exit(1);
  }
  // Things that must never reach the browser: secrets, server-only identifiers and SQL.
  const BUNDLE_PATTERNS = [
    ...SECRET_PATTERNS,
    ["password hash column", /password_hash/],
    ["session token hashing", /token_hash/],
    // Env var NAMES may appear in help text; values are caught by the secret patterns above.
    ["Session secret value", /SESSION_SECRET\s*[:=]\s*["'][A-Za-z0-9+/_=-]{16,}/],
    ["SQL in client bundle", /\bselect\s+[\w*,\s.]+\s+from\s+(?:app_users|app_sessions|revisions|import_rows|published_snapshots)\b/i],
    // (The CMS editor legitimately has an "internal note" form field; published payloads are tested in tests/db.)
    ["PGlite in client bundle", /@electric-sql\/pglite/],
  ];
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  for (const f of walk(dir)) {
    if (!/\.(js|css|html|json|txt)$/.test(f)) continue;
    problems.push(...findings(readFileSync(f, "utf8"), relative(root, f), BUNDLE_PATTERNS));
  }
} else {
  console.error("Usage: node scripts/security-check.mjs <repo|bundle>");
  process.exit(2);
}

if (problems.length) {
  console.error(`Security check (${mode}) found ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`Security check (${mode}): no findings.`);
