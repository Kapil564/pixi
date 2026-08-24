import * as fs from 'node:fs';
import * as path from 'node:path';

export interface DiskSpaceInfo {
  freeBytes: number;
  freeGb: number;
  isSufficient: boolean;
  targetPath: string;
}

const REQUIRED_FREE_BYTES = 3 * 1024 * 1024 * 1024; // 3.0 GB requirement for local models

/**
 * Checks available disk space on the drive containing targetPath (defaults to user appData or system root).
 */
export function checkFreeDiskSpace(targetPath?: string): DiskSpaceInfo {
  const checkPath = targetPath || process.env.APPDATA || 'C:\\';

  try {
    const rootPath = path.parse(checkPath).root || 'C:\\';
    const stats = fs.statfsSync(rootPath);
    const bfree = BigInt(stats.bfree);
    const bsize = BigInt(stats.bsize);
    const freeBytes = Number(bfree * bsize);
    const freeGb = Math.round((freeBytes / (1024 * 1024 * 1024)) * 10) / 10;
    const isSufficient = freeBytes >= REQUIRED_FREE_BYTES;

    return {
      freeBytes,
      freeGb,
      isSufficient,
      targetPath: rootPath,
    };
  } catch (err) {
    console.warn('[Disk Check Warning] Unable to query disk space on rootPath via fs.statfsSync, trying checkPath:', err);
    try {
      const stats = fs.statfsSync(checkPath);
      const bfree = BigInt(stats.bfree);
      const bsize = BigInt(stats.bsize);
      const freeBytes = Number(bfree * bsize);
      const freeGb = Math.round((freeBytes / (1024 * 1024 * 1024)) * 10) / 10;
      const isSufficient = freeBytes >= REQUIRED_FREE_BYTES;

      return {
        freeBytes,
        freeGb,
        isSufficient,
        targetPath: checkPath,
      };
    } catch (fallbackErr) {
      console.error('[Disk Check Error] Unable to query disk space via fs.statfsSync:', fallbackErr);
      return {
        freeBytes: 0,
        freeGb: 0,
        isSufficient: false,
        targetPath: checkPath,
      };
    }
  }
}
