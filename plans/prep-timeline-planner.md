# Prep Timeline & Visual Day Planner — Implementation Plan

## Overview

Transform the Today page from a list-based task view into a visual timeline/day planner optimized for an ADHD chef. The core idea: **see time, don't read lists**. Tasks are shown as blocks on a horizontal timeline anchored to day phases, with a "now" marker that moves in real-time, parallel task swimlanes, and a stripped-down focus mode for service.

---

## Current State

### What exists today
- **Today page** (`public/js/pages/today.js`, `routes/today.js`): Groups tasks by day phase (Admin, Prep, Service, Wrap-up) + overdue + unscheduled. Shows progress bar, spotlight ("Do This Next"), phase icons.
- **Day phases** (configurable in Settings): Each has `id`, `name`, `start` (HH:MM), `end` (HH:MM). Default: Admin 12:00–14:30, Prep 14:30–17:00, Service 17:00–21:00, Wrap-up 21:00–22:30.
- **Tasks** have: `due_date`, `due_time` (HH:MM, optional), `day_phase` (nullable FK to phase id), `timing_bucket` (prep tasks), `priority`, `is_next`.
- **Notification engine** (`public/js/utils/notifications.js`): Fires reminders for phase transitions and task due times.

### What's missing
- No visual timeline — tasks are in card lists, not positioned by time.
- No duration/estimate per task — can't calculate when a task ends or if tasks overlap.
- No parallel track concept — a chef often has 3 things running simultaneously (stock simmering, butchering, sauces).
- No "now" marker — no visual indicator of where you are in the day.
- No focus mode — full app UI during service is overwhelming.
- No drag-to-reschedule — can't slide a task to a different time slot.

---

## Architecture

### New database columns/tables

```sql
-- Migration 1: Add estimated_minutes to tasks
ALTER TABLE tasks ADD COLUMN estimated_minutes INTEGER DEFAULT NULL;

-- Migration 2: Add track column for parallel swimlanes (A, B, C, etc.)
ALTER TABLE tasks ADD COLUMN track TEXT DEFAULT NULL;
```

No new tables needed. The timeline view is a frontend rendering concern — the data model just needs duration and track info.

### Backend changes

#### File: `routes/today.js`

**Modify `GET /api/today`:**
- Return `estimated_minutes` and `track` in task objects (already included since SELECT * is used).
- Add a new field `timeline_slots` — pre-computed array of time slots from phase start to end in 15-minute increments, with tasks assigned to their correct slot based on `due_time` + `estimated_minutes`. This helps the frontend render without doing time math.

```js
// Example timeline_slots response shape:
{
  timeline_slots: [
    { time: '14:30', phase_id: 'prep', tasks: [{ id: 1, title: 'Start stock', track: 'A', end_time: '15:30' }] },
    { time: '14:45', phase_id: 'prep', tasks: [] },
    { time: '15:00', phase_id: 'prep', tasks: [{ id: 2, title: 'Butcher proteins', track: 'B', end_time: '16:00' }] },
    // ...
  ]
}
```

**New endpoint: `PUT /api/todos/:id/schedule`**
Quick-schedule a task: set `due_time`, `estimated_minutes`, `track`, and `day_phase` in one call. Used by drag-to-reschedule.

```js
router.put('/:id/schedule', (req, res) => {
  const { due_time, estimated_minutes, track, day_phase } = req.body;
  // Validate HH:MM, positive integer, track is single letter A-D
  // Update task, broadcast task_updated
});
```

#### File: `routes/todos.js`

**Modify `POST /api/todos` and `PUT /api/todos/:id`:**
- Accept `estimated_minutes` (positive integer, nullable) and `track` (string A-D, nullable) in create/update.
- Include in auto→manual promotion logic (editing these fields also promotes).

#### File: `services/prepTaskGenerator.js`

**Modify `extractPrepTasks`:**
- Attempt to extract time estimates from direction text. Look for patterns like "simmer for 30 minutes", "rest 1 hour", "cook 20 min". Map to `estimated_minutes`.
- Return estimate alongside each task in the result.

**New function: `estimateDuration(text)`:**
```js
// Regex patterns:
// "(\d+)\s*(min|minute|minutes)" → N minutes
// "(\d+)\s*(hour|hours|hr|hrs)" → N * 60 minutes
// "(\d+)-(\d+)\s*(min|hour)" → average
// Default: 15 minutes for tasks with no detectable duration
function estimateDuration(text) {
  // ... regex matching ...
  return minutes || 15; // default 15 min
}
```

### Frontend changes

#### File: `public/js/pages/today.js` — Major rewrite

