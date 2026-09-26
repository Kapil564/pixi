export type IntentResult =
  | { intent: 'chat.respond'; params: { message: string } }
  | { intent: 'reminder.create'; params: { text: string; due: string } }
  | { intent: 'reminder.list'; params: Record<string, never> }
  | { intent: 'reminder.complete'; params: { id?: number; text?: string } }
  | { intent: 'todo.create'; params: { text: string } }
  | { intent: 'todo.list'; params: Record<string, never> }
  | { intent: 'todo.complete'; params: { id?: number; text?: string } }
  | { intent: 'unknown'; params: Record<string, never> };

export interface TranscriptionResult {
  text: string;
}

export interface AssistantResponse {
  spoken?: string;
  display?: string;
  intent?: string;
}
