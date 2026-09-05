import { eq, asc, inArray, count, isNull } from 'drizzle-orm';
import { db, assertDbReady } from './index';
import { sessions, messages } from './schema';

export interface DbMessage {
  id: number;
  sessionId: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  tokenCount: number | null;
}

export interface DbSession {
  id: number;
  startedAt: string;
  endedAt: string | null;
  summary: string | null;
}

/**
 * Creates a new session record in SQLite and returns its ID.
 */
export function createSession(): number {
  assertDbReady();
  const result = db.insert(sessions).values({
    startedAt: new Date().toISOString(),
    endedAt: null,
    summary: null,
  }).returning({ id: sessions.id }).get();
  return result.id;
}

/**
 * Marks a session as ended by setting endedAt to the current timestamp.
 */
export function endSession(sessionId: number): void {
  assertDbReady();
  db.update(sessions)
    .set({ endedAt: new Date().toISOString() })
    .where(eq(sessions.id, sessionId))
    .run();
}

/**
 * Gets the active open session (where endedAt is null) or creates a new one.
 */
export function getActiveOrCreateSession(): number {
  assertDbReady();
  const activeSession = db.select()
    .from(sessions)
    .where(isNull(sessions.endedAt))
    .orderBy(asc(sessions.id))
    .get();

  if (activeSession) {
    return activeSession.id;
  }
  return createSession();
}

/**
 * Adds a new message record to the specified session in SQLite.
 */
export function addMessage(params: {
  sessionId: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tokenCount?: number;
}): number {
  assertDbReady();
  const result = db.insert(messages).values({
    sessionId: params.sessionId,
    role: params.role,
    content: params.content,
    createdAt: new Date().toISOString(),
    tokenCount: params.tokenCount ?? null,
  }).returning({ id: messages.id }).get();

  return result.id;
}

/**
 * Retrieves all messages for a session ordered by ID ascending.
 */
export function getSessionMessages(sessionId: number): DbMessage[] {
  assertDbReady();
  return db.select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.id))
    .all() as DbMessage[];
}

/**
 * Retrieves the most recent N messages for a session.
 */
export function getRecentSessionMessages(sessionId: number, limit: number): DbMessage[] {
  const all = getSessionMessages(sessionId);
  if (all.length <= limit) return all;
  return all.slice(all.length - limit);
}

/**
 * Gets total message count for a session.
 */
export function getSessionMessageCount(sessionId: number): number {
  assertDbReady();
  const result = db.select({ value: count() })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .get();
  return result?.value ?? 0;
}

/**
 * Fetches current summary for a session.
 */
export function getSessionSummary(sessionId: number): string | null {
  assertDbReady();
  const sessionRecord = db.select({ summary: sessions.summary })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .get();
  return sessionRecord?.summary ?? null;
}

/**
 * Updates the summary string for a session.
 */
export function updateSessionSummary(sessionId: number, summary: string): void {
  assertDbReady();
  db.update(sessions)
    .set({ summary })
    .where(eq(sessions.id, sessionId))
    .run();
}

/**
 * Retrieves older messages to prune from SQLite (all except the last `keepCount` messages).
 */
export function getOlderMessagesToPrune(sessionId: number, keepCount: number): DbMessage[] {
  const all = getSessionMessages(sessionId);
  if (all.length <= keepCount) return [];
  return all.slice(0, all.length - keepCount);
}

/**
 * Deletes messages by their primary key IDs.
 */
export function deleteMessagesByIds(ids: number[]): void {
  if (ids.length === 0) return;
  assertDbReady();
  db.delete(messages)
    .where(inArray(messages.id, ids))
    .run();
}
