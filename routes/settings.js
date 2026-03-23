const express = require('express');
const { getDb } = require('../db/database');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

// GET /api/settings/backup — export all data as JSON
router.get('/backup', asyncHandler(async (req, res) => {
  const db = await getDb();
  const tables = ['dishes', 'ingredients', 'dish_ingredients', 'allergen_keywords',
    'dish_allergens', 'ingredient_allergens', 'menus', 'menu_courses', 'menu_dishes',
    'weekly_specials', 'tags', 'dish_tags', 'dish_substitutions', 'dish_section_headers',
    'dish_components', 'dish_directions', 'dish_service_directions', 'tasks',
    'service_notes', 'settings', 'passkey_credentials', 'ai_history', 'ai_usage',
    'ai_conversations', 'ai_messages', 'chefsheets'];

  const backup = {};
  for (const table of tables) {
    backup[table] = await db.prepare(`SELECT * FROM ${table}`).all();
  }

  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `platestack-backup-${timestamp}.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.json(backup);
}));

// POST /api/settings/restore — no longer supported (use Cloud SQL backups)
router.post('/restore', asyncHandler(async (req, res) => {
  res.status(400).json({ error: 'Database restore is managed via Cloud SQL backups. Contact your administrator.' });
}));

module.exports = router;
