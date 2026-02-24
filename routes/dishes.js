const express = require('express');
const multer = require('multer');
const path = require('path');
const { getDb } = require('../db/database');
const { updateDishAllergens, getAllergenKeywords, addAllergenKeyword, deleteAllergenKeyword } = require('../services/allergenDetector');
const { calculateDishCost, calculateFoodCostPercent, suggestPrice, round2 } = require('../services/costCalculator');
const { importRecipe } = require('../services/recipeImporter');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

// Photo upload config
const storage = multer.diskStorage({
  destination: process.env.UPLOADS_PATH || path.join(__dirname, '..', 'uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `dish-${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    cb(null, ext && mime);
  },
});

// GET /api/dishes/tags/all — list all tags (BEFORE /:id)
router.get('/tags/all', (req, res) => {
  const db = getDb();
  const tags = db.prepare('SELECT * FROM tags ORDER BY name').all();
  res.json(tags);
});

// GET /api/dishes - List all dishes
router.get('/', (req, res) => {
  const db = getDb();
  const { category, search, favorite, tag } = req.query;

  let sql = 'SELECT * FROM dishes';
  const conditions = ['deleted_at IS NULL'];
  const params = [];

  if (category) {
    conditions.push('category = ?');
    params.push(category);
  }
  if (search) {
    conditions.push('(name LIKE ? OR description LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (favorite === '1') {
    conditions.push('is_favorite = 1');
  }

  sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY name';

  let dishes = db.prepare(sql).all(...params);

  // Filter by tag if specified
  if (tag) {
    const tagRow = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE').get(tag);
    if (tagRow) {
      const taggedIds = new Set(
        db.prepare('SELECT dish_id FROM dish_tags WHERE tag_id = ?').all(tagRow.id).map(r => r.dish_id)
      );
      dishes = dishes.filter(d => taggedIds.has(d.id));
    } else {
      dishes = [];
    }
  }

  // Attach allergens and tags to each dish
  const allergenStmt = db.prepare('SELECT allergen, source FROM dish_allergens WHERE dish_id = ?');
  const tagStmt = db.prepare(`
    SELECT t.name FROM dish_tags dt JOIN tags t ON t.id = dt.tag_id WHERE dt.dish_id = ?
  `);
  for (const dish of dishes) {
    dish.allergens = allergenStmt.all(dish.id);
    dish.tags = tagStmt.all(dish.id).map(t => t.name);
  }

  res.json(dishes);
});

// GET /api/dishes/:id - Get single dish with full details
router.get('/:id', (req, res) => {
  const db = getDb();
  const dish = db.prepare('SELECT * FROM dishes WHERE id = ?').get(req.params.id);
  if (!dish) return res.status(404).json({ error: 'Dish not found' });

  // Get ingredients (ordered by sort_order)
  const ingRows = db.prepare(`
    SELECT di.*, i.name AS ingredient_name, i.unit_cost, i.base_unit, i.category AS ingredient_category
    FROM dish_ingredients di
    JOIN ingredients i ON i.id = di.ingredient_id
    WHERE di.dish_id = ?
    ORDER BY di.sort_order, di.id
  `).all(dish.id);

  // Get section headers
  const sectionRows = db.prepare(
    'SELECT id, label, sort_order FROM dish_section_headers WHERE dish_id = ? ORDER BY sort_order'
  ).all(dish.id);

  // Merge into a single ordered list (sections interspersed with ingredients)
  dish.ingredients = [
    ...ingRows.map(r => ({ ...r, row_type: 'ingredient' })),
    ...sectionRows.map(r => ({ ...r, row_type: 'section' })),
  ].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);

  // Get allergens
  dish.allergens = db.prepare('SELECT allergen, source FROM dish_allergens WHERE dish_id = ?').all(dish.id);

  // Get tags
  dish.tags = db.prepare(`
    SELECT t.name FROM dish_tags dt JOIN tags t ON t.id = dt.tag_id WHERE dt.dish_id = ?
  `).all(dish.id).map(t => t.name);

  // Get substitutions
  dish.substitutions = db.prepare('SELECT * FROM dish_substitutions WHERE dish_id = ? ORDER BY allergen, id').all(dish.id);

  // Calculate cost
  const costResult = calculateDishCost(dish.ingredients);

  // Parse manual costs and add to total
  let manualCosts = [];
  try { manualCosts = JSON.parse(dish.manual_costs || '[]'); } catch {}
  dish.manual_costs = manualCosts;
  const manualTotal = round2(manualCosts.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0));
  const combinedTotal = round2(costResult.totalCost + manualTotal);
  dish.cost = { ...costResult, manualTotal, combinedTotal };

  dish.food_cost_percent = calculateFoodCostPercent(combinedTotal, dish.suggested_price);
  dish.suggested_price_calc = suggestPrice(combinedTotal);

  res.json(dish);
});

