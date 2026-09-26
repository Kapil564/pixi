import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAppPaths } from './paths';
import { downloadAndExtractZip } from './download';

export interface LocalAssetStatus {
  name: string;
  downloaded: boolean;
  binaryDownloaded: boolean;
  downloading: boolean;
  downloadProgress: number;
  statusText: string;
  assetPath: string;
}

export interface LocalAssetManagerOptions {
  /** Display label used in progress/status text, e.g. 'Whisper model'. */
  assetLabel: string;
  /** Singular noun used in logs, e.g. 'model'. */
  assetTerm: string;
  /** Subdirectory under userDataDir holding the assets, e.g. 'models'. */
  dirName: string;
  /** Env var providing the default selected asset, e.g. 'WHISPER_LOCAL_MODEL'. */
  selectionEnvVar: string;
  defaultSelection: string;
  /** Log prefix, e.g. 'Whisper Manager'. */
  logPrefix: string;
  /** Term used in the selection change log, e.g. 'STT model' (defaults to assetTerm). */
  selectionTerm?: string;
  /** Returns false when the asset name is unknown/not a valid download target. */
  hasAsset: (name: string) => boolean;
  /** Returns true when the asset's files exist on disk. */
  isDownloaded: (name: string) => boolean;
  /** Absolute path to the primary asset file (may create the assets dir). */
  getAssetPath: (name: string) => string;
  /** Performs the actual asset download; must call onProgress(percent). */
  downloadAsset: (name: string, targetPath: string, onProgress: (percent: number) => void) => Promise<void>;
  /** Locates the runtime binary (env var override / bin dir / PATH). */
  findBinary: () => string | undefined;
  binaryDownloadUrl: string;
  binaryZipName: string;
  /** e.g. 'Whisper executable'. */
  binaryDisplayName: string;
  buildStatusText: (ctx: {
    name: string;
    downloading: boolean;
    progress: number;
    downloaded: boolean;
    binaryDownloaded: boolean;
  }) => string;
}

/**
 * Ensures a userDataDir subdirectory exists and returns its absolute path.
 */
export function ensureDataSubdir(subdir: string): string {
  const dir = path.join(getAppPaths().userDataDir, subdir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Creates a stateful local asset manager (download tracking, status building,
 * binary provisioning) shared by the Whisper STT and Piper TTS modules.
 */
export function createLocalAssetManager(opts: LocalAssetManagerOptions) {
  let selection = process.env[opts.selectionEnvVar] || opts.defaultSelection;
  let isDownloading = false;
  let downloadingName: string | null = null;
  let currentProgress = 0;

  const getSelection = (): string => selection;

  const setSelection = (name: string): void => {
    if (opts.hasAsset(name)) {
      selection = name;
      console.log(`[${opts.logPrefix}] Selected local ${opts.selectionTerm || opts.assetTerm} changed to: "${selection}"`);
    }
  };

  /**
   * Downloads the named asset (if missing) with progress tracking.
   */
  const downloadAsset = async (
    name = selection,
    onProgress?: (progressPercent: number, statusText: string) => void
  ): Promise<boolean> => {
    if (!opts.hasAsset(name)) {
      console.error(`[${opts.logPrefix}] Unknown ${opts.assetTerm} name: ${name}`);
      return false;
    }

    if (opts.isDownloaded(name)) {
      console.log(`[${opts.logPrefix}] ${opts.assetLabel} ${name} is already downloaded.`);
      if (onProgress) onProgress(100, `${opts.assetLabel} ${name} ready.`);
      return true;
    }

    if (isDownloading) {
      if (downloadingName === name) {
        console.log(`[${opts.logPrefix}] Same ${opts.assetTerm} download already in progress.`);
        return true;
      }
      console.log(`[${opts.logPrefix}] Different ${opts.assetTerm} "${name}" requested but "${downloadingName}" is downloading. Waiting...`);
      return false;
    }

    isDownloading = true;
    downloadingName = name;
    currentProgress = 0;
    console.log(`[${opts.logPrefix}] Starting download for ${opts.assetTerm} "${name}"...`);

    const targetPath = opts.getAssetPath(name);
    const tempPath = `${targetPath}.tmp`;

    try {
      await opts.downloadAsset(name, targetPath, (percent) => {
        currentProgress = percent;
        if (onProgress) onProgress(percent, `Downloading ${opts.assetLabel} ${name}: ${percent}%`);
      });

      currentProgress = 100;
      isDownloading = false;
      downloadingName = null;
      if (onProgress) {
        onProgress(100, `${opts.assetLabel} ${name} download complete.`);
      }
      return true;
    } catch (err) {
      console.error(`[${opts.logPrefix} Download Error] Failed downloading ${opts.assetTerm} ${name}:`, err);
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {
        // ignore
      }
      isDownloading = false;
      downloadingName = null;
      return false;
    }
  };

  /**
   * Downloads and extracts the runtime binary if not already present.
   */
  const downloadBinary = async (): Promise<boolean> => {
    if (opts.findBinary()) {
      console.log(`[${opts.logPrefix} Binary Download] ${opts.binaryDisplayName} binary is already present.`);
      return true;
    }

    console.log(`[${opts.logPrefix} Binary Download] Starting download of ${opts.binaryDisplayName} for Windows...`);
    try {
      await downloadAndExtractZip(
        opts.binaryDownloadUrl,
        path.join(getAppPaths().userDataDir, 'bin'),
        opts.binaryZipName,
      );
      console.log(`[${opts.logPrefix} Binary Download] Successfully downloaded and extracted ${opts.binaryDisplayName}.`);
      return true;
    } catch (err) {
      console.error(`[${opts.logPrefix} Binary Download Error]:`, err);
      return false;
    }
  };

  /**
   * Builds the current runtime status for the selected asset.
   */
  const getStatus = (): LocalAssetStatus => {
    const name = selection;
    const downloaded = opts.isDownloaded(name);
    const binaryDownloaded = Boolean(opts.findBinary());
    const statusText = opts.buildStatusText({
      name,
      downloading: isDownloading,
      progress: currentProgress,
      downloaded,
      binaryDownloaded,
    });

    return {
      name,
      downloaded,
      binaryDownloaded,
      downloading: isDownloading,
      downloadProgress: currentProgress,
      statusText,
      assetPath: opts.getAssetPath(name),
    };
  };

  return {
    getSelection,
    setSelection,
    isDownloaded: opts.isDownloaded,
    getAssetPath: opts.getAssetPath,
    getStatus,
    downloadAsset,
    downloadBinary,
  };
}