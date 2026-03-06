const express = require('express');
const { getDb } = require('../db/database');
const { calculateDishCost, round2 } = require('../services/costCalculator');
const { getDishAllergensBatch } = require('../services/allergenDetector');
const { exportSpecialsDocx } = require('../services/specialsExporter');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

const VALID_MENU_TYPES = ['standard', 'event'];
const VALID_SERVICE_STYLES = ['coursed', 'alacarte'];

const COURSE_TEMPLATES = {
  '3-course': ['Starter', 'Main', 'Dessert'],
  '5-course': ['Amuse Bouche', 'Starter', 'Fish', 'Main', 'Dessert'],
  'tasting': ['Amuse Bouche', 'First Course', 'Second Course', 'Intermezzo', 'Main', 'Pre-Dessert', 'Dessert'],
};

// GET /api/menus - List all menus
router.get('/', (req, res) => {
  const db = getDb();
  const menus = db.prepare(`
    SELECT * FROM menus WHERE deleted_at IS NULL
    ORDER BY
      CASE WHEN menu_type = 'standard' THEN 0 ELSE 1 END,
      event_date DESC,
      created_at DESC
  `).all();

  if (menus.length > 0) {
    const menuIds = menus.map(m => m.id);
    const placeholders = menuIds.map(() => '?').join(',');

    // Batch: dish counts and menu_dish rows per menu (excluding soft-deleted dishes)
    const menuDishRows = db.prepare(`
      SELECT md.menu_id, md.dish_id, md.servings
      FROM menu_dishes md
      JOIN dishes d ON d.id = md.dish_id
      WHERE md.menu_id IN (${placeholders}) AND d.deleted_at IS NULL
    `).all(...menuIds);

    // Group menu_dishes by menu_id
    const menuDishMap = {};
    for (const row of menuDishRows) {
      if (!menuDishMap[row.menu_id]) menuDishMap[row.menu_id] = [];
      menuDishMap[row.menu_id].push(row);
    }

    // Batch: get all unique dish_ids across all menus, fetch their ingredients once
    const allDishIds = [...new Set(menuDishRows.map(r => r.dish_id))];
    const dishCostMap = {};
    if (allDishIds.length > 0) {
      const dishPlaceholders = allDishIds.map(() => '?').join(',');
      const ingredientRows = db.prepare(`
        SELECT di.dish_id, di.quantity, di.unit, i.unit_cost, i.base_unit, i.name AS ingredient_name
        FROM dish_ingredients di
        JOIN ingredients i ON i.id = di.ingredient_id
        WHERE di.dish_id IN (${dishPlaceholders})
      `).all(...allDishIds);

      // Group ingredients by dish_id and compute cost
      const dishIngrMap = {};
      for (const row of ingredientRows) {
        if (!dishIngrMap[row.dish_id]) dishIngrMap[row.dish_id] = [];
        dishIngrMap[row.dish_id].push(row);
      }
      for (const dishId of allDishIds) {
        dishCostMap[dishId] = calculateDishCost(dishIngrMap[dishId] || []);
      }
    }

    // Batch: course counts per menu
    const courseRows = db.prepare(
      `SELECT menu_id, COUNT(*) AS cnt FROM menu_courses WHERE menu_id IN (${placeholders}) GROUP BY menu_id`
    ).all(...menuIds);
    const courseCountMap = {};
    for (const r of courseRows) courseCountMap[r.menu_id] = r.cnt;

    for (const menu of menus) {
      const dishes = menuDishMap[menu.id] || [];
      menu.dish_count = dishes.length;
      menu.course_count = courseCountMap[menu.id] || 0;

      let totalFoodCost = 0;
      for (const md of dishes) {
        const cost = dishCostMap[md.dish_id] || { totalCost: 0 };
        totalFoodCost += cost.totalCost * md.servings;
      }
      menu.total_food_cost = round2(totalFoodCost);

      if (menu.sell_price && menu.sell_price > 0) {
        menu.menu_food_cost_percent = round2((totalFoodCost / menu.sell_price) * 100);
      }
    }
  }

  res.json(menus);
});

