/**
 * gstack browse server — persistent Chromium daemon
 *
 * Architecture:
 *   Bun.serve HTTP on localhost → routes commands to Playwright
 *   Console/network/dialog buffers: CircularBuffer in-memory + async disk flush
 *   Chromium crash → server EXITS with clear error (CLI auto-restarts)
 *   Auto-shutdown after BROWSE_IDLE_TIMEOUT (default 30 min)
 *
 * State:
 *   State file: <project-root>/.gstack/browse.json (set via BROWSE_STATE_FILE env)
 *   Log files:  <project-root>/.gstack/browse-{console,network,dialog}.log
 *   Port:       random 10000-60000 (or BROWSE_PORT env for debug override)
 */

import { BrowserManager } from './browser-manager';
import { handleReadCommand } from './read-commands';
import { handleWriteCommand } from './write-commands';
import { handleMetaCommand } from './meta-commands';
import { handleCookiePickerRoute } from './cookie-picker-routes';
import { COMMAND_DESCRIPTIONS } from './commands';
import { SNAPSHOT_FLAGS } from './snapshot';
import { resolveConfig, ensureStateDir, readVersionHash } from './config';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { createServer as createNetServer } from 'net';
import { fileURLToPath } from 'url';

// ─── Config ─────────────────────────────────────────────────────
const config = resolveConfig();
ensureStateDir(config);
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

// ─── Auth ───────────────────────────────────────────────────────
const AUTH_TOKEN = crypto.randomUUID();
const BROWSE_PORT = parseInt(process.env.BROWSE_PORT || '0', 10);
const IDLE_TIMEOUT_MS = parseInt(process.env.BROWSE_IDLE_TIMEOUT || '1800000', 10); // 30 min

function validateAuth(req: Request): boolean {
  const header = req.headers.get('authorization');
  return header === `Bearer ${AUTH_TOKEN}`;
}

// ─── Help text (auto-generated from COMMAND_DESCRIPTIONS) ────────
function generateHelpText(): string {
  // Group commands by category
  const groups = new Map<string, string[]>();
  for (const [cmd, meta] of Object.entries(COMMAND_DESCRIPTIONS)) {
    const display = meta.usage || cmd;
    const list = groups.get(meta.category) || [];
    list.push(display);
    groups.set(meta.category, list);
  }

  const categoryOrder = [
    'Navigation', 'Reading', 'Interaction', 'Inspection',
    'Visual', 'Snapshot', 'Meta', 'Tabs', 'Server',
  ];

  const lines = ['gstack browse — headless browser for AI agents', '', 'Commands:'];
  for (const cat of categoryOrder) {
    const cmds = groups.get(cat);
    if (!cmds) continue;
    lines.push(`  ${(cat + ':').padEnd(15)}${cmds.join(', ')}`);
  }

  // Snapshot flags from source of truth
  lines.push('');
  lines.push('Snapshot flags:');
  const flagPairs: string[] = [];
  for (const flag of SNAPSHOT_FLAGS) {
    const label = flag.valueHint ? `${flag.short} ${flag.valueHint}` : flag.short;
    flagPairs.push(`${label}  ${flag.long}`);
  }
  // Print two flags per line for compact display
  for (let i = 0; i < flagPairs.length; i += 2) {
    const left = flagPairs[i].padEnd(28);
    const right = flagPairs[i + 1] || '';
    lines.push(`  ${left}${right}`);
  }

  return lines.join('\n');
}

// ─── Buffer (from buffers.ts) ────────────────────────────────────
import { consoleBuffer, networkBuffer, dialogBuffer, addConsoleEntry, addNetworkEntry, addDialogEntry, type LogEntry, type NetworkEntry, type DialogEntry } from './buffers';
export { consoleBuffer, networkBuffer, dialogBuffer, addConsoleEntry, addNetworkEntry, addDialogEntry, type LogEntry, type NetworkEntry, type DialogEntry };

const CONSOLE_LOG_PATH = config.consoleLog;
const NETWORK_LOG_PATH = config.networkLog;
const DIALOG_LOG_PATH = config.dialogLog;
let lastConsoleFlushed = 0;
let lastNetworkFlushed = 0;
let lastDialogFlushed = 0;
let flushInProgress = false;