The today page gets two view modes: **Timeline View** (default) and **List View** (toggle for fallback).

**Timeline View layout:**

```
┌─────────────────────────────────────────────────────────────┐
│ [Timeline] [List] [Focus]          Today, Feb 28   12 / 18 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  NOW ▼                                                      │
│  ┌──────────┬──────────┬──────────┬──────────┐              │
│  │  Admin   │   Prep   │ Service  │ Wrap-up  │              │
│  │ 12–14:30 │ 14:30–17 │  17–21   │ 21–22:30 │              │
│  ├──────────┼──────────┼──────────┼──────────┤              │
│  │          │ ████████ │          │          │  Track A      │
│  │ ████     │ ████████ │          │          │               │
│  │          │     █████│          │          │  Track B      │
│  │          │ ████     │          │          │               │
│  │          │          │ ████████ │          │  Track C      │
│  └──────────┴──────────┴──────────┴──────────┘              │
│                                                             │
│  ┌─ Unscheduled (3) ──────────────────────────────────────┐ │
│  │ • Order fish  • Call supplier  • Menu review           │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌─ Overdue (2) ──────────────────────────────────────────┐ │
│  │ • Prep mushroom duxelles (yesterday)                   │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Key UI elements:**

1. **Horizontal timeline** with phase columns sized proportional to their duration.
2. **Now marker** — red vertical line at current time position, auto-scrolls every minute via `setInterval`. On mobile, the timeline auto-scrolls to center the now marker.
3. **Task blocks** — colored rectangles spanning their `estimated_minutes`. Width = (duration / phase_duration) * column_width. Height varies by track (A=top, B=middle, C=bottom).
4. **Track swimlanes** — up to 3-4 parallel tracks. Tasks without a track auto-assigned by the frontend (greedy algorithm: assign to first track with no overlap).
5. **Drag-to-reschedule** — drag a task block horizontally to change its `due_time`. Drop snaps to 15-minute increments. Calls `PUT /api/todos/:id/schedule`.
6. **Unscheduled tasks** — below the timeline, tasks with no `due_time`. Can be dragged onto the timeline to schedule them.
7. **Completed tasks** — fade to 50% opacity, strikethrough title. Toggle to hide completed.
8. **Priority colors** — high=red border-left, medium=yellow, low=green.
9. **Click to expand** — clicking a task block shows a popover with full details + edit/complete/delete actions.

**List View** (toggle):
- Preserves the current card-based layout as a fallback.
- Same data, just rendered as grouped cards instead of timeline blocks.

**Focus Mode** (toggle):
- Strips the UI to a single centered panel:
  ```
  ┌────────────────────────────────┐
  │          DO THIS NEXT          │
  │                                │
  │   Braise Short Ribs            │
  │   Due: 15:30 · Prep phase      │
  │                                │
  │        [ Done ✓ ]              │
  │                                │
  │   Next up: Reduce jus          │
  │                                │
  │      [Exit Focus Mode]         │
  └────────────────────────────────┘
  ```
- No sidebar, no nav bar (hidden via CSS class on body).
- Shows only the `is_next` task (or first uncompleted high-priority task if none marked).
- "Done" button completes it and auto-advances to the next task (by due_time, then priority).
- Large touch targets for kitchen glove use.
- Background color shifts by phase (subtle: prep=blue tint, service=warm tint).
- Auto-exits when all tasks are done (shows completion celebration).

#### File: `public/js/utils/timelineRenderer.js` — New utility

Extracted rendering logic to keep `today.js` manageable:

```js
/**
 * Render the timeline grid into a container element.
 * @param {HTMLElement} container - Target element
 * @param {Object} data - Response from GET /api/today (with timeline_slots)
 * @param {Object} options - { onTaskClick, onTaskDrop, onTaskComplete }
 */
export function renderTimeline(container, data, options) {
  // 1. Calculate phase column widths (proportional to duration)
  // 2. Render phase headers
  // 3. Render time grid (15-min marks with subtle lines)
  // 4. Auto-assign tracks for tasks without explicit track
  // 5. Render task blocks positioned by time and track
  // 6. Render now marker
  // 7. Attach drag handlers
  // 8. Start now-marker interval (updates every 60s)
  // Return cleanup function for the interval
}

/**
 * Auto-assign tracks to avoid overlaps (greedy algorithm).
 * @param {Array} tasks - Tasks with due_time and estimated_minutes
 * @returns {Array} Tasks with track assigned
 */