// POST /api/dishes - Create dish
router.post('/', (req, res) => {
  const db = getDb();
  const { name, description, category, chefs_notes, suggested_price, ingredients, tags, substitutions, manual_costs } = req.body;

  if (!name) return res.status(400).json({ error: 'Name is required' });

  const result = db.prepare(`
    INSERT INTO dishes (name, description, category, chefs_notes, suggested_price, manual_costs)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, description || '', category || 'main', chefs_notes || '', suggested_price || 0, manual_costs ? JSON.stringify(manual_costs) : '[]');

  const dishId = result.lastInsertRowid;

  // Add ingredients
  saveIngredients(db, dishId, ingredients);

  // Save tags
  saveDishTags(db, dishId, tags);

  // Save substitutions
  saveDishSubstitutions(db, dishId, substitutions);

  // Detect allergens
  updateDishAllergens(dishId);

  req.broadcast('dish_created', { id: dishId }, req.headers['x-client-id']);
  res.status(201).json({ id: dishId });
});

// POST /api/dishes/:id/duplicate - Duplicate a dish
router.post('/:id/duplicate', (req, res) => {
  const db = getDb();
  const source = db.prepare('SELECT * FROM dishes WHERE id = ?').get(req.params.id);
  if (!source) return res.status(404).json({ error: 'Dish not found' });

  const result = db.prepare(`
    INSERT INTO dishes (name, description, category, chefs_notes, suggested_price)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    'Copy of ' + source.name,
    source.description,
    source.category,
    source.chefs_notes,
    source.suggested_price
  );

  const newId = result.lastInsertRowid;

  // Copy all dish_ingredients (including sort_order)
  const ingredients = db.prepare(`
    SELECT ingredient_id, quantity, unit, prep_note, sort_order
    FROM dish_ingredients WHERE dish_id = ?
    ORDER BY sort_order, id
  `).all(req.params.id);

  const insertDI = db.prepare(`
    INSERT INTO dish_ingredients (dish_id, ingredient_id, quantity, unit, prep_note, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const ing of ingredients) {
    insertDI.run(newId, ing.ingredient_id, ing.quantity, ing.unit, ing.prep_note, ing.sort_order || 0);
  }

  // Copy section headers
  const sectionHeaders = db.prepare(
    'SELECT label, sort_order FROM dish_section_headers WHERE dish_id = ? ORDER BY sort_order'
  ).all(req.params.id);
  const insertHeader = db.prepare(
    'INSERT INTO dish_section_headers (dish_id, label, sort_order) VALUES (?, ?, ?)'
  );
  for (const h of sectionHeaders) {
    insertHeader.run(newId, h.label, h.sort_order);
  }

  // Copy substitutions
  const subs = db.prepare('SELECT * FROM dish_substitutions WHERE dish_id = ?').all(req.params.id);
  const insertSub = db.prepare(`
    INSERT INTO dish_substitutions (dish_id, allergen, original_ingredient, substitute_ingredient, substitute_quantity, substitute_unit, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const s of subs) {
    insertSub.run(newId, s.allergen, s.original_ingredient, s.substitute_ingredient, s.substitute_quantity, s.substitute_unit, s.notes);
  }

  // Copy tags
  const tagIds = db.prepare('SELECT tag_id FROM dish_tags WHERE dish_id = ?').all(req.params.id);
  const insertTag = db.prepare('INSERT OR IGNORE INTO dish_tags (dish_id, tag_id) VALUES (?, ?)');
  for (const t of tagIds) {
    insertTag.run(newId, t.tag_id);
  }

  updateDishAllergens(newId);

  req.broadcast('dish_created', { id: newId }, req.headers['x-client-id']);
  res.status(201).json({ id: newId });
});

// POST /api/dishes/import-url - Import recipe from URL
router.post('/import-url', asyncHandler(async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    const recipe = await importRecipe(url);
    res.json(recipe);
  } catch (err) {
    res.status(422).json({ error: err.message });
  }
}));

