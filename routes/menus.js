const express = require('express');
const { getDb } = require('../db/database');
const { calculateDishCost } = require('../services/costCalculator');
const { exportSpecialsDocx } = require('../services/specialsExporter');
const asyncHandler = require('../middleware/asyncHandler');

const { round2 } = require('../services/costCalculator');

const router = express.Router();

// Helper: compute cost for a single dish
function getDishCost(db, dishId) {
  const ingredients = db.prepare(`
    SELECT di.*, i.name AS ingredient_name, i.unit_cost, i.base_unit
    FROM dish_ingredients di
    JOIN ingredients i ON i.id = di.ingredient_id
    WHERE di.dish_id = ?
  `).all(dishId);
  return calculateDishCost(ingredients);
}

// GET /api/menus - List all menus
router.get('/', (req, res) => {
  const db = getDb();
  const menus = db.prepare('SELECT * FROM menus WHERE deleted_at IS NULL ORDER BY created_at DESC').all();

  for (const menu of menus) {
    const stats = db.prepare(`
      SELECT COUNT(*) AS dish_count
      FROM menu_dishes WHERE menu_id = ?
    `).get(menu.id);
    menu.dish_count = stats.dish_count;

    // Calculate total food cost for the menu
    const menuDishes = db.prepare(`
      SELECT md.dish_id, md.servings FROM menu_dishes md WHERE md.menu_id = ?
    `).all(menu.id);

    let totalFoodCost = 0;
    for (const md of menuDishes) {
      const cost = getDishCost(db, md.dish_id);
      totalFoodCost += cost.totalCost * md.servings;
    }
    menu.total_food_cost = Math.round(totalFoodCost * 100) / 100;

    if (menu.sell_price && menu.sell_price > 0) {
      menu.menu_food_cost_percent = Math.round((totalFoodCost / menu.sell_price) * 10000) / 100;
    }
  }

  res.json(menus);
});

