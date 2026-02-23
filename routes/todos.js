const express = require('express');
const { getDb } = require('../db/database');
const { generateShoppingList } = require('../services/shoppingListGenerator');
const { generatePrepTasks } = require('../services/prepTaskGenerator');

const router = express.Router();

// GET /api/todos/menu/:id/shopping-list
router.get('/menu/:id/shopping-list', (req, res) => {
  const result = generateShoppingList(req.params.id);
  if (!result) return res.status(404).json({ error: 'Menu not found' });
  res.json(result);
});

// GET /api/todos/menu/:id/scaled-shopping-list?covers=N
router.get('/menu/:id/scaled-shopping-list', (req, res) => {
  const covers = parseInt(req.query.covers);
  if (!covers || covers < 1) {
    return res.status(400).json({ error: 'covers parameter is required and must be a positive integer' });
  }

  const result = generateShoppingList(req.params.id);
  if (!result) return res.status(404).json({ error: 'Menu not found' });

  // Calculate base covers (sum of all servings in the menu)
  const db = getDb();
  const servingsRow = db.prepare(
    'SELECT COALESCE(SUM(servings), 0) AS total_servings FROM menu_dishes WHERE menu_id = ?'
  ).get(req.params.id);
  const baseCovers = servingsRow.total_servings || 1;
  const scaleFactor = covers / baseCovers;

  // Scale all quantities and costs
  for (const group of result.groups) {
    for (const item of group.items) {
      item.total_quantity = Math.round(item.total_quantity * scaleFactor * 100) / 100;
      if (item.estimated_cost !== null) {
        item.estimated_cost = Math.round(item.estimated_cost * scaleFactor * 100) / 100;
      }
      // Re-normalize units after scaling
      if (item.unit === 'g' && item.total_quantity >= 1000) {
        item.total_quantity = Math.round(item.total_quantity / 1000 * 100) / 100;
        item.unit = 'kg';
      } else if (item.unit === 'ml' && item.total_quantity >= 1000) {
        item.total_quantity = Math.round(item.total_quantity / 1000 * 100) / 100;
        item.unit = 'L';
      }
    }
  }
  result.total_estimated_cost = Math.round(result.total_estimated_cost * scaleFactor * 100) / 100;
  result.covers = covers;
  result.base_covers = baseCovers;
  result.scale_factor = Math.round(scaleFactor * 100) / 100;

  res.json(result);
});

// GET /api/todos/menu/:id/prep-tasks
router.get('/menu/:id/prep-tasks', (req, res) => {
  const result = generatePrepTasks(req.params.id);
  if (!result) return res.status(404).json({ error: 'Menu not found' });
  res.json(result);
});

module.exports = router;
