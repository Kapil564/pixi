import type { LLMProvider } from '../providers/llm';
import { saveFactToMemory, parseMemoryFile, getManifest } from './markdown-memory';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { getAppPaths } from '../shared/paths';

export interface ExtractedFact {
  fact: string;
  category: 'profile' | 'preferences' | 'routines' | 'projects' | 'people';
  target_file: string; // e.g. "profile.md", "preferences.md", "routines.md", "projects/saira.md", "people/john.md"
  confidence: number;
}

const FACT_EXTRACTION_SYSTEM_PROMPT = `You are a long-term memory fact extractor for the voice assistant Saira.
Your goal is to extract notable, long-term user facts from a conversation turn to persist in Saira's memory markdown files.

Output Format:
Return ONLY a valid JSON array of extracted fact objects with zero markdown formatting or extra text:
[
  {
    "fact": "Fact text written concisely in 3rd person (e.g. User's name is Kapil)",
    "category": "profile" | "preferences" | "routines" | "projects" | "people",
    "target_file": "profile.md" | "preferences.md" | "routines.md" | "projects/<name>.md" | "people/<name>.md",
    "confidence": number (0.0 to 1.0)
  }
]

Strict Rules for Extraction:
1. PRIORITIZE IDENTITY FACTS: User's name, job role, title, core identity go straight to "profile.md".
2. TARGET FILE MAPPING:
   - Profile/identity -> "profile.md"
   - Likes/dislikes/communication style -> "preferences.md"
   - Recurring patterns/schedules -> "routines.md"
   - Specific project notes -> "projects/<project-name>.md"
   - Information about specific people -> "people/<person-name>.md"
3. STRICT SENSITIVITY FILTER:
   - EXCLUDE health, medical, financial, credit card, password, bank, or relationship details UNLESS the user explicitly and directly instructs Saira to remember/note it down (e.g., "Remember that I'm allergic to peanuts", "Keep in mind my wife's name is Sarah").
   - Never extract casual or implicit health/financial mentions.
4. CONFIDENCE THRESHOLD: Only extract facts with high confidence (>= 0.75).
5. If no noteworthy facts are present in the turn, return an empty JSON array: []`;

const CONTRADICTION_CHECK_PROMPT = `You are a memory dedup and contradiction analyzer.
Given an existing list of bullet point facts from a memory file and a NEW extracted fact, determine if the new fact is a duplicate, a contradiction, or new information.

Return ONLY a JSON object matching:
{
  "isDuplicate": boolean,
  "isContradiction": boolean,
  "existingIndex": number (-1 if none),
  "updatedBulletText": string | null (If contradiction, construct updated line merging old & new e.g. "Eats chicken now (previously vegetarian)")
}`;

/**
 * Parses JSON response from LLM string.
 */
function safeJsonParse<T>(raw: string): T | null {
  if (!raw || !raw.trim()) return null;
  const cleaned = raw.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Try extracting JSON array [...] or object {...} using regex
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/) || cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as T;
      } catch (err) {
        console.warn('[Fact Extractor JSON Warning] Substring JSON parse failed:', err);
      }
    }
    console.warn('[Fact Extractor JSON Warning] Unable to parse LLM response as JSON:', raw);
    return null;
  }
}

/**
 * Runs async fact extraction after a turn completes (non-blocking).
 */
export async function extractAndStoreFacts(params: {
  userMessage: string;
  assistantResponse: string;
  llm: LLMProvider;
}): Promise<void> {
  const turnPrompt = `User: ${params.userMessage}\nAssistant: ${params.assistantResponse}\n\nExtract long-term memory facts as a JSON array:`;

  try {
    const response = await params.llm.generateCompletion(FACT_EXTRACTION_SYSTEM_PROMPT, turnPrompt);
    const facts = safeJsonParse<ExtractedFact[]>(response);

    if (!facts || !Array.isArray(facts) || facts.length === 0) {
      return;
    }

    const memoryDir = getAppPaths().memoryDir;

    for (const item of facts) {
      if (!item.fact || !item.target_file || (item.confidence != null && item.confidence < 0.75)) {
        continue;
      }

      // Check target file for existing facts to analyze duplicates/contradictions
      let relPath = item.target_file.replace(/^memory[\/\\]/, '');
      if (!relPath.endsWith('.md')) relPath += '.md';

      const fullPath = path.join(memoryDir, relPath);
      let existingBullets: string[] = [];

      if (fs.existsSync(fullPath)) {
        const fileContent = fs.readFileSync(fullPath, 'utf-8');
        const parsed = parseMemoryFile(fileContent);
        existingBullets = parsed.bullets;
      }

      let contradictionInfo: { isContradiction: boolean; existingFactIndex?: number; updatedBulletText?: string } | undefined;

      if (existingBullets.length > 0) {
        const checkPrompt = `Existing Bullets:\n${existingBullets.map((b, idx) => `[${idx}] ${b}`).join('\n')}\n\nNew Fact: "${item.fact}"`;
        try {
          const checkResp = await params.llm.generateCompletion(CONTRADICTION_CHECK_PROMPT, checkPrompt);
          const checkResult = safeJsonParse<{
            isDuplicate: boolean;
            isContradiction: boolean;
            existingIndex: number;
            updatedBulletText: string | null;
          }>(checkResp);

          if (checkResult) {
            if (checkResult.isDuplicate) {
              console.log(`[Fact Extractor] Skipping duplicate fact: "${item.fact}" for ${relPath}`);
              continue;
            }
            if (checkResult.isContradiction && checkResult.existingIndex >= 0) {
              contradictionInfo = {
                isContradiction: true,
                existingFactIndex: checkResult.existingIndex,
                updatedBulletText: checkResult.updatedBulletText || `${item.fact} (previously: ${existingBullets[checkResult.existingIndex]})`,
              };
            }
          }
        } catch (err) {
          console.warn('[Fact Extractor] Contradiction check failed, proceeding with standard append:', err);
        }
      }

      console.log(`[Fact Extractor] Saving fact to ${relPath}: "${item.fact}"`);
      await saveFactToMemory({
        fact: item.fact,
        category: item.category,
        targetFile: relPath,
        contradictionInfo,
      });
    }
  } catch (err) {
    console.error('[Fact Extractor Error] Exception during async fact extraction:', err);
  }
}
