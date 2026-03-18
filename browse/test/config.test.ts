import { afterEach, describe, expect, test } from 'bun:test';
import {
  resolveConfig,
  ensureStateDir,
  readVersionHash,
  getGitRoot,
  getRemoteSlug,
  resolveLaunchConfig,
  writeLaunchConfig,
} from '../src/config';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function rememberTempDir(dir: string): string {
  tempDirs.push(dir);
  return dir;
}

function makeConfig() {
  const root = rememberTempDir(fs.mkdtempSync(path.join(os.tmpdir(), 'browse-config-')));
  const stateFile = path.join(root, '.gstack', 'browse.json');
  const config = resolveConfig({ BROWSE_STATE_FILE: stateFile });
  ensureStateDir(config);
  return config;
}

describe('config', () => {
  describe('getGitRoot', () => {
    test('returns a path when in a git repo', () => {
      const root = getGitRoot();
      expect(root).not.toBeNull();
      expect(fs.existsSync(path.join(root!, '.git'))).toBe(true);
    });
  });

  describe('resolveConfig', () => {
    test('uses git root by default', () => {
      const config = resolveConfig({});
      const gitRoot = getGitRoot();
      expect(gitRoot).not.toBeNull();
      expect(config.projectDir).toBe(gitRoot);
      expect(config.stateDir).toBe(path.join(gitRoot!, '.gstack'));
      expect(config.stateFile).toBe(path.join(gitRoot!, '.gstack', 'browse.json'));
    });

    test('derives paths from BROWSE_STATE_FILE when set', () => {
      const stateFile = '/tmp/test-config/.gstack/browse.json';
      const config = resolveConfig({ BROWSE_STATE_FILE: stateFile });
      expect(config.stateFile).toBe(stateFile);
      expect(config.stateDir).toBe('/tmp/test-config/.gstack');
      expect(config.projectDir).toBe('/tmp/test-config');
    });

    test('log paths are in stateDir', () => {
      const config = resolveConfig({});
      expect(config.consoleLog).toBe(path.join(config.stateDir, 'browse-console.log'));
      expect(config.networkLog).toBe(path.join(config.stateDir, 'browse-network.log'));
      expect(config.dialogLog).toBe(path.join(config.stateDir, 'browse-dialog.log'));
    });

    test('derives login-session paths from the state file', () => {
      const config = makeConfig();
      expect(config.launchConfigFile).toBe(path.join(config.stateDir, 'browse-launch.json'));
      expect(config.persistentProfileDir).toBe(path.join(config.stateDir, 'chrome-profile'));
    });
  });

  describe('ensureStateDir', () => {
    test('creates directory if it does not exist', () => {
      const tmpDir = rememberTempDir(path.join(os.tmpdir(), `browse-config-test-${Date.now()}`));
      const config = resolveConfig({ BROWSE_STATE_FILE: path.join(tmpDir, '.gstack', 'browse.json') });
      expect(fs.existsSync(config.stateDir)).toBe(false);
      ensureStateDir(config);
      expect(fs.existsSync(config.stateDir)).toBe(true);
    });

    test('is a no-op if directory already exists', () => {
      const tmpDir = rememberTempDir(path.join(os.tmpdir(), `browse-config-test-${Date.now()}`));
      const stateDir = path.join(tmpDir, '.gstack');
      fs.mkdirSync(stateDir, { recursive: true });
      const config = resolveConfig({ BROWSE_STATE_FILE: path.join(stateDir, 'browse.json') });
      ensureStateDir(config);
      expect(fs.existsSync(config.stateDir)).toBe(true);
    });

    test('adds .gstack/ to .gitignore if not present', () => {
      const tmpDir = rememberTempDir(path.join(os.tmpdir(), `browse-gitignore-test-${Date.now()}`));
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules/\n');
      const config = resolveConfig({ BROWSE_STATE_FILE: path.join(tmpDir, '.gstack', 'browse.json') });
      ensureStateDir(config);
      const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
      expect(content).toContain('.gstack/');
      expect(content).toBe('node_modules/\n.gstack/\n');
    });

    test('does not duplicate .gstack/ in .gitignore', () => {
      const tmpDir = rememberTempDir(path.join(os.tmpdir(), `browse-gitignore-test-${Date.now()}`));
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules/\n.gstack/\n');
      const config = resolveConfig({ BROWSE_STATE_FILE: path.join(tmpDir, '.gstack', 'browse.json') });
      ensureStateDir(config);
      const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
      expect(content).toBe('node_modules/\n.gstack/\n');
    });

    test('handles .gitignore without trailing newline', () => {
      const tmpDir = rememberTempDir(path.join(os.tmpdir(), `browse-gitignore-test-${Date.now()}`));
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules');
      const config = resolveConfig({ BROWSE_STATE_FILE: path.join(tmpDir, '.gstack', 'browse.json') });
      ensureStateDir(config);
      const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
      expect(content).toBe('node_modules\n.gstack/\n');
    });

    test('logs warning to browse-server.log on non-ENOENT gitignore error', () => {
      const tmpDir = rememberTempDir(path.join(os.tmpdir(), `browse-gitignore-test-${Date.now()}`));
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules/\n');
      fs.chmodSync(path.join(tmpDir, '.gitignore'), 0o444);
      const config = resolveConfig({ BROWSE_STATE_FILE: path.join(tmpDir, '.gstack', 'browse.json') });
      ensureStateDir(config);
      const logPath = path.join(config.stateDir, 'browse-server.log');
      expect(fs.existsSync(logPath)).toBe(true);
      const logContent = fs.readFileSync(logPath, 'utf-8');
      expect(logContent).toContain('Warning: could not update .gitignore');
      const gitignoreContent = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf-8');
      expect(gitignoreContent).toBe('node_modules/\n');
      fs.chmodSync(path.join(tmpDir, '.gitignore'), 0o644);
    });

    test('skips if no .gitignore exists', () => {
      const tmpDir = rememberTempDir(path.join(os.tmpdir(), `browse-gitignore-test-${Date.now()}`));
      fs.mkdirSync(tmpDir, { recursive: true });
      const config = resolveConfig({ BROWSE_STATE_FILE: path.join(tmpDir, '.gstack', 'browse.json') });
      ensureStateDir(config);
      expect(fs.existsSync(path.join(tmpDir, '.gitignore'))).toBe(false);
    });
  });

  describe('getRemoteSlug', () => {
    test('returns owner-repo format for current repo', () => {
      const slug = getRemoteSlug();
      expect(slug).toBeTruthy();
      expect(slug).toMatch(/^[a-zA-Z0-9._-]+-[a-zA-Z0-9._-]+$/);
    });

    test('parses SSH remote URLs', () => {
      const url = 'git@github.com:garrytan/gstack.git';
      const match = url.match(/[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
      expect(match).not.toBeNull();
      expect(`${match![1]}-${match![2]}`).toBe('garrytan-gstack');
    });

    test('parses HTTPS remote URLs', () => {
      const url = 'https://github.com/garrytan/gstack.git';
      const match = url.match(/[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
      expect(match).not.toBeNull();
      expect(`${match![1]}-${match![2]}`).toBe('garrytan-gstack');
    });

    test('parses HTTPS remote URLs without .git suffix', () => {
      const url = 'https://github.com/garrytan/gstack';
      const match = url.match(/[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
      expect(match).not.toBeNull();
      expect(`${match![1]}-${match![2]}`).toBe('garrytan-gstack');
    });
  });

  describe('readVersionHash', () => {
    test('returns null when .version file does not exist', () => {
      const result = readVersionHash('/nonexistent/path/browse');
      expect(result).toBeNull();
    });

    test('reads version from .version file adjacent to execPath', () => {
      const tmpDir = rememberTempDir(path.join(os.tmpdir(), `browse-version-test-${Date.now()}`));
      fs.mkdirSync(tmpDir, { recursive: true });
      const versionFile = path.join(tmpDir, '.version');
      fs.writeFileSync(versionFile, 'abc123def\n');
      const result = readVersionHash(path.join(tmpDir, 'browse'));
      expect(result).toBe('abc123def');
    });
  });
});

describe('resolveServerScript', () => {
  const { resolveServerScript } = require('../src/cli');

  test('uses BROWSE_SERVER_SCRIPT env when set', () => {
    const result = resolveServerScript({ BROWSE_SERVER_SCRIPT: '/custom/server.ts' }, '', '');
    expect(result).toBe('/custom/server.ts');
  });

  test('finds server.ts adjacent to cli.ts in dev mode', () => {
    const srcDir = path.resolve(__dirname, '../src');
    const result = resolveServerScript({}, srcDir, '');
    expect(result).toBe(path.join(srcDir, 'server.ts'));
  });

  test('throws when server.ts cannot be found', () => {
    expect(() => resolveServerScript({}, '/nonexistent/$bunfs', '/nonexistent/browse')).toThrow(
      'Cannot find server.ts',
    );
  });
});

describe('version mismatch detection', () => {
  test('detects when versions differ', () => {
    const stateVersion = 'abc123';
    const currentVersion = 'def456';
    expect(stateVersion !== currentVersion).toBe(true);
  });

  test('no mismatch when versions match', () => {
    const stateVersion = 'abc123';
    const currentVersion = 'abc123';
    expect(stateVersion !== currentVersion).toBe(false);
  });

  test('no mismatch when either version is null', () => {
    const currentVersion: string | null = null;
    const stateVersion: string | undefined = 'abc123';
    const shouldRestart =
      currentVersion !== null && stateVersion !== undefined && currentVersion !== stateVersion;
    expect(shouldRestart).toBe(false);
  });
});

describe('browse launch config', () => {
  test('writeLaunchConfig persists the login-session mode', () => {
    const config = makeConfig();

    const written = writeLaunchConfig(config, {
      mode: 'persistent',
      headless: false,
      browser: 'edge',
    });

    expect(written.mode).toBe('persistent');
    expect(written.headless).toBe(false);
    expect(written.browser).toBe('edge');

    const resolved = resolveLaunchConfig({}, config);
    expect(resolved.mode).toBe('persistent');
    expect(resolved.headless).toBe(false);
    expect(resolved.browser).toBe('edge');
    expect(resolved.profileDir).toBe(config.persistentProfileDir);
  });

  test('environment overrides stored launch config', () => {
    const config = makeConfig();

    writeLaunchConfig(config, {
      mode: 'persistent',
      headless: false,
      browser: 'chrome',
    });

    const overridden = resolveLaunchConfig(
      {
        BROWSE_SESSION_MODE: 'ephemeral',
        BROWSE_HEADLESS: 'true',
        BROWSE_BROWSER: 'edge',
      },
      config,
    );

    expect(overridden.mode).toBe('ephemeral');
    expect(overridden.headless).toBe(true);
    expect(overridden.browser).toBe('edge');
  });
});
