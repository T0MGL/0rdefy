/**
 * Audit: find every reference to `sleeves_status` in the runtime codebase.
 *
 * Usage:
 *   tsx scripts/audit_sleeves_status.ts                  (text output)
 *   tsx scripts/audit_sleeves_status.ts --format=json
 *   tsx scripts/audit_sleeves_status.ts --format=markdown
 *
 * Exit codes:
 *   0 = no references found (code is clean, safe to apply migration 148c)
 *   1 = at least one runtime reference found (code sweep not complete)
 *   2 = invalid usage
 *
 * Scope:
 *   - api/**\/*.ts       (backend services, routes, middlewares)
 *   - src/**\/*.ts       (frontend shared code, services)
 *   - src/**\/*.tsx      (frontend pages and components)
 *   - scripts/**\/*.ts   (operational scripts)
 *
 * Deliberately excluded:
 *   - db/migrations/**   (historical record, not runtime code)
 *   - node_modules, dist, build, .next, .turbo
 *   - markdown docs, json config, lock files
 *
 * Each match includes file path, line number, a best-effort classification
 * (read, write, filter) and a trimmed snippet of the line.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type OutputFormat = 'text' | 'json' | 'markdown';
type RefKind = 'write' | 'filter' | 'read';

interface Reference {
  file: string;
  line: number;
  kind: RefKind;
  snippet: string;
}

interface CliArgs {
  format: OutputFormat;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const SCAN_DIRS = ['api', 'src', 'scripts'];

const IGNORED_SEGMENTS = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.git',
  'coverage',
  'playwright-report',
  'test-results',
]);

const ACCEPTED_EXTENSIONS = new Set(['.ts', '.tsx']);

const NEEDLE = 'sleeves_status';

function parseArgs(): CliArgs {
  const args: CliArgs = { format: 'text' };

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--format=')) {
      const value = arg.slice('--format='.length) as OutputFormat;
      if (value !== 'text' && value !== 'json' && value !== 'markdown') {
        console.error(`Invalid --format: ${value}. Use text, json, or markdown.`);
        process.exit(2);
      }
      args.format = value;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: tsx scripts/audit_sleeves_status.ts [--format=text|json|markdown]');
      process.exit(0);
    }
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }

  return args;
}

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (IGNORED_SEGMENTS.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, out);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const ext = path.extname(entry.name);
    if (!ACCEPTED_EXTENSIONS.has(ext)) {
      continue;
    }
    out.push(fullPath);
  }
}

function classify(line: string): RefKind {
  const trimmed = line.trim();
  // Write: assignment, update, insert.
  if (/sleeves_status\s*[:=]/.test(trimmed)) {
    return 'write';
  }
  if (/\.update\s*\(\s*\{[^}]*sleeves_status/.test(trimmed)) {
    return 'write';
  }
  if (/\.insert\s*\(\s*\{[^}]*sleeves_status/.test(trimmed)) {
    return 'write';
  }
  // Filter: .eq, .in, .not, .is, WHERE.
  if (/\.(eq|in|not|is|neq|lt|gt|lte|gte|match|filter)\s*\(\s*['"]sleeves_status['"]/.test(trimmed)) {
    return 'filter';
  }
  if (/WHERE\s+.*sleeves_status/i.test(trimmed)) {
    return 'filter';
  }
  // Default: read access.
  return 'read';
}

function scanFile(absolutePath: string): Reference[] {
  const relative = path.relative(PROJECT_ROOT, absolutePath);
  const content = fs.readFileSync(absolutePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const refs: Reference[] = [];

  lines.forEach((line, idx) => {
    if (!line.includes(NEEDLE)) {
      return;
    }
    refs.push({
      file: relative,
      line: idx + 1,
      kind: classify(line),
      snippet: line.trim().slice(0, 200),
    });
  });

  return refs;
}

function renderText(refs: Reference[]): string {
  if (refs.length === 0) {
    return 'Audit sleeves_status: 0 references found. Code is clean.';
  }

  const byFile = new Map<string, Reference[]>();
  for (const ref of refs) {
    const arr = byFile.get(ref.file) ?? [];
    arr.push(ref);
    byFile.set(ref.file, arr);
  }

  const lines: string[] = [];
  lines.push(`Audit sleeves_status: ${refs.length} references in ${byFile.size} files`);
  lines.push('');

  const sortedFiles = Array.from(byFile.keys()).sort();
  for (const file of sortedFiles) {
    const fileRefs = byFile.get(file) ?? [];
    const writeCount = fileRefs.filter((r) => r.kind === 'write').length;
    const filterCount = fileRefs.filter((r) => r.kind === 'filter').length;
    const readCount = fileRefs.filter((r) => r.kind === 'read').length;
    lines.push(
      `${file} (${fileRefs.length} refs: ${writeCount}w ${filterCount}f ${readCount}r)`,
    );
    for (const ref of fileRefs) {
      lines.push(`  ${ref.line.toString().padStart(5, ' ')}:${ref.kind.padEnd(6, ' ')} ${ref.snippet}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function renderJson(refs: Reference[]): string {
  return JSON.stringify(
    {
      total: refs.length,
      references: refs,
    },
    null,
    2,
  );
}

function renderMarkdown(refs: Reference[]): string {
  if (refs.length === 0) {
    return '# Audit: sleeves_status\n\nZero references. Code is clean.\n';
  }

  const byFile = new Map<string, Reference[]>();
  for (const ref of refs) {
    const arr = byFile.get(ref.file) ?? [];
    arr.push(ref);
    byFile.set(ref.file, arr);
  }

  const lines: string[] = [];
  lines.push('# Audit: sleeves_status');
  lines.push('');
  lines.push(`Found ${refs.length} references across ${byFile.size} files.`);
  lines.push('');
  lines.push('| File | Line | Kind | Snippet |');
  lines.push('|---|---|---|---|');

  const sortedFiles = Array.from(byFile.keys()).sort();
  for (const file of sortedFiles) {
    const fileRefs = byFile.get(file) ?? [];
    for (const ref of fileRefs) {
      const safeSnippet = ref.snippet.replace(/\|/g, '\\|');
      lines.push(`| ${file} | ${ref.line} | ${ref.kind} | \`${safeSnippet}\` |`);
    }
  }

  return lines.join('\n');
}

function main(): void {
  const args = parseArgs();

  const files: string[] = [];
  for (const dir of SCAN_DIRS) {
    const absolute = path.join(PROJECT_ROOT, dir);
    if (!fs.existsSync(absolute)) {
      continue;
    }
    walk(absolute, files);
  }

  const allRefs: Reference[] = [];
  for (const file of files) {
    const refs = scanFile(file);
    if (refs.length > 0) {
      allRefs.push(...refs);
    }
  }

  let rendered: string;
  switch (args.format) {
    case 'json':
      rendered = renderJson(allRefs);
      break;
    case 'markdown':
      rendered = renderMarkdown(allRefs);
      break;
    case 'text':
    default:
      rendered = renderText(allRefs);
      break;
  }

  console.log(rendered);

  process.exit(allRefs.length === 0 ? 0 : 1);
}

main();