async function flushBuffers() {
  if (flushInProgress) return; // Guard against concurrent flush
  flushInProgress = true;

  try {
    // Console buffer
    const newConsoleCount = consoleBuffer.totalAdded - lastConsoleFlushed;
    if (newConsoleCount > 0) {
      const entries = consoleBuffer.last(Math.min(newConsoleCount, consoleBuffer.length));
      const lines = entries.map(e =>
        `[${new Date(e.timestamp).toISOString()}] [${e.level}] ${e.text}`
      ).join('\n') + '\n';
      await fs.promises.appendFile(CONSOLE_LOG_PATH, lines, 'utf8');
      lastConsoleFlushed = consoleBuffer.totalAdded;
    }

    // Network buffer
    const newNetworkCount = networkBuffer.totalAdded - lastNetworkFlushed;
    if (newNetworkCount > 0) {
      const entries = networkBuffer.last(Math.min(newNetworkCount, networkBuffer.length));
      const lines = entries.map(e =>
        `[${new Date(e.timestamp).toISOString()}] ${e.method} ${e.url} → ${e.status || 'pending'} (${e.duration || '?'}ms, ${e.size || '?'}B)`
      ).join('\n') + '\n';
      await fs.promises.appendFile(NETWORK_LOG_PATH, lines, 'utf8');
      lastNetworkFlushed = networkBuffer.totalAdded;
    }

    // Dialog buffer
    const newDialogCount = dialogBuffer.totalAdded - lastDialogFlushed;
    if (newDialogCount > 0) {
      const entries = dialogBuffer.last(Math.min(newDialogCount, dialogBuffer.length));
      const lines = entries.map(e =>
        `[${new Date(e.timestamp).toISOString()}] [${e.type}] "${e.message}" → ${e.action}${e.response ? ` "${e.response}"` : ''}`
      ).join('\n') + '\n';
      await fs.promises.appendFile(DIALOG_LOG_PATH, lines, 'utf8');
      lastDialogFlushed = dialogBuffer.totalAdded;
    }
  } catch {
    // Flush failures are non-fatal — buffers are in memory
  } finally {
    flushInProgress = false;
  }
}

// Flush every 1 second
const flushInterval = setInterval(flushBuffers, 1000);

// ─── Idle Timer ────────────────────────────────────────────────
let lastActivity = Date.now();

function resetIdleTimer() {
  lastActivity = Date.now();
}

const idleCheckInterval = setInterval(() => {
  if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
    console.log(`[browse] Idle for ${IDLE_TIMEOUT_MS / 1000}s, shutting down`);
    shutdown();
  }
}, 60_000);

// ─── Command Sets (from commands.ts — single source of truth) ───
import { READ_COMMANDS, WRITE_COMMANDS, META_COMMANDS } from './commands';
export { READ_COMMANDS, WRITE_COMMANDS, META_COMMANDS };

// ─── Server ────────────────────────────────────────────────────
const browserManager = new BrowserManager();
let isShuttingDown = false;
let httpServer: ReturnType<typeof createServer> | null = null;

// Find port: explicit BROWSE_PORT, or random in 10000-60000
async function findPort(): Promise<number> {
  // Explicit port override (for debugging)
  if (BROWSE_PORT) {
    return assertPortAvailable(BROWSE_PORT);
  }

  // Random port with retry
  const MIN_PORT = 10000;
  const MAX_PORT = 60000;
  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const port = MIN_PORT + Math.floor(Math.random() * (MAX_PORT - MIN_PORT));
    try {
      return await assertPortAvailable(port);
    } catch {
      continue;
    }
  }
  throw new Error(`[browse] No available port after ${MAX_RETRIES} attempts in range ${MIN_PORT}-${MAX_PORT}`);
}

function assertPortAvailable(port: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const testServer = createNetServer();
    testServer.once('error', () => {
      testServer.close();
      reject(new Error(`[browse] Port ${port}${BROWSE_PORT ? ' (from BROWSE_PORT env)' : ''} is in use`));
    });
    testServer.listen(port, '127.0.0.1', () => {
      testServer.close((closeErr) => closeErr ? reject(closeErr) : resolve(port));
    });
  });
}

/**
 * Translate Playwright errors into actionable messages for AI agents.
 */
function wrapError(err: any): string {
  const msg = err.message || String(err);
  // Timeout errors
  if (err.name === 'TimeoutError' || msg.includes('Timeout') || msg.includes('timeout')) {
    if (msg.includes('locator.click') || msg.includes('locator.fill') || msg.includes('locator.hover')) {
      return `Element not found or not interactable within timeout. Check your selector or run 'snapshot' for fresh refs.`;
    }
    if (msg.includes('page.goto') || msg.includes('Navigation')) {
      return `Page navigation timed out. The URL may be unreachable or the page may be loading slowly.`;
    }
    return `Operation timed out: ${msg.split('\n')[0]}`;
  }
  // Multiple elements matched
  if (msg.includes('resolved to') && msg.includes('elements')) {
    return `Selector matched multiple elements. Be more specific or use @refs from 'snapshot'.`;
  }
  // Pass through other errors
  return msg;
}

