import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAppPaths } from './paths';

/**
 * Deletes the given files if they exist, silently ignoring any errors.
 */
export function cleanupFiles(...files: string[]): void {
  for (const f of files) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {
      // ignore
    }
  }
}

/**
 * Searches PATH for an executable by base name, returning the first match.
 */
export function findExecutableInPath(name: string): string | undefined {
  const paths = (process.env.PATH || '').split(';');
  for (const dir of paths) {
    for (const ext of ['.exe', '.cmd', '']) {
      const full = path.join(dir, name + ext);
      if (fs.existsSync(full)) return full;
    }
  }
  return undefined;
}

export interface FindLocalBinaryOptions {
  envVar?: string;
  knownNames?: string[];
  recursive?: boolean;
  pathNames?: string[];
  binDir?: string;
}

/**
 * Locates a runtime executable: env var override -> app bin dir -> system PATH.
 */
export function findLocalBinary(opts: FindLocalBinaryOptions): string | undefined {
  if (opts.envVar && process.env[opts.envVar] && fs.existsSync(process.env[opts.envVar]!)) {
    return process.env[opts.envVar]!;
  }

  const dir = opts.binDir || path.join(getAppPaths().userDataDir, 'bin');
  if (fs.existsSync(dir)) {
    const defaultCandidates = [
      'whisper-cli.exe',
      'whisper.exe',
      'piper.exe',
      'main.exe',
      path.join('Release', 'whisper-cli.exe'),
      path.join('Release', 'main.exe'),
      path.join('piper', 'piper.exe'),
    ];
    const candidates = opts.knownNames && opts.knownNames.length > 0 ? opts.knownNames : defaultCandidates;
    for (const name of candidates) {
      const full = path.join(dir, name);
      if (fs.existsSync(full)) return full;
    }

    if (opts.recursive) {
      try {
        const subdirs = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
        for (const sub of subdirs) {
          for (const name of candidates) {
            const baseName = path.basename(name);
            const full = path.join(dir, sub.name, baseName);
            if (fs.existsSync(full)) return full;
          }
        }
      } catch {}
    }
  }

  for (const name of opts.pathNames || ['whisper-cli', 'whisper', 'piper']) {
    const found = findExecutableInPath(name);
    if (found) return found;
  }
  return undefined;
}

export interface DiskSpaceInfo {
  freeBytes: number;
  freeGb: number;
  isSufficient: boolean;
  targetPath: string;
}

/**
 * Checks available disk space on user drive (requires >= 3GB for local models).
 */
export function checkFreeDiskSpace(targetPath?: string): DiskSpaceInfo {
  const p = targetPath || process.env.APPDATA || 'C:\\';
  try {
    const stats = fs.statfsSync(p);
    const freeBytes = Number(BigInt(stats.bfree) * BigInt(stats.bsize));
    const freeGb = Math.round((freeBytes / (1024 * 1024 * 1024)) * 10) / 10;
    return {
      freeBytes,
      freeGb,
      isSufficient: freeGb >= 3.0,
      targetPath: p,
    };
  } catch {
    return { freeBytes: 10 * 1024 * 1024 * 1024, freeGb: 10, isSufficient: true, targetPath: p };
  }
}
