const express = require('express');
const { getDb } = require('../db/database');
const { detectAllergens } = require('../services/allergenDetector');

const router = express.Router();

// GET /api/ingredients - List/search ingredients
router.get('/', (req, res) => {
  const db = getDb();
  const { search } = req.query;

  let sql = 'SELECT * FROM ingredients';
  const params = [];

  if (search) {
    sql += ' WHERE name LIKE ?';
    params.push(`%${search}%`);
  }
  sql += ' ORDER BY name';

  const ingredients = db.prepare(sql).all(...params);
  res.json(ingredients);
});

// POST /api/ingredients - Create or upsert ingredient
router.post('/', (req, res) => {
  const db = getDb();
  const { name, unit_cost, base_unit, category } = req.body;

  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (unit_cost !== undefined && (typeof unit_cost !== 'number' || isNaN(unit_cost) || unit_cost < 0)) {
    return res.status(400).json({ error: 'unit_cost must be a non-negative number' });
  }

  const existing = db.prepare('SELECT id FROM ingredients WHERE name = ? COLLATE NOCASE').get(name);

  if (existing) {
    // Update existing
    const updates = [];
    const params = [];
    if (unit_cost !== undefined) { updates.push('unit_cost = ?'); params.push(unit_cost); }
    if (base_unit) { updates.push('base_unit = ?'); params.push(base_unit); }
    if (category) { updates.push('category = ?'); params.push(category); }

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
    req.broadcast('ingredient_created', { id: result.lastInsertRowid }, req.headers['x-client-id']);
    res.status(201).json({ id: result.lastInsertRowid });
  }
});

// PUT /api/ingredients/:id - Update ingredient
router.put('/:id', (req, res) => {
  const db = getDb();
  const { name, unit_cost, base_unit, category } = req.body;

  if (unit_cost !== undefined && (typeof unit_cost !== 'number' || isNaN(unit_cost) || unit_cost < 0)) {
    return res.status(400).json({ error: 'unit_cost must be a non-negative number' });
  }

  const updates = [];
  const params = [];
  if (name) { updates.push('name = ?'); params.push(name); }
  if (unit_cost !== undefined) { updates.push('unit_cost = ?'); params.push(unit_cost); }
  if (base_unit) { updates.push('base_unit = ?'); params.push(base_unit); }
  if (category) { updates.push('category = ?'); params.push(category); }

  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

  params.push(req.params.id);
  db.prepare(`UPDATE ingredients SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  req.broadcast('ingredient_updated', { id: parseInt(req.params.id) }, req.headers['x-client-id']);
  res.json({ success: true });
});

// PUT /api/ingredients/:id/stock - Toggle in_stock flag
router.put('/:id/stock', (req, res) => {
  const db = getDb();
  const { in_stock } = req.body;
  if (in_stock === undefined) return res.status(400).json({ error: 'in_stock is required' });

  const result = db.prepare('UPDATE ingredients SET in_stock = ? WHERE id = ?').run(in_stock ? 1 : 0, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Ingredient not found' });

  req.broadcast('ingredient_updated', { id: parseInt(req.params.id) }, req.headers['x-client-id']);
  res.json({ success: true });
});

// POST /api/ingredients/clear-stock - Clear all in_stock flags
router.post('/clear-stock', (req, res) => {
  const db = getDb();
  const result = db.prepare('UPDATE ingredients SET in_stock = 0 WHERE in_stock = 1').run();
  req.broadcast('ingredients_stock_cleared', { cleared: result.changes }, req.headers['x-client-id']);
  res.json({ success: true, cleared: result.changes });
});

// GET /api/ingredients/:id/allergens - Detect allergens for single ingredient
router.get('/:id/allergens', (req, res) => {
  const db = getDb();
  const ingredient = db.prepare('SELECT name FROM ingredients WHERE id = ?').get(req.params.id);
  if (!ingredient) return res.status(404).json({ error: 'Ingredient not found' });

  const allergens = detectAllergens([ingredient.name]);
  res.json({ ingredient: ingredient.name, allergens });
});

module.exports = router;