async function handleCommand(body: any): Promise<Response> {
  const { command, args = [] } = body;

  if (!command) {
    return new Response(JSON.stringify({ error: 'Missing "command" field' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    let result: string;

    if (READ_COMMANDS.has(command)) {
      result = await handleReadCommand(command, args, browserManager);
    } else if (WRITE_COMMANDS.has(command)) {
      result = await handleWriteCommand(command, args, browserManager);
    } else if (META_COMMANDS.has(command)) {
      result = await handleMetaCommand(command, args, browserManager, shutdown);
    } else if (command === 'help') {
      const helpText = generateHelpText();
      return new Response(helpText, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    } else {
      return new Response(JSON.stringify({
        error: `Unknown command: ${command}`,
        hint: `Available commands: ${[...READ_COMMANDS, ...WRITE_COMMANDS, ...META_COMMANDS].sort().join(', ')}`,
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(result, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: wrapError(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log('[browse] Shutting down...');
  clearInterval(flushInterval);
  clearInterval(idleCheckInterval);
  await flushBuffers(); // Final flush (async now)

  if (httpServer) {
    await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    httpServer = null;
  }

  await browserManager.close();

  // Clean up state file
  try { fs.unlinkSync(config.stateFile); } catch {}

  process.exit(0);
}

// Handle signals
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

async function requestFromNode(req: IncomingMessage, port: number): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
  return new Request(`http://127.0.0.1:${port}${req.url || '/'}`, {
    method: req.method || 'GET',
    headers: req.headers as Record<string, string>,
    body: body && !['GET', 'HEAD'].includes(req.method || 'GET') ? body : undefined,
    duplex: 'half' as any,
  });
}

async function sendNodeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const payload = Buffer.from(await response.arrayBuffer());
  res.end(payload);
}

// ─── Start ─────────────────────────────────────────────────────
async function start() {
  // Clear old log files
  try { fs.unlinkSync(CONSOLE_LOG_PATH); } catch {}
  try { fs.unlinkSync(NETWORK_LOG_PATH); } catch {}
  try { fs.unlinkSync(DIALOG_LOG_PATH); } catch {}

  const port = await findPort();

  // Launch browser
  await browserManager.launch();

  const startTime = Date.now();
  httpServer = createServer(async (req, res) => {
    try {
      resetIdleTimer();
      const request = await requestFromNode(req, port);
      const url = new URL(request.url);
      let response: Response;

      if (url.pathname.startsWith('/cookie-picker')) {
        response = await handleCookiePickerRoute(url, request, browserManager);
      } else if (url.pathname === '/health') {
        const healthy = await browserManager.isHealthy();
        response = new Response(JSON.stringify({
          status: healthy ? 'healthy' : 'unhealthy',
          uptime: Math.floor((Date.now() - startTime) / 1000),
          tabs: browserManager.getTabCount(),
          currentUrl: browserManager.getCurrentUrl(),
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } else if (!validateAuth(request)) {
        response = new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      } else if (url.pathname === '/command' && req.method === 'POST') {
        const body = await request.json();
        response = await handleCommand(body);
        await sendNodeResponse(res, response);
        if (body.command === 'stop' || body.command === 'restart') {
          setTimeout(() => {
            void shutdown();
          }, 50);
        }
        return;
      } else {
        response = new Response('Not found', { status: 404 });
      }

      await sendNodeResponse(res, response);
    } catch (err: any) {
      const response = new Response(JSON.stringify({ error: err.message || 'Internal error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
      await sendNodeResponse(res, response);
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer!.once('error', reject);
    httpServer!.listen(port, '127.0.0.1', () => resolve());
  });

  // Write state file (atomic: write .tmp then rename)
  const launch = browserManager.getLaunchInfo();
  const state = {
    pid: process.pid,
    port,
    token: AUTH_TOKEN,
    startedAt: new Date().toISOString(),
    serverPath: path.resolve(MODULE_DIR, 'server.ts'),
    binaryVersion: readVersionHash() || undefined,
    launchMode: launch.mode,
    headless: launch.headless,
    browser: launch.browser,
    browserName: launch.browserName,
    profileDir: launch.profileDir || undefined,
  };
  const tmpFile = config.stateFile + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmpFile, config.stateFile);

  browserManager.serverPort = port;
  console.log(`[browse] Server running on http://127.0.0.1:${port} (PID: ${process.pid})`);
  console.log(`[browse] State file: ${config.stateFile}`);
  console.log(`[browse] Idle timeout: ${IDLE_TIMEOUT_MS / 1000}s`);
}

start().catch((err) => {
  console.error(`[browse] Failed to start: ${err.message}`);
  process.exit(1);
});