// GET /api/menus/:id - Get menu with all dishes and cost breakdown
router.get('/:id', (req, res) => {
  const db = getDb();
  const menu = db.prepare('SELECT * FROM menus WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!menu) return res.status(404).json({ error: 'Menu not found' });

  // Get dishes in this menu
  menu.dishes = db.prepare(`
    SELECT d.*, md.servings, md.sort_order, md.id AS menu_dish_id, md.active_days
    FROM menu_dishes md
    JOIN dishes d ON d.id = md.dish_id
    WHERE md.menu_id = ?
    ORDER BY md.sort_order, d.category, d.name
  `).all(menu.id);

  // Attach allergens, cost, and substitution count to each dish
  const allergenStmt = db.prepare('SELECT allergen, source FROM dish_allergens WHERE dish_id = ?');
  const subsCountStmt = db.prepare('SELECT COUNT(*) AS cnt FROM dish_substitutions WHERE dish_id = ?');
  const allAllergens = new Set();
  let totalFoodCost = 0;

  // Parse guest_allergies
  const guestAllergies = menu.guest_allergies
    ? menu.guest_allergies.split(',').map(a => a.trim()).filter(Boolean)
    : [];

  for (const dish of menu.dishes) {
    dish.allergens = allergenStmt.all(dish.id);
    dish.allergens.forEach(a => allAllergens.add(a.allergen));

    // Check for guest allergy conflicts
    if (guestAllergies.length) {
      dish.allergy_conflicts = dish.allergens
        .filter(a => guestAllergies.includes(a.allergen))
        .map(a => a.allergen);
    } else {
      dish.allergy_conflicts = [];
    }

    // Substitution count
    const subsRow = subsCountStmt.get(dish.id);
    dish.substitution_count = subsRow ? subsRow.cnt : 0;

    // Cost per serving / portion
    const costResult = getDishCost(db, dish.id);
    const batchYield = dish.batch_yield || 1;
    dish.cost_per_batch = costResult.totalCost;
    dish.cost_per_portion = Math.round(costResult.totalCost / batchYield * 100) / 100;
    dish.cost_per_serving = dish.cost_per_portion; // backward compat alias
    dish.batch_yield = batchYield;
    dish.total_portions = dish.servings * batchYield;
    dish.cost_total = Math.round(costResult.totalCost * dish.servings * 100) / 100;
    totalFoodCost += dish.cost_total;
  }

  menu.all_allergens = Array.from(allAllergens).sort();
  menu.total_food_cost = Math.round(totalFoodCost * 100) / 100;

  // Menu-level costing
  if (menu.sell_price && menu.sell_price > 0) {
    menu.menu_food_cost_percent = Math.round((totalFoodCost / menu.sell_price) * 10000) / 100;

    // Per-dish percentage of sell price
    for (const dish of menu.dishes) {
      dish.percent_of_menu_price = menu.sell_price > 0
        ? Math.round((dish.cost_total / menu.sell_price) * 10000) / 100
        : null;
    }
  }

  res.json(menu);
});

// GET /api/menus/:id/kitchen-print - Full menu data for kitchen print
router.get('/:id/kitchen-print', (req, res) => {
  const db = getDb();
  const menu = db.prepare('SELECT * FROM menus WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!menu) return res.status(404).json({ error: 'Menu not found' });

  const dishes = db.prepare(`
    SELECT d.*, md.servings, md.sort_order
    FROM menu_dishes md
    JOIN dishes d ON d.id = md.dish_id
    WHERE md.menu_id = ? AND d.deleted_at IS NULL
    ORDER BY md.sort_order, d.category, d.name
  `).all(menu.id);

  const allergenStmt = db.prepare('SELECT allergen FROM dish_allergens WHERE dish_id = ?');
  const ingredientStmt = db.prepare(`
    SELECT di.quantity, di.unit, di.prep_note, i.name AS ingredient_name
    FROM dish_ingredients di
    JOIN ingredients i ON i.id = di.ingredient_id
    WHERE di.dish_id = ?
    ORDER BY di.sort_order
  `);
  const subsStmt = db.prepare('SELECT * FROM dish_substitutions WHERE dish_id = ? ORDER BY allergen');
  const componentStmt = db.prepare(
    'SELECT name, sort_order FROM dish_components WHERE dish_id = ? ORDER BY sort_order, id'
  );

  const directionStmt = db.prepare(
    'SELECT type, text, sort_order FROM dish_directions WHERE dish_id = ? ORDER BY sort_order, id'
  );

  for (const dish of dishes) {
    dish.allergens = allergenStmt.all(dish.id).map(a => a.allergen);

    // Scale ingredient quantities by servings (batch count)
    const rawIngredients = ingredientStmt.all(dish.id);
    const scaleFactor = dish.servings || 1;
    dish.ingredients = rawIngredients.map(ing => ({
      ...ing,
      base_quantity: ing.quantity,
      quantity: round2((Number(ing.quantity) || 0) * scaleFactor),
    }));

    dish.substitutions = subsStmt.all(dish.id);
    dish.components = componentStmt.all(dish.id);
    dish.directions = directionStmt.all(dish.id);

    // Batch yield info for print
    const batchYield = dish.batch_yield || 1;
    dish.total_portions = dish.servings * batchYield;
  }

  // Group by category
  const grouped = {};
  for (const dish of dishes) {
    const cat = dish.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(dish);
  }

  res.json({
    menu,
    dishes,
    grouped,
    guest_allergies: menu.guest_allergies ? menu.guest_allergies.split(',').map(a => a.trim()).filter(Boolean) : [],
    expected_covers: menu.expected_covers || 0,
  });
});

// POST /api/menus - Create menu
router.post('/', (req, res) => {
  const db = getDb();
  const { name, description, sell_price, expected_covers, guest_allergies, allergen_covers, schedule_days } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (sell_price !== undefined && (typeof sell_price !== 'number' || sell_price < 0)) {
    return res.status(400).json({ error: 'sell_price must be a non-negative number' });
  }
  if (expected_covers !== undefined && (typeof expected_covers !== 'number' || expected_covers < 0 || !Number.isInteger(expected_covers))) {
    return res.status(400).json({ error: 'expected_covers must be a non-negative integer' });
  }
  if (schedule_days !== undefined) {
    if (!Array.isArray(schedule_days) || !schedule_days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) {
      return res.status(400).json({ error: 'schedule_days must be an array of day numbers (0=Sun..6=Sat)' });
    }
  }

  const coversJson = allergen_covers
    ? (typeof allergen_covers === 'string' ? allergen_covers : JSON.stringify(allergen_covers))
    : '{}';
  const scheduleDaysJson = schedule_days ? JSON.stringify(schedule_days) : '[]';

  const result = db.prepare(
    'INSERT INTO menus (name, description, sell_price, expected_covers, guest_allergies, allergen_covers, schedule_days) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(name, description || '', sell_price || 0, expected_covers || 0, guest_allergies || '', coversJson, scheduleDaysJson);

  req.broadcast('menu_created', { id: result.lastInsertRowid }, req.headers['x-client-id']);
  res.status(201).json({ id: result.lastInsertRowid });
});

// PUT /api/menus/:id - Update menu
router.put('/:id', (req, res) => {
  const db = getDb();
  const { name, description, is_active, sell_price, expected_covers, guest_allergies, allergen_covers, schedule_days } = req.body;

  if (schedule_days !== undefined) {
    if (!Array.isArray(schedule_days) || !schedule_days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) {
      return res.status(400).json({ error: 'schedule_days must be an array of day numbers (0=Sun..6=Sat)' });
    }
  }

  const updates = [];
  const params = [];
  if (name) { updates.push('name = ?'); params.push(name); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description); }
  if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }
  if (sell_price !== undefined) { updates.push('sell_price = ?'); params.push(sell_price); }
  if (expected_covers !== undefined) { updates.push('expected_covers = ?'); params.push(expected_covers); }
  if (guest_allergies !== undefined) { updates.push('guest_allergies = ?'); params.push(guest_allergies); }
  if (allergen_covers !== undefined) {
    updates.push('allergen_covers = ?');
    params.push(typeof allergen_covers === 'string' ? allergen_covers : JSON.stringify(allergen_covers));
  }
  if (schedule_days !== undefined) {
    updates.push('schedule_days = ?');
    params.push(JSON.stringify(schedule_days));
  }
  updates.push("updated_at = datetime('now')");

  params.push(req.params.id);
  db.prepare(`UPDATE menus SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  req.broadcast('menu_updated', { id: parseInt(req.params.id) }, req.headers['x-client-id']);
  res.json({ success: true });
});

// DELETE /api/menus/:id - Soft delete
router.delete('/:id', (req, res) => {
  const db = getDb();
  const menu = db.prepare('SELECT id FROM menus WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!menu) return res.status(404).json({ error: 'Menu not found' });

  db.prepare("UPDATE menus SET deleted_at = datetime('now') WHERE id = ?").run(req.params.id);
  req.broadcast('menu_deleted', { id: parseInt(req.params.id) }, req.headers['x-client-id']);
  res.json({ success: true });
});

// POST /api/menus/:id/restore - Restore soft-deleted menu
router.post('/:id/restore', (req, res) => {
  const db = getDb();
  const result = db.prepare("UPDATE menus SET deleted_at = NULL WHERE id = ?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Menu not found' });
  req.broadcast('menu_created', { id: parseInt(req.params.id) }, req.headers['x-client-id']);
  res.json({ success: true });
});

// PUT /api/menus/:id/dishes/reorder - Batch update sort_order
router.put('/:id/dishes/reorder', (req, res) => {
  const db = getDb();
  const { order } = req.body;

  if (!order || !Array.isArray(order)) {
    return res.status(400).json({ error: 'order array is required' });
  }

  const stmt = db.prepare('UPDATE menu_dishes SET sort_order = ? WHERE menu_id = ? AND dish_id = ?');
  for (const item of order) {
    stmt.run(item.sort_order, req.params.id, item.dish_id);
  }

  req.broadcast('menu_updated', { id: parseInt(req.params.id) }, req.headers['x-client-id']);
  res.json({ success: true });
});

// POST /api/menus/:id/dishes - Add dish to menu
router.post('/:id/dishes', (req, res) => {
  const db = getDb();
  const { dish_id, servings, sort_order, active_days } = req.body;

  if (!dish_id) return res.status(400).json({ error: 'dish_id is required' });
  if (servings !== undefined && (typeof servings !== 'number' || servings < 1)) {
    return res.status(400).json({ error: 'servings must be a positive number' });
  }
  if (active_days !== undefined && active_days !== null) {
    if (!Array.isArray(active_days) || !active_days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) {
      return res.status(400).json({ error: 'active_days must be an array of day numbers (0=Sun..6=Sat)' });
    }
  }

  const maxOrder = db.prepare('SELECT MAX(sort_order) AS max_order FROM menu_dishes WHERE menu_id = ?').get(req.params.id);
  const order = sort_order !== undefined ? sort_order : (maxOrder.max_order || 0) + 1;
  const activeDaysJson = active_days ? JSON.stringify(active_days) : null;

  try {
    db.prepare('INSERT INTO menu_dishes (menu_id, dish_id, servings, sort_order, active_days) VALUES (?, ?, ?, ?, ?)').run(
      req.params.id, dish_id, servings || 1, order, activeDaysJson
    );
    req.broadcast('menu_updated', { id: parseInt(req.params.id) }, req.headers['x-client-id']);
    res.status(201).json({ success: true });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Dish already in this menu' });
    }
    throw err;
  }
});

// PUT /api/menus/:id/dishes/:dishId - Update servings/order/active_days
router.put('/:id/dishes/:dishId', (req, res) => {
  const db = getDb();
  const { servings, sort_order, active_days } = req.body;

  if (active_days !== undefined && active_days !== null) {
    if (!Array.isArray(active_days) || !active_days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) {
      return res.status(400).json({ error: 'active_days must be an array of day numbers (0=Sun..6=Sat)' });
    }
  }

  const updates = [];
  const params = [];
  if (servings !== undefined) { updates.push('servings = ?'); params.push(servings); }
  if (sort_order !== undefined) { updates.push('sort_order = ?'); params.push(sort_order); }
  if (active_days !== undefined) {
    updates.push('active_days = ?');
    params.push(active_days === null ? null : JSON.stringify(active_days));
  }

  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

  params.push(req.params.id, req.params.dishId);
  db.prepare(`UPDATE menu_dishes SET ${updates.join(', ')} WHERE menu_id = ? AND dish_id = ?`).run(...params);

  req.broadcast('menu_updated', { id: parseInt(req.params.id) }, req.headers['x-client-id']);
  res.json({ success: true });
});

// DELETE /api/menus/:id/dishes/:dishId - Remove dish from menu
router.delete('/:id/dishes/:dishId', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM menu_dishes WHERE menu_id = ? AND dish_id = ?').run(req.params.id, req.params.dishId);
  req.broadcast('menu_updated', { id: parseInt(req.params.id) }, req.headers['x-client-id']);
  res.json({ success: true });
});

// ============================
// Weekly Specials
// ============================

// GET /api/menus/specials/export-docx - Export weekly specials as .docx
router.get('/specials/export-docx', asyncHandler(async (req, res) => {
  const { week } = req.query;
  if (!week) return res.status(400).json({ error: 'week query parameter is required (YYYY-MM-DD)' });

  try {
    const buffer = await exportSpecialsDocx(week);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="specials-${week}.docx"`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(422).json({ error: err.message });
  }
}));