// GET /api/menus/:id - Get menu with all dishes and cost breakdown
router.get('/:id', (req, res) => {
  const db = getDb();
  const menu = db.prepare('SELECT * FROM menus WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!menu) return res.status(404).json({ error: 'Menu not found' });

  // Get courses for this menu
  menu.courses = db.prepare(
    'SELECT * FROM menu_courses WHERE menu_id = ? ORDER BY sort_order, id'
  ).all(menu.id);

  // Get dishes in this menu (include course_id and notes)
  menu.dishes = db.prepare(`
    SELECT d.*, md.servings, md.sort_order, md.id AS menu_dish_id, md.active_days, md.course_id, md.notes AS menu_dish_notes
    FROM menu_dishes md
    JOIN dishes d ON d.id = md.dish_id
    WHERE md.menu_id = ? AND d.deleted_at IS NULL
    ORDER BY md.sort_order, d.category, d.name
  `).all(menu.id);

  // Batch fetch allergens, substitution counts, and costs for all dishes
  const allAllergens = new Set();
  let totalFoodCost = 0;

  // Parse guest_allergies
  const guestAllergies = menu.guest_allergies
    ? menu.guest_allergies.split(',').map(a => a.trim()).filter(Boolean)
    : [];

  if (menu.dishes.length > 0) {
    const dishIds = menu.dishes.map(d => d.id);
    const ph = dishIds.map(() => '?').join(',');

    // Batch: allergens (aggregated from ingredient_allergens + dish manual)
    const allergenMap = getDishAllergensBatch(dishIds);

    // Batch: substitution counts
    const subsRows = db.prepare(
      `SELECT dish_id, COUNT(*) AS cnt FROM dish_substitutions WHERE dish_id IN (${ph}) GROUP BY dish_id`
    ).all(...dishIds);
    const subsMap = {};
    for (const r of subsRows) subsMap[r.dish_id] = r.cnt;

    // Batch: ingredients for cost calculation
    const ingredientRows = db.prepare(
      `SELECT di.dish_id, di.quantity, di.unit, i.unit_cost, i.base_unit, i.name AS ingredient_name
       FROM dish_ingredients di
       JOIN ingredients i ON i.id = di.ingredient_id
       WHERE di.dish_id IN (${ph})`
    ).all(...dishIds);
    const ingredientMap = {};
    for (const r of ingredientRows) {
      if (!ingredientMap[r.dish_id]) ingredientMap[r.dish_id] = [];
      ingredientMap[r.dish_id].push(r);
    }

    for (const dish of menu.dishes) {
      dish.allergens = allergenMap[dish.id] || [];
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
      dish.substitution_count = subsMap[dish.id] || 0;

      // Cost per serving / portion
      const costResult = calculateDishCost(ingredientMap[dish.id] || []);
      const batchYield = dish.batch_yield || 1;
      dish.cost_per_batch = costResult.totalCost;
      dish.cost_per_portion = round2(costResult.totalCost / batchYield);
      dish.cost_per_serving = dish.cost_per_portion; // backward compat alias
      dish.batch_yield = batchYield;
      dish.total_portions = dish.servings * batchYield;
      dish.cost_total = round2(costResult.totalCost * dish.servings);
      totalFoodCost += dish.cost_total;
    }
  }

  menu.all_allergens = Array.from(allAllergens).sort();
  menu.total_food_cost = round2(totalFoodCost);

  // Menu-level costing
  if (menu.sell_price && menu.sell_price > 0) {
    menu.menu_food_cost_percent = round2((totalFoodCost / menu.sell_price) * 100);

    // Per-dish percentage of sell price
    for (const dish of menu.dishes) {
      dish.percent_of_menu_price = menu.sell_price > 0
        ? round2((dish.cost_total / menu.sell_price) * 100)
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

  // Get courses
  const courses = db.prepare('SELECT * FROM menu_courses WHERE menu_id = ? ORDER BY sort_order, id').all(menu.id);

  const dishes = db.prepare(`
    SELECT d.*, md.servings, md.sort_order, md.course_id, md.notes AS menu_dish_notes
    FROM menu_dishes md
    JOIN dishes d ON d.id = md.dish_id
    WHERE md.menu_id = ? AND d.deleted_at IS NULL
    ORDER BY md.sort_order, d.category, d.name
  `).all(menu.id);

  if (dishes.length > 0) {
    const dishIds = dishes.map(d => d.id);
    const ph = dishIds.map(() => '?').join(',');

    // Batch: allergens (aggregated from ingredient_allergens + dish manual)
    const allergenBatchMap = getDishAllergensBatch(dishIds);
    const allergenMap = {};
    for (const id of dishIds) {
      allergenMap[id] = (allergenBatchMap[id] || []).map(a => a.allergen);
    }

    // Batch: ingredients
    const ingredientRows = db.prepare(
      `SELECT di.dish_id, di.quantity, di.unit, di.prep_note, i.name AS ingredient_name
       FROM dish_ingredients di
       JOIN ingredients i ON i.id = di.ingredient_id
       WHERE di.dish_id IN (${ph})
       ORDER BY di.sort_order`
    ).all(...dishIds);
    const ingredientMap = {};
    for (const r of ingredientRows) {
      if (!ingredientMap[r.dish_id]) ingredientMap[r.dish_id] = [];
      ingredientMap[r.dish_id].push(r);
    }

    // Batch: substitutions
    const subsRows = db.prepare(
      `SELECT * FROM dish_substitutions WHERE dish_id IN (${ph}) ORDER BY allergen`
    ).all(...dishIds);
    const subsMap = {};
    for (const r of subsRows) {
      if (!subsMap[r.dish_id]) subsMap[r.dish_id] = [];
      subsMap[r.dish_id].push(r);
    }

    // Batch: components
    const compRows = db.prepare(
      `SELECT dish_id, name, sort_order FROM dish_components WHERE dish_id IN (${ph}) ORDER BY sort_order, id`
    ).all(...dishIds);
    const compMap = {};
    for (const r of compRows) {
      if (!compMap[r.dish_id]) compMap[r.dish_id] = [];
      compMap[r.dish_id].push(r);
    }

    // Batch: directions
    const dirRows = db.prepare(
      `SELECT dish_id, type, text, sort_order FROM dish_directions WHERE dish_id IN (${ph}) ORDER BY sort_order, id`
    ).all(...dishIds);
    const dirMap = {};
    for (const r of dirRows) {
      if (!dirMap[r.dish_id]) dirMap[r.dish_id] = [];
      dirMap[r.dish_id].push(r);
    }

    // Batch: service directions
    const svcDirRows = db.prepare(
      `SELECT dish_id, type, text, sort_order FROM dish_service_directions WHERE dish_id IN (${ph}) ORDER BY sort_order, id`
    ).all(...dishIds);
    const svcDirMap = {};
    for (const r of svcDirRows) {
      if (!svcDirMap[r.dish_id]) svcDirMap[r.dish_id] = [];
      svcDirMap[r.dish_id].push(r);
    }

    for (const dish of dishes) {
      dish.allergens = allergenMap[dish.id] || [];

      // Scale ingredient quantities by servings (batch count)
      const rawIngredients = ingredientMap[dish.id] || [];
      const scaleFactor = dish.servings || 1;
      dish.ingredients = rawIngredients.map(ing => ({
        ...ing,
        base_quantity: ing.quantity,
        quantity: round2((Number(ing.quantity) || 0) * scaleFactor),
      }));

      dish.substitutions = subsMap[dish.id] || [];
      dish.components = compMap[dish.id] || [];
      dish.directions = dirMap[dish.id] || [];
      dish.service_directions = svcDirMap[dish.id] || [];

      // Batch yield info for print
      const batchYield = dish.batch_yield || 1;
      dish.total_portions = dish.servings * batchYield;
    }
  }

  // Group by category
  const grouped = {};
  for (const dish of dishes) {
    const cat = dish.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(dish);
  }

  // Group by course
  const courseMap = {};
  const unassigned = [];
  for (const dish of dishes) {
    if (dish.course_id) {
      if (!courseMap[dish.course_id]) courseMap[dish.course_id] = [];
      courseMap[dish.course_id].push(dish);
    } else {
      unassigned.push(dish);
    }
  }

  res.json({
    menu,
    dishes,
    grouped,
    courses,
    courseMap,
    unassigned,
    guest_allergies: menu.guest_allergies ? menu.guest_allergies.split(',').map(a => a.trim()).filter(Boolean) : [],
    expected_covers: menu.expected_covers || 0,
  });
});

// POST /api/menus - Create menu
router.post('/', (req, res) => {
  const db = getDb();
  const { name, description, sell_price, expected_covers, guest_allergies, allergen_covers, schedule_days, menu_type, event_date, gcal_event_id, service_style } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (sell_price !== undefined && (typeof sell_price !== 'number' || sell_price < 0)) {
    return res.status(400).json({ error: 'sell_price must be a non-negative number' });
  }
  if (expected_covers !== undefined && (typeof expected_covers !== 'number' || expected_covers < 0 || !Number.isInteger(expected_covers))) {
    return res.status(400).json({ error: 'expected_covers must be a non-negative integer' });
  }

  // Service style validation
  if (service_style !== undefined && !VALID_SERVICE_STYLES.includes(service_style)) {
    return res.status(400).json({ error: 'service_style must be "coursed" or "alacarte"' });
  }

  // Menu type validation
  const type = menu_type || 'event';
  if (!VALID_MENU_TYPES.includes(type)) {
    return res.status(400).json({ error: 'menu_type must be "standard" or "event"' });
  }

  // Event date validation
  if (event_date !== undefined && event_date !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(event_date)) {
      return res.status(400).json({ error: 'event_date must be YYYY-MM-DD format' });
    }
  }

  // Schedule days only allowed on standard menus
  if (schedule_days !== undefined && type !== 'standard') {
    return res.status(400).json({ error: 'schedule_days can only be set on the house menu' });
  }
  if (schedule_days !== undefined) {
    if (!Array.isArray(schedule_days) || !schedule_days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) {
      return res.status(400).json({ error: 'schedule_days must be an array of day numbers (0=Sun..6=Sat)' });
    }
  }

  // If setting as standard, demote any existing standard menu
  if (type === 'standard') {
    db.prepare("UPDATE menus SET menu_type = 'event' WHERE menu_type = 'standard' AND deleted_at IS NULL").run();
  }

  const coversJson = allergen_covers
    ? (typeof allergen_covers === 'string' ? allergen_covers : JSON.stringify(allergen_covers))
    : '{}';
  const scheduleDaysJson = (schedule_days && type === 'standard') ? JSON.stringify(schedule_days) : '[]';

  const result = db.prepare(
    'INSERT INTO menus (name, description, sell_price, expected_covers, guest_allergies, allergen_covers, schedule_days, menu_type, event_date, gcal_event_id, service_style) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(name, description || '', sell_price || 0, expected_covers || 0, guest_allergies || '', coversJson, scheduleDaysJson, type, event_date || null, gcal_event_id || null, service_style || 'alacarte');

  req.broadcast('menu_created', { id: result.lastInsertRowid }, req.headers['x-client-id']);
  res.status(201).json({ id: result.lastInsertRowid });
});

// PUT /api/menus/:id - Update menu
router.put('/:id', (req, res) => {
  const db = getDb();
  const { name, description, is_active, sell_price, expected_covers, guest_allergies, allergen_covers, schedule_days, menu_type, event_date, gcal_event_id, service_style } = req.body;

  // Look up current menu to know its type
  const current = db.prepare('SELECT menu_type FROM menus WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Menu not found' });

  const effectiveType = menu_type || current.menu_type || 'event';

  // Menu type validation
  if (menu_type !== undefined && !VALID_MENU_TYPES.includes(menu_type)) {
    return res.status(400).json({ error: 'menu_type must be "standard" or "event"' });
  }

  // Event date validation
  if (event_date !== undefined && event_date !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(event_date)) {
      return res.status(400).json({ error: 'event_date must be YYYY-MM-DD format' });
    }
  }

  // Schedule days only allowed on standard menus
  if (schedule_days !== undefined && effectiveType !== 'standard') {
    return res.status(400).json({ error: 'schedule_days can only be set on the house menu' });
  }
  if (schedule_days !== undefined) {
    if (!Array.isArray(schedule_days) || !schedule_days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) {
      return res.status(400).json({ error: 'schedule_days must be an array of day numbers (0=Sun..6=Sat)' });
    }
  }

  // If promoting to standard, demote any existing standard menu
  if (menu_type === 'standard' && current.menu_type !== 'standard') {
    db.prepare("UPDATE menus SET menu_type = 'event' WHERE menu_type = 'standard' AND deleted_at IS NULL AND id != ?").run(req.params.id);
  }

  const updates = [];
  const params = [];
  if (name) { updates.push('name = ?'); params.push(name); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description); }
  if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }
  if (sell_price !== undefined) {
    if (typeof sell_price !== 'number' || isNaN(sell_price) || sell_price < 0) {
      return res.status(400).json({ error: 'sell_price must be a non-negative number' });
    }
    updates.push('sell_price = ?'); params.push(sell_price);
  }
  if (expected_covers !== undefined) {
    if (typeof expected_covers !== 'number' || isNaN(expected_covers) || expected_covers < 0 || !Number.isInteger(expected_covers)) {
      return res.status(400).json({ error: 'expected_covers must be a non-negative integer' });
    }
    updates.push('expected_covers = ?'); params.push(expected_covers);
  }
  if (guest_allergies !== undefined) { updates.push('guest_allergies = ?'); params.push(guest_allergies); }
  if (allergen_covers !== undefined) {
    updates.push('allergen_covers = ?');
    params.push(typeof allergen_covers === 'string' ? allergen_covers : JSON.stringify(allergen_covers));
  }
  if (menu_type !== undefined) {
    updates.push('menu_type = ?'); params.push(menu_type);
    // When demoting to event, clear schedule_days
    if (menu_type === 'event') {
      updates.push("schedule_days = '[]'");
    }
  }
  if (event_date !== undefined) {
    updates.push('event_date = ?'); params.push(event_date);
  }
  if (schedule_days !== undefined) {
    updates.push('schedule_days = ?');
    params.push(JSON.stringify(schedule_days));
  }
  if (gcal_event_id !== undefined) {
    updates.push('gcal_event_id = ?');
    params.push(gcal_event_id);
  }
  if (service_style !== undefined) {
    if (!VALID_SERVICE_STYLES.includes(service_style)) {
      return res.status(400).json({ error: 'service_style must be "coursed" or "alacarte"' });
    }
    updates.push('service_style = ?'); params.push(service_style);
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
  const menu = db.prepare('SELECT id FROM menus WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!menu) return res.status(404).json({ error: 'Menu not found' });

  const { order } = req.body;

  if (!order || !Array.isArray(order)) {
    return res.status(400).json({ error: 'order array is required' });
  }

  const stmtWithCourse = db.prepare('UPDATE menu_dishes SET sort_order = ?, course_id = ? WHERE menu_id = ? AND dish_id = ?');
  const stmtNoCourse = db.prepare('UPDATE menu_dishes SET sort_order = ? WHERE menu_id = ? AND dish_id = ?');
  for (const item of order) {
    if (item.course_id !== undefined) {
      stmtWithCourse.run(item.sort_order, item.course_id === null ? null : item.course_id, req.params.id, item.dish_id);
    } else {
      stmtNoCourse.run(item.sort_order, req.params.id, item.dish_id);
    }
  }

  req.broadcast('menu_updated', { id: parseInt(req.params.id) }, req.headers['x-client-id']);
  res.json({ success: true });
});

// POST /api/menus/:id/dishes - Add dish to menu
router.post('/:id/dishes', (req, res) => {
  const db = getDb();
  const { dish_id, servings, sort_order, active_days, course_id } = req.body;

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
    db.prepare('INSERT INTO menu_dishes (menu_id, dish_id, servings, sort_order, active_days, course_id) VALUES (?, ?, ?, ?, ?, ?)').run(
      req.params.id, dish_id, servings || 1, order, activeDaysJson, course_id || null
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

// PUT /api/menus/:id/dishes/:dishId - Update servings/order/active_days/course_id/notes
router.put('/:id/dishes/:dishId', (req, res) => {
  const db = getDb();
  const { servings, sort_order, active_days, course_id, notes } = req.body;

  if (active_days !== undefined && active_days !== null) {
    if (!Array.isArray(active_days) || !active_days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) {
      return res.status(400).json({ error: 'active_days must be an array of day numbers (0=Sun..6=Sat)' });
    }
  }

  const updates = [];
  const params = [];
  if (servings !== undefined) {
    if (typeof servings !== 'number' || isNaN(servings) || servings < 1) {
      return res.status(400).json({ error: 'servings must be a positive number' });
    }
    updates.push('servings = ?'); params.push(servings);
  }
  if (sort_order !== undefined) { updates.push('sort_order = ?'); params.push(sort_order); }
  if (active_days !== undefined) {
    updates.push('active_days = ?');
    params.push(active_days === null ? null : JSON.stringify(active_days));
  }
  if (course_id !== undefined) {
    updates.push('course_id = ?');
    params.push(course_id === null ? null : course_id);
  }
  if (notes !== undefined) {
    updates.push('notes = ?');
    params.push(notes || '');
  }

  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

  params.push(req.params.id, req.params.dishId);
  const result = db.prepare(`UPDATE menu_dishes SET ${updates.join(', ')} WHERE menu_id = ? AND dish_id = ?`).run(...params);
  if (result.changes === 0) return res.status(404).json({ error: 'Menu dish not found' });

  req.broadcast('menu_updated', { id: parseInt(req.params.id) }, req.headers['x-client-id']);
  res.json({ success: true });
});

// DELETE /api/menus/:id/dishes/:dishId - Remove dish from menu
router.delete('/:id/dishes/:dishId', (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM menu_dishes WHERE menu_id = ? AND dish_id = ?').run(req.params.id, req.params.dishId);
  if (result.changes === 0) return res.status(404).json({ error: 'Menu dish not found' });
  req.broadcast('menu_updated', { id: parseInt(req.params.id) }, req.headers['x-client-id']);
  res.json({ success: true });
});

// ============================
// Menu Courses / Sections
// ============================

// GET /api/menus/:id/courses - List courses for a menu
router.get('/:id/courses', (req, res) => {
  const db = getDb();
  const menu = db.prepare('SELECT id FROM menus WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!menu) return res.status(404).json({ error: 'Menu not found' });

  const courses = db.prepare('SELECT * FROM menu_courses WHERE menu_id = ? ORDER BY sort_order, id').all(req.params.id);
  res.json(courses);
});

// POST /api/menus/:id/courses - Create a course/section
router.post('/:id/courses', (req, res) => {
  const db = getDb();
  const menu = db.prepare('SELECT id FROM menus WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!menu) return res.status(404).json({ error: 'Menu not found' });

  const { name, notes, sort_order } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Course name is required' });
  }

  const maxOrder = db.prepare('SELECT MAX(sort_order) AS max_order FROM menu_courses WHERE menu_id = ?').get(req.params.id);
  const order = sort_order !== undefined ? sort_order : (maxOrder.max_order || 0) + 1;

  const result = db.prepare('INSERT INTO menu_courses (menu_id, name, notes, sort_order) VALUES (?, ?, ?, ?)').run(
    req.params.id, name.trim(), notes || '', order
  );

  req.broadcast('menu_updated', { id: parseInt(req.params.id) }, req.headers['x-client-id']);
  res.status(201).json({ id: result.lastInsertRowid, name: name.trim(), notes: notes || '', sort_order: order });
});

// PUT /api/menus/:id/courses/reorder - Batch reorder courses
// NOTE: Must be defined before /:id/courses/:courseId to avoid matching "reorder" as courseId
router.put('/:id/courses/reorder', (req, res) => {
  const db = getDb();
  const menu = db.prepare('SELECT id FROM menus WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!menu) return res.status(404).json({ error: 'Menu not found' });

  const { order } = req.body;
  if (!order || !Array.isArray(order)) {
    return res.status(400).json({ error: 'order array is required' });
  }

  const stmt = db.prepare('UPDATE menu_courses SET sort_order = ? WHERE id = ? AND menu_id = ?');
  for (const item of order) {
    stmt.run(item.sort_order, item.course_id, req.params.id);
  }

  req.broadcast('menu_updated', { id: parseInt(req.params.id) }, req.headers['x-client-id']);
  res.json({ success: true });
});

// POST /api/menus/:id/courses/from-template - Create courses from a template
// NOTE: Must be defined before /:id/courses/:courseId
router.post('/:id/courses/from-template', (req, res) => {
  const db = getDb();
  const menu = db.prepare('SELECT id FROM menus WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!menu) return res.status(404).json({ error: 'Menu not found' });

  const { template } = req.body;
  if (!template || !COURSE_TEMPLATES[template]) {
    return res.status(400).json({ error: `Invalid template. Choose from: ${Object.keys(COURSE_TEMPLATES).join(', ')}` });
  }

  const courseNames = COURSE_TEMPLATES[template];
  const maxOrder = db.prepare('SELECT MAX(sort_order) AS max_order FROM menu_courses WHERE menu_id = ?').get(req.params.id);
  let startOrder = (maxOrder.max_order || 0) + 1;

  const created = [];
  const stmt = db.prepare('INSERT INTO menu_courses (menu_id, name, sort_order) VALUES (?, ?, ?)');
  for (const name of courseNames) {
    const result = stmt.run(req.params.id, name, startOrder++);
    created.push({ id: result.lastInsertRowid, name, sort_order: startOrder - 1 });
  }

  req.broadcast('menu_updated', { id: parseInt(req.params.id) }, req.headers['x-client-id']);
  res.status(201).json({ courses: created, template });
});

// PUT /api/menus/:id/courses/:courseId - Update course name/notes/sort_order
router.put('/:id/courses/:courseId', (req, res) => {
  const db = getDb();
  const { name, notes, sort_order } = req.body;

  const updates = [];
  const params = [];
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Course name cannot be empty' });
    updates.push('name = ?'); params.push(name.trim());
  }
  if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
  if (sort_order !== undefined) { updates.push('sort_order = ?'); params.push(sort_order); }

  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

  params.push(req.params.courseId, req.params.id);
  const result = db.prepare(`UPDATE menu_courses SET ${updates.join(', ')} WHERE id = ? AND menu_id = ?`).run(...params);
  if (result.changes === 0) return res.status(404).json({ error: 'Course not found' });

  req.broadcast('menu_updated', { id: parseInt(req.params.id) }, req.headers['x-client-id']);
  res.json({ success: true });
});

// DELETE /api/menus/:id/courses/:courseId - Delete course (dishes become unassigned)
router.delete('/:id/courses/:courseId', (req, res) => {
  const db = getDb();
  // Unassign dishes from this course
  db.prepare('UPDATE menu_dishes SET course_id = NULL WHERE course_id = ? AND menu_id = ?').run(req.params.courseId, req.params.id);
  const result = db.prepare('DELETE FROM menu_courses WHERE id = ? AND menu_id = ?').run(req.params.courseId, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Course not found' });

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
  const conditions = ['d.deleted_at IS NULL'];
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

  // Batch attach allergens
  if (specials.length > 0) {
    const specialDishIds = [...new Set(specials.map(s => s.dish_id))];
    const allergenBatch = getDishAllergensBatch(specialDishIds);
    const allergenMap = {};
    for (const id of specialDishIds) {
      allergenMap[id] = (allergenBatch[id] || []).map(a => a.allergen);
    }
    for (const s of specials) {
      s.allergens = allergenMap[s.dish_id] || [];
    }
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
  const result = db.prepare(`UPDATE weekly_specials SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  if (result.changes === 0) return res.status(404).json({ error: 'Special not found' });
  req.broadcast('special_updated', { id: parseInt(req.params.id) }, req.headers['x-client-id']);
  res.json({ success: true });
});

// DELETE /api/menus/specials/:id
router.delete('/specials/:id', (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM weekly_specials WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Special not found' });
  req.broadcast('special_deleted', { id: parseInt(req.params.id) }, req.headers['x-client-id']);
  res.json({ success: true });
});

module.exports = router;
