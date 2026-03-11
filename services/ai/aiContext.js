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

module.exports = { buildContext };
