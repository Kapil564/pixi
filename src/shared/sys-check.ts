import * as os from 'node:os';
import { config } from './config';

export interface SystemRequirementsResult {
  isCompatible: boolean;
  osType: string;
  osRelease: string;
  isWindows10Or11: boolean;
  totalRamGb: number;
  freeRamGb: number;
  ramOk: boolean;
  cpuArch: string;
  isX64: boolean;
  warnings: string[];
  errors: string[];
}

const RECOMMENDED_FREE_RAM_GB = 2.0;
const RECOMMENDED_TOTAL_RAM_GB = 4.0;

/**
 * Validates system specifications: OS compatibility, free RAM, and CPU architecture.
 * Non-fatal hardware limitations output warnings to terminal console rather than blocking UI execution.
 */
export function checkSystemRequirements(): SystemRequirementsResult {
  const osType = os.type();
  const osRelease = os.release();
  const cpuArch = os.arch();

  // Windows 10/11 release string starts with 10.
  const isWindows = osType === 'Windows_NT';
  const releaseMajor = parseInt(osRelease.split('.')[0], 10) || 0;
  const isWindows10Or11 = isWindows && releaseMajor >= 10;

  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const totalRamGb = Math.round((totalBytes / (1024 * 1024 * 1024)) * 10) / 10;
  const freeRamGb = Math.round((freeBytes / (1024 * 1024 * 1024)) * 10) / 10;

  const isCloudMode = config.llm.provider !== 'ollama';
  const requiredMinFreeRam = isCloudMode ? 0.5 : 1.0;

  const ramOk = freeRamGb >= requiredMinFreeRam;
  const isX64 = cpuArch === 'x64' || cpuArch === 'arm64';

  const warnings: string[] = [];
  const errors: string[] = [];

  if (!isWindows10Or11) {
    const msg = `Operating System "${osType} ${osRelease}" is below recommended Windows 10/11 version.`;
    warnings.push(msg);
    console.warn(`[System Requirements Warning] ${msg}`);
  }

  if (!isX64) {
    const msg = `CPU Architecture "${cpuArch}" is not 64-bit (x64/arm64 recommended for local AI binaries).`;
    warnings.push(msg);
    console.warn(`[System Requirements Warning] ${msg}`);
  }

  if (!ramOk) {
    const msg = `Available Free RAM (${freeRamGb} GB) is low (less than ${requiredMinFreeRam} GB minimum required for offline models).`;
    warnings.push(msg);
    console.warn(`[System Requirements Warning] ${msg}`);
  } else if (!isCloudMode && freeRamGb < RECOMMENDED_FREE_RAM_GB) {
    const msg = `Available Free RAM (${freeRamGb} GB) is low (${RECOMMENDED_FREE_RAM_GB} GB recommended for optimal offline LLM performance).`;
    warnings.push(msg);
    console.warn(`[System Requirements Warning] ${msg}`);
  }

  if (totalRamGb < RECOMMENDED_TOTAL_RAM_GB) {
    const msg = `Total System RAM (${totalRamGb} GB) is below recommended ${RECOMMENDED_TOTAL_RAM_GB} GB.`;
    warnings.push(msg);
    console.warn(`[System Requirements Warning] ${msg}`);
  }

  // System is treated as compatible so hardware specs output terminal warnings without blocking UI setup
  const isCompatible = true;

  return {
    isCompatible,
    osType,
    osRelease,
    isWindows10Or11,
    totalRamGb,
    freeRamGb,
    ramOk,
    cpuArch,
    isX64,
    warnings,
    errors,
  };
}
