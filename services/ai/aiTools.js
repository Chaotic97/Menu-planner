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
    autoApprove: true,
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
    autoApprove: true,
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
    autoApprove: true,
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
    autoApprove: true,
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
    autoApprove: true,
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
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query to match against dish names and descriptions' },
      },
      required: ['query'],
    },
  },
  {
    name: 'lookup_dish',
    description: 'Get full details of a specific dish including ingredients, allergens, directions, and cost. Use when the user asks about a specific dish.',
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {
        dish_id: { type: 'number', description: 'ID of the dish' },
        dish_name: { type: 'string', description: 'Name of the dish (fuzzy matched if no ID)' },
      },
      required: [],
    },
  },
  {
    name: 'lookup_menu',
    description: 'Get full details of a menu including dishes, costs, and allergen info. Use when the user asks about a specific menu.',
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {
        menu_id: { type: 'number', description: 'ID of the menu' },
        menu_name: { type: 'string', description: 'Name of the menu (fuzzy matched if no ID)' },
      },
      required: [],
    },
  },
  {
    name: 'search_ingredients',
    description: 'Search for ingredients by name. Returns matching ingredients with cost, stock status, and which dishes use them.',
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query for ingredient name' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_tasks',
    description: 'Search tasks and to-do items. Can filter by type, status, priority, or search by title.',
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query for task title' },
        type: { type: 'string', enum: ['prep', 'custom'], description: 'Filter by task type' },
        completed: { type: 'boolean', description: 'Filter by completion status' },
        overdue: { type: 'boolean', description: 'Only show overdue tasks' },
      },
      required: [],
    },
  },
  {
    name: 'search_service_notes',
    description: 'Search service notes by date, shift, or content.',
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Filter by date (YYYY-MM-DD)' },
        shift: { type: 'string', enum: ['all', 'am', 'lunch', 'pm', 'prep'], description: 'Filter by shift' },
        query: { type: 'string', description: 'Search in title/content' },
      },
      required: [],
    },
  },
  {
    name: 'get_shopping_list',
    description: 'Get the shopping list for a specific menu. Shows aggregated ingredients with quantities and costs.',
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {
        menu_id: { type: 'number', description: 'ID of the menu' },
        menu_name: { type: 'string', description: 'Name of the menu (fuzzy matched if no ID)' },
      },
      required: [],
    },
  },
  {
    name: 'get_system_summary',
    description: 'Get a high-level summary of the PlateStack system: dish count, menu count, task counts, ingredient count, and recent activity.',
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
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

/**
 * Check if a tool is auto-approved (no confirmation needed)
 */
function isAutoApproved(toolName) {
  const tool = TOOL_REGISTRY.find(t => t.name === toolName);
  return tool ? !!tool.autoApprove : false;
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

  lookup_dish(input, opts) {
    const db = getDb();
    let dish;

    if (input.dish_id) {
      dish = db.prepare('SELECT * FROM dishes WHERE id = ? AND deleted_at IS NULL').get(input.dish_id);
    } else if (input.dish_name) {
      dish = db.prepare("SELECT * FROM dishes WHERE name LIKE ? AND deleted_at IS NULL LIMIT 1").get(`%${input.dish_name}%`);
    }

    if (!dish) {
      return { success: true, message: 'Dish not found.' };
    }

    const ingredients = db.prepare(
      `SELECT di.quantity, di.unit, i.name, i.unit_cost, di.prep_note
       FROM dish_ingredients di JOIN ingredients i ON di.ingredient_id = i.id
       WHERE di.dish_id = ? ORDER BY di.sort_order`
    ).all(dish.id);

    const allergens = db.prepare('SELECT allergen, source FROM dish_allergens WHERE dish_id = ?').all(dish.id);

    const directions = db.prepare(
      'SELECT type, text FROM dish_directions WHERE dish_id = ? ORDER BY sort_order'
    ).all(dish.id);

    const parts = [`Dish: "${dish.name}" (ID: ${dish.id})`, `Category: ${dish.category || 'other'}`];
    if (dish.description) parts.push(`Description: ${dish.description}`);
    if (dish.suggested_price) parts.push(`Suggested price: ${dish.suggested_price}`);
    if (dish.batch_yield) parts.push(`Batch yield: ${dish.batch_yield} portions`);

    if (ingredients.length) {
      let totalCost = 0;
      parts.push(`Ingredients (${ingredients.length}):`);
      for (const ing of ingredients) {
        const qty = ing.quantity ? `${ing.quantity}${ing.unit ? ' ' + ing.unit : ''}` : '';
        const cost = ing.quantity && ing.unit_cost ? (ing.quantity * ing.unit_cost).toFixed(2) : '?';
        if (ing.quantity && ing.unit_cost) totalCost += ing.quantity * ing.unit_cost;
        parts.push(`  - ${qty} ${ing.name} (cost: ${cost})${ing.prep_note ? ' [' + ing.prep_note + ']' : ''}`);
      }
      parts.push(`Total ingredient cost: ${totalCost.toFixed(2)}`);
      if (dish.batch_yield > 0) parts.push(`Cost per portion: ${(totalCost / dish.batch_yield).toFixed(2)}`);
    }

    if (allergens.length) {
      parts.push('Allergens: ' + allergens.map(a => `${a.allergen} (${a.source})`).join(', '));
    }

    if (directions.length) {
      parts.push('Directions:');
      let step = 0;
      for (const dir of directions) {
        if (dir.type === 'section') parts.push(`  [${dir.text}]`);
        else { step++; parts.push(`  ${step}. ${dir.text}`); }
      }
    }

    const message = parts.join('\n');
    if (opts.preview) return { description: `Look up dish: "${dish.name}"`, message };
    return { success: true, message };
  },

  lookup_menu(input, opts) {
    const db = getDb();
    let menu;

    if (input.menu_id) {
      menu = db.prepare('SELECT * FROM menus WHERE id = ? AND deleted_at IS NULL').get(input.menu_id);
    } else if (input.menu_name) {
      menu = db.prepare("SELECT * FROM menus WHERE name LIKE ? AND deleted_at IS NULL LIMIT 1").get(`%${input.menu_name}%`);
    }

    if (!menu) {
      return { success: true, message: 'Menu not found.' };
    }

    const dishes = db.prepare(
      `SELECT d.id, d.name, d.category, d.suggested_price, d.batch_yield, md.servings
       FROM menu_dishes md JOIN dishes d ON md.dish_id = d.id
       WHERE md.menu_id = ? AND d.deleted_at IS NULL ORDER BY md.sort_order`
    ).all(menu.id);

    const parts = [`Menu: "${menu.name}" (ID: ${menu.id})`];
    if (menu.description) parts.push(`Description: ${menu.description}`);
    if (menu.sell_price) parts.push(`Sell price: ${menu.sell_price}`);
    if (menu.expected_covers) parts.push(`Expected covers: ${menu.expected_covers}`);
    if (menu.guest_allergies) parts.push(`Guest allergies: ${menu.guest_allergies}`);

    if (dishes.length) {
      parts.push(`Dishes (${dishes.length}):`);
      for (const d of dishes) {
        const portions = d.servings * (d.batch_yield || 1);
        parts.push(`  - ${d.name} (${d.category || 'other'}) — ${d.servings} batch(es), ${portions} portions${d.suggested_price ? ', price: ' + d.suggested_price : ''}`);
      }
    } else {
      parts.push('No dishes on this menu yet.');
    }

    const message = parts.join('\n');
    if (opts.preview) return { description: `Look up menu: "${menu.name}"`, message };
    return { success: true, message };
  },

  search_ingredients(input, opts) {
    const db = getDb();
    // Single query with LEFT JOIN to count dish usage — avoids N+1
    const ingredients = db.prepare(
      `SELECT i.id, i.name, i.unit_cost, i.base_unit, i.category, i.in_stock,
              COUNT(di.ingredient_id) as dish_count
       FROM ingredients i
       LEFT JOIN dish_ingredients di ON di.ingredient_id = i.id
       WHERE i.name LIKE ?
       GROUP BY i.id
       ORDER BY i.name LIMIT 20`
    ).all(`%${input.query}%`);

    if (!ingredients.length) {
      const message = `No ingredients found matching "${input.query}".`;
      if (opts.preview) return { description: `Search ingredients: "${input.query}"`, message };
      return { success: true, message };
    }

    const parts = [`Found ${ingredients.length} ingredient(s) matching "${input.query}":`];
    for (const ing of ingredients) {
      const stock = ing.in_stock ? ' [IN STOCK]' : '';
      parts.push(`  - "${ing.name}" (ID:${ing.id}) — cost: ${ing.unit_cost || '?'}/${ing.base_unit || '?'}, used in ${ing.dish_count} dish(es)${stock}`);
    }

    const message = parts.join('\n');
    if (opts.preview) return { description: `Search ingredients: "${input.query}"`, message };
    return { success: true, message };
  },

  search_tasks(input, opts) {
    const db = getDb();
    let sql = 'SELECT t.*, m.name as menu_name FROM tasks t LEFT JOIN menus m ON t.menu_id = m.id WHERE 1=1';
    const params = [];

    if (input.query) { sql += ' AND t.title LIKE ?'; params.push(`%${input.query}%`); }
    if (input.type) { sql += ' AND t.type = ?'; params.push(input.type); }
    if (input.completed !== undefined) { sql += ' AND t.completed = ?'; params.push(input.completed ? 1 : 0); }
    if (input.overdue) { sql += " AND t.due_date < date('now') AND t.completed = 0"; }

    sql += ' ORDER BY t.due_date, t.priority LIMIT 20';
    const tasks = db.prepare(sql).all(...params);

    if (!tasks.length) {
      const message = 'No matching tasks found.';
      if (opts.preview) return { description: 'Search tasks', message };
      return { success: true, message };
    }

    const parts = [`Found ${tasks.length} task(s):`];
    for (const t of tasks) {
      const status = t.completed ? '[DONE]' : (t.due_date && t.due_date < new Date().toISOString().slice(0, 10) ? '[OVERDUE]' : '');
      const menu = t.menu_name ? ` (menu: ${t.menu_name})` : '';
      parts.push(`  - ${status} "${t.title}" [${t.priority}] ${t.type}${menu}${t.due_date ? ' due ' + t.due_date : ''}${t.due_time ? ' at ' + t.due_time : ''}`);
    }

    const message = parts.join('\n');
    if (opts.preview) return { description: 'Search tasks', message };
    return { success: true, message };
  },

  search_service_notes(input, opts) {
    const db = getDb();
    let sql = 'SELECT * FROM service_notes WHERE 1=1';
    const params = [];

    if (input.date) { sql += ' AND date = ?'; params.push(input.date); }
    if (input.shift) { sql += ' AND shift = ?'; params.push(input.shift); }
    if (input.query) { sql += ' AND (title LIKE ? OR content LIKE ?)'; params.push(`%${input.query}%`, `%${input.query}%`); }

    sql += ' ORDER BY date DESC, created_at DESC LIMIT 15';
    const notes = db.prepare(sql).all(...params);

    if (!notes.length) {
      const message = 'No matching service notes found.';
      if (opts.preview) return { description: 'Search service notes', message };
      return { success: true, message };
    }

    const parts = [`Found ${notes.length} note(s):`];
    for (const n of notes) {
      const content = n.content.length > 80 ? n.content.slice(0, 80) + '...' : n.content;
      parts.push(`  - [${n.date} / ${n.shift}] "${n.title}": ${content}`);
    }

    const message = parts.join('\n');
    if (opts.preview) return { description: 'Search service notes', message };
    return { success: true, message };
  },

  get_shopping_list(input, opts) {
    const db = getDb();
    let menuId = input.menu_id;
    let menuName = input.menu_name;

    if (!menuId && menuName) {
      const menu = db.prepare("SELECT id, name FROM menus WHERE name LIKE ? AND deleted_at IS NULL LIMIT 1").get(`%${menuName}%`);
      if (menu) { menuId = menu.id; menuName = menu.name; }
    }
    if (menuId && !menuName) {
      const menu = db.prepare('SELECT name FROM menus WHERE id = ? AND deleted_at IS NULL').get(menuId);
      if (menu) menuName = menu.name;
    }

    if (!menuId) {
      return { success: true, message: 'Menu not found.' };
    }

    // Aggregate ingredients from all dishes on this menu
    const items = db.prepare(
      `SELECT i.name, i.unit_cost, i.base_unit, i.in_stock,
              SUM(di.quantity * md.servings) as total_qty, di.unit
       FROM menu_dishes md
       JOIN dish_ingredients di ON di.dish_id = md.dish_id
       JOIN ingredients i ON di.ingredient_id = i.id
       JOIN dishes d ON md.dish_id = d.id
       WHERE md.menu_id = ? AND d.deleted_at IS NULL
       GROUP BY i.id
       ORDER BY i.name`
    ).all(menuId);

    if (!items.length) {
      return { success: true, message: `Shopping list for "${menuName}" is empty (no dishes or no ingredients).` };
    }

    let totalCost = 0;
    const toBuy = items.filter(i => !i.in_stock);
    const inStock = items.filter(i => i.in_stock);

    const parts = [`Shopping list for "${menuName}" (${items.length} items):`];
    parts.push(`\nTo buy (${toBuy.length}):`);
    for (const item of toBuy) {
      const cost = item.total_qty && item.unit_cost ? (item.total_qty * item.unit_cost).toFixed(2) : '?';
      if (item.total_qty && item.unit_cost) totalCost += item.total_qty * item.unit_cost;
      parts.push(`  - ${item.total_qty || '?'} ${item.unit || ''} ${item.name} — est. cost: ${cost}`);
    }
    if (inStock.length) {
      parts.push(`\nAlready in stock (${inStock.length}):`);
      for (const item of inStock) {
        parts.push(`  - ${item.total_qty || '?'} ${item.unit || ''} ${item.name}`);
      }
    }
    parts.push(`\nEstimated total cost (to buy): ${totalCost.toFixed(2)}`);

    const message = parts.join('\n');
    if (opts.preview) return { description: `Shopping list for "${menuName}"`, message };
    return { success: true, message };
  },

  get_system_summary(input, opts) {
    const db = getDb();

    const dishCount = db.prepare('SELECT COUNT(*) as cnt FROM dishes WHERE deleted_at IS NULL').get().cnt;
    const menuCount = db.prepare('SELECT COUNT(*) as cnt FROM menus WHERE deleted_at IS NULL').get().cnt;
    const ingredientCount = db.prepare('SELECT COUNT(*) as cnt FROM ingredients').get().cnt;
    const taskTotal = db.prepare('SELECT COUNT(*) as cnt FROM tasks').get().cnt;
    const taskPending = db.prepare('SELECT COUNT(*) as cnt FROM tasks WHERE completed = 0').get().cnt;
    const taskOverdue = db.prepare("SELECT COUNT(*) as cnt FROM tasks WHERE completed = 0 AND due_date < date('now')").get().cnt;
    const noteCount = db.prepare('SELECT COUNT(*) as cnt FROM service_notes').get().cnt;
    const specialCount = db.prepare('SELECT COUNT(*) as cnt FROM weekly_specials WHERE is_active = 1').get().cnt;
    const inStockCount = db.prepare('SELECT COUNT(*) as cnt FROM ingredients WHERE in_stock = 1').get().cnt;

    // Recent activity
    const recentDishes = db.prepare(
      "SELECT name, created_at FROM dishes WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 5"
    ).all();

    const parts = [
      'PlateStack System Summary:',
      `  Dishes: ${dishCount}`,
      `  Menus: ${menuCount}`,
      `  Ingredients: ${ingredientCount} (${inStockCount} in stock)`,
      `  Tasks: ${taskTotal} total, ${taskPending} pending, ${taskOverdue} overdue`,
      `  Service notes: ${noteCount}`,
      `  Active specials: ${specialCount}`,
    ];

    if (recentDishes.length) {
      parts.push('\nRecently added dishes:');
      for (const d of recentDishes) {
        parts.push(`  - ${d.name} (${d.created_at || 'unknown'})`);
      }
    }

    const message = parts.join('\n');
    if (opts.preview) return { description: 'System summary', message };
    return { success: true, message };
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
  isAutoApproved,
};
