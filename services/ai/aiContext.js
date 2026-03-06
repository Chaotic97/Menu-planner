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

  // For any page, provide a summary of available dishes and menus for fuzzy matching.
  // Cap list sizes to keep context window manageable (~4K chars max for lists).
  const MAX_DISH_LIST = 40;
  const MAX_MENU_LIST = 15;

  if (!pageContext.entityType || pageContext.entityType !== 'dish') {
    const dishCount = db.prepare('SELECT COUNT(*) as cnt FROM dishes WHERE deleted_at IS NULL').get();
    parts.push(`Total dishes in system: ${dishCount.cnt}`);

    const dishes = db.prepare(
      `SELECT id, name, category FROM dishes WHERE deleted_at IS NULL ORDER BY name LIMIT ${MAX_DISH_LIST}`
    ).all();
    if (dishes.length) {
      const dishList = dishes.map(d => `"${d.name}" (ID:${d.id})`).join(', ');
      parts.push('Available dishes: ' + dishList);
      if (dishCount.cnt > MAX_DISH_LIST) {
        parts.push(`(${dishCount.cnt - MAX_DISH_LIST} more dishes not shown — use search_dishes to find others)`);
      }
    }
  }

  const menuCount = db.prepare('SELECT COUNT(*) as cnt FROM menus WHERE deleted_at IS NULL').get();
  parts.push(`Total menus: ${menuCount.cnt}`);

  const menus = db.prepare(
    `SELECT id, name, menu_type, event_date FROM menus WHERE deleted_at IS NULL ORDER BY event_date DESC, name LIMIT ${MAX_MENU_LIST}`
  ).all();
  if (menus.length) {
    parts.push('Available menus: ' + menus.map(m => {
      let label = `"${m.name}" (ID:${m.id}`;
      if (m.menu_type === 'standard') label += ', house menu';
      if (m.event_date) label += `, date: ${m.event_date}`;
      label += ')';
      return label;
    }).join(', '));
    if (menuCount.cnt > MAX_MENU_LIST) {
      parts.push(`(${menuCount.cnt - MAX_MENU_LIST} more menus not shown — use list_menus to see all)`);
    }
  }

  return parts.join('\n');
}

module.exports = { buildContext };
