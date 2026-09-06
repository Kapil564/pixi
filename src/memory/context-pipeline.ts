import { getProfileMemory, getRelevantMemories } from './markdown-memory';
import { getRecentSessionMessages, getSessionSummary, type DbMessage } from '../db/session-store';

export interface AssembledContext {
  profileContext: string;
  relevantMemoryContext: string;
  sessionSummary: string | null;
  recentMessages: DbMessage[];
  fullPromptContext: string;
}

const DEFAULT_PERSONA = `# Global Assistant Context & Behavior Guidelines

## Assistant Role & Persona
- **Name**: pixi
- **Role**: Intelligent, voice-first Windows desktop assistant
- **Tone**: Professional, concise, direct, helpful, and natural in spoken responses.

## Behavior & Operating Rules Across All Sessions
- **Conciseness**: Keep spoken responses short, natural, and clear for text-to-speech output. Avoid overly verbose explanations or markdown formatting (tables, bullet lists) in spoken responses.
- **Direct Action**: When completing tasks (reminders, to-dos, questions), respond clearly and directly without unnecessary filler.
- **Interruption Respect**: pixi immediately stops speaking whenever the user speaks or enters text.
- **Session Continuity**: Maintain high accuracy and reliable intent classification across all voice and text interactions.
`;

/**
 * Assembles context for a live conversation turn according to the 5-step pipeline:
 * 1. Load profile.md (always)
 * 2. Keyword-match user message against memory manifest -> load relevant files
 * 3. Load recent raw messages for current session + sessions.summary if present
 * 4. Combine system prompt + profile + relevant memory + summary + recent history
 */
export function assembleContext(params: {
  userMessage: string;
  sessionId: number;
  recentMessageLimit?: number;
}): AssembledContext {
  const limit = params.recentMessageLimit || 10;

  // Step 1: Load profile.md (always)
  const profileContext = getProfileMemory();

  // Step 2: Keyword-match current user message against memory manifest -> load relevant files
  const relevantFiles = getRelevantMemories(params.userMessage);
  let relevantMemoryContext = '';
  if (relevantFiles.length > 0) {
    relevantMemoryContext = relevantFiles
      .map((f) => `### Memory File: ${f.relPath}\n${f.content}`)
      .join('\n\n');
  }

  // Step 3: Load recent raw messages for current session + sessions.summary
  const sessionSummary = getSessionSummary(params.sessionId);
  const recentMessages = getRecentSessionMessages(params.sessionId, limit);

  // Step 4: Combine into full system/context prompt
  const contextBlocks: string[] = [DEFAULT_PERSONA];

  if (profileContext.trim()) {
    contextBlocks.push(`## Permanent User Identity & Profile (profile.md)\n${profileContext.trim()}`);
  }

  if (relevantMemoryContext.trim()) {
    contextBlocks.push(`## Relevant Long-Term Memories (Retrieved via Keyword Matching)\n${relevantMemoryContext.trim()}`);
  }

  if (sessionSummary && sessionSummary.trim()) {
    contextBlocks.push(`## Prior Session Summary\n${sessionSummary.trim()}`);
  }

  if (recentMessages.length > 0) {
    const historyFormatted = recentMessages
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n');
    contextBlocks.push(`## Recent Session Conversation History\n${historyFormatted}`);
  }

  const fullPromptContext = contextBlocks.join('\n\n---\n\n');

  return {
    profileContext,
    relevantMemoryContext,
    sessionSummary,
    recentMessages,
    fullPromptContext,
  };
}
