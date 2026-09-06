import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAppPaths } from './paths';

/**
 * Checks for previous AppData directories (e.g. saira-assistant, Saira, pixi)
 * and migrates downloaded Whisper models, Piper voices, and executable binaries
 * to the current active userData directory so our official models are immediately available.
 */
export function migrateLegacyModelAssets(): void {
  try {
    const targetPaths = getAppPaths();
    const currentDir = targetPaths.userDataDir;
    if (!process.env.APPDATA) return;

    const legacyDirs = [
      path.join(process.env.APPDATA, 'saira-assistant'),
      path.join(process.env.APPDATA, 'Saira'),
      path.join(process.env.APPDATA, 'pixi'),
    ].filter((dir) => fs.existsSync(dir) && path.resolve(dir).toLowerCase() !== path.resolve(currentDir).toLowerCase());

    for (const legacyDir of legacyDirs) {
      // 1. Migrate Whisper Models (ggml-*.bin)
      const legacyModelsDir = path.join(legacyDir, 'models');
      const targetModelsDir = path.join(currentDir, 'models');
      if (fs.existsSync(legacyModelsDir)) {
        if (!fs.existsSync(targetModelsDir)) {
          fs.mkdirSync(targetModelsDir, { recursive: true });
        }
        const entries = fs.readdirSync(legacyModelsDir);
        for (const file of entries) {
          if (file.endsWith('.tmp')) continue; // Skip temporary incomplete downloads
          const srcFile = path.join(legacyModelsDir, file);
          const destFile = path.join(targetModelsDir, file);
          try {
            const stat = fs.statSync(srcFile);
            if (stat.isFile() && stat.size > 10 * 1024 * 1024) {
              const destExists = fs.existsSync(destFile);
              const destSize = destExists ? fs.statSync(destFile).size : 0;
              if (!destExists || destSize < stat.size) {
                console.log(`[Model Migration] Migrating model "${file}" from ${legacyDir} -> ${currentDir}`);
                fs.copyFileSync(srcFile, destFile);
              }
            }
          } catch (err) {
            console.warn(`[Model Migration] Error migrating model ${file}:`, err);
          }
        }
      }

      // 2. Migrate Piper Voices (*.onnx, *.onnx.json)
      const legacyVoicesDir = path.join(legacyDir, 'voices');
      const targetVoicesDir = path.join(currentDir, 'voices');
      if (fs.existsSync(legacyVoicesDir)) {
        if (!fs.existsSync(targetVoicesDir)) {
          fs.mkdirSync(targetVoicesDir, { recursive: true });
        }
        const entries = fs.readdirSync(legacyVoicesDir);
        for (const file of entries) {
          const srcFile = path.join(legacyVoicesDir, file);
          const destFile = path.join(targetVoicesDir, file);
          try {
            if (fs.statSync(srcFile).isFile()) {
              if (!fs.existsSync(destFile) || fs.statSync(destFile).size < fs.statSync(srcFile).size) {
                console.log(`[Model Migration] Migrating voice asset "${file}" from ${legacyDir} -> ${currentDir}`);
                fs.copyFileSync(srcFile, destFile);
              }
            }
          } catch (err) {
            console.warn(`[Model Migration] Error migrating voice asset ${file}:`, err);
          }
        }
      }

      // 3. Migrate Binaries (whisper-cli.exe, piper.exe, Release/)
      const legacyBinDir = path.join(legacyDir, 'bin');
      const targetBinDir = path.join(currentDir, 'bin');
      if (fs.existsSync(legacyBinDir)) {
        if (!fs.existsSync(targetBinDir)) {
          fs.mkdirSync(targetBinDir, { recursive: true });
        }
        copyDirRecursive(legacyBinDir, targetBinDir);
      }
    }
  } catch (err) {
    console.warn('[Model Migration Warning] Could not migrate legacy assets:', err);
  }
}

function copyDirRecursive(src: string, dest: string): void {
  try {
    if (!fs.existsSync(src)) return;
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        copyDirRecursive(srcPath, destPath);
      } else if (entry.isFile()) {
        if (!fs.existsSync(destPath)) {
          try {
            fs.copyFileSync(srcPath, destPath);
          } catch {}
        }
      }
    }
  } catch {
    // ignore
  }
}
