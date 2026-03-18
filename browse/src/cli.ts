/**
 * gstack CLI — thin wrapper that talks to the persistent server
 *
 * Flow:
 *   1. Read .gstack/browse.json for port + token
 *   2. If missing or stale PID → start server in background
 *   3. Health check + version mismatch detection
 *   4. Send command via HTTP POST
 *   5. Print response to stdout (or stderr for errors)
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';
import {
  resolveConfig,
  ensureStateDir,
  readVersionHash,
  resolveLaunchConfig,
  writeLaunchConfig,
  type BrowseLaunchConfig,
} from './config';
import { getTempRoot } from './path-utils';

const config = resolveConfig();
const MAX_START_WAIT = 30000;
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export function resolveServerScript(
  env: Record<string, string | undefined> = process.env,
  metaDir: string = MODULE_DIR,
  execPath: string = process.execPath,
): string {
  if (env.BROWSE_SERVER_SCRIPT) {
    return env.BROWSE_SERVER_SCRIPT;
  }

  const direct = path.resolve(metaDir, 'server.ts');
  if (fs.existsSync(direct)) {
    return direct;
  }

  if (execPath) {
    const adjacent = path.resolve(path.dirname(execPath), '..', 'src', 'server.ts');
    if (fs.existsSync(adjacent)) {
      return adjacent;
    }
  }

  throw new Error(
    'Cannot find server.ts. Set BROWSE_SERVER_SCRIPT env or run from the browse source tree.',
  );
}

const SERVER_SCRIPT = resolveServerScript();

interface ServerState {
  pid: number;
  port: number;
  token: string;
  startedAt: string;
  serverPath: string;
  binaryVersion?: string;
  launchMode?: 'ephemeral' | 'persistent';
  headless?: boolean;
  browser?: 'chromium' | 'chrome' | 'edge';
  browserName?: string;
  profileDir?: string;
}

function readState(): ServerState | null {
  try {
    const data = fs.readFileSync(config.stateFile, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function killServer(pid: number): Promise<void> {
  if (!isProcessAlive(pid)) return;

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }

  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && isProcessAlive(pid)) {
    await sleep(100);
  }

  if (isProcessAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
}

/**
 * Clean up legacy /tmp/browse-server*.json files from before project-local state.
 * Verifies PID ownership before sending signals.
 */
function cleanupLegacyState(): void {
  const tempRoot = getTempRoot();
  try {
    const files = fs.readdirSync(tempRoot).filter((f) => f.startsWith('browse-server') && f.endsWith('.json'));
    for (const file of files) {
      const fullPath = path.join(tempRoot, file);
      try {
        const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
        if (data.pid && isProcessAlive(data.pid) && process.platform !== 'win32') {
          const check = spawnSync('ps', ['-p', String(data.pid), '-o', 'command='], {
            encoding: 'utf8',
            timeout: 2000,
          });
          const cmd = check.stdout.trim();
          if (cmd.includes('bun') || cmd.includes('server.ts')) {
            try {
              process.kill(data.pid, 'SIGTERM');
            } catch {}
          }
        }
        fs.unlinkSync(fullPath);
      } catch {}
    }

    const logFiles = fs.readdirSync(tempRoot).filter((f) =>
      f.startsWith('browse-console') || f.startsWith('browse-network') || f.startsWith('browse-dialog'),
    );
    for (const file of logFiles) {
      try {
        fs.unlinkSync(path.join(tempRoot, file));
      } catch {}
    }
  } catch {}
}

async function startServer(): Promise<ServerState> {
  ensureStateDir(config);

  try {
    fs.unlinkSync(config.stateFile);
  } catch {}

  const useNodeRuntime = process.platform === 'win32';
  const command = useNodeRuntime ? process.execPath : 'bun';
  const commandArgs = useNodeRuntime
    ? ['--experimental-sqlite', '--import', 'tsx', SERVER_SCRIPT]
    : ['run', SERVER_SCRIPT];
  const proc = spawn(command, commandArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSE_STATE_FILE: config.stateFile },
    detached: true,
    windowsHide: true,
  });

  proc.unref();

  const start = Date.now();
  while (Date.now() - start < MAX_START_WAIT) {
    const state = readState();
    if (state && isProcessAlive(state.pid)) {
      proc.stdout?.destroy();
      proc.stderr?.destroy();
      return state;
    }
    await sleep(100);
  }

  const stderr = proc.stderr;
  if (stderr) {
    const chunks: Buffer[] = [];
    stderr.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    await sleep(100);
    if (chunks.length > 0) {
      const errText = Buffer.concat(chunks).toString('utf8');
      throw new Error(`Server failed to start:\n${errText}`);
    }
  }

  throw new Error(`Server failed to start within ${MAX_START_WAIT / 1000}s`);
}