// GET /api/menus/specials/list - List all weekly specials
router.get('/specials/list', (req, res) => {
  const db = getDb();
  const { week, active_only } = req.query;

  let sql = `
    SELECT ws.*, d.name AS dish_name, d.description AS dish_description,
           d.category, d.photo_path, d.suggested_price
    FROM weekly_specials ws
    JOIN dishes d ON d.id = ws.dish_id
  `;
  const conditions = [];
  const params = [];

  if (week) {
    conditions.push('ws.week_start <= ? AND ws.week_end >= ?');
    params.push(week, week);
  }
  if (active_only === 'true') {
    conditions.push('ws.is_active = 1');
  }

  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY ws.week_start DESC, d.category, d.name';

  const specials = db.prepare(sql).all(...params);

  // Attach allergens
  const allergenStmt = db.prepare('SELECT allergen FROM dish_allergens WHERE dish_id = ?');
  for (const s of specials) {
    s.allergens = allergenStmt.all(s.dish_id).map(a => a.allergen);
  }

  res.json(specials);
});

// POST /api/menus/specials - Create a weekly special
router.post('/specials', (req, res) => {
  const db = getDb();
  const { dish_id, week_start, week_end, notes } = req.body;

  if (!dish_id || !week_start || !week_end) {
    return res.status(400).json({ error: 'dish_id, week_start, and week_end are required' });
  }

  const result = db.prepare(
    'INSERT INTO weekly_specials (dish_id, week_start, week_end, notes) VALUES (?, ?, ?, ?)'
  ).run(dish_id, week_start, week_end, notes || '');

  req.broadcast('special_created', { id: result.lastInsertRowid, week_start }, req.headers['x-client-id']);
  res.status(201).json({ id: result.lastInsertRowid });
});

// PUT /api/menus/specials/:id - Update a weekly special
router.put('/specials/:id', (req, res) => {
  const db = getDb();
  const { dish_id, week_start, week_end, notes, is_active } = req.body;

  const updates = [];
  const params = [];
  if (dish_id) { updates.push('dish_id = ?'); params.push(dish_id); }
  if (week_start) { updates.push('week_start = ?'); params.push(week_start); }
  if (week_end) { updates.push('week_end = ?'); params.push(week_end); }
  if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
  if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }

  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

  params.push(req.params.id);
  db.prepare(`UPDATE weekly_specials SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  req.broadcast('special_updated', { id: parseInt(req.params.id) }, req.headers['x-client-id']);
  res.json({ success: true });
});

// DELETE /api/menus/specials/:id
router.delete('/specials/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM weekly_specials WHERE id = ?').run(req.params.id);
  req.broadcast('special_deleted', { id: parseInt(req.params.id) }, req.headers['x-client-id']);
  res.json({ success: true });
});

module.exports = router;
