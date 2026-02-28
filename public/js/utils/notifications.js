/**
 * Notification Engine — client-side reminder scheduling for PlateStack.
 *
 * Uses the Notification API (not Web Push) to show reminders for:
 *  - Prep phase transitions ("Prep starts in 15 min")
 *  - Task due times ("Braise short ribs is due in 10 min")
 *  - Overdue task alerts (periodic)
 *  - Daily briefing ("You have 8 tasks today")
 *  - Expiring weekly specials
 *
 * All scheduling is client-side via setTimeout. Works when the tab is open
 * (ideal for a kitchen tablet that stays on the app).
 */

import { getNotificationPreferences, getNotificationPending } from '../api.js';

const STORAGE_PREFIX = 'nt_shown_';
const CHECK_INTERVAL = 3 * 60 * 1000; // 3 minutes

let prefs = null;
let timers = [];
let checkIntervalId = null;
let running = false;

/**
 * Initialize the notification engine. Call once after auth succeeds.
 * Requests permission if not yet granted, loads preferences, starts scheduling.
 */
export async function initNotifications() {
  if (running) return;
  if (!('Notification' in window)) return;

  try {
    prefs = await getNotificationPreferences();
  } catch {
    return; // can't load prefs, silently skip
  }

  if (!prefs.enabled) return;

  // Request permission if needed
  if (Notification.permission === 'default') {
    const result = await Notification.requestPermission();
    if (result !== 'granted') return;
  }
  if (Notification.permission !== 'granted') return;

  running = true;
  await runCheck();
  checkIntervalId = setInterval(runCheck, CHECK_INTERVAL);
}

/**
 * Stop the notification engine. Call on logout or cleanup.
 */
export function stopNotifications() {
  running = false;
  clearAllTimers();
  if (checkIntervalId) {
    clearInterval(checkIntervalId);
    checkIntervalId = null;
  }
}

/**
 * Reload preferences and restart scheduling. Call when prefs change.
 */
export async function restartNotifications() {
  stopNotifications();
  await initNotifications();
}

// ─── Internal ────────────────────────────────────────────────────────────────

function clearAllTimers() {
  for (const t of timers) clearTimeout(t);
  timers = [];
}

function wasShown(key) {
  const today = new Date().toISOString().slice(0, 10);
  return localStorage.getItem(`${STORAGE_PREFIX}${key}_${today}`) === '1';
}

function markShown(key) {
  const today = new Date().toISOString().slice(0, 10);
  localStorage.setItem(`${STORAGE_PREFIX}${key}_${today}`, '1');
}

/** Clean up stale shown-markers older than today */
function cleanStaleMarkers() {
  const today = new Date().toISOString().slice(0, 10);
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(STORAGE_PREFIX) && !k.endsWith(today)) {
      keys.push(k);
    }
  }
  for (const k of keys) localStorage.removeItem(k);
}

function showNotification(title, body, tag, data) {
  if (wasShown(tag)) return;
  markShown(tag);

  try {
    const n = new Notification(title, {
      body,
      tag, // replaces existing notification with same tag
      icon: '/favicon.svg',
      data,
    });

    n.onclick = () => {
      window.focus();
      if (data && data.hash) {
        window.location.hash = data.hash;
      }
      n.close();
    };
  } catch {
    // Notification constructor can throw in some contexts
  }
}

