/**
 * find-browse — locate the gstack browse binary.
 *
 * Compiled to browse/dist/find-browse (standalone binary, no bun runtime needed).
 * Outputs the absolute path to the browse binary on stdout, or exits 1 if not found.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawnSync } from 'child_process';

// ─── Binary Discovery ───────────────────────────────────────────

function getGitRoot(): string | null {
  try {
    const proc = spawnSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
    });
    if (proc.status !== 0) return null;
    return proc.stdout.trim();
  } catch {
    return null;
  }
}

export function locateBinary(): string | null {
  const root = getGitRoot();
  const home = homedir();
  const candidates: string[] = [];

  // Workspace-local takes priority (for development)
  if (root) {
    candidates.push(
      join(root, '.codex', 'skills', 'gstack', 'browse', 'dist', 'browse'),
      join(root, '.codex', 'skills', 'gstack', 'browse', 'dist', 'browse.exe'),
      join(root, '.claude', 'skills', 'gstack', 'browse', 'dist', 'browse'),
      join(root, '.claude', 'skills', 'gstack', 'browse', 'dist', 'browse.exe'),
    );
  }

  // Global fallback
  candidates.push(
    join(home, '.codex', 'skills', 'gstack', 'browse', 'dist', 'browse'),
    join(home, '.codex', 'skills', 'gstack', 'browse', 'dist', 'browse.exe'),
    join(home, '.claude', 'skills', 'gstack', 'browse', 'dist', 'browse'),
    join(home, '.claude', 'skills', 'gstack', 'browse', 'dist', 'browse.exe'),
  );

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

// ─── Main ───────────────────────────────────────────────────────

function main() {
  const bin = locateBinary();
  if (!bin) {
    process.stderr.write('ERROR: browse binary not found. Run: cd <skill-dir> && ./setup\n');
    process.exit(1);
  }

  console.log(bin);
}

main();