// POST /api/dishes/:id/favorite - Toggle favorite
router.post('/:id/favorite', (req, res) => {
  const db = getDb();
  const dish = db.prepare('SELECT is_favorite FROM dishes WHERE id = ?').get(req.params.id);
  if (!dish) return res.status(404).json({ error: 'Dish not found' });

  const newVal = dish.is_favorite ? 0 : 1;
  db.prepare('UPDATE dishes SET is_favorite = ? WHERE id = ?').run(newVal, req.params.id);

  req.broadcast('dish_updated', { id: parseInt(req.params.id) }, req.headers['x-client-id']);
  res.json({ is_favorite: newVal });
});

// POST /api/dishes/:id/restore - Restore soft-deleted dish
router.post('/:id/restore', (req, res) => {
  const db = getDb();
  db.prepare("UPDATE dishes SET deleted_at = NULL WHERE id = ?").run(req.params.id);
  req.broadcast('dish_created', { id: parseInt(req.params.id) }, req.headers['x-client-id']);
  res.json({ success: true });
});

// PUT /api/dishes/:id - Update dish
router.put('/:id', (req, res) => {
  const db = getDb();
  const dish = db.prepare('SELECT * FROM dishes WHERE id = ?').get(req.params.id);
  if (!dish) return res.status(404).json({ error: 'Dish not found' });

  const { name, description, category, chefs_notes, suggested_price, ingredients, tags, substitutions, manual_costs } = req.body;

  db.prepare(`
    UPDATE dishes SET name = ?, description = ?, category = ?, chefs_notes = ?, suggested_price = ?, manual_costs = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name || dish.name,
    description !== undefined ? description : dish.description,
    category || dish.category,
    chefs_notes !== undefined ? chefs_notes : dish.chefs_notes,
    suggested_price !== undefined ? suggested_price : dish.suggested_price,
    manual_costs !== undefined ? JSON.stringify(manual_costs) : (dish.manual_costs || '[]'),
    req.params.id
  );

  // Replace ingredients if provided
  if (ingredients) {
    db.prepare('DELETE FROM dish_ingredients WHERE dish_id = ?').run(req.params.id);
    db.prepare('DELETE FROM dish_section_headers WHERE dish_id = ?').run(req.params.id);
    saveIngredients(db, req.params.id, ingredients);

    // Re-detect allergens
    updateDishAllergens(req.params.id);
  }

  // Update tags if provided
  if (tags !== undefined) {
    saveDishTags(db, req.params.id, tags);
  }

  // Update substitutions if provided
  if (substitutions !== undefined) {
    saveDishSubstitutions(db, req.params.id, substitutions);
  }

  req.broadcast('dish_updated', { id: parseInt(req.params.id) }, req.headers['x-client-id']);
  res.json({ success: true });
});

// DELETE /api/dishes/:id - Soft delete
router.delete('/:id', (req, res) => {
  const db = getDb();
  const dish = db.prepare('SELECT id FROM dishes WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
  if (!dish) return res.status(404).json({ error: 'Dish not found' });

  db.prepare("UPDATE dishes SET deleted_at = datetime('now') WHERE id = ?").run(req.params.id);
  req.broadcast('dish_deleted', { id: parseInt(req.params.id) }, req.headers['x-client-id']);
  res.json({ success: true });
});

// POST /api/dishes/:id/photo - Upload photo
router.post('/:id/photo', upload.single('photo'), (req, res) => {
  const db = getDb();
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const photoPath = `/uploads/${req.file.filename}`;
  db.prepare('UPDATE dishes SET photo_path = ?, updated_at = datetime(\'now\') WHERE id = ?').run(photoPath, req.params.id);
  req.broadcast('dish_updated', { id: parseInt(req.params.id) }, req.headers['x-client-id']);
  res.json({ photo_path: photoPath });
});

// POST /api/dishes/:id/allergens - Manual allergen override
router.post('/:id/allergens', (req, res) => {
  const db = getDb();
  const { allergen, action } = req.body;

  if (action === 'add') {
    db.prepare('INSERT OR REPLACE INTO dish_allergens (dish_id, allergen, source) VALUES (?, ?, ?)').run(req.params.id, allergen, 'manual');
  } else if (action === 'remove') {
    db.prepare('DELETE FROM dish_allergens WHERE dish_id = ? AND allergen = ?').run(req.params.id, allergen);
  }

  res.json({ success: true });
});

// Allergen keywords management
router.get('/allergen-keywords/all', (req, res) => {
  res.json(getAllergenKeywords());
});

router.post('/allergen-keywords', (req, res) => {
  const { keyword, allergen } = req.body;
  addAllergenKeyword(keyword, allergen);
  res.status(201).json({ success: true });
});

router.delete('/allergen-keywords/:id', (req, res) => {
  deleteAllergenKeyword(req.params.id);
  res.json({ success: true });
});

// --- Helper functions ---

function saveIngredients(db, dishId, ingredients) {
  if (!ingredients || !ingredients.length) return;

  // Split into section headers and real ingredients, preserving DOM order (sort_order = index)
  const headerItems = [];
  const realItems = [];

  for (let i = 0; i < ingredients.length; i++) {
    const item = ingredients[i];
    if (item.section_header) {
      const label = String(item.section_header).trim();
      if (label) headerItems.push({ label, sort_order: i });
    } else {
      const key = (item.name || '').trim();
      if (key) realItems.push({ ...item, sort_order: i });
    }
  }

  // Save section headers
  if (headerItems.length) {
    const insertHeader = db.prepare(
      'INSERT INTO dish_section_headers (dish_id, label, sort_order) VALUES (?, ?, ?)'
    );
    for (const h of headerItems) {
      insertHeader.run(dishId, h.label, h.sort_order);
    }
  }

  // Deduplicate real ingredients by name (case-insensitive).
  // Same name + same unit → sum quantities; different unit → keep first occurrence.
  const seen = new Map();
  for (const ing of realItems) {
    const key = ing.name.trim().toLowerCase();
    if (seen.has(key)) {
      const existing = seen.get(key);
      if (existing.unit === (ing.unit || 'each')) {
        existing.quantity = Math.round(((existing.quantity || 0) + (ing.quantity || 0)) * 1000) / 1000;
      }
      // Different unit: keep first occurrence (preserves its sort_order)
    } else {
      seen.set(key, { ...ing });
    }
  }

  const insertIngredient = db.prepare('INSERT OR IGNORE INTO ingredients (name) VALUES (?)');
  const getIngredient = db.prepare('SELECT id FROM ingredients WHERE name = ? COLLATE NOCASE');
  const insertDishIngredient = db.prepare(`
    INSERT INTO dish_ingredients (dish_id, ingredient_id, quantity, unit, prep_note, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const updateIngredientCost = db.prepare(
    'UPDATE ingredients SET unit_cost = ?, base_unit = ? WHERE id = ?'
  );

  for (const ing of seen.values()) {
    insertIngredient.run(ing.name);
    const row = getIngredient.get(ing.name);
    if (row) {
      insertDishIngredient.run(
        dishId, row.id, ing.quantity || 0, ing.unit || 'each', ing.prep_note || '', ing.sort_order || 0
      );
      if (ing.unit_cost !== undefined) {
        updateIngredientCost.run(
          ing.unit_cost !== null ? parseFloat(ing.unit_cost) : null,
          ing.base_unit || ing.unit || 'g',
          row.id
        );
      }
    }
  }
}

function saveDishTags(db, dishId, tags) {
  if (!tags || !Array.isArray(tags)) return;

  db.prepare('DELETE FROM dish_tags WHERE dish_id = ?').run(dishId);

  for (const tagName of tags) {
    const name = tagName.trim();
    if (!name) continue;
    db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(name);
    const tag = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE').get(name);
    if (tag) {
      db.prepare('INSERT OR IGNORE INTO dish_tags (dish_id, tag_id) VALUES (?, ?)').run(dishId, tag.id);
    }
  }
}

function saveDishSubstitutions(db, dishId, substitutions) {
  if (!substitutions || !Array.isArray(substitutions)) return;

  db.prepare('DELETE FROM dish_substitutions WHERE dish_id = ?').run(dishId);

  const insertSub = db.prepare(`
    INSERT INTO dish_substitutions (dish_id, allergen, original_ingredient, substitute_ingredient, substitute_quantity, substitute_unit, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const sub of substitutions) {
    if (!sub.allergen || !sub.original_ingredient || !sub.substitute_ingredient) continue;
    insertSub.run(
      dishId,
      sub.allergen,
      sub.original_ingredient,
      sub.substitute_ingredient,
      sub.substitute_quantity || null,
      sub.substitute_unit || null,
      sub.notes || ''
    );
  }
}

module.exports = router;
