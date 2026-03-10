const express = require('express');
const { getDb } = require('../db/database');
const { updateIngredientAllergens } = require('../services/allergenDetector');

const VALID_ALLERGENS = ['celery','crustaceans','eggs','fish','gluten','lupin','milk','molluscs','mustard','nuts','peanuts','sesame','soy','sulphites'];

const router = express.Router();

// GET /api/ingredients - List/search ingredients
router.get('/', (req, res) => {
  const db = getDb();
  const { search, include_usage } = req.query;

  let sql;
  if (include_usage) {
    sql = `SELECT i.*, COUNT(di.dish_id) AS dish_count
           FROM ingredients i
           LEFT JOIN dish_ingredients di ON di.ingredient_id = i.id
           LEFT JOIN dishes d ON d.id = di.dish_id AND d.deleted_at IS NULL`;
  } else {
    sql = 'SELECT * FROM ingredients i';
  }

  const params = [];
  if (search) {
    sql += ' WHERE i.name LIKE ?';
    params.push(`%${search}%`);
  }

  if (include_usage) {
    sql += ' GROUP BY i.id';
  }
  sql += ' ORDER BY i.name';

  const ingredients = db.prepare(sql).all(...params);

  // Batch attach allergens
  if (ingredients.length > 0) {
    const ids = ingredients.map(i => i.id);
    const ph = ids.map(() => '?').join(',');
    const allergenRows = db.prepare(
      `SELECT ingredient_id, allergen, source FROM ingredient_allergens WHERE ingredient_id IN (${ph})`
    ).all(...ids);
    const allergenMap = {};
    for (const r of allergenRows) {
      if (!allergenMap[r.ingredient_id]) allergenMap[r.ingredient_id] = [];
      allergenMap[r.ingredient_id].push({ allergen: r.allergen, source: r.source });
    }
    for (const ing of ingredients) {
      ing.allergens = allergenMap[ing.id] || [];
    }
  }

  res.json(ingredients);
});