export function autoAssignTracks(tasks) {
  // Sort by due_time
  // For each task, try tracks A, B, C, D...
  // Assign to first track where no existing task overlaps
  // Overlap = task.start < existing.end && task.end > existing.start
}
```

#### File: `public/js/utils/focusMode.js` — New utility

```js
/**
 * Enter focus mode: hide nav, show single-task view.
 * @param {Object} currentTask - The task to focus on
 * @param {Object} callbacks - { onComplete, onSkip, onExit }
 */
export function enterFocusMode(currentTask, callbacks) {
  // Add 'focus-mode' class to document.body
  // Create full-screen overlay with task details
  // Large "Done" button, "Skip" link, "Exit" button
  // Return cleanup function
}
```

### CSS changes

#### File: `public/css/style.css`

New sections with prefix `.tl-` (timeline) and `.fm-` (focus mode):

```css
/* ============================
   Timeline View (.tl-)
   ============================ */

.tl-container { ... }           /* Horizontal scrolling container */
.tl-phase-columns { ... }       /* Flex row of phase columns */
.tl-phase-column { ... }        /* Single phase column, proportional width */
.tl-phase-header { ... }        /* Phase name + time range label */
.tl-grid { ... }                /* 15-min gridlines */
.tl-grid-line { ... }           /* Subtle vertical lines at each 15-min mark */
.tl-track { ... }               /* Horizontal swimlane within a phase */
.tl-task-block { ... }          /* Individual task rectangle */
.tl-task-block--high { ... }    /* Red left border for high priority */
.tl-task-block--completed { ... } /* Faded + strikethrough */
.tl-now-marker { ... }          /* Red vertical line, position: absolute */
.tl-time-label { ... }          /* HH:MM labels along the top */
.tl-unscheduled { ... }         /* Below-timeline unscheduled task area */
.tl-overdue { ... }             /* Overdue section */

/* --- Timeline: drag state --- */
.tl-task-block--dragging { ... }
.tl-drop-zone { ... }
.tl-drop-zone--active { ... }

/* ============================
   Focus Mode (.fm-)
   ============================ */

.fm-overlay { ... }             /* Full-screen fixed overlay */
.fm-card { ... }                /* Centered task card */
.fm-title { ... }               /* Large task title */
.fm-meta { ... }                /* Due time, phase, menu badge */
.fm-done-btn { ... }            /* Large touch-friendly button */
.fm-next-preview { ... }        /* "Next up: ..." text */
.fm-exit { ... }                /* Exit button */
.fm-phase-bg--prep { ... }      /* Subtle background tint per phase */
.fm-phase-bg--service { ... }
.fm-completion { ... }          /* Celebration screen when all done */

