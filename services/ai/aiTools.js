/**
 * AI Tools — tool registry for Claude Haiku function calling.
 * Each tool has a schema (for Haiku) and a handler (for execution).
 * Adding a new AI command = adding one entry to TOOL_REGISTRY.
 */

const { getDb } = require('../../db/database');
const { saveSnapshot } = require('./aiHistory');

// ─── Tool Definitions (sent to Haiku) ────────────────────────────

const TOOL_REGISTRY = [
  {
    name: 'create_menu',
    description: 'Create a new menu in PlateStack. Use when the user wants to make a new menu.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the menu' },
        description: { type: 'string', description: 'Optional description of the menu' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_dish',
    description: 'Create a new dish in PlateStack. Use when the user wants to add a new dish/recipe.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the dish' },
        category: {
          type: 'string',
          description: 'Category of the dish',
          enum: ['starter', 'main', 'side', 'dessert', 'sauce', 'bread', 'mise en place', 'other'],
        },
        description: { type: 'string', description: 'Brief description of the dish' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_task',
    description: 'Create a task or to-do item. Use when the user wants to add a reminder, prep task, or any to-do.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title/description' },
        priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Task priority' },
        due_date: { type: 'string', description: 'Due date in YYYY-MM-DD format' },
        due_time: { type: 'string', description: 'Due time in HH:MM format' },
        type: { type: 'string', enum: ['prep', 'custom'], description: 'Task type' },
      },
      required: ['title'],
    },
  },
  {
    name: 'add_dish_to_menu',
    description: 'Add an existing dish to a menu. Requires knowing the dish and menu by name or ID.',
    input_schema: {
      type: 'object',
      properties: {
        dish_id: { type: 'number', description: 'ID of the dish to add' },
        dish_name: { type: 'string', description: 'Name of the dish (used for fuzzy matching if no ID)' },
        menu_id: { type: 'number', description: 'ID of the menu to add the dish to' },
        menu_name: { type: 'string', description: 'Name of the menu (used for fuzzy matching if no ID)' },
        servings: { type: 'number', description: 'Number of servings/batches. Defaults to 1.' },
      },
      required: [],
    },
  },
  {
    name: 'cleanup_recipe',
    description: 'Clean up and standardize recipe directions for the current dish. Improves readability, standardizes culinary terminology, and structures steps properly. Only use when user is viewing or editing a specific dish.',
    input_schema: {
      type: 'object',
      properties: {
        dish_id: { type: 'number', description: 'ID of the dish to clean up (from page context)' },
      },
      required: ['dish_id'],
    },
  },
  {
    name: 'check_allergens',
    description: 'Verify allergens for a dish by analyzing its ingredients. Catches potential allergens the keyword-based detector might miss.',
    input_schema: {
      type: 'object',
      properties: {
        dish_id: { type: 'number', description: 'ID of the dish to check (from page context)' },
      },
      required: ['dish_id'],
    },
  },
  {
    name: 'scale_recipe',
    description: 'Provide smart scaling advice for a recipe. Goes beyond simple multiplication — advises on salt ratios, batch splitting, timing adjustments.',
    input_schema: {
      type: 'object',
      properties: {
        dish_id: { type: 'number', description: 'ID of the dish to scale' },
        target_portions: { type: 'number', description: 'Target number of portions' },
      },
      required: ['dish_id', 'target_portions'],
    },
  },
  {
    name: 'convert_units',
    description: 'Convert between cooking units, including volume-to-weight conversions for specific ingredients.',
    input_schema: {
      type: 'object',
      properties: {
        ingredient_name: { type: 'string', description: 'The ingredient being converted (needed for volume-to-weight)' },
        from_quantity: { type: 'number', description: 'The quantity to convert' },
        from_unit: { type: 'string', description: 'The unit to convert from (e.g. "cups", "ml", "oz")' },
        to_unit: { type: 'string', description: 'The unit to convert to (e.g. "g", "kg", "ml")' },
      },
      required: ['from_quantity', 'from_unit'],
    },
  },
  {
    name: 'add_service_note',
    description: 'Create a service note for the kitchen. Use for daily notes, reminders, or shift-specific information.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Note title' },
        content: { type: 'string', description: 'Note content' },
        date: { type: 'string', description: 'Date in YYYY-MM-DD format. Defaults to today.' },
        shift: { type: 'string', enum: ['all', 'am', 'lunch', 'pm', 'prep'], description: 'Which shift this note applies to' },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'search_dishes',
    description: 'Search for dishes by name or description. Use when the user is looking for a specific dish.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query to match against dish names and descriptions' },
      },
      required: ['query'],
    },
  },
];