function launchConfigMatchesState(state: ServerState, launch: BrowseLaunchConfig): boolean {
  const stateMode = state.launchMode ?? 'ephemeral';
  const stateHeadless = state.headless ?? true;
  const stateBrowser = state.browser ?? (process.platform === 'win32' ? 'chrome' : 'chromium');

  if (stateMode !== launch.mode) return false;
  if (stateHeadless !== launch.headless) return false;
  if (stateBrowser !== launch.browser) return false;

  if (launch.mode === 'persistent') {
    return path.resolve(state.profileDir || config.persistentProfileDir) === path.resolve(launch.profileDir);
  }

  return true;
}

async function ensureServer(): Promise<ServerState> {
  const state = readState();
  const currentLaunch = resolveLaunchConfig({}, config);

  if (state && isProcessAlive(state.pid)) {
    const currentVersion = readVersionHash();
    if (currentVersion && state.binaryVersion && currentVersion !== state.binaryVersion) {
      console.error('[browse] Binary updated, restarting server...');
      await killServer(state.pid);
      return startServer();
    }

    if (!launchConfigMatchesState(state, currentLaunch)) {
      console.error('[browse] Launch config changed, restarting server...');
      await killServer(state.pid);
      return startServer();
    }

    try {
      const resp = await fetch(`http://127.0.0.1:${state.port}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (resp.ok) {
        const health = (await resp.json()) as any;
        if (health.status === 'healthy') {
          return state;
        }
      }
    } catch {}
  }

  console.error('[browse] Starting server...');
  return startServer();
}

async function sendCommand(
  state: ServerState,
  command: string,
  args: string[],
  retries = 0,
): Promise<void> {
  const body = JSON.stringify({ command, args });

  try {
    const resp = await fetch(`http://127.0.0.1:${state.port}/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`,
      },
      body,
      signal: AbortSignal.timeout(30000),
    });

    if (resp.status === 401) {
      console.error('[browse] Auth failed — server may have restarted. Retrying...');
      const newState = readState();
      if (newState && newState.token !== state.token) {
        return sendCommand(newState, command, args);
      }
      throw new Error('Authentication failed');
    }

    const text = await resp.text();

    if (resp.ok) {
      process.stdout.write(text);
      if (!text.endsWith('\n')) process.stdout.write('\n');
    } else {
      try {
        const err = JSON.parse(text);
        console.error(err.error || text);
        if (err.hint) console.error(err.hint);
      } catch {
        console.error(text);
      }
      process.exit(1);
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      console.error('[browse] Command timed out after 30s');
      process.exit(1);
    }

    if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.message?.includes('fetch failed')) {
      if (retries >= 1) throw new Error('[browse] Server crashed twice in a row — aborting');
      console.error('[browse] Server connection lost. Restarting...');
      const newState = await startServer();
      return sendCommand(newState, command, args, retries + 1);
    }

    throw err;
  }
}

function printCliHelp() {
  console.log(`gstack browse — Fast headless browser for AI coding agents

Usage: browse <command> [args...]

Navigation:     goto <url> | back | forward | reload | url
Content:        text | html [sel] | links | forms | accessibility
Interaction:    click <sel> | fill <sel> <val> | select <sel> <val>
                hover <sel> | type <text> | press <key>
                scroll [sel] | wait <sel|--networkidle|--load> | viewport <WxH>
                upload <sel> <file1> [file2...]
                cookie-import <json-file>
                cookie-import-browser [browser] [--domain <d>]
Inspection:     js <expr> | eval <file> | css <sel> <prop> | attrs <sel>
                console [--clear|--errors] | network [--clear] | dialog [--clear]
                cookies | storage [set <k> <v>] | perf
                is <prop> <sel> (visible|hidden|enabled|disabled|checked|editable|focused)
Visual:         screenshot [--viewport] [--clip x,y,w,h] [@ref|sel] [path]
                pdf [path] | responsive [prefix]
Snapshot:       snapshot [-i] [-c] [-d N] [-s sel] [-D] [-a] [-o path] [-C]
                -D/--diff: diff against previous snapshot
                -a/--annotate: annotated screenshot with ref labels
                -C/--cursor-interactive: find non-ARIA clickable elements
Compare:        diff <url1> <url2>
Multi-step:     chain (reads JSON from stdin)
Tabs:           tabs | tab <id> | newtab [url] | closetab [id]
Server:         status | cookie <n>=<v> | header <n>:<v>
                useragent <str> | stop | restart
Dialogs:        dialog-accept [text] | dialog-dismiss
Login session:  login-session start [url] | login-session headed [url]
                login-session headless | login-session status | login-session stop

Refs:           After 'snapshot', use @e1, @e2... as selectors:
                click @e3 | fill @e4 "value" | hover @e1
                @c refs from -C: click @c1`);
}

