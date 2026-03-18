/**
 * Shared config for browse CLI + server.
 *
 * Resolution:
 *   1. BROWSE_STATE_FILE env → derive stateDir from parent
 *   2. git rev-parse --show-toplevel → projectDir/.gstack/
 *   3. process.cwd() fallback (non-git environments)
 *
 * The CLI computes the config and passes BROWSE_STATE_FILE to the
 * spawned server. The server derives all paths from that env var.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

export interface BrowseConfig {
  projectDir: string;
  stateDir: string;
  stateFile: string;
  launchConfigFile: string;
  persistentProfileDir: string;
  consoleLog: string;
  networkLog: string;
  dialogLog: string;
}

export type BrowseLaunchMode = 'ephemeral' | 'persistent';
export type BrowseLaunchBrowser = 'chromium' | 'chrome' | 'edge';

export interface BrowseLaunchConfig {
  mode: BrowseLaunchMode;
  headless: boolean;
  browser: BrowseLaunchBrowser;
  profileDir: string;
}

/**
 * Detect the git repository root, or null if not in a repo / git unavailable.
 */
export function getGitRoot(): string | null {
  try {
    const proc = spawnSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      timeout: 2_000, // Don't hang if .git is broken
    });
    if (proc.status !== 0) return null;
    return proc.stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Resolve all browse config paths.
 *
 * If BROWSE_STATE_FILE is set (e.g. by CLI when spawning server, or by
 * tests for isolation), all paths are derived from it. Otherwise, the
 * project root is detected via git or cwd.
 */
export function resolveConfig(
  env: Record<string, string | undefined> = process.env,
): BrowseConfig {
  let stateFile: string;
  let stateDir: string;
  let projectDir: string;

  if (env.BROWSE_STATE_FILE) {
    stateFile = env.BROWSE_STATE_FILE;
    stateDir = path.dirname(stateFile);
    projectDir = path.dirname(stateDir); // parent of .gstack/
  } else {
    projectDir = getGitRoot() || process.cwd();
    stateDir = path.join(projectDir, '.gstack');
    stateFile = path.join(stateDir, 'browse.json');
  }

  return {
    projectDir,
    stateDir,
    stateFile,
    launchConfigFile: path.join(stateDir, 'browse-launch.json'),
    persistentProfileDir: path.join(stateDir, 'chrome-profile'),
    consoleLog: path.join(stateDir, 'browse-console.log'),
    networkLog: path.join(stateDir, 'browse-network.log'),
    dialogLog: path.join(stateDir, 'browse-dialog.log'),
  };
}

/**
 * Create the .gstack/ state directory if it doesn't exist.
 * Throws with a clear message on permission errors.
 */
export function ensureStateDir(config: BrowseConfig): void {
  try {
    fs.mkdirSync(config.stateDir, { recursive: true });
  } catch (err: any) {
    if (err.code === 'EACCES') {
      throw new Error(`Cannot create state directory ${config.stateDir}: permission denied`);
    }
    if (err.code === 'ENOTDIR') {
      throw new Error(`Cannot create state directory ${config.stateDir}: a file exists at that path`);
    }
    throw err;
  }

  // Ensure .gstack/ is in the project's .gitignore
  const gitignorePath = path.join(config.projectDir, '.gitignore');
  try {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    if (!content.match(/^\.gstack\/?$/m)) {
      const separator = content.endsWith('\n') ? '' : '\n';
      fs.appendFileSync(gitignorePath, `${separator}.gstack/\n`);
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      // Write warning to server log (visible even in daemon mode)
      const logPath = path.join(config.stateDir, 'browse-server.log');
      try {
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] Warning: could not update .gitignore at ${gitignorePath}: ${err.message}\n`);
      } catch {
        // stateDir write failed too — nothing more we can do
      }
    }
    // ENOENT (no .gitignore) — skip silently
  }
}

/**
 * Derive a slug from the git remote origin URL (owner-repo format).
 * Falls back to the directory basename if no remote is configured.
 */
export function getRemoteSlug(): string {
  try {
    const proc = spawnSync('git', ['remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      timeout: 2_000,
    });
    if (proc.status !== 0) throw new Error('no remote');
    const url = proc.stdout.trim();
    // SSH:   git@github.com:owner/repo.git → owner-repo
    // HTTPS: https://github.com/owner/repo.git → owner-repo
    const match = url.match(/[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (match) return `${match[1]}-${match[2]}`;
    throw new Error('unparseable');
  } catch {
    const root = getGitRoot();
    return path.basename(root || process.cwd());
  }
}

function normalizeLaunchMode(value: unknown, fallback: BrowseLaunchMode): BrowseLaunchMode {
  return value === 'persistent' || value === 'ephemeral' ? value : fallback;
}

function normalizeLaunchBrowser(value: unknown, fallback: BrowseLaunchBrowser): BrowseLaunchBrowser {
  return value === 'chrome' || value === 'edge' || value === 'chromium' ? value : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (['1', 'true', 'yes', 'on'].includes(value.toLowerCase())) return true;
    if (['0', 'false', 'no', 'off'].includes(value.toLowerCase())) return false;
  }
  return fallback;
}

function readLaunchConfigFile(config: BrowseConfig): Partial<BrowseLaunchConfig> {
  try {
    return JSON.parse(fs.readFileSync(config.launchConfigFile, 'utf-8'));
  } catch {
    return {};
  }
}

export function getDefaultLaunchConfig(config: BrowseConfig): BrowseLaunchConfig {
  return {
    mode: 'ephemeral',
    headless: true,
    browser: process.platform === 'win32' ? 'chrome' : 'chromium',
    profileDir: config.persistentProfileDir,
  };
}

export function resolveLaunchConfig(
  env: Record<string, string | undefined> = process.env,
  config: BrowseConfig = resolveConfig(env),
): BrowseLaunchConfig {
  const defaults = getDefaultLaunchConfig(config);
  const stored = readLaunchConfigFile(config);

  return {
    mode: normalizeLaunchMode(env.BROWSE_SESSION_MODE ?? stored.mode, defaults.mode),
    headless: normalizeBoolean(env.BROWSE_HEADLESS ?? stored.headless, defaults.headless),
    browser: normalizeLaunchBrowser(env.BROWSE_BROWSER ?? stored.browser, defaults.browser),
    profileDir: path.resolve(env.BROWSE_PROFILE_DIR || stored.profileDir || defaults.profileDir),
  };
}

export function writeLaunchConfig(
  config: BrowseConfig,
  update: Partial<BrowseLaunchConfig>,
): BrowseLaunchConfig {
  const current = resolveLaunchConfig({}, config);
  const next: BrowseLaunchConfig = {
    mode: normalizeLaunchMode(update.mode ?? current.mode, current.mode),
    headless: normalizeBoolean(update.headless ?? current.headless, current.headless),
    browser: normalizeLaunchBrowser(update.browser ?? current.browser, current.browser),
    profileDir: path.resolve(update.profileDir || current.profileDir),
  };

  const tmpFile = config.launchConfigFile + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmpFile, config.launchConfigFile);
  return next;
}

/**
 * Read the binary version (git SHA) from browse/dist/.version.
 * Returns null if the file doesn't exist or can't be read.
 */
export function readVersionHash(execPath: string = process.execPath): string | null {
  try {
    const versionFile = path.resolve(path.dirname(execPath), '.version');
    return fs.readFileSync(versionFile, 'utf-8').trim() || null;
  } catch {
    return null;
  }
}
