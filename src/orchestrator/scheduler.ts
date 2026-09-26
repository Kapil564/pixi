import notifier from 'node-notifier';
import { db } from '../db';
import { getDueReminders, markReminderNotified } from '../db/actions';
import type { TTSProvider } from '../providers/tts';
import { isPipelineReady } from '../providers/readiness';

let isChecking = false;
let pollingIntervalId: NodeJS.Timeout | null = null;

/**
 * Checks for due, unnotified reminders in SQLite, sends native Windows notifications,
 * speaks reminder via TTS, and marks reminder notified in database.
 * Can be called manually (e.g. on system sleep resume / screen unlock).
 */
export async function checkAndFireDueReminders(tts: TTSProvider): Promise<void> {
  if (isChecking) return;
  isChecking = true;

  try {
    const due = await getDueReminders(db, new Date());
    for (const reminder of due) {
      // TTS is the last pipeline stage (STT -> LLM -> TTS). Until the shared
      // readiness gate reports the full pipeline ready, skip spoken delivery and
      // leave the reminder pending so it is retried once setup completes.
      if (!isPipelineReady()) {
        console.log(
          `[Scheduler] Skipping spoken reminder #${reminder.id}: voice pipeline not ready yet (STT -> LLM -> TTS gate). Reminder stays pending.`
        );
        continue;
      }

      const message = `Reminder: ${reminder.text}`;
      console.log(`[Scheduler] Firing due reminder #${reminder.id}: "${reminder.text}"`);

      notifier.notify({
        title: 'pixi Reminder',
        message: reminder.text,
        sound: true,
      });

      try {
        await tts.speak(message);
        await markReminderNotified(db, reminder.id);
      } catch (err) {
        console.error('[Scheduler TTS Error] Spoken reminder failed, leaving reminder pending for retry:', err);
      }
    }
  } catch (err) {
    console.error('[Scheduler Error]:', err);
  } finally {
    isChecking = false;
  }
}

/**
 * Starts background reminder polling on a 30-second interval independent of UI window state.
 * Includes a multiple-start guard to prevent duplicate interval accumulations.
 */
export function startReminderPolling(tts: TTSProvider): void {
  if (pollingIntervalId) {
    console.log('[Scheduler] Background reminder polling loop is already active.');
    return;
  }

  console.log('[Scheduler] Starting background reminder polling loop (30s interval)...');

  // Run immediate check on startup
  checkAndFireDueReminders(tts);

  // Poll every 30 seconds
  pollingIntervalId = setInterval(() => {
    checkAndFireDueReminders(tts);
  }, 30 * 1000);
}
