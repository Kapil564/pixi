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
  const extensions = ['.exe', '.cmd', '.bat', ''];
  const paths = (process.env.PATH || '').split(';');
  for (const dir of paths) {
    for (const ext of extensions) {
      const full = path.join(dir, name + ext);
      try {
        if (fs.existsSync(full) && !fs.statSync(full).isDirectory()) return full;
      } catch {
        // ignore
      }
    }
  }
  return undefined;
}

/**
 * Recursively scans a directory for a known whisper.cpp executable, preferring
 * whisper-cli, then other whisper binaries, then main (the legacy entrypoint).
 */
export function findExeRecursive(dir: string, depth = 0): string | undefined {
  if (depth > 4) return undefined;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    // Priority 1: Check for whisper-cli.exe in current dir
    for (const entry of entries) {
      if (entry.isFile()) {
        const name = entry.name.toLowerCase();
        if (name === 'whisper-cli.exe' || name === 'whisper-cli') {
          return path.join(dir, entry.name);
        }
      }
    }

    // Priority 2: Check for other whisper binaries in current dir
    for (const entry of entries) {
      if (entry.isFile()) {
        const name = entry.name.toLowerCase();
        if (name === 'whisper.exe' || (name.startsWith('whisper') && name.endsWith('.exe'))) {
          return path.join(dir, entry.name);
        }
      }
    }

    // Priority 3: Check subdirectories recursively
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const found = findExeRecursive(path.join(dir, entry.name), depth + 1);
        if (found) return found;
      }
    }

    // Priority 4: Fallback to main.exe in current dir if no whisper-cli exists
    for (const entry of entries) {
      if (entry.isFile()) {
        const name = entry.name.toLowerCase();
        if (name === 'main.exe' || name === 'main') {
          return path.join(dir, entry.name);
        }
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}

export interface FindLocalBinaryOptions {
  /** Optional env var override that points directly at the executable. */
  envVar?: string;
  /** Exact file names (optionally relative subpaths) to check in the bin dir. */
  knownNames?: string[];
  /** Recursively scan the bin dir for a known executable. */
  recursive?: boolean;
  /** Base names to search for on the system PATH. */
  pathNames?: string[];
  /** Override the default app bin dir. */
  binDir?: string;
}

/**
 * Locates a bundled/downloaded runtime executable: env var override -> app bin dir -> system PATH.
 */
export function findLocalBinary(opts: FindLocalBinaryOptions): string | undefined {
  const { envVar, knownNames, recursive, pathNames, binDir } = opts;

  if (envVar && process.env[envVar] && fs.existsSync(process.env[envVar]!)) {
    return process.env[envVar]!;
  }

  const dir = binDir || path.join(getAppPaths().userDataDir, 'bin');

  try {
    if (fs.existsSync(dir)) {
      if (recursive) {
        const found = findExeRecursive(dir);
        if (found) return found;
      }
      for (const name of knownNames || []) {
        const candidate = path.join(dir, name);
        if (fs.existsSync(candidate) && !fs.statSync(candidate).isDirectory()) return candidate;
      }
    }
  } catch {
    // ignore
  }

  for (const name of pathNames || []) {
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

const REQUIRED_FREE_BYTES = 3 * 1024 * 1024 * 1024; // 3.0 GB requirement for local models

/**
 * Computes free disk space info for a path, returning null when it cannot be queried.
 */
function getFreeSpaceInfo(p: string): DiskSpaceInfo | null {
  try {
    const stats = fs.statfsSync(p);
    const bfree = BigInt(stats.bfree);
    const bsize = BigInt(stats.bsize);
    const freeBytes = Number(bfree * bsize);
    const freeGb = Math.round((freeBytes / (1024 * 1024 * 1024)) * 10) / 10;
    const isSufficient = freeBytes >= REQUIRED_FREE_BYTES;
    return { freeBytes, freeGb, isSufficient, targetPath: p };
  } catch {
    return null;
  }
}

/**
 * Checks available disk space on the drive containing targetPath (defaults to user appData or system root).
 */
export function checkFreeDiskSpace(targetPath?: string): DiskSpaceInfo {
  const checkPath = targetPath || process.env.APPDATA || 'C:\\';
  const rootPath = path.parse(checkPath).root || 'C:\\';

  const rootInfo = getFreeSpaceInfo(rootPath);
  if (rootInfo) return rootInfo;

  console.warn('[Disk Check Warning] Unable to query disk space on rootPath via fs.statfsSync, trying checkPath:', rootInfo);
  if (checkPath !== rootPath) {
    const checkInfo = getFreeSpaceInfo(checkPath);
    if (checkInfo) return checkInfo;
  }

  console.error(`[Disk Check Error] Unable to query disk space via fs.statfsSync on "${checkPath}":`);
  return {
    freeBytes: 0,
    freeGb: 0,
    isSufficient: false,
    targetPath: checkPath,
  };
}
