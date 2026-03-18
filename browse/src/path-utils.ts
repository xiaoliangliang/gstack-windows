import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

export function getTempRoot(): string {
  const candidates = [
    path.resolve(os.tmpdir()),
    path.resolve(process.cwd(), '.gstack', 'tmp'),
    path.resolve(path.parse(process.cwd()).root, 'gstack-temp'),
  ];

  for (const candidate of candidates) {
    if (isWritableDirectory(candidate)) {
      return candidate;
    }
  }

  return path.resolve(os.tmpdir());
}

export function getSafeDirectories(): string[] {
  return [getTempRoot(), path.resolve(process.cwd())];
}

export function isWithinDirectory(targetPath: string, baseDir: string): boolean {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedBase = path.resolve(baseDir);
  const relative = path.relative(resolvedBase, resolvedTarget);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function validateSafePath(filePath: string, safeDirectories: string[] = getSafeDirectories()): void {
  const resolved = path.resolve(filePath);
  const isSafe = safeDirectories.some(dir => isWithinDirectory(resolved, dir));
  if (!isSafe) {
    throw new Error(`Path must be within: ${safeDirectories.join(', ')}`);
  }
}

export function defaultTempPath(fileName: string): string {
  return path.join(getTempRoot(), fileName);
}

function isWritableDirectory(dirPath: string): boolean {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    const probe = path.join(dirPath, `.probe-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}
