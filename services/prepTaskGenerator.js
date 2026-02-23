const { getDb } = require('../db/database');

function extractTiming(text) {
  const lower = text.toLowerCase();
  if (/overnight|day before|24\s*h|the night before/i.test(lower)) return 'day_before';
  if (/morning|same day|4[-\s]?6\s*h|half day|hours ahead/i.test(lower)) return 'morning_of';
  if (/[12]\s*h.*before|hour before|2 hours/i.test(lower)) return '1_2_hours_before';
  if (/30\s*min|just before|right before|last minute|à la minute/i.test(lower)) return 'last_minute';
  return 'during_service';
}

const TIMING_LABELS = {
  day_before: 'Day Before Service',
  morning_of: 'Morning of Service',
  '1_2_hours_before': '1-2 Hours Before Service',
  during_service: 'During Service',
  last_minute: 'Last Minute / À La Minute',
};

const TIMING_ORDER = ['day_before', 'morning_of', '1_2_hours_before', 'during_service', 'last_minute'];

const VERB_PATTERN = /^(make|prep|prepare|marinate|soak|brine|rest|chill|freeze|defrost|thaw|blanch|reduce|toast|roast|bake|boil|simmer|strain|chop|dice|slice|mince|julienne|butcher|portion|temper|bloom|proof|ferment|pickle|cure|smoke|dry|rehydrate|mix|combine|whisk|fold|knead|roll|shape|pipe|set|refrigerate|warm|preheat|stock|infuse|season|trim|debone|fillet|zest|grate|crush|pound|sear|braise|deglaze|mount|emulsify|caramelize|char|grill|fry|deep fry|pan fry|poach|steam|sous vide|vacuum seal|hang|age|clarify|skim|pass|blend|puree|cool|store)/i;

const TIME_PATTERN = /(\d+\s*(hr|hour|min|minute|day|night)s?\s*(before|ahead|prior))|overnight|advance|morning of|day before|in advance/i;

function extractPrepTasks(chefNotes, dishName) {
  if (!chefNotes || !chefNotes.trim()) return [];

  const sentences = chefNotes.split(/[.\n;]+/).map(s => s.trim()).filter(s => s.length > 2);
  const tasks = [];

  for (const sentence of sentences) {
    const hasTime = TIME_PATTERN.test(sentence);
    const hasVerb = VERB_PATTERN.test(sentence);

    if (hasTime || hasVerb) {
      tasks.push({
        task: sentence,
        dish: dishName,
        timing: extractTiming(sentence),
        source: 'chefs_notes',
      });
    }
  }

  return tasks;
}

function generatePrepTasks(menuId) {
  const db = getDb();

  const menu = db.prepare('SELECT * FROM menus WHERE id = ?').get(menuId);
  if (!menu) return null;

  const dishes = db.prepare(`
    SELECT d.id, d.name, d.chefs_notes, md.servings
    FROM menu_dishes md
    JOIN dishes d ON d.id = md.dish_id
    WHERE md.menu_id = ?
    ORDER BY md.sort_order
  `).all(menuId);

  const allTasks = [];

  for (const dish of dishes) {
    // Extract from chef's notes
    const noteTasks = extractPrepTasks(dish.chefs_notes, dish.name);
    allTasks.push(...noteTasks);

    // Extract from ingredient prep notes
    const ingredients = db.prepare(`
      SELECT i.name, di.prep_note
      FROM dish_ingredients di
      JOIN ingredients i ON i.id = di.ingredient_id
      WHERE di.dish_id = ? AND di.prep_note != ''
    `).all(dish.id);

    for (const ing of ingredients) {
      if (ing.prep_note && ing.prep_note.trim()) {
        allTasks.push({
          task: `${ing.name}: ${ing.prep_note}`,
          dish: dish.name,
          timing: extractTiming(ing.prep_note),
          source: 'ingredient_prep',
        });
      }
    }
  }

  // Group by timing
  const grouped = {};
  for (const task of allTasks) {
    if (!grouped[task.timing]) grouped[task.timing] = [];
    grouped[task.timing].push(task);
  }

  const taskGroups = TIMING_ORDER
    .filter(t => grouped[t] && grouped[t].length > 0)
    .map(t => ({
      timing: t,
      label: TIMING_LABELS[t],
      tasks: grouped[t],
    }));

  return {
    menu_id: menuId,
    menu_name: menu.name,
    generated_at: new Date().toISOString(),
    task_groups: taskGroups,
    total_tasks: allTasks.length,
  };
}

module.exports = { generatePrepTasks };