// POST /api/ingredients - Create or upsert ingredient
router.post('/', (req, res) => {
  const db = getDb();
  const { name, unit_cost, base_unit, category, g_per_ml } = req.body;

  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (unit_cost !== undefined && (typeof unit_cost !== 'number' || isNaN(unit_cost) || unit_cost < 0)) {
    return res.status(400).json({ error: 'unit_cost must be a non-negative number' });
  }
  if (g_per_ml !== undefined && g_per_ml !== null && (typeof g_per_ml !== 'number' || isNaN(g_per_ml) || g_per_ml <= 0)) {
    return res.status(400).json({ error: 'g_per_ml must be a positive number or null' });
  }

  const existing = db.prepare('SELECT id FROM ingredients WHERE name = ? COLLATE NOCASE').get(name);

  if (existing) {
    // Update existing
    const updates = [];
    const params = [];
    if (unit_cost !== undefined) { updates.push('unit_cost = ?'); params.push(unit_cost); }
    if (base_unit) { updates.push('base_unit = ?'); params.push(base_unit); }
    if (category) { updates.push('category = ?'); params.push(category); }
    if (g_per_ml !== undefined) { updates.push('g_per_ml = ?'); params.push(g_per_ml); }

    if (updates.length) {
      params.push(existing.id);
      db.prepare(`UPDATE ingredients SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }
    req.broadcast('ingredient_updated', { id: existing.id }, req.headers['x-client-id']);
    res.json({ id: existing.id, updated: true });
  } else {
    const result = db.prepare(
      'INSERT INTO ingredients (name, unit_cost, base_unit, category) VALUES (?, ?, ?, ?)'
    ).run(name, unit_cost || 0, base_unit || 'g', category || 'other');

    // Auto-detect allergens for the new ingredient
    updateIngredientAllergens(result.lastInsertRowid);

    req.broadcast('ingredient_created', { id: result.lastInsertRowid }, req.headers['x-client-id']);
    res.status(201).json({ id: result.lastInsertRowid });
  }
});

// PUT /api/ingredients/:id - Update ingredient
router.put('/:id', (req, res) => {
  const db = getDb();
  const { name, unit_cost, base_unit, category, g_per_ml } = req.body;

  if (unit_cost !== undefined && (typeof unit_cost !== 'number' || isNaN(unit_cost) || unit_cost < 0)) {
    return res.status(400).json({ error: 'unit_cost must be a non-negative number' });
  }
  if (g_per_ml !== undefined && g_per_ml !== null && (typeof g_per_ml !== 'number' || isNaN(g_per_ml) || g_per_ml <= 0)) {
    return res.status(400).json({ error: 'g_per_ml must be a positive number or null' });
  }

  const updates = [];
  const params = [];
  if (name) { updates.push('name = ?'); params.push(name); }
  if (unit_cost !== undefined) { updates.push('unit_cost = ?'); params.push(unit_cost); }
  if (base_unit) { updates.push('base_unit = ?'); params.push(base_unit); }
  if (category) { updates.push('category = ?'); params.push(category); }
  if (g_per_ml !== undefined) { updates.push('g_per_ml = ?'); params.push(g_per_ml); }

  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

  params.push(req.params.id);
  const result = db.prepare(`UPDATE ingredients SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  if (result.changes === 0) return res.status(404).json({ error: 'Ingredient not found' });

  // Re-detect allergens if name changed
  if (name) {
    updateIngredientAllergens(parseInt(req.params.id));
  }

  req.broadcast('ingredient_updated', { id: parseInt(req.params.id) }, req.headers['x-client-id']);
  res.json({ success: true });
});

// GET /api/ingredients/:id/allergens - Get allergens for single ingredient
router.get('/:id/allergens', (req, res) => {
  const db = getDb();
  const ingredient = db.prepare('SELECT name FROM ingredients WHERE id = ?').get(req.params.id);
  if (!ingredient) return res.status(404).json({ error: 'Ingredient not found' });

  const allergens = db.prepare(
    'SELECT allergen, source FROM ingredient_allergens WHERE ingredient_id = ? ORDER BY allergen'
  ).all(req.params.id);
  res.json({ ingredient: ingredient.name, allergens: allergens.map(a => a.allergen) });
});

// POST /api/ingredients/:id/allergens - Manual allergen override for ingredient
router.post('/:id/allergens', (req, res) => {
  const db = getDb();

  const ingredient = db.prepare('SELECT id FROM ingredients WHERE id = ?').get(req.params.id);
  if (!ingredient) return res.status(404).json({ error: 'Ingredient not found' });

  const { allergen, action } = req.body;

  if (!allergen || !VALID_ALLERGENS.includes(allergen)) {
    return res.status(400).json({ error: 'Invalid allergen. Must be one of the EU 14.' });
  }
  if (action !== 'add' && action !== 'remove') {
    return res.status(400).json({ error: "Action must be 'add' or 'remove'." });
  }

  if (action === 'add') {
    db.prepare('INSERT OR REPLACE INTO ingredient_allergens (ingredient_id, allergen, source) VALUES (?, ?, ?)').run(req.params.id, allergen, 'manual');
  } else {
    db.prepare('DELETE FROM ingredient_allergens WHERE ingredient_id = ? AND allergen = ?').run(req.params.id, allergen);
  }

  req.broadcast('ingredient_updated', { id: parseInt(req.params.id) }, req.headers['x-client-id']);
  res.json({ success: true });
});

// PATCH /api/ingredients/bulk-density - Bulk update density values
router.patch('/bulk-density', (req, res) => {
  const db = getDb();
  const { items } = req.body;

  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'items array is required' });
  }

  const update = db.prepare('UPDATE ingredients SET g_per_ml = ? WHERE id = ?');
  let updated = 0;

  for (const item of items) {
    if (!item.id) continue;
    if (item.g_per_ml !== null && (typeof item.g_per_ml !== 'number' || isNaN(item.g_per_ml) || item.g_per_ml <= 0)) continue;
    const result = update.run(item.g_per_ml, item.id);
    if (result.changes > 0) updated++;
  }

  res.json({ updated });
});

module.exports = router;
