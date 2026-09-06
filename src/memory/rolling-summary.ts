import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import type { LLMProvider } from '../providers/llm';
import { getAppPaths } from '../shared/paths';
import {
  getSessionMessageCount,
  getOlderMessagesToPrune,
  getSessionSummary,
  updateSessionSummary,
  deleteMessagesByIds,
  getSessionMessages,
  type DbMessage,
} from '../db/session-store';

function getArchiveDir(): string {
  return getAppPaths().archiveDir;
}
const MESSAGE_THRESHOLD = 20;
const KEEP_BUFFER_COUNT = 10;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Track last message timestamp per session
const lastMessageTimestamps: Map<number, number> = new Map();

export function recordMessageActivity(sessionId: number): void {
  lastMessageTimestamps.set(sessionId, Date.now());
}

/**
 * Ensures archive/sessions directory exists.
 */
function ensureArchiveDir(): void {
  const archiveDir = getArchiveDir();
  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir, { recursive: true });
  }
}

/**
 * Appends pruned messages to archive/sessions/{date}-session-{id}.jsonl.gz
 */
export function archivePrunedMessages(sessionId: number, messagesToPrune: DbMessage[]): void {
  if (messagesToPrune.length === 0) return;

  ensureArchiveDir();

  const archiveDir = getArchiveDir();
  const startDate = messagesToPrune[0].createdAt.split('T')[0] || new Date().toISOString().split('T')[0];
  const archivePath = path.join(archiveDir, `${startDate}-session-${sessionId}.jsonl.gz`);

  const jsonlLines = messagesToPrune.map((msg) => JSON.stringify(msg)).join('\n') + '\n';

  let existingBuffer = Buffer.alloc(0);
  if (fs.existsSync(archivePath)) {
    try {
      const compressedContent = fs.readFileSync(archivePath);
      existingBuffer = zlib.gunzipSync(compressedContent);
    } catch (err) {
      console.error(`[Archive Error] Failed to read existing archive ${archivePath}:`, err);
    }
  }

  const combinedText = existingBuffer.length > 0
    ? existingBuffer.toString('utf-8') + jsonlLines
    : jsonlLines;

  const compressedData = zlib.gzipSync(Buffer.from(combinedText, 'utf-8'));
  fs.writeFileSync(archivePath, compressedData);
  console.log(`[Archive] Saved ${messagesToPrune.length} pruned message(s) to ${archivePath}`);
}

const ROLLING_SUMMARIZE_SYSTEM_PROMPT = `You are a session summarizer for the voice assistant pixi.
Your task is to merge new conversation transcript excerpts into an existing running session summary.

Instructions:
1. Maintain a clear, concise, cumulative summary of the session history.
2. Incorporate key facts, questions asked, actions performed, and answers provided.
3. Keep the summary focused and concise (under 250 words).
4. Return ONLY the updated summary text. Do not include markdown headers or greetings.`;

/**
 * Performs rolling summary + prune on a session if threshold or idle condition is met.
 */
export async function checkAndRunRollingSummary(
  sessionId: number,
  llm: LLMProvider,
  forcePrune = false
): Promise<boolean> {
  const count = getSessionMessageCount(sessionId);
  const lastActivity = lastMessageTimestamps.get(sessionId) || 0;
  const isIdle = (Date.now() - lastActivity) >= IDLE_TIMEOUT_MS && count > KEEP_BUFFER_COUNT;
  const hitsThreshold = count >= MESSAGE_THRESHOLD;

  if (!forcePrune && !hitsThreshold && !isIdle) {
    return false;
  }

  const olderMessages = getOlderMessagesToPrune(sessionId, KEEP_BUFFER_COUNT);
  if (olderMessages.length === 0) {
    return false;
  }

  console.log(`[Rolling Summary] Pruning ${olderMessages.length} message(s) for Session #${sessionId}...`);

  // Step 1: Dump raw messages to flat archive file (.jsonl.gz)
  archivePrunedMessages(sessionId, olderMessages);

  // Step 2: Summarize pruned messages via fast LLM call
  const existingSummary = getSessionSummary(sessionId) || '';
  const transcriptFormatted = olderMessages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n');

  const userPrompt = `Existing Session Summary:
---
${existingSummary || '(No prior summary)'}
---

New Messages To Summarize:
---
${transcriptFormatted}
---

Return the cumulative updated session summary:`;

  try {
    const newSummary = await llm.generateCompletion(ROLLING_SUMMARIZE_SYSTEM_PROMPT, userPrompt);
    if (newSummary && newSummary.trim().length > 0) {
      updateSessionSummary(sessionId, newSummary.trim());
      console.log(`[Rolling Summary] Updated Session #${sessionId} summary.`);

      // Step 3: Delete pruned raw rows from SQLite messages table ONLY after summary update succeeds
      const prunedIds = olderMessages.map((m) => m.id);
      deleteMessagesByIds(prunedIds);
      console.log(`[Rolling Summary] Deleted ${prunedIds.length} pruned row(s) from SQLite messages table.`);
      return true;
    } else {
      console.warn(`[Rolling Summary Warning] LLM returned empty summary for session #${sessionId}. Retaining raw message rows.`);
      return false;
    }
  } catch (err) {
    console.error(`[Rolling Summary Error] Failed summarizing session #${sessionId}:`, err);
    throw err instanceof Error ? err : new Error(`Failed to summarize session #${sessionId}: ${String(err)}`);
  }
}
