/**
 * AI Context Builder — hydrates page context into data Haiku can use.
 * Takes { page, entityType, entityId } from the frontend and returns
 * a concise string describing the current state.
 */

const { getDb } = require('../../db/database');

/**
 * Build context string from page context
 * @param {Object} pageContext - { page, entityType, entityId }
 * @returns {string} Context description for the system prompt
 */
async function buildContext(pageContext) {
  if (!pageContext || !pageContext.page) return '';

  const db = getDb();
  const parts = [];
  const page = pageContext.page;

  // Inject current date/time so the model knows "today"
  const now = new Date();
  parts.push(`Current date and time: ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}, ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`);

  parts.push(`User is on page: ${page}`);

  // Dish edit/view context
  if (pageContext.entityType === 'dish' && pageContext.entityId) {
    const dish = db.prepare(
      'SELECT id, name, description, category, chefs_notes, batch_yield, suggested_price FROM dishes WHERE id = ? AND deleted_at IS NULL'
    ).get(pageContext.entityId);

    if (dish) {
      parts.push(`Current dish: "${dish.name}" (ID: ${dish.id})`);
      if (dish.category) parts.push(`Category: ${dish.category}`);
      if (dish.description) parts.push(`Description: ${dish.description}`);
      if (dish.batch_yield) parts.push(`Batch yield: ${dish.batch_yield} portions`);

      // Get ingredients
      const ingredients = db.prepare(
        `SELECT di.quantity, di.unit, i.name, di.prep_note, di.sort_order
         FROM dish_ingredients di
         JOIN ingredients i ON di.ingredient_id = i.id
         WHERE di.dish_id = ?
         ORDER BY di.sort_order`
      ).all(pageContext.entityId);

      if (ingredients.length) {
        parts.push('Ingredients:');
        for (const ing of ingredients) {
          const qty = ing.quantity ? `${ing.quantity}${ing.unit ? ' ' + ing.unit : ''}` : '';
          const prep = ing.prep_note ? `, ${ing.prep_note}` : '';
          parts.push(`  - ${qty} ${ing.name}${prep}`);
        }
      }

      // Get directions
      const directions = db.prepare(
        'SELECT type, text, sort_order FROM dish_directions WHERE dish_id = ? ORDER BY sort_order'
      ).all(pageContext.entityId);

      if (directions.length) {
        parts.push('Current directions:');
        let stepNum = 0;
        for (const dir of directions) {
          if (dir.type === 'section') {
            parts.push(`  [${dir.text}]`);
            stepNum = 0;
          } else {
            stepNum++;
            parts.push(`  ${stepNum}. ${dir.text}`);
          }
        }
      } else if (dish.chefs_notes) {
        parts.push(`Chef's notes (legacy): ${dish.chefs_notes}`);
      }

      // Get allergens
      const allergens = db.prepare(
        'SELECT allergen, source FROM dish_allergens WHERE dish_id = ?'
      ).all(pageContext.entityId);

      if (allergens.length) {
        parts.push('Current allergens: ' + allergens.map(a => `${a.allergen} (${a.source})`).join(', '));
      }
    }
  }

  // Menu context
  if (pageContext.entityType === 'menu' && pageContext.entityId) {
    const menu = db.prepare(
      'SELECT id, name, description, sell_price, expected_covers, menu_type, event_date, service_style FROM menus WHERE id = ? AND deleted_at IS NULL'
    ).get(pageContext.entityId);

    if (menu) {
      parts.push(`Current menu: "${menu.name}" (ID: ${menu.id})`);
      if (menu.menu_type) parts.push(`Menu type: ${menu.menu_type}`);
      if (menu.service_style) parts.push(`Service style: ${menu.service_style}`);
      if (menu.event_date) parts.push(`Event date: ${menu.event_date}`);
      if (menu.sell_price) parts.push(`Sell price: ${menu.sell_price}`);
      if (menu.expected_covers) parts.push(`Expected covers: ${menu.expected_covers}`);

      // Get courses/sections
      const courses = db.prepare(
        'SELECT id, name, notes FROM menu_courses WHERE menu_id = ? ORDER BY sort_order'
      ).all(pageContext.entityId);

      const dishes = db.prepare(
        `SELECT d.id, d.name, d.category, md.servings, md.course_id
         FROM menu_dishes md
         JOIN dishes d ON md.dish_id = d.id
         WHERE md.menu_id = ? AND d.deleted_at IS NULL
         ORDER BY md.sort_order`
      ).all(pageContext.entityId);

      if (courses.length) {
        parts.push(`Courses/Sections (${courses.length}):`);
        for (const c of courses) {
          const courseDishes = dishes.filter(d => d.course_id === c.id);
          parts.push(`  [${c.name}] (${courseDishes.length} dishes)${c.notes ? ' — ' + c.notes : ''}`);
          for (const d of courseDishes) {
            parts.push(`    - ${d.name} (${d.category || 'uncategorized'}, ${d.servings} servings)`);
          }
        }
      }

      const unassigned = dishes.filter(d => !d.course_id);
      if (unassigned.length) {
        parts.push(`${courses.length ? 'Unassigned d' : 'D'}ishes on menu:`);
        for (const d of unassigned) {
          parts.push(`  - ${d.name} (${d.category || 'uncategorized'}, ${d.servings} servings)`);
        }
      }
    }
  }

  // --- Kitchen pulse: compact stats so Haiku knows current workload ---
  const taskPending = db.prepare('SELECT COUNT(*) as cnt FROM tasks WHERE completed = 0').get().cnt;
  const taskOverdue = db.prepare("SELECT COUNT(*) as cnt FROM tasks WHERE completed = 0 AND due_date < date('now')").get().cnt;
  if (taskPending > 0 || taskOverdue > 0) {
    const overdueNote = taskOverdue > 0 ? ` (${taskOverdue} overdue)` : '';
    parts.push(`Tasks: ${taskPending} pending${overdueNote}`);
  }

  const todayNotes = db.prepare(
    "SELECT title, shift FROM service_notes WHERE date = date('now') ORDER BY created_at DESC LIMIT 3"
  ).all();
  if (todayNotes.length) {
    parts.push("Today's service notes: " + todayNotes.map(n => `${n.title} (${n.shift})`).join(', '));
  }

  const upcomingEvents = db.prepare(
    "SELECT id, name, event_date FROM menus WHERE deleted_at IS NULL AND menu_type = 'event' AND event_date >= date('now') ORDER BY event_date LIMIT 5"
  ).all();
  if (upcomingEvents.length) {
    parts.push('Upcoming events: ' + upcomingEvents.map(m => `${m.name} on ${m.event_date} (${m.id})`).join(', '));
  }

  // Provide dish/menu lists for name resolution — skip when already on a specific entity.
  // Keep lists compact: name + ID only, capped to reduce token overhead.
  if (!pageContext.entityType) {
    const dishes = db.prepare(
      'SELECT id, name FROM dishes WHERE deleted_at IS NULL ORDER BY name LIMIT 25'
    ).all();
    if (dishes.length) {
      parts.push('Dishes: ' + dishes.map(d => `${d.name} (${d.id})`).join(', '));
      const total = db.prepare('SELECT COUNT(*) as cnt FROM dishes WHERE deleted_at IS NULL').get().cnt;
      if (total > 25) parts.push(`(${total - 25} more — use search_dishes)`);
    }
  }

  if (pageContext.entityType !== 'menu') {
    const menus = db.prepare(
      'SELECT id, name FROM menus WHERE deleted_at IS NULL ORDER BY name LIMIT 10'
    ).all();
    if (menus.length) {
      parts.push('Menus: ' + menus.map(m => `${m.name} (${m.id})`).join(', '));
    }
  }

  return parts.join('\n');
}