function printLoginSessionStatus(launch: BrowseLaunchConfig, state: ServerState | null) {
  const running = !!state && isProcessAlive(state.pid);
  const lines = [
    `Login session: ${launch.mode === 'persistent' ? 'enabled' : 'disabled'}`,
    `Launch mode: ${launch.mode} ${launch.headless ? 'headless' : 'headed'}`,
    `Preferred browser: ${launch.browser}`,
    `Profile dir: ${launch.profileDir}`,
    `Profile on disk: ${fs.existsSync(launch.profileDir) ? 'yes' : 'no'}`,
    `Server: ${running ? `running (PID ${state!.pid})` : 'stopped'}`,
  ];

  if (running && state?.browserName) {
    lines.push(`Active browser: ${state.browserName}${state.headless ? ' (headless)' : ' (headed)'}`);
  }

  if (launch.mode === 'persistent') {
    lines.push('Use "browse login-session headed" to log in manually, then "browse login-session headless" to reuse that session for automation.');
  } else if (fs.existsSync(launch.profileDir)) {
    lines.push('Saved login profile is still on disk. Run "browse login-session headed" to reopen it.');
  }

  console.log(lines.join('\n'));
}

async function handleLoginSessionCommand(args: string[]): Promise<void> {
  ensureStateDir(config);

  const subcommand = (args[0] || 'status').toLowerCase();
  const url = args.slice(1).join(' ').trim() || undefined;

  if (!['start', 'headed', 'headless', 'status', 'stop'].includes(subcommand)) {
    throw new Error(
      'Usage: browse login-session <start [url]|headed [url]|headless|status|stop>',
    );
  }

  if (subcommand === 'status') {
    printLoginSessionStatus(resolveLaunchConfig({}, config), readState());
    return;
  }

  if (subcommand === 'stop') {
    writeLaunchConfig(config, { mode: 'ephemeral', headless: true });
    const state = readState();
    if (state && isProcessAlive(state.pid)) {
      await killServer(state.pid);
    }
    console.log(`Persistent login session disabled.\nSaved profile kept at: ${config.persistentProfileDir}`);
    return;
  }

  const headless = subcommand === 'headless' ? true : false;
  const launch = writeLaunchConfig(config, {
    mode: 'persistent',
    headless,
  });
  const state = await ensureServer();

  if (url) {
    await sendCommand(state, 'newtab', [url]);
  }

  console.log(
    [
      `Persistent login session ready.`,
      `Mode: ${launch.headless ? 'headless' : 'headed'}`,
      `Profile: ${launch.profileDir}`,
      `Browser: ${state.browserName || launch.browser}`,
      launch.headless
        ? 'Codex will now reuse this saved profile for future browse commands.'
        : 'A real browser window should be open now. Sign in there once and the session will be saved.',
    ].join('\n'),
  );
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
    printCliHelp();
    process.exit(0);
  }

  cleanupLegacyState();

  const command = args[0];
  const commandArgs = args.slice(1);

  if (command === 'login-session') {
    await handleLoginSessionCommand(commandArgs);
    return;
  }

  if (command === 'chain' && commandArgs.length === 0) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.from(chunk));
    }
    const stdin = Buffer.concat(chunks).toString('utf8');
    commandArgs.push(stdin.trim());
  }

  const state = await ensureServer();
  await sendCommand(state, command, commandArgs);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`[browse] ${err.message}`);
    process.exit(1);
  });
}
