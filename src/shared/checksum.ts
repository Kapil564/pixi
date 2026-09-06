import * as crypto from 'node:crypto';
import * as fs from 'node:fs';

/**
 * Known official SHA-256 checksums for external binary and model release assets.
 */
export const KNOWN_CHECKSUMS: Record<string, string> = {
  // Whisper Models (Hugging Face ggerganov/whisper.cpp)
  'ggml-small.en.bin': '1be3a9a2063e5c912a24c56e2eb9036f018e6900f9a2e6f47761d7636e093409',
  'ggml-base.en.bin': '60ed5bc22b1265880ee2168a61d95b090620603f901ab7fb735f4b5059d0b642',

  // Whisper Windows Executable Binary Zip (ggml-org/whisper.cpp b4938)
  'whisper-bin-x64.zip': 'c2a4b60edb11f7e11a9191ffb50929535527d4d91c9903dbe3e554583bbbc63d',

  // Piper Windows Executable Binary Zip (rhasspy/piper 2023.11.14-2)
  'piper_windows_amd64.zip': 'ca6a89c922aa16ec1bf5a7a726715f21226d40db240e9fb4d8b940989efef533',

  // Piper Voices (Hugging Face rhasspy/piper-voices v1.0.0)
  'en_US-amy-medium.onnx': 'a3edbd71249b6b7a2d8a0f9bcbcbd1891cf232c12563f8bb64f26038312e443a',
  'en_US-lessac-medium.onnx': 'c7ef696d07ebcae9581f185794719e598929e7943d043818e604ef64a8342721',
  'en_GB-alan-medium.onnx': 'e5ef35b54900cb310aef5a1f6a165df8a5b281f6d900df887d15ffb9691b10a9',
};

/**
 * Calculates SHA-256 hash of a file using Node stream.
 */
export async function calculateFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
    stream.on('error', (err) => reject(err));
  });
}

/**
 * Verifies file integrity against an expected SHA-256 hash if configured.
 * Returns true if valid or unchecked, or false if hash mismatch occurs.
 */
export async function verifyFileIntegrity(
  filePath: string,
  expectedHash?: string
): Promise<{ valid: boolean; hash: string }> {
  try {
    const hash = await calculateFileSha256(filePath);

    if (expectedHash) {
      const isMatch = hash === expectedHash.toLowerCase();
      if (!isMatch) {
        console.warn(`[Integrity Warning] SHA-256 mismatch for ${filePath}! Expected: ${expectedHash}, Actual: ${hash}`);
        return { valid: false, hash };
      }
      console.log(`[Integrity Verified] SHA-256 match for ${filePath} (${hash.slice(0, 12)}...)`);
      return { valid: true, hash };
    }

    console.log(`[Integrity Info] Calculated SHA-256 for ${filePath}: ${hash}`);
    return { valid: true, hash };
  } catch (err) {
    console.error(`[Integrity Error] Failed to calculate hash for ${filePath}:`, err);
    return { valid: false, hash: '' };
  }
}