/**
 * Get tool definitions formatted for the Anthropic API
 */
function getToolDefinitions() {
  return TOOL_REGISTRY.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  }));
}

// ─── Tool Handlers ───────────────────────────────────────────────

const handlers = {
  create_menu(input, opts) {
    if (opts.preview) {
      return {
        description: `Create menu: "${input.name}"${input.description ? ` — ${input.description}` : ''}`,
        message: `I'll create a new menu called "${input.name}".`,
      };
    }

    const db = getDb();
    const result = db.prepare('INSERT INTO menus (name, description) VALUES (?, ?)').run(
      input.name, input.description || ''
    );
    const id = result.lastInsertRowid;
    const undoId = saveSnapshot('menu', id, 'create', null);

    if (opts.broadcast) opts.broadcast('menu_created', { id });

    return {
      success: true,
      message: `Menu "${input.name}" created.`,
      entityType: 'menu',
      entityId: id,
      undoId,
      navigateTo: `#/menus/${id}`,
    };
  },

  create_dish(input, opts) {
    if (opts.preview) {
      return {
        description: `Create dish: "${input.name}"${input.category ? ` (${input.category})` : ''}`,
        message: `I'll create a new dish called "${input.name}".`,
      };
    }

    const db = getDb();
    const result = db.prepare('INSERT INTO dishes (name, description, category) VALUES (?, ?, ?)').run(
      input.name, input.description || '', input.category || 'other'
    );
    const id = result.lastInsertRowid;
    const undoId = saveSnapshot('dish', id, 'create', null);

    if (opts.broadcast) opts.broadcast('dish_created', { id });

    return {
      success: true,
      message: `Dish "${input.name}" created.`,
      entityType: 'dish',
      entityId: id,
      undoId,
      navigateTo: `#/dishes/${id}/edit`,
    };
  },

  create_task(input, opts) {
    const today = new Date().toISOString().slice(0, 10);
    const title = input.title;
    const priority = input.priority || 'medium';
    const dueDate = input.due_date || today;
    const dueTime = input.due_time || null;
    const type = input.type || 'custom';

    if (opts.preview) {
      let desc = `Create task: "${title}"`;
      if (priority !== 'medium') desc += ` [${priority}]`;
      if (dueDate !== today) desc += ` due ${dueDate}`;
      if (dueTime) desc += ` at ${dueTime}`;
      return { description: desc, message: `I'll create a task: "${title}".` };
    }

    const db = getDb();
    const result = db.prepare(
      'INSERT INTO tasks (title, type, priority, due_date, due_time, source) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(title, type, priority, dueDate, dueTime, 'manual');
    const id = result.lastInsertRowid;
    const undoId = saveSnapshot('task', id, 'create', null);

    if (opts.broadcast) opts.broadcast('task_created', { id, type });

    return {
      success: true,
      message: `Task "${title}" created.`,
      entityType: 'task',
      entityId: id,
      undoId,
    };
  },

  add_dish_to_menu(input, opts) {
    const db = getDb();

    // Resolve dish
    let dishId = input.dish_id;
    let dishName = input.dish_name;
    if (!dishId && dishName) {
      const dish = db.prepare(
        "SELECT id, name FROM dishes WHERE name LIKE ? AND deleted_at IS NULL LIMIT 1"
      ).get(`%${dishName}%`);
      if (dish) { dishId = dish.id; dishName = dish.name; }
    }
    if (dishId && !dishName) {
      const dish = db.prepare('SELECT name FROM dishes WHERE id = ? AND deleted_at IS NULL').get(dishId);
      if (dish) dishName = dish.name;
    }

    // Resolve menu
    let menuId = input.menu_id;
    let menuName = input.menu_name;
    if (!menuId && menuName) {
      const menu = db.prepare(
        "SELECT id, name FROM menus WHERE name LIKE ? AND deleted_at IS NULL LIMIT 1"
      ).get(`%${menuName}%`);
      if (menu) { menuId = menu.id; menuName = menu.name; }
    }
    if (menuId && !menuName) {
      const menu = db.prepare('SELECT name FROM menus WHERE id = ? AND deleted_at IS NULL').get(menuId);
      if (menu) menuName = menu.name;
    }

    if (!dishId || !menuId) {
      const missing = [];
      if (!dishId) missing.push('dish');
      if (!menuId) missing.push('menu');
      return {
        description: `Could not find: ${missing.join(', ')}`,
        message: `I couldn't find the ${missing.join(' or ')} you specified. Please check the name and try again.`,
      };
    }

    const servings = input.servings || 1;

    if (opts.preview) {
      return {
        description: `Add "${dishName}" to menu "${menuName}" (${servings} serving${servings !== 1 ? 's' : ''})`,
        message: `I'll add "${dishName}" to "${menuName}".`,
      };
    }

    // Check if already on menu
    const existing = db.prepare('SELECT 1 FROM menu_dishes WHERE menu_id = ? AND dish_id = ?').get(menuId, dishId);
    if (existing) {
      return {
        success: false,
        message: `"${dishName}" is already on "${menuName}".`,
      };
    }

    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM menu_dishes WHERE menu_id = ?').get(menuId);
    db.prepare('INSERT INTO menu_dishes (menu_id, dish_id, servings, sort_order) VALUES (?, ?, ?, ?)').run(
      menuId, dishId, servings, maxOrder.next
    );

    if (opts.broadcast) opts.broadcast('menu_updated', { id: menuId });

    return {
      success: true,
      message: `Added "${dishName}" to "${menuName}".`,
      entityType: 'menu',
      entityId: menuId,
    };
  },

  cleanup_recipe(input, opts) {
    const db = getDb();
    const dishId = input.dish_id;

    const dish = db.prepare('SELECT id, name, chefs_notes FROM dishes WHERE id = ? AND deleted_at IS NULL').get(dishId);
    if (!dish) {
      return { description: 'Dish not found', message: 'Could not find that dish.' };
    }

    const directions = db.prepare(
      'SELECT id, type, text, sort_order FROM dish_directions WHERE dish_id = ? ORDER BY sort_order'
    ).all(dishId);

    if (!directions.length && !dish.chefs_notes) {
      return { description: 'No directions to clean up', message: 'This dish has no directions or chef\'s notes to clean up.' };
    }

    if (opts.preview) {
      const currentText = directions.length
        ? directions.map(d => d.type === 'section' ? `[${d.text}]` : d.text).join('\n')
        : dish.chefs_notes;
      return {
        description: `Clean up directions for "${dish.name}"`,
        message: `I'll clean up and standardize the directions for "${dish.name}". You'll see a before/after comparison.`,
        currentDirections: currentText,
        needsAiProcessing: true,
      };
    }

    // This is called AFTER Haiku has returned cleaned directions in the two-step flow
    // The actual cleaned directions come from the AI response, passed through input.cleaned_directions
    if (input.cleaned_directions) {
      // Save snapshot of current directions for undo
      const undoId = saveSnapshot('dish', dishId, 'update', { directions });

      // Replace directions
      db.prepare('DELETE FROM dish_directions WHERE dish_id = ?').run(dishId);
      for (let i = 0; i < input.cleaned_directions.length; i++) {
        const dir = input.cleaned_directions[i];
        db.prepare('INSERT INTO dish_directions (dish_id, type, text, sort_order) VALUES (?, ?, ?, ?)')
          .run(dishId, dir.type || 'step', dir.text, i);
      }

      // Clear legacy chefs_notes since we now have structured directions
      db.prepare('UPDATE dishes SET chefs_notes = ? WHERE id = ?').run('', dishId);

      if (opts.broadcast) opts.broadcast('dish_updated', { id: dishId });

      return {
        success: true,
        message: `Directions for "${dish.name}" have been cleaned up.`,
        entityType: 'dish',
        entityId: dishId,
        undoId,
      };
    }

    return { success: false, message: 'Missing cleaned directions data.' };
  },

  check_allergens(input, opts) {
    const db = getDb();
    const dishId = input.dish_id;

    const dish = db.prepare('SELECT id, name FROM dishes WHERE id = ? AND deleted_at IS NULL').get(dishId);
    if (!dish) {
      return { description: 'Dish not found', message: 'Could not find that dish.' };
    }

    const ingredients = db.prepare(
      `SELECT i.name FROM dish_ingredients di JOIN ingredients i ON di.ingredient_id = i.id WHERE di.dish_id = ?`
    ).all(dishId);

    const currentAllergens = db.prepare('SELECT allergen, source FROM dish_allergens WHERE dish_id = ?').all(dishId);

    if (opts.preview) {
      return {
        description: `Check allergens for "${dish.name}" (${ingredients.length} ingredients)`,
        message: `I'll analyze the ingredients in "${dish.name}" for potential allergens that may have been missed by keyword detection.`,
        needsAiProcessing: true,
        currentAllergens,
        ingredients: ingredients.map(i => i.name),
      };
    }

    // Text-only response — Haiku analyzes and returns findings as text
    return {
      success: true,
      message: 'Allergen check complete.',
    };
  },

  scale_recipe(input, opts) {
    const db = getDb();
    const dish = db.prepare('SELECT id, name, batch_yield FROM dishes WHERE id = ? AND deleted_at IS NULL').get(input.dish_id);
    if (!dish) {
      return { description: 'Dish not found', message: 'Could not find that dish.' };
    }

    if (opts.preview) {
      return {
        description: `Smart scaling advice for "${dish.name}" to ${input.target_portions} portions`,
        message: `I'll provide scaling advice for "${dish.name}" from ${dish.batch_yield} to ${input.target_portions} portions.`,
        needsAiProcessing: true,
      };
    }

    // Text-only — Haiku provides advice, no DB mutation
    return { success: true, message: 'Scaling advice provided.' };
  },

  convert_units(input, opts) {
    if (opts.preview) {
      const desc = input.ingredient_name
        ? `Convert ${input.from_quantity} ${input.from_unit} of ${input.ingredient_name}${input.to_unit ? ' to ' + input.to_unit : ''}`
        : `Convert ${input.from_quantity} ${input.from_unit}${input.to_unit ? ' to ' + input.to_unit : ''}`;
      return {
        description: desc,
        message: `I'll convert ${input.from_quantity} ${input.from_unit}${input.ingredient_name ? ' of ' + input.ingredient_name : ''}.`,
        needsAiProcessing: true,
      };
    }

    // Text-only — Haiku provides the conversion
    return { success: true, message: 'Conversion provided.' };
  },

  add_service_note(input, opts) {
    const today = new Date().toISOString().slice(0, 10);
    const date = input.date || today;
    const shift = input.shift || 'all';

    if (opts.preview) {
      return {
        description: `Add service note: "${input.title}" (${date}, ${shift})`,
        message: `I'll create a service note: "${input.title}".`,
      };
    }

    const db = getDb();
    const result = db.prepare(
      'INSERT INTO service_notes (date, shift, title, content) VALUES (?, ?, ?, ?)'
    ).run(date, shift, input.title, input.content);
    const id = result.lastInsertRowid;
    const undoId = saveSnapshot('service_note', id, 'create', null);

    if (opts.broadcast) opts.broadcast('service_note_created', { id, date });

    return {
      success: true,
      message: `Service note "${input.title}" created for ${date}.`,
      entityType: 'service_note',
      entityId: id,
      undoId,
    };
  },

  search_dishes(input, opts) {
    const db = getDb();
    const dishes = db.prepare(
      "SELECT id, name, category, description FROM dishes WHERE deleted_at IS NULL AND (name LIKE ? OR description LIKE ?) ORDER BY name LIMIT 10"
    ).all(`%${input.query}%`, `%${input.query}%`);

    const message = dishes.length
      ? 'Found ' + dishes.length + ' dish(es):\n' + dishes.map(d => `- "${d.name}" (${d.category || 'uncategorized'}) — ID: ${d.id}`).join('\n')
      : `No dishes found matching "${input.query}".`;

    if (opts.preview) {
      return { description: `Search dishes: "${input.query}"`, message };
    }

    return { success: true, message, dishes };
  },
};

/**
 * Execute a tool handler
 * @param {string} toolName
 * @param {Object} input - tool input parameters
 * @param {Object} opts - { preview: bool, pageContext?, broadcast? }
 */
function executeToolHandler(toolName, input, opts) {
  const handler = handlers[toolName];
  if (!handler) {
    return { description: `Unknown tool: ${toolName}`, message: `I don't know how to do that yet.` };
  }
  return handler(input, opts || {});
}

module.exports = {
  getToolDefinitions,
  executeToolHandler,
};