/* --- Focus Mode: body state --- */
body.focus-mode .top-nav,
body.focus-mode #bottom-nav,
body.focus-mode .sidebar-reveal-btn,
body.focus-mode .quick-capture-bar { display: none; }
```

**Responsive considerations:**
- **Desktop (>480px):** Full horizontal timeline, phases side by side.
- **Mobile (<=480px):** Timeline scrolls horizontally, current phase auto-scrolled into view. Focus mode is identical (already full-screen).
- **Print:** Timeline renders as a simple table (phase → tasks list). Focus mode hidden.

### API client additions

#### File: `public/js/api.js`

```js
export const scheduleTask = (id, data) => request(`/todos/${id}/schedule`, { method: 'PUT', body: data });
```

---

## Implementation Order

### Phase 1: Data model + backend (estimated: 1 session)
1. Add `estimated_minutes` and `track` migrations to `db/database.js`.
2. Add same migrations to `tests/helpers/setupTestApp.js`.
3. Update `PUT /api/todos/:id` and `POST /api/todos` in `routes/todos.js` to accept `estimated_minutes` and `track`.
4. Add `PUT /api/todos/:id/schedule` endpoint.
5. Add `estimateDuration(text)` function to `services/prepTaskGenerator.js` (exported for testing).
6. Wire `estimateDuration` into `generatePrepTasks` to auto-populate `estimated_minutes` for generated prep tasks.
7. Modify `GET /api/today` to include `timeline_slots` computation.
8. Write unit tests for `estimateDuration` in `tests/prepTaskGenerator.test.js`.
9. Write integration tests for schedule endpoint and updated today response.
10. Add `scheduleTask` to `public/js/api.js`.

### Phase 2: Timeline renderer (estimated: 1-2 sessions)
1. Create `public/js/utils/timelineRenderer.js` with `renderTimeline()` and `autoAssignTracks()`.
2. Create timeline CSS section (`.tl-*` classes) in `style.css`.
3. Modify `public/js/pages/today.js`:
   - Add view mode toggle (Timeline / List / Focus) at top.
   - Default to Timeline view.
   - Move existing card rendering to a `renderListView()` function.
   - Add `renderTimelineView()` that calls `renderTimeline()`.
   - Preserve all existing functionality (spotlight, progress, overdue, sync listeners).
4. Implement the now-marker with `setInterval` (update position every 60 seconds).
5. Implement click-to-expand popover on task blocks.
6. Add responsive styles for mobile timeline scrolling.
7. Test on desktop and mobile viewports.

### Phase 3: Drag-to-reschedule (estimated: 1 session)
1. Add drag event handlers to task blocks (`mousedown`/`touchstart` → `mousemove`/`touchmove` → `mouseup`/`touchend`).
2. Implement snap-to-15-minute grid logic.
3. On drop: call `PUT /api/todos/:id/schedule` with new `due_time`.
4. Visual feedback: ghost block during drag, highlight drop zone.
5. Support dragging unscheduled tasks onto the timeline (assigns `due_time` + `day_phase`).
6. Test touch interactions on mobile.

### Phase 4: Focus mode (estimated: 1 session)
1. Create `public/js/utils/focusMode.js` with `enterFocusMode()`.
2. Add focus mode CSS (`.fm-*` classes).
3. Wire focus mode toggle button in today.js.
4. Implement auto-advance on task completion.
5. Implement phase-based background tinting.
6. Implement completion celebration.
7. Ensure nav/sidebar hidden and restored on exit.
8. Test with touch interactions (kitchen glove-friendly tap targets).

### Phase 5: Polish + integration (estimated: 1 session)
1. Ensure notification engine works with timeline (phase reminders trigger visual flash on the phase header).
2. Add print styles for timeline view (as a simple table).
3. Duration estimation for imported recipes (hook into recipe importer output).
4. localStorage persistence for preferred view mode (`today_view_mode`).
5. Update CLAUDE.md with new endpoints, CSS prefixes, and patterns.
6. Full test suite pass + lint clean.

---

## Key Decisions

### Why client-side timeline computation?
The backend returns raw task data with times; the frontend computes pixel positions. This keeps the server simple and allows smooth drag interactions without round-trips. The backend's `timeline_slots` is an optional optimization — the frontend can compute slots itself from the raw data if needed.

### Why 15-minute grid?
Kitchen work doesn't need minute-level precision. 15-minute blocks are the right granularity — enough to distinguish tasks without being fiddly on a touch screen. The grid also constrains drag-to-reschedule to sensible increments.

### Why max 3-4 tracks?
A chef realistically juggles 2-3 parallel tasks (main station work + something simmering + something in the oven). 4 tracks is the practical upper limit. More would make the UI too dense. The auto-assign algorithm fills tracks A→B→C greedily.

### Why focus mode is separate from timeline?
Timeline = planning. Focus = execution. These are different mental modes. During service, the chef doesn't need to see the whole day — they need to see ONE thing. Focus mode optimizes for single-task attention, which is the ADHD superpower when properly harnessed.

### Why not a calendar library?
The timeline is purpose-built for a kitchen day (5-12 hour span, not 24 hours; phase-based, not hour-based). Calendar libraries (FullCalendar, etc.) add bundle bloat and force a generic day/week/month model that doesn't fit. The custom renderer is ~200 lines of vanilla JS — simpler and faster.

---

## Files Created/Modified Summary

| File | Action | Description |
|------|--------|-------------|
| `db/database.js` | Modify | Add 2 migrations (estimated_minutes, track) |
| `routes/today.js` | Modify | Add timeline_slots to GET response |
| `routes/todos.js` | Modify | Accept estimated_minutes, track in create/update; add schedule endpoint |
| `services/prepTaskGenerator.js` | Modify | Add estimateDuration() function |
| `public/js/api.js` | Modify | Add scheduleTask() |
| `public/js/pages/today.js` | Major rewrite | Timeline/List/Focus view modes |
| `public/js/utils/timelineRenderer.js` | Create | Timeline rendering + track assignment |
| `public/js/utils/focusMode.js` | Create | Focus mode overlay |
| `public/css/style.css` | Modify | Add .tl-* and .fm-* sections |
| `tests/prepTaskGenerator.test.js` | Modify | Add estimateDuration tests |
| `tests/integration/todos.test.js` | Modify | Add schedule endpoint tests |
| `tests/integration/today.test.js` | Modify | Add timeline_slots tests |
| `tests/helpers/setupTestApp.js` | Modify | Add migrations |
| `CLAUDE.md` | Modify | Document new endpoints, CSS prefixes, patterns |
