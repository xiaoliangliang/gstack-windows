/**
 * Chromium browser cookie import — read and decrypt cookies from real browsers.
 *
 * macOS:
 *   Chromium cookies are decrypted from the SQLite DB via Keychain + PBKDF2.
 *
 * Windows:
 *   We can read plaintext domains from the SQLite DB and import cookies from
 *   legacy Chromium profiles that still use the Local State `encrypted_key`.
 *   Modern Chrome / Edge default profiles often use app-bound encryption
 *   (`app_bound_encrypted_key`). Those cookies cannot be exported from outside
 *   the real browser process in a reliable way, so we detect that case and
 *   fail with a clear, actionable message instead of a generic unsupported
 *   error.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, spawnSync } from 'child_process';
import { getTempRoot } from './path-utils';

// ─── Types ──────────────────────────────────────────────────────

export interface BrowserInfo {
  name: string;
  aliases: string[];
  mac?: {
    dataDir: string; // relative to ~/Library/Application Support/
    keychainService: string;
  };
  win?: {
    userDataDir: string; // relative to %LOCALAPPDATA%
  };
}

export interface DomainEntry {
  domain: string;
  count: number;
}

export interface ImportResult {
  cookies: PlaywrightCookie[];
  count: number;
  failed: number;
  domainCounts: Record<string, number>;
}

export interface PlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  secure: boolean;
  httpOnly: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

export class CookieImportError extends Error {
  constructor(
    message: string,
    public code: string,
    public action?: 'retry',
  ) {
    super(message);
    this.name = 'CookieImportError';
  }
}

interface RawCookie {
  host_key: string;
  name: string;
  value: string;
  encrypted_value: Buffer | Uint8Array;
  path: string;
  expires_utc: string | number | bigint;
  is_secure: number;
  is_httponly: number;
  has_expires: number;
  samesite: number;
}

interface CookieExpiryRow {
  host_key: string;
  expires_utc: string | number | bigint;
  has_expires: number;
}

interface DbAdapter {
  all(sql: string, params?: unknown[]): any[];
  close(): void;
}

interface WindowsLocalState {
  os_crypt?: {
    encrypted_key?: string;
    app_bound_encrypted_key?: string;
  };
}

// ─── Browser Registry ───────────────────────────────────────────

const BROWSER_REGISTRY: BrowserInfo[] = [
  {
    name: 'Comet',
    aliases: ['comet', 'perplexity'],
    mac: {
      dataDir: 'Comet/',
      keychainService: 'Comet Safe Storage',
    },
  },
  {
    name: 'Chrome',
    aliases: ['chrome', 'google-chrome'],
    mac: {
      dataDir: 'Google/Chrome/',
      keychainService: 'Chrome Safe Storage',
    },
    win: {
      userDataDir: 'Google/Chrome/User Data',
    },
  },
  {
    name: 'Arc',
    aliases: ['arc'],
    mac: {
      dataDir: 'Arc/User Data/',
      keychainService: 'Arc Safe Storage',
    },
  },
  {
    name: 'Brave',
    aliases: ['brave'],
    mac: {
      dataDir: 'BraveSoftware/Brave-Browser/',
      keychainService: 'Brave Safe Storage',
    },
    win: {
      userDataDir: 'BraveSoftware/Brave-Browser/User Data',
    },
  },
  {
    name: 'Edge',
    aliases: ['edge'],
    mac: {
      dataDir: 'Microsoft Edge/',
      keychainService: 'Microsoft Edge Safe Storage',
    },
    win: {
      userDataDir: 'Microsoft/Edge/User Data',
    },
  },
];

// ─── Runtime state ──────────────────────────────────────────────

const keyCache = new Map<string, Buffer>();
let BunDatabase: any = null;
let NodeDatabaseSync: any = null;

if (process.platform === 'win32') {
  try {
    ({ DatabaseSync: NodeDatabaseSync } = await import('node:sqlite'));
  } catch {
    NodeDatabaseSync = null;
  }
} else {
  ({ Database: BunDatabase } = await import('bun:sqlite'));
}

// ─── Public API ─────────────────────────────────────────────────

export function findInstalledBrowsers(): BrowserInfo[] {
  if (process.platform === 'win32') {
    return BROWSER_REGISTRY.filter((browser) => {
      if (!browser.win) return false;
      try {
        return fs.existsSync(getWindowsCookieDbPath(browser, 'Default'));
      } catch {
        return false;
      }
    });
  }

  const appSupport = path.join(os.homedir(), 'Library', 'Application Support');
  return BROWSER_REGISTRY.filter((browser) => {
    if (!browser.mac) return false;
    const dbPath = path.join(appSupport, browser.mac.dataDir, 'Default', 'Cookies');
    try {
      return fs.existsSync(dbPath);
    } catch {
      return false;
    }
  });
}

export function listDomains(
  browserName: string,
  profile = 'Default',
): { domains: DomainEntry[]; browser: string } {
  assertSupportedPlatform();
  const browser = resolveBrowser(browserName);
  const db = openDb(getCookieDbPath(browser, profile), browser.name);

  try {
    const now = chromiumNow();
    const rows = db.all(
      `SELECT host_key, CAST(expires_utc AS TEXT) AS expires_utc, has_expires
       FROM cookies
       ORDER BY host_key`
    ) as CookieExpiryRow[];

    const counts = new Map<string, number>();
    for (const row of rows) {
      if (isExpired(row.expires_utc, row.has_expires, now)) continue;
      counts.set(row.host_key, (counts.get(row.host_key) || 0) + 1);
    }

    const domains = [...counts.entries()]
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));

    return { domains, browser: browser.name };
  } finally {
    db.close();
  }
}

export async function importCookies(
  browserName: string,
  domains: string[],
  profile = 'Default',
): Promise<ImportResult> {
  assertSupportedPlatform();
  if (domains.length === 0) {
    return { cookies: [], count: 0, failed: 0, domainCounts: {} };
  }

  const browser = resolveBrowser(browserName);
  return process.platform === 'win32'
    ? importCookiesWindows(browser, domains, profile)
    : importCookiesMac(browser, domains, profile);
}

// ─── Shared: Browser Resolution ────────────────────────────────

function assertSupportedPlatform(): void {
  if (process.platform === 'win32') {
    if (!NodeDatabaseSync) {
      throw new CookieImportError(
        'Windows browser cookie import needs Node SQLite support. Rebuild gstack browse with the Windows Node wrapper that enables --experimental-sqlite.',
        'unsupported_runtime',
      );
    }
    return;
  }

  if (!BunDatabase) {
    throw new CookieImportError(
      'bun:sqlite is unavailable in this runtime. Use the Bun runtime on macOS for browser cookie import.',
      'unsupported_runtime',
    );
  }
}

function resolveBrowser(nameOrAlias: string): BrowserInfo {
  const needle = nameOrAlias.toLowerCase().trim();
  const found = BROWSER_REGISTRY.find((browser) =>
    browser.aliases.includes(needle) || browser.name.toLowerCase() === needle
  );

  if (!found) {
    const supported = BROWSER_REGISTRY.flatMap((browser) => browser.aliases).join(', ');
    throw new CookieImportError(
      `Unknown browser '${nameOrAlias}'. Supported: ${supported}`,
      'unknown_browser',
    );
  }

  if (process.platform === 'win32' && !found.win) {
    throw new CookieImportError(
      `${found.name} cookie import is not implemented on Windows in gstack.`,
      'unsupported_platform',
    );
  }

  if (process.platform !== 'win32' && !found.mac) {
    throw new CookieImportError(
      `${found.name} cookie import is not implemented on this platform in gstack.`,
      'unsupported_platform',
    );
  }

  return found;
}

function validateProfile(profile: string): void {
  if (/[/\\]|\.\./.test(profile) || /[\x00-\x1f]/.test(profile)) {
    throw new CookieImportError(
      `Invalid profile name: '${profile}'`,
      'bad_request',
    );
  }
}

function getCookieDbPath(browser: BrowserInfo, profile: string): string {
  validateProfile(profile);

  const dbPath = process.platform === 'win32'
    ? getWindowsCookieDbPath(browser, profile)
    : getMacCookieDbPath(browser, profile);

  if (!fs.existsSync(dbPath)) {
    throw new CookieImportError(
      `${browser.name} is not installed (no cookie database at ${dbPath})`,
      'not_installed',
    );
  }

  return dbPath;
}

function getMacCookieDbPath(browser: BrowserInfo, profile: string): string {
  const appSupport = path.join(os.homedir(), 'Library', 'Application Support');
  return path.join(appSupport, browser.mac!.dataDir, profile, 'Cookies');
}

function getWindowsCookieDbPath(browser: BrowserInfo, profile: string): string {
  const userDataRoot = getWindowsUserDataRoot(browser);
  const networkPath = path.join(userDataRoot, profile, 'Network', 'Cookies');
  if (fs.existsSync(networkPath)) return networkPath;
  return path.join(userDataRoot, profile, 'Cookies');
}

function getWindowsUserDataRoot(browser: BrowserInfo): string {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, browser.win!.userDataDir);
}

// ─── Shared: SQLite Access ─────────────────────────────────────

function openDb(dbPath: string, browserName: string): DbAdapter {
  if (process.platform === 'win32') {
    return openNodeDb(dbPath, browserName);
  }
  return openBunDb(dbPath, browserName);
}

function openBunDb(dbPath: string, browserName: string): DbAdapter {
  try {
    const db = new BunDatabase(dbPath, { readonly: true });
    return {
      all(sql: string, params: unknown[] = []) {
        return db.query(sql).all(...params);
      },
      close() {
        db.close();
      },
    };
  } catch (err: any) {
    if (isDbLockError(err)) return openBunDbFromCopy(dbPath, browserName);
    if (isDbCorruptError(err)) {
      throw new CookieImportError(
        `Cookie database for ${browserName} is corrupt`,
        'db_corrupt',
      );
    }
    throw err;
  }
}

function openBunDbFromCopy(dbPath: string, browserName: string): DbAdapter {
  const tmpPath = makeTempDbPath(browserName);

  try {
    copyDbWithSidecars(dbPath, tmpPath);
    const db = new BunDatabase(tmpPath, { readonly: true });
    return {
      all(sql: string, params: unknown[] = []) {
        return db.query(sql).all(...params);
      },
      close() {
        try {
          db.close();
        } finally {
          cleanupTempDb(tmpPath);
        }
      },
    };
  } catch {
    cleanupTempDb(tmpPath);
    throw new CookieImportError(
      `Cookie database is locked (${browserName} may be running). Try closing ${browserName} first.`,
      'db_locked',
      'retry',
    );
  }
}

function openNodeDb(dbPath: string, browserName: string): DbAdapter {
  try {
    const db = new NodeDatabaseSync(dbPath, { readOnly: true });
    return {
      all(sql: string, params: unknown[] = []) {
        return db.prepare(sql).all(...params);
      },
      close() {
        db.close();
      },
    };
  } catch (err: any) {
    if (isDbLockError(err)) return openNodeDbFromCopy(dbPath, browserName);
    if (isDbCorruptError(err)) {
      throw new CookieImportError(
        `Cookie database for ${browserName} is corrupt`,
        'db_corrupt',
      );
    }
    throw err;
  }
}

function openNodeDbFromCopy(dbPath: string, browserName: string): DbAdapter {
  const tmpPath = makeTempDbPath(browserName);

  try {
    copyDbWithSidecars(dbPath, tmpPath);
    const db = new NodeDatabaseSync(tmpPath, { readOnly: true });
    return {
      all(sql: string, params: unknown[] = []) {
        return db.prepare(sql).all(...params);
      },
      close() {
        try {
          db.close();
        } finally {
          cleanupTempDb(tmpPath);
        }
      },
    };
  } catch {
    cleanupTempDb(tmpPath);
    throw new CookieImportError(
      `Cookie database is locked (${browserName} may be running). Try closing ${browserName} first.`,
      'db_locked',
      'retry',
    );
  }
}

function isDbLockError(err: any): boolean {
  const message = String(err?.message || '').toLowerCase();
  return (
    message.includes('sqlite_busy') ||
    message.includes('database is locked') ||
    message.includes('unable to open database file') ||
    message.includes('access is denied') ||
    message.includes('permission denied')
  );
}

function isDbCorruptError(err: any): boolean {
  const message = String(err?.message || '').toLowerCase();
  return message.includes('sqlite_corrupt') || message.includes('malformed');
}

function makeTempDbPath(browserName: string): string {
  const tempRoot = getTempRoot();
  fs.mkdirSync(tempRoot, { recursive: true });
  return path.join(
    tempRoot,
    `browse-cookies-${browserName.toLowerCase()}-${crypto.randomUUID()}.db`
  );
}

function copyDbWithSidecars(sourcePath: string, targetPath: string): void {
  fs.copyFileSync(sourcePath, targetPath);
  const walPath = sourcePath + '-wal';
  const shmPath = sourcePath + '-shm';
  if (fs.existsSync(walPath)) fs.copyFileSync(walPath, targetPath + '-wal');
  if (fs.existsSync(shmPath)) fs.copyFileSync(shmPath, targetPath + '-shm');
}

function cleanupTempDb(tmpPath: string): void {
  try { fs.unlinkSync(tmpPath); } catch {}
  try { fs.unlinkSync(tmpPath + '-wal'); } catch {}
  try { fs.unlinkSync(tmpPath + '-shm'); } catch {}
}

// ─── macOS Import ───────────────────────────────────────────────

async function importCookiesMac(
  browser: BrowserInfo,
  domains: string[],
  profile: string,
): Promise<ImportResult> {
  const derivedKey = await getMacDerivedKey(browser);
  const db = openDb(getCookieDbPath(browser, profile), browser.name);

  try {
    const now = chromiumNow();
    const placeholders = domains.map(() => '?').join(',');
    const rows = db.all(
      `SELECT host_key, name, value, encrypted_value, path,
              CAST(expires_utc AS TEXT) AS expires_utc,
              is_secure, is_httponly, has_expires, samesite
       FROM cookies
       WHERE host_key IN (${placeholders})`,
      domains,
    ) as RawCookie[];

    const cookies: PlaywrightCookie[] = [];
    let failed = 0;
    const domainCounts: Record<string, number> = {};

    for (const row of rows) {
      if (isExpired(row.expires_utc, row.has_expires, now)) continue;
      try {
        const value = decryptMacCookieValue(row, derivedKey);
        const cookie = toPlaywrightCookie(row, value);
        cookies.push(cookie);
        domainCounts[row.host_key] = (domainCounts[row.host_key] || 0) + 1;
      } catch {
        failed++;
      }
    }

    return { cookies, count: cookies.length, failed, domainCounts };
  } finally {
    db.close();
  }
}

async function getMacDerivedKey(browser: BrowserInfo): Promise<Buffer> {
  const cacheKey = `mac:${browser.name}`;
  const cached = keyCache.get(cacheKey);
  if (cached) return cached;

  const password = await getKeychainPassword(browser.mac!.keychainService);
  const derived = crypto.pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
  keyCache.set(cacheKey, derived);
  return derived;
}

async function getKeychainPassword(service: string): Promise<string> {
  const proc = spawn(
    'security',
    ['find-generic-password', '-s', service, '-w'],
    { shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => {
      proc.kill();
      reject(new CookieImportError(
        `macOS is waiting for Keychain permission. Look for a dialog asking to allow access to "${service}".`,
        'keychain_timeout',
        'retry',
      ));
    }, 10_000),
  );

  try {
    const [exitCode, stdout, stderr] = await Promise.race([
      new Promise<[number | null, string, string]>((resolve) => {
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        proc.stdout?.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
        proc.stderr?.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));
        proc.on('close', (code) => {
          resolve([
            code,
            Buffer.concat(stdoutChunks).toString('utf-8'),
            Buffer.concat(stderrChunks).toString('utf-8'),
          ]);
        });
      }),
      timeout,
    ]);

    if (exitCode !== 0) {
      const errText = stderr.trim().toLowerCase();
      if (errText.includes('user canceled') || errText.includes('denied') || errText.includes('interaction not allowed')) {
        throw new CookieImportError(
          `Keychain access denied. Click "Allow" in the macOS dialog for "${service}".`,
          'keychain_denied',
          'retry',
        );
      }
      if (errText.includes('could not be found') || errText.includes('not found')) {
        throw new CookieImportError(
          `No Keychain entry for "${service}". Is this a Chromium-based browser?`,
          'keychain_not_found',
        );
      }
      throw new CookieImportError(
        `Could not read Keychain: ${stderr.trim()}`,
        'keychain_error',
        'retry',
      );
    }

    return stdout.trim();
  } catch (err) {
    if (err instanceof CookieImportError) throw err;
    throw new CookieImportError(
      `Could not read Keychain: ${(err as Error).message}`,
      'keychain_error',
      'retry',
    );
  }
}

function decryptMacCookieValue(row: RawCookie, key: Buffer): string {
  if (row.value && row.value.length > 0) return row.value;

  const ev = Buffer.from(row.encrypted_value);
  if (ev.length === 0) return '';

  const prefix = ev.subarray(0, 3).toString('utf-8');
  if (prefix !== 'v10') {
    throw new Error(`Unknown encryption prefix: ${prefix}`);
  }

  const ciphertext = ev.subarray(3);
  const iv = Buffer.alloc(16, 0x20);
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  if (plaintext.length <= 32) return '';
  return plaintext.subarray(32).toString('utf-8');
}

// ─── Windows Import ─────────────────────────────────────────────

async function importCookiesWindows(
  browser: BrowserInfo,
  domains: string[],
  profile: string,
): Promise<ImportResult> {
  const localState = readWindowsLocalState(browser);
  const legacyKey = await getWindowsLegacyKey(browser, localState);
  const hasAppBoundKey = Boolean(localState.os_crypt?.app_bound_encrypted_key);
  const db = openDb(getCookieDbPath(browser, profile), browser.name);

  try {
    const placeholders = domains.map(() => '?').join(',');
    const rows = db.all(
      `SELECT host_key, name, value, encrypted_value, path,
              CAST(expires_utc AS TEXT) AS expires_utc,
              is_secure, is_httponly, has_expires, samesite
       FROM cookies
       WHERE host_key IN (${placeholders})
       ORDER BY host_key, name`,
      domains,
    ) as RawCookie[];

    const now = chromiumNow();
    const cookies: PlaywrightCookie[] = [];
    let failed = 0;
    let appBoundBlocked = false;
    const domainCounts: Record<string, number> = {};

    for (const row of rows) {
      if (isExpired(row.expires_utc, row.has_expires, now)) continue;

      try {
        const value = decryptWindowsCookieValue(row, legacyKey);
        const cookie = toPlaywrightCookie(row, value);
        cookies.push(cookie);
        domainCounts[row.host_key] = (domainCounts[row.host_key] || 0) + 1;
      } catch (err: any) {
        if (err?.code === 'app_bound_cookie') {
          appBoundBlocked = true;
        }
        failed++;
      }
    }

    if (cookies.length === 0 && hasAppBoundKey && appBoundBlocked) {
      throw new CookieImportError(
        `${browser.name} on Windows is using app-bound cookie encryption for this profile. gstack can list domains from the cookie DB, but it cannot automatically export those login cookies from outside the real browser process. Use a non-default / legacy Chromium profile, or sign into the gstack browse session manually.`,
        'app_bound_encryption_unsupported',
      );
    }

    return { cookies, count: cookies.length, failed, domainCounts };
  } finally {
    db.close();
  }
}

function readWindowsLocalState(browser: BrowserInfo): WindowsLocalState {
  const statePath = path.join(getWindowsUserDataRoot(browser), 'Local State');
  if (!fs.existsSync(statePath)) {
    throw new CookieImportError(
      `Missing Local State file for ${browser.name} at ${statePath}`,
      'not_installed',
    );
  }

  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  } catch (err: any) {
    throw new CookieImportError(
      `Could not parse Local State for ${browser.name}: ${err.message}`,
      'bad_state',
    );
  }
}

async function getWindowsLegacyKey(
  browser: BrowserInfo,
  localState: WindowsLocalState,
): Promise<Buffer | null> {
  const cacheKey = `win:${browser.name}:legacy`;
  const cached = keyCache.get(cacheKey);
  if (cached) return cached;

  const b64 = localState.os_crypt?.encrypted_key;
  if (!b64) return null;

  let raw: Buffer;
  try {
    raw = Buffer.from(b64, 'base64');
  } catch {
    return null;
  }

  const prefix = raw.subarray(0, 5).toString('utf-8');
  if (prefix !== 'DPAPI') return null;

  const decrypted = await windowsCurrentUserDpapiUnprotect(raw.subarray(5));
  keyCache.set(cacheKey, decrypted);
  return decrypted;
}

function decryptWindowsCookieValue(row: RawCookie, key: Buffer | null): string {
  if (row.value && row.value.length > 0) return row.value;

  const ev = Buffer.from(row.encrypted_value);
  if (ev.length === 0) return '';

  const prefix = ev.subarray(0, 3).toString('utf-8');
  if (prefix === 'v20') {
    const err: any = new Error('Cookie is protected by app-bound encryption');
    err.code = 'app_bound_cookie';
    throw err;
  }

  if ((prefix === 'v10' || prefix === 'v11') && key) {
    return decryptWindowsAesCookieValue(ev, key);
  }

  throw new Error(`Unsupported Windows cookie encryption prefix: ${prefix}`);
}

function decryptWindowsAesCookieValue(encryptedValue: Buffer, key: Buffer): string {
  const nonce = encryptedValue.subarray(3, 15);
  const ciphertext = encryptedValue.subarray(15, encryptedValue.length - 16);
  const authTag = encryptedValue.subarray(encryptedValue.length - 16);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf-8');
}

async function windowsCurrentUserDpapiUnprotect(blob: Buffer): Promise<Buffer> {
  const ps = findPowerShellExecutable();
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.Security',
    '$raw = [Convert]::FromBase64String($env:GSTACK_DPAPI_B64)',
    '$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($raw, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[Console]::Out.Write([Convert]::ToBase64String($plain))',
  ].join('; ');

  const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');

  const proc = spawn(
    ps,
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand],
    {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GSTACK_DPAPI_B64: blob.toString('base64') },
      windowsHide: true,
    },
  );

  const [exitCode, stdout, stderr] = await new Promise<[number | null, string, string]>((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    proc.stdout?.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    proc.stderr?.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));
    proc.on('close', (code) => {
      resolve([
        code,
        Buffer.concat(stdoutChunks).toString('utf-8'),
        Buffer.concat(stderrChunks).toString('utf-8'),
      ]);
    });
  });

  if (exitCode !== 0) {
    throw new CookieImportError(
      `Could not decrypt Windows browser key: ${stderr.trim() || 'PowerShell DPAPI call failed'}`,
      'dpapi_error',
    );
  }

  try {
    return Buffer.from(stdout.trim(), 'base64');
  } catch {
    throw new CookieImportError(
      'Could not decode Windows browser key returned by DPAPI helper.',
      'dpapi_error',
    );
  }
}

function findPowerShellExecutable(): string {
  const wherePwsh = spawnSync('where.exe', ['pwsh.exe'], {
    shell: false,
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
    encoding: 'utf8',
  });
  if (wherePwsh.status === 0 && wherePwsh.stdout.trim()) {
    return wherePwsh.stdout.trim().split(/\r?\n/)[0];
  }

  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const legacyPowerShell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (fs.existsSync(legacyPowerShell)) return legacyPowerShell;
  return 'powershell.exe';
}

// ─── Shared: Cookie Mapping ────────────────────────────────────

function toPlaywrightCookie(row: RawCookie, value: string): PlaywrightCookie {
  return {
    name: row.name,
    value,
    domain: row.host_key,
    path: row.path || '/',
    expires: chromiumEpochToUnix(row.expires_utc, row.has_expires),
    secure: row.is_secure === 1,
    httpOnly: row.is_httponly === 1,
    sameSite: mapSameSite(row.samesite),
  };
}

const CHROMIUM_EPOCH_OFFSET = 11644473600000000n;

function chromiumNow(): bigint {
  return BigInt(Date.now()) * 1000n + CHROMIUM_EPOCH_OFFSET;
}

function chromiumEpochToUnix(epoch: string | number | bigint, hasExpires: number): number {
  if (hasExpires === 0 || epoch === 0 || epoch === 0n || epoch === '0') return -1;
  const epochBig = BigInt(epoch);
  const unixMicro = epochBig - CHROMIUM_EPOCH_OFFSET;
  return Number(unixMicro / 1000000n);
}

function isExpired(epoch: string | number | bigint, hasExpires: number, now: bigint): boolean {
  if (hasExpires === 0) return false;
  const epochBig = BigInt(epoch);
  return epochBig !== 0n && epochBig <= now;
}

function mapSameSite(value: number): 'Strict' | 'Lax' | 'None' {
  switch (value) {
    case 0: return 'None';
    case 1: return 'Lax';
    case 2: return 'Strict';
    default: return 'Lax';
  }
}
