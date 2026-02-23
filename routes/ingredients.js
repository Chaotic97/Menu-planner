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
    res.json({ id: existing.id, updated: true });
  } else {
    const result = db.prepare(
      'INSERT INTO ingredients (name, unit_cost, base_unit, category) VALUES (?, ?, ?, ?)'
    ).run(name, unit_cost || 0, base_unit || 'g', category || 'other');
    res.status(201).json({ id: result.lastInsertRowid });
  }
});

// PUT /api/ingredients/:id - Update ingredient
router.put('/:id', (req, res) => {
  const db = getDb();
  const { name, unit_cost, base_unit, category } = req.body;

  const updates = [];
  const params = [];
  if (name) { updates.push('name = ?'); params.push(name); }
  if (unit_cost !== undefined) { updates.push('unit_cost = ?'); params.push(unit_cost); }
  if (base_unit) { updates.push('base_unit = ?'); params.push(base_unit); }
  if (category) { updates.push('category = ?'); params.push(category); }

  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

  params.push(req.params.id);
  db.prepare(`UPDATE ingredients SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
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