async function runCheck() {
  if (!running || !prefs) return;

  cleanStaleMarkers();
  clearAllTimers();

  let pending;
  try {
    pending = await getNotificationPending();
  } catch {
    return;
  }

  const now = new Date();

  // 1. Daily briefing
  if (prefs.daily_briefing && pending.today_summary) {
    const { total, completed } = pending.today_summary;
    if (total > 0) {
      const briefingKey = 'briefing';
      if (!wasShown(briefingKey)) {
        const [bH, bM] = (prefs.daily_briefing_time || '08:00').split(':').map(Number);
        const briefingTime = new Date(now);
        briefingTime.setHours(bH, bM, 0, 0);

        if (now >= briefingTime) {
          // Past briefing time — show immediately if not shown
          const remaining = total - completed;
          showNotification(
            'Daily Briefing',
            `You have ${remaining} task${remaining !== 1 ? 's' : ''} today (${completed} already done).`,
            briefingKey,
            { hash: '#/today' }
          );
        } else {
          // Schedule for briefing time
          const delay = briefingTime - now;
          const remaining = total - completed;
          timers.push(setTimeout(() => {
            showNotification(
              'Daily Briefing',
              `You have ${remaining} task${remaining !== 1 ? 's' : ''} today.`,
              briefingKey,
              { hash: '#/today' }
            );
          }, delay));
        }
      }
    }
  }

  // 2. Overdue alerts
  if (prefs.overdue_alerts && pending.overdue && pending.overdue.length > 0) {
    const count = pending.overdue.length;
    const overdueKey = `overdue_${Math.floor(now.getTime() / (prefs.overdue_interval_minutes * 60 * 1000))}`;
    showNotification(
      'Overdue Tasks',
      `You have ${count} overdue task${count !== 1 ? 's' : ''}. The oldest: "${pending.overdue[0].title}"`,
      overdueKey,
      { hash: '#/todos' }
    );
  }

  // 3. Task due reminders
  if (prefs.task_due_reminders && pending.upcoming_today) {
    const leadMs = (prefs.task_lead_minutes || 10) * 60 * 1000;

    for (const task of pending.upcoming_today) {
      if (!task.due_time) continue;
      const [h, m] = task.due_time.split(':').map(Number);
      const dueAt = new Date(now);
      dueAt.setHours(h, m, 0, 0);

      const reminderAt = new Date(dueAt.getTime() - leadMs);
      const delay = reminderAt - now;
      const taskTag = `task_${task.id}`;

      if (delay <= 0 && delay > -leadMs) {
        // Within the reminder window now
        showNotification(
          'Task Due Soon',
          `"${task.title}" is due at ${task.due_time}${task.menu_name ? ` (${task.menu_name})` : ''}`,
          taskTag,
          { hash: '#/today' }
        );
      } else if (delay > 0) {
        // Schedule for later
        timers.push(setTimeout(() => {
          showNotification(
            'Task Due Soon',
            `"${task.title}" is due in ${prefs.task_lead_minutes} min${task.menu_name ? ` (${task.menu_name})` : ''}`,
            taskTag,
            { hash: '#/today' }
          );
        }, delay));
      }
    }
  }

  // 4. Prep phase reminders
  if (prefs.prep_reminders && pending.phases && pending.phases.length > 0) {
    const leadMs = (prefs.prep_lead_minutes || 15) * 60 * 1000;

    for (const phase of pending.phases) {
      if (!phase.start) continue;
      const [h, m] = phase.start.split(':').map(Number);
      const phaseStart = new Date(now);
      phaseStart.setHours(h, m, 0, 0);

      const reminderAt = new Date(phaseStart.getTime() - leadMs);
      const delay = reminderAt - now;
      const phaseTag = `phase_${phase.id}`;

      if (delay <= 0 && delay > -leadMs) {
        showNotification(
          'Phase Starting Soon',
          `${phase.name} starts at ${phase.start}`,
          phaseTag,
          { hash: '#/today' }
        );
      } else if (delay > 0) {
        timers.push(setTimeout(() => {
          showNotification(
            'Phase Starting Soon',
            `${phase.name} starts in ${prefs.prep_lead_minutes} min`,
            phaseTag,
            { hash: '#/today' }
          );
        }, delay));
      }
    }
  }

  // 5. Expiring specials
  if (prefs.specials_expiring && pending.expiring_specials && pending.expiring_specials.length > 0) {
    for (const special of pending.expiring_specials) {
      const specialTag = `special_${special.id}`;
      showNotification(
        'Special Expiring',
        `"${special.dish_name}" special ends ${special.week_end}`,
        specialTag,
        { hash: '#/specials' }
      );
    }
  }
}
