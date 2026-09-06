import { db } from '../db';
import {
  completeTodo,
  createReminder,
  createTodo,
  listPendingReminders,
  listTodos,
  markReminderNotified,
} from '../db/actions';
import type { AssistantResponse, IntentResult } from '../shared/types';

export async function executeIntent(intent: IntentResult): Promise<AssistantResponse> {
  switch (intent.intent) {
    case 'chat.respond': {
      const msg = intent.params?.message || (intent as any).message || (intent as any).response || (intent as any).text || '';
      return { spoken: msg, display: msg };
    }

    case 'reminder.create': {
      const text = intent.params?.text?.trim();
      const rawDue = intent.params?.due;
      if (!text) {
        const msg = 'Unable to set reminder: Missing reminder text.';
        return { spoken: msg, display: msg };
      }
      if (!rawDue) {
        const msg = 'Unable to set reminder: Missing due date/time.';
        return { spoken: msg, display: msg };
      }
      const due = new Date(rawDue);
      if (isNaN(due.getTime())) {
        const msg = `Unable to set reminder: Invalid date format "${rawDue}".`;
        return { spoken: msg, display: msg };
      }

      await createReminder(db, text, due);
      const displayText = `Reminder set: ${text} at ${due.toLocaleString()}`;
      const spokenText = `I have set a reminder for ${text} at ${due.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`;
      return {
        spoken: spokenText,
        display: displayText,
      };
    }

    case 'reminder.list': {
      const reminders = await listPendingReminders(db);
      if (reminders.length === 0) {
        const msg = 'You have no upcoming reminders.';
        return { spoken: msg, display: msg };
      }
      const text = reminders.map((r) => `- ${r.text} at ${new Date(r.due).toLocaleString()}`).join('\n');
      const spokenText = `You have ${reminders.length} upcoming ${reminders.length === 1 ? 'reminder' : 'reminders'}: ${reminders.map(r => r.text).join(', ')}.`;
      return {
        spoken: spokenText,
        display: text,
      };
    }

    case 'reminder.complete': {
      const rawId = intent.params?.id;
      const reminderId = Number(rawId);
      if (!rawId || isNaN(reminderId) || reminderId <= 0) {
        const msg = 'Unable to complete reminder: Missing or invalid reminder ID.';
        return { spoken: msg, display: msg };
      }
      await markReminderNotified(db, reminderId);
      const msg = `Reminder #${reminderId} marked complete.`;
      return { spoken: msg, display: msg };
    }

    case 'todo.create': {
      const text = intent.params?.text?.trim();
      if (!text) {
        const msg = 'Unable to add to-do: Missing item text.';
        return { spoken: msg, display: msg };
      }
      await createTodo(db, text);
      const msg = `Added ${text} to your to-do list.`;
      return { spoken: msg, display: msg };
    }

    case 'todo.list': {
      const todos = await listTodos(db);
      if (todos.length === 0) {
        const msg = 'Your to-do list is empty.';
        return { spoken: msg, display: msg };
      }
      const text = todos.map((t) => `- [${t.completed ? 'x' : ' '}] ${t.text}`).join('\n');
      const pendingTodos = todos.filter(t => !t.completed);
      const spokenText = pendingTodos.length === 0 
        ? 'All your to-dos are completed.' 
        : `Here are your to-dos: ${pendingTodos.map(t => t.text).join(', ')}.`;
      return {
        spoken: spokenText,
        display: text,
      };
    }

    case 'todo.complete': {
      const rawId = intent.params?.id;
      const todoId = Number(rawId);
      if (!rawId || isNaN(todoId) || todoId <= 0) {
        const msg = 'Unable to complete to-do: Missing or invalid to-do ID.';
        return { spoken: msg, display: msg };
      }
      await completeTodo(db, todoId);
      const msg = `To-do #${todoId} marked complete.`;
      return { spoken: msg, display: msg };
    }

    case 'unknown':
    default: {
      return {
        spoken: "I'm not sure how to help with that yet.",
        display: 'Unknown intent.',
      };
    }
  }
}