/**
 * Build dynamic suggestion hints — lightweight stats for the command bar.
 * No AI call, pure DB. Returns { suggestions: [...] } keyed by page pattern.
 */
function buildSuggestionHints(page) {
  const db = getDb();
  const hints = [];

  // Task stats — useful on any page
  const taskOverdue = db.prepare("SELECT COUNT(*) as cnt FROM tasks WHERE completed = 0 AND due_date < date('now')").get().cnt;

  // Menu stats
  const menusWithoutTasks = db.prepare(
    `SELECT m.id, m.name FROM menus m
     WHERE m.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.menu_id = m.id AND t.source = 'auto')
     LIMIT 3`
  ).all();

  // Upcoming events
  const nextEvent = db.prepare(
    "SELECT name, event_date FROM menus WHERE deleted_at IS NULL AND menu_type = 'event' AND event_date >= date('now') ORDER BY event_date LIMIT 1"
  ).get();

  // Dishes without directions (could use cleanup)
  const dishesNeedingCleanup = db.prepare(
    `SELECT d.id, d.name FROM dishes d
     WHERE d.deleted_at IS NULL
     AND d.chefs_notes IS NOT NULL AND d.chefs_notes != ''
     AND NOT EXISTS (SELECT 1 FROM dish_directions dd WHERE dd.dish_id = d.id)
     LIMIT 3`
  ).all();

  // Today's notes count
  const todayNotesCount = db.prepare("SELECT COUNT(*) as cnt FROM service_notes WHERE date = date('now')").get().cnt;

  // Build page-specific dynamic suggestions
  if (page === '#/todos' || page === '#/today') {
    if (taskOverdue > 0) {
      hints.push({ icon: '\u26a0\ufe0f', text: `${taskOverdue} overdue task${taskOverdue !== 1 ? 's' : ''}`, prompt: 'Show me overdue tasks' });
    }
    for (const m of menusWithoutTasks) {
      hints.push({ icon: '\ud83d\udccb', text: `Generate prep for ${m.name}`, prompt: `Generate prep tasks for menu "${m.name}"` });
    }
  } else if (page === '#/dishes' || page === '#/' || page === '') {
    for (const d of dishesNeedingCleanup.slice(0, 2)) {
      hints.push({ icon: '\u2728', text: `Clean up ${d.name}`, prompt: `Clean up the recipe for "${d.name}"` });
    }
  } else if (page === '#/menus') {
    for (const m of menusWithoutTasks.slice(0, 2)) {
      hints.push({ icon: '\ud83d\udccb', text: `Generate prep for ${m.name}`, prompt: `Generate prep tasks for menu "${m.name}"` });
    }
  } else if (page === '#/service-notes') {
    if (todayNotesCount === 0) {
      hints.push({ icon: '\ud83d\udcdd', text: "No notes for today yet", prompt: 'Add a service note for today: ' });
    }
  }

  // Universal hints (shown on any page when relevant)
  if (nextEvent && !page.startsWith('#/menus/')) {
    hints.push({ icon: '\ud83d\udcc5', text: `${nextEvent.name} — ${nextEvent.event_date}`, prompt: `Tell me about the upcoming event "${nextEvent.name}"` });
  }
  if (taskOverdue > 0 && page !== '#/todos' && page !== '#/today') {
    hints.push({ icon: '\u26a0\ufe0f', text: `${taskOverdue} overdue task${taskOverdue !== 1 ? 's' : ''}`, prompt: 'Show me overdue tasks' });
  }

  return hints;
}

module.exports = { buildContext, buildSuggestionHints };
