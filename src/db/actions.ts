import { and, eq, lte } from 'drizzle-orm';
import { db, assertDbReady } from './index';
import { reminders, todos } from './schema';

export async function createReminder(
  database: typeof db,
  text: string,
  due: Date,
): Promise<number> {
  assertDbReady();
  const result = database
    .insert(reminders)
    .values({ text, due: due.toISOString(), notified: 0 })
    .returning({ id: reminders.id })
    .get();
  return result.id;
}

export async function listPendingReminders(database: typeof db) {
  assertDbReady();
  return database
    .select()
    .from(reminders)
    .where(eq(reminders.notified, 0))
    .all();
}

export async function markReminderNotified(database: typeof db, id: number) {
  assertDbReady();
  database.update(reminders).set({ notified: 1 }).where(eq(reminders.id, id)).run();
}

export async function getDueReminders(database: typeof db, now: Date) {
  assertDbReady();
  return database
    .select()
    .from(reminders)
    .where(and(lte(reminders.due, now.toISOString()), eq(reminders.notified, 0)))
    .all();
}

export async function createTodo(database: typeof db, text: string): Promise<number> {
  assertDbReady();
  const result = database.insert(todos).values({ text, completed: 0 }).returning({ id: todos.id }).get();
  return result.id;
}

export async function listTodos(database: typeof db) {
  assertDbReady();
  return database.select().from(todos).all();
}

export async function completeTodo(database: typeof db, id: number) {
  assertDbReady();
  database.update(todos).set({ completed: 1 }).where(eq(todos.id, id)).run();
}
