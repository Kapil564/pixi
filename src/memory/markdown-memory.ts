import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAppPaths } from '../shared/paths';

export interface MemoryFrontmatter {
  category: string;
  updated: string;
  description: string;
}

export interface MemoryFileContent {
  frontmatter: MemoryFrontmatter;
  bullets: string[];
  rawText: string;
}

export interface MemoryManifestItem {
  relPath: string; // e.g. "profile.md", "preferences.md", "projects/saira.md"
  absPath: string;
  category: string;
  description: string;
  keywords: Set<string>;
}

// In-memory manifest cache
let manifestCache: MemoryManifestItem[] = [];

// Simple async Mutex to serialize file writes
class Mutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const release = () => {
        if (this.queue.length > 0) {
          const next = this.queue.shift();
          if (next) next();
        } else {
          this.locked = false;
        }
      };

      if (this.locked) {
        this.queue.push(() => {
          this.locked = true;
          resolve(release);
        });
      } else {
        this.locked = true;
        resolve(release);
      }
    });
  }
}

const memoryWriteMutex = new Mutex();

function getMemoryDir(): string {
  return getAppPaths().memoryDir;
}

/**
 * Ensures initial default memory directory and core files exist.
 */
export function initMemoryStorage(): void {
  const memoryDir = getMemoryDir();

  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }

  const projectsDir = path.join(memoryDir, 'projects');
  if (!fs.existsSync(projectsDir)) {
    fs.mkdirSync(projectsDir, { recursive: true });
  }

  const peopleDir = path.join(memoryDir, 'people');
  if (!fs.existsSync(peopleDir)) {
    fs.mkdirSync(peopleDir, { recursive: true });
  }

  // Ensure mandatory files exist
  ensureFileExists('profile.md', {
    category: 'profile',
    description: 'User identity, name, role, and fundamental user facts',
  }, ['- Name: Kapil']);

  ensureFileExists('preferences.md', {
    category: 'preferences',
    description: 'User likes, dislikes, communication style, and workflow preferences',
  }, ['- Spoken responses should be concise, direct, and natural']);

  ensureFileExists('routines.md', {
    category: 'routines',
    description: 'Recurring daily schedules, habits, and recurring patterns',
  }, []);

  refreshManifest();
}

function ensureFileExists(
  relPath: string,
  frontmatter: Partial<MemoryFrontmatter>,
  defaultBullets: string[]
): void {
  const fullPath = path.join(getMemoryDir(), relPath);
  if (!fs.existsSync(fullPath)) {
    const today = new Date().toISOString().split('T')[0];
    const content = formatMemoryFile({
      category: frontmatter.category || 'general',
      updated: today,
      description: frontmatter.description || relPath,
    }, defaultBullets);
    fs.writeFileSync(fullPath, content, 'utf-8');
  }
}

/**
 * Parse YAML frontmatter and bullet points from markdown memory file.
 */
export function parseMemoryFile(content: string): MemoryFileContent {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const fm: MemoryFrontmatter = {
    category: 'general',
    updated: new Date().toISOString().split('T')[0],
    description: '',
  };
  let bodyText = content;

  if (frontmatterMatch) {
    const fmLines = frontmatterMatch[1].split('\n');
    for (const line of fmLines) {
      const parts = line.split(':');
      if (parts.length >= 2) {
        const key = parts[0].trim().toLowerCase();
        const value = parts.slice(1).join(':').trim();
        if (key === 'category') fm.category = value;
        if (key === 'updated') fm.updated = value;
        if (key === 'description') fm.description = value;
      }
    }
    bodyText = frontmatterMatch[2];
  }

  const bullets: string[] = [];
  const lines = bodyText.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      bullets.push(trimmed.slice(2).trim());
    }
  }

  return { frontmatter: fm, bullets, rawText: content };
}

/**
 * Format memory frontmatter and bullets into markdown content.
 */
export function formatMemoryFile(fm: MemoryFrontmatter, bullets: string[]): string {
  const fmBlock = `---
category: ${fm.category}
updated: ${fm.updated}
description: ${fm.description}
---`;

  if (bullets.length === 0) {
    return `${fmBlock}\n`;
  }
  const bulletBlock = bullets.map((b) => `- ${b}`).join('\n');
  return `${fmBlock}\n\n${bulletBlock}\n`;
}

const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren\'t',
  'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'can\'t', 'cannot', 'could', 'did', 'do', 'does', 'doing', 'don\'t', 'down', 'during', 'each',
  'few', 'for', 'from', 'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers',
  'herself', 'him', 'himself', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself',
  'let\'s', 'me', 'more', 'most', 'my', 'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once',
  'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'she',
  'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves',
  'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until',
  'up', 'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom',
  'why', 'with', 'would', 'you', 'your', 'yours', 'yourself', 'yourselves', 'saira', 'assistant',
  'please', 'tell', 'show', 'remember', 'note', 'add', 'set', 'list'
]);

function extractKeywords(text: string): Set<string> {
  const words = text.toLowerCase().replace(/[^a-z0-9\s_-]/g, ' ').split(/\s+/);
  const set = new Set<string>();
  for (const w of words) {
    if (w.length > 2 && !STOP_WORDS.has(w)) {
      set.add(w);
    }
  }
  return set;
}

/**
 * Recursively scans memory/ directory and updates the in-memory manifest cache.
 */
export function refreshManifest(): MemoryManifestItem[] {
  const memoryDir = getMemoryDir();

  if (!fs.existsSync(memoryDir)) {
    initMemoryStorage();
  }

  const items: MemoryManifestItem[] = [];

  function scanDir(dir: string, prefix = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        scanDir(fullPath, relPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const parsed = parseMemoryFile(content);
          const nameWithoutExt = entry.name.replace(/\.md$/, '');
          const keywordSource = `${relPath} ${nameWithoutExt} ${parsed.frontmatter.category} ${parsed.frontmatter.description}`;
          const keywords = extractKeywords(keywordSource);

          items.push({
            relPath,
            absPath: fullPath,
            category: parsed.frontmatter.category,
            description: parsed.frontmatter.description,
            keywords,
          });
        } catch (err) {
          console.error(`[Memory] Failed to read memory file ${relPath}:`, err);
        }
      }
    }
  }

  scanDir(memoryDir);
  manifestCache = items;
  return items;
}

export function getManifest(forceRefresh = false): MemoryManifestItem[] {
  if (manifestCache.length === 0 || forceRefresh) {
    refreshManifest();
  }
  return manifestCache;
}

/**
 * Loads profile.md (ALWAYS loaded).
 */
export function getProfileMemory(): string {
  const profilePath = path.join(getMemoryDir(), 'profile.md');
  if (fs.existsSync(profilePath)) {
    return fs.readFileSync(profilePath, 'utf-8');
  }
  return '';
}

/**
 * Retrieves relevant memory files based on keyword overlap with user message.
 * Note: profile.md is excluded here because it is ALWAYS loaded separately.
 */
export function getRelevantMemories(userMessage: string): Array<{ relPath: string; content: string }> {
  const userKeywords = extractKeywords(userMessage);
  if (userKeywords.size === 0) return [];

  // Retrieve cached manifest for memory context indexing (manifest is auto-refreshed on saves)
  const manifest = getManifest();
  const results: Array<{ relPath: string; content: string }> = [];

  for (const item of manifest) {
    // Skip profile.md as it's always included by default
    if (item.relPath === 'profile.md') continue;

    let overlapCount = 0;
    for (const kw of userKeywords) {
      if (item.keywords.has(kw)) {
        overlapCount++;
      }
    }

    if (overlapCount > 0) {
      try {
        const content = fs.readFileSync(item.absPath, 'utf-8');
        results.push({ relPath: item.relPath, content });
      } catch (err) {
        console.error(`[Memory] Error loading memory file ${item.relPath}:`, err);
      }
    }
  }

  return results;
}

/**
 * Writes or updates a fact in a target memory markdown file with Mutex write serialization
 * and in-place contradiction/dedup handling.
 */
export async function saveFactToMemory(params: {
  fact: string;
  category: string;
  targetFile: string; // e.g. "profile.md", "preferences.md", "projects/saira.md"
  contradictionInfo?: { isContradiction: boolean; existingFactIndex?: number; updatedBulletText?: string };
}): Promise<void> {
  const release = await memoryWriteMutex.acquire();

  try {
    initMemoryStorage();
    const memoryDir = getMemoryDir();

    // Standardize path relative to memoryDir
    let relPath = params.targetFile.replace(/^memory[\/\\]/, '').replace(/^(\.\.[\/\\])+/, '');
    if (!relPath.endsWith('.md')) relPath += '.md';

    const resolvedMemoryDir = path.resolve(memoryDir);
    const fullPath = path.resolve(memoryDir, relPath);

    if (!fullPath.startsWith(resolvedMemoryDir + path.sep) && fullPath !== resolvedMemoryDir) {
      console.error(`[Memory Security Error] Rejected path traversal attempt: "${params.targetFile}" resolves outside memory directory.`);
      return;
    }

    const parentDir = path.dirname(fullPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    let fm: MemoryFrontmatter = {
      category: params.category || 'general',
      updated: new Date().toISOString().split('T')[0],
      description: `Memory file for ${relPath.replace(/\.md$/, '')}`,
    };
    let bullets: string[] = [];

    if (fs.existsSync(fullPath)) {
      const fileContent = fs.readFileSync(fullPath, 'utf-8');
      const parsed = parseMemoryFile(fileContent);
      fm = parsed.frontmatter;
      bullets = parsed.bullets;
    }

    fm.updated = new Date().toISOString().split('T')[0];

    const newFactClean = params.fact.trim();

    // Handle contradiction / in-place update if provided
    if (params.contradictionInfo?.isContradiction && typeof params.contradictionInfo.existingFactIndex === 'number') {
      const idx = params.contradictionInfo.existingFactIndex;
      if (idx >= 0 && idx < bullets.length) {
        bullets[idx] = params.contradictionInfo.updatedBulletText || `${newFactClean} (previously: ${bullets[idx]})`;
      } else {
        bullets.push(newFactClean);
      }
    } else {
      // Check for exact/near duplicate
      const lowerNew = newFactClean.toLowerCase();
      const existingIdx = bullets.findIndex((b) => b.toLowerCase().includes(lowerNew) || lowerNew.includes(b.toLowerCase()));

      if (existingIdx !== -1) {
        // If it's similar, update to the newer wording
        bullets[existingIdx] = newFactClean;
      } else {
        bullets.push(newFactClean);
      }
    }

    const updatedContent = formatMemoryFile(fm, bullets);
    fs.writeFileSync(fullPath, updatedContent, 'utf-8');

    // Refresh manifest after write
    refreshManifest();
  } catch (err) {
    console.error(`[Memory Write Error] Failed to write fact to ${params.targetFile}:`, err);
  } finally {
    release();
  }
}
