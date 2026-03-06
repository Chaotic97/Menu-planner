/**
 * AI Tools — tool registry for Claude Haiku function calling.
 * Each tool has a schema (for Haiku) and a handler (for execution).
 * Adding a new AI command = adding one entry to TOOL_REGISTRY.
 */

const { getDb } = require('../../db/database');
const { saveSnapshot } = require('./aiHistory');
const { getDishAllergens, getDishAllergensBatch } = require('../allergenDetector');

// ─── Tool Definitions (sent to Haiku) ────────────────────────────

const TOOL_REGISTRY = [
  // ─── Create Tools (need confirmation) ──────────────────────────
  {
    name: 'create_menu',
    description: 'Create a new menu in PlateStack. Use when the user wants to make a new menu. Menus can be "event" type (one-off with an optional date) or "standard" type (recurring house menu). Only one standard menu can exist at a time.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the menu' },
        description: { type: 'string', description: 'Optional description of the menu' },
        event_date: { type: 'string', description: 'Date for the menu in YYYY-MM-DD format (e.g. "2026-03-15"). Used for event menus to track when the event takes place.' },
        menu_type: { type: 'string', enum: ['event', 'standard'], description: 'Type of menu. "event" (default) for one-off events, "standard" for the recurring house menu. Only one standard menu can exist.' },
        service_style: { type: 'string', enum: ['coursed', 'alacarte'], description: 'Service style. "coursed" for multi-course meals, "alacarte" (default) for à la carte with custom sections.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_dish',
    description: 'Create a new dish in PlateStack. Use when the user wants to add a new dish/recipe. Only create actual food or drink items — never create non-food items like section headers, menu labels, prices, or descriptions as dishes.',
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
    name: 'create_ingredient',
    description: 'Create a new ingredient or update an existing one (upserts by name). Use when the user wants to add an ingredient to the system.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Ingredient name' },
        unit_cost: { type: 'number', description: 'Cost per base unit (e.g. price per kg)' },
        base_unit: { type: 'string', description: 'Base unit for costing (e.g. kg, L, each)' },
        category: { type: 'string', description: 'Category (e.g. produce, dairy, meat, dry goods)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_special',
    description: 'Create a weekly special. Links a dish to a specific week for the specials board.',
    input_schema: {
      type: 'object',
      properties: {
        dish_id: { type: 'number', description: 'ID of the dish' },
        dish_name: { type: 'string', description: 'Name of the dish (fuzzy matched if no ID)' },
        week_start: { type: 'string', description: 'Week start date (YYYY-MM-DD, should be a Monday)' },
        notes: { type: 'string', description: 'Optional notes about the special' },
      },
      required: [],
    },
  },
  {
    name: 'add_dish_to_menu',
    description: 'Add an existing dish to a menu. Requires knowing the dish and menu by name or ID. Can optionally assign to a course/section by name.',
    input_schema: {
      type: 'object',
      properties: {
        dish_id: { type: 'number', description: 'ID of the dish to add' },
        dish_name: { type: 'string', description: 'Name of the dish (used for fuzzy matching if no ID)' },
        menu_id: { type: 'number', description: 'ID of the menu to add the dish to' },
        menu_name: { type: 'string', description: 'Name of the menu (used for fuzzy matching if no ID)' },
        servings: { type: 'number', description: 'Number of servings/batches. Defaults to 1.' },
        course_name: { type: 'string', description: 'Name of the course/section to assign the dish to. Will match by name or create if not found.' },
      },
      required: [],
    },
  },

  // ─── Update Tools (need confirmation) ──────────────────────────
  {
    name: 'update_dish',
    description: 'Update an existing dish. Can change name, category, description, batch_yield, or suggested_price. Use when user wants to modify dish details.',
    input_schema: {
      type: 'object',
      properties: {
        dish_id: { type: 'number', description: 'ID of the dish to update' },
        dish_name: { type: 'string', description: 'Name of the dish (fuzzy matched if no ID)' },
        name: { type: 'string', description: 'New name for the dish' },
        category: { type: 'string', enum: ['starter', 'main', 'side', 'dessert', 'sauce', 'bread', 'mise en place', 'other'], description: 'New category' },
        description: { type: 'string', description: 'New description' },
        batch_yield: { type: 'number', description: 'New batch yield (portions per batch)' },
        suggested_price: { type: 'number', description: 'New suggested price' },
      },
      required: [],
    },
  },
  {
    name: 'update_menu',
    description: 'Update an existing menu. Can change name, description, sell_price, expected_covers, or guest_allergies.',
    input_schema: {
      type: 'object',
      properties: {
        menu_id: { type: 'number', description: 'ID of the menu to update' },
        menu_name: { type: 'string', description: 'Name of the menu (fuzzy matched if no ID)' },
        name: { type: 'string', description: 'New name for the menu' },
        description: { type: 'string', description: 'New description' },
        sell_price: { type: 'number', description: 'New sell price' },
        expected_covers: { type: 'number', description: 'New expected covers' },
        guest_allergies: { type: 'string', description: 'Comma-separated guest allergies (e.g. "gluten,nuts")' },
        event_date: { type: 'string', description: 'New event date (YYYY-MM-DD)' },
      },
      required: [],
    },
  },
  {
    name: 'update_task',
    description: 'Update an existing task. Can change title, description, priority, due_date, due_time, or mark complete/incomplete.',
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'number', description: 'ID of the task to update' },
        title: { type: 'string', description: 'New title' },
        description: { type: 'string', description: 'New description' },
        priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'New priority' },
        due_date: { type: 'string', description: 'New due date (YYYY-MM-DD)' },
        due_time: { type: 'string', description: 'New due time (HH:MM)' },
        completed: { type: 'boolean', description: 'Set completion status' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'update_ingredient',
    description: 'Update an existing ingredient. Can change unit_cost, base_unit, or category.',
    input_schema: {
      type: 'object',
      properties: {
        ingredient_id: { type: 'number', description: 'ID of the ingredient' },
        ingredient_name: { type: 'string', description: 'Name of the ingredient (fuzzy matched if no ID)' },
        unit_cost: { type: 'number', description: 'New cost per base unit' },
        base_unit: { type: 'string', description: 'New base unit' },
        category: { type: 'string', description: 'New category' },
      },
      required: [],
    },
  },
  {
    name: 'update_servings',
    description: 'Update the number of servings/batches for a dish on a menu.',
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {
        menu_id: { type: 'number', description: 'ID of the menu' },
        menu_name: { type: 'string', description: 'Menu name (fuzzy matched)' },
        dish_id: { type: 'number', description: 'ID of the dish' },
        dish_name: { type: 'string', description: 'Dish name (fuzzy matched)' },
        servings: { type: 'number', description: 'New number of servings/batches' },
      },
      required: ['servings'],
    },
  },
  {
    name: 'update_service_note',
    description: 'Update an existing service note. Can change title, content, shift, or date.',
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {
        note_id: { type: 'number', description: 'ID of the service note to update' },
        title: { type: 'string', description: 'New title' },
        content: { type: 'string', description: 'New content' },
        shift: { type: 'string', enum: ['all', 'am', 'lunch', 'pm', 'prep'], description: 'New shift' },
        date: { type: 'string', description: 'New date (YYYY-MM-DD)' },
      },
      required: ['note_id'],
    },
  },

  // ─── Delete Tools (need confirmation) ──────────────────────────
  {
    name: 'delete_dish',
    description: 'Delete a dish (soft delete — can be restored). Use when user wants to remove a dish.',
    input_schema: {
      type: 'object',
      properties: {
        dish_id: { type: 'number', description: 'ID of the dish to delete' },
        dish_name: { type: 'string', description: 'Name of the dish (fuzzy matched if no ID)' },
      },
      required: [],
    },
  },
  {
    name: 'delete_menu',
    description: 'Delete a menu (soft delete — can be restored). Use when user wants to remove a menu.',
    input_schema: {
      type: 'object',
      properties: {
        menu_id: { type: 'number', description: 'ID of the menu to delete' },
        menu_name: { type: 'string', description: 'Name of the menu (fuzzy matched if no ID)' },
      },
      required: [],
    },
  },
  {
    name: 'delete_task',
    description: 'Delete a task permanently.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'number', description: 'ID of the task to delete' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'delete_service_note',
    description: 'Delete a service note permanently.',
    input_schema: {
      type: 'object',
      properties: {
        note_id: { type: 'number', description: 'ID of the service note to delete' },
      },
      required: ['note_id'],
    },
  },
  {
    name: 'remove_dish_from_menu',
    description: 'Remove a dish from a menu.',
    input_schema: {
      type: 'object',
      properties: {
        menu_id: { type: 'number', description: 'ID of the menu' },
        menu_name: { type: 'string', description: 'Menu name (fuzzy matched)' },
        dish_id: { type: 'number', description: 'ID of the dish to remove' },
        dish_name: { type: 'string', description: 'Dish name (fuzzy matched)' },
      },
      required: [],
    },
  },

  {
    name: 'add_course_to_menu',
    description: 'Add a course or section to a menu. Menus support coursed (multi-course meal) and à la carte (custom sections) modes.',
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {
        menu_id: { type: 'number', description: 'ID of the menu' },
        menu_name: { type: 'string', description: 'Menu name (fuzzy matched)' },
        name: { type: 'string', description: 'Name of the course/section (e.g. "Starter", "Small Plates")' },
        notes: { type: 'string', description: 'Optional notes for this course (e.g. timing, service instructions)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'move_dish_to_course',
    description: 'Move a dish to a different course/section within a menu.',
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {
        menu_id: { type: 'number', description: 'ID of the menu' },
        menu_name: { type: 'string', description: 'Menu name (fuzzy matched)' },
        dish_id: { type: 'number', description: 'ID of the dish to move' },
        dish_name: { type: 'string', description: 'Dish name (fuzzy matched)' },
        course_name: { type: 'string', description: 'Name of the target course/section' },
      },
      required: ['course_name'],
    },
  },

  // ─── Quick Action Tools (auto-approved) ────────────────────────
  {
    name: 'toggle_favorite',
    description: 'Toggle a dish as favorite/unfavorite.',
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
    name: 'toggle_ingredient_stock',
    description: 'Toggle an ingredient in-stock / out-of-stock status.',
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {
        ingredient_id: { type: 'number', description: 'ID of the ingredient' },
        ingredient_name: { type: 'string', description: 'Name of the ingredient (fuzzy matched if no ID)' },
        in_stock: { type: 'boolean', description: 'Set to true for in-stock, false for out-of-stock. If omitted, toggles current state.' },
      },
      required: [],
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a task as complete or incomplete. Shortcut for quickly completing tasks.',
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'number', description: 'ID of the task' },
        completed: { type: 'boolean', description: 'true to complete, false to uncomplete. Defaults to true.' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'batch_complete_tasks',
    description: 'Mark multiple tasks as complete or incomplete at once.',
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {
        task_ids: { type: 'array', items: { type: 'number' }, description: 'Array of task IDs to complete/uncomplete' },
        completed: { type: 'boolean', description: 'true to complete, false to uncomplete. Defaults to true.' },
      },
      required: ['task_ids'],
    },
  },
  {
    name: 'duplicate_dish',
    description: 'Duplicate a dish with all its ingredients, directions, allergens, and tags. Creates a copy with "(Copy)" appended to the name.',
    input_schema: {
      type: 'object',
      properties: {
        dish_id: { type: 'number', description: 'ID of the dish to duplicate' },
        dish_name: { type: 'string', description: 'Name of the dish (fuzzy matched if no ID)' },
      },
      required: [],
    },
  },

  // ─── Allergen Tools ────────────────────────────────────────────
  {
    name: 'add_allergen',
    description: 'Add a manual allergen flag to a dish. Use when a user says a dish contains an allergen that auto-detection missed.',
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {
        dish_id: { type: 'number', description: 'ID of the dish' },
        dish_name: { type: 'string', description: 'Name of the dish (fuzzy matched if no ID)' },
        allergen: { type: 'string', enum: ['celery', 'gluten', 'crustaceans', 'eggs', 'fish', 'lupin', 'milk', 'molluscs', 'mustard', 'nuts', 'peanuts', 'sesame', 'soy', 'sulphites'], description: 'The allergen to add' },
      },
      required: ['allergen'],
    },
  },
  {
    name: 'remove_allergen',
    description: 'Remove an allergen flag from a dish.',
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {
        dish_id: { type: 'number', description: 'ID of the dish' },
        dish_name: { type: 'string', description: 'Name of the dish (fuzzy matched if no ID)' },
        allergen: { type: 'string', enum: ['celery', 'gluten', 'crustaceans', 'eggs', 'fish', 'lupin', 'milk', 'molluscs', 'mustard', 'nuts', 'peanuts', 'sesame', 'soy', 'sulphites'], description: 'The allergen to remove' },
      },
      required: ['allergen'],
    },
  },

  // ─── Data Generation Tools ─────────────────────────────────────
  {
    name: 'generate_prep_tasks',
    description: 'Generate prep tasks for a menu. Creates practical prep tasks from all dishes on the menu. Replaces existing auto-generated tasks but preserves manually edited ones.',
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

  // ─── Additional Data Access Tools (auto-approved) ──────────────
  {
    name: 'list_menus',
    description: 'List all menus in the system. Useful when user asks "what menus do I have?" or needs to pick a menu.',
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'list_dishes',
    description: 'List dishes, optionally filtered by category or favorites. Use when user asks "show me all starters" or "what dishes do I have?".',
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['starter', 'main', 'side', 'dessert', 'sauce', 'bread', 'mise en place', 'other'], description: 'Filter by category' },
        favorite: { type: 'boolean', description: 'Only show favorites' },
        tag: { type: 'string', description: 'Filter by tag name' },
      },
      required: [],
    },
  },
  {
    name: 'lookup_ingredient',
    description: 'Get full details of a specific ingredient including cost, stock status, and which dishes use it.',
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {
        ingredient_id: { type: 'number', description: 'ID of the ingredient' },
        ingredient_name: { type: 'string', description: 'Name of the ingredient (fuzzy matched if no ID)' },
      },
      required: [],
    },
  },
  {
    name: 'list_specials',
    description: 'List weekly specials, optionally for a specific week.',
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {
        week_start: { type: 'string', description: 'Week start date (YYYY-MM-DD). If omitted, shows current week.' },
      },
      required: [],
    },
  },
  {
    name: 'list_tags',
    description: 'List all tags used across dishes.',
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_menu_cost_analysis',
    description: 'Analyze food costs for a menu. Shows each dish cost, food cost percentages, and highlights dishes over the 35% threshold. Use when user asks about profitability, costs, or pricing.',
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
    name: 'get_dish_allergens',
    description: 'Get all allergens for a specific dish. Shows both auto-detected and manually added allergens.',
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
    name: 'get_menu_allergens',
    description: 'Get a complete allergen breakdown for an entire menu — shows which dishes contain which allergens. Critical for guest allergy management.',
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

  // ─── Advisory Tools (text-only, auto-approved) ─────────────────
  {
    name: 'suggest_dish_pairings',
    description: 'Suggest dish pairings and menu composition ideas. Provides culinary advice based on flavour profiles, textures, and balance.',
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {
        dish_id: { type: 'number', description: 'ID of a dish to pair with' },
        dish_name: { type: 'string', description: 'Name of a dish to pair with (fuzzy matched if no ID)' },
        context: { type: 'string', description: 'Additional context like cuisine, event type, dietary requirements' },
      },
      required: [],
    },
  },
  {
    name: 'dietary_analysis',
    description: 'Analyze a menu for dietary suitability. Checks if a menu works for specific diets (vegan, vegetarian, gluten-free, etc.) and suggests modifications.',
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {
        menu_id: { type: 'number', description: 'ID of the menu to analyze' },
        menu_name: { type: 'string', description: 'Name of the menu (fuzzy matched if no ID)' },
        diet: { type: 'string', description: 'Diet to check for (e.g. "vegan", "vegetarian", "gluten-free", "dairy-free", "keto")' },
      },
      required: [],
    },
  },
  {
    name: 'suggest_substitution',
    description: 'Suggest ingredient substitutions for allergens, dietary requirements, or cost savings. Provides professional alternatives with quantity adjustments.',
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {
        ingredient_name: { type: 'string', description: 'The ingredient to find a substitute for' },
        reason: { type: 'string', description: 'Why a substitution is needed (e.g. "allergen:nuts", "vegan", "cheaper", "unavailable")' },
        dish_context: { type: 'string', description: 'What dish the ingredient is used in, for context-appropriate suggestions' },
      },
      required: ['ingredient_name'],
    },
  },
  {
    name: 'suggest_price',
    description: 'Suggest a sell price for a dish based on its food cost and target food cost percentage. Provides pricing analysis and recommendations.',
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {
        dish_id: { type: 'number', description: 'ID of the dish to price' },
        dish_name: { type: 'string', description: 'Name of the dish (fuzzy matched if no ID)' },
        target_food_cost_percent: { type: 'number', description: 'Target food cost percentage (default 30)' },
      },
      required: [],
    },
  },

  // ─── Recipe Building Tools ─────────────────────────────────────
  {
    name: 'add_ingredient_to_dish',
    description: 'Add an ingredient to a dish recipe. Creates the ingredient in the system if it doesn\'t exist. Use when the user says "add 500g flour to the focaccia".',
    input_schema: {
      type: 'object',
      properties: {
        dish_id: { type: 'number', description: 'ID of the dish' },
        dish_name: { type: 'string', description: 'Name of the dish (fuzzy matched if no ID)' },
        ingredient_name: { type: 'string', description: 'Name of the ingredient to add' },
        quantity: { type: 'number', description: 'Quantity of the ingredient' },
        unit: { type: 'string', description: 'Unit of measurement (e.g. g, kg, ml, L, each, bunch)' },
        prep_note: { type: 'string', description: 'Prep instructions (e.g. "diced", "julienned", "room temperature")' },
      },
      required: ['ingredient_name'],
    },
  },
  {
    name: 'remove_ingredient_from_dish',
    description: 'Remove an ingredient from a dish recipe. Use when the user says "remove the cream from the soup" or "take out the butter".',
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {
        dish_id: { type: 'number', description: 'ID of the dish' },
        dish_name: { type: 'string', description: 'Name of the dish (fuzzy matched if no ID)' },
        ingredient_name: { type: 'string', description: 'Name of the ingredient to remove' },
        ingredient_id: { type: 'number', description: 'ID of the ingredient to remove (if known)' },
      },
      required: ['ingredient_name'],
    },
  },
  {
    name: 'add_direction_to_dish',
    description: 'Add a direction step or section header to a dish recipe. Appends at the end by default. Use when the user says "add a step: rest the dough for 30 minutes".',
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {
        dish_id: { type: 'number', description: 'ID of the dish' },
        dish_name: { type: 'string', description: 'Name of the dish (fuzzy matched if no ID)' },
        text: { type: 'string', description: 'The direction step text or section header title' },
        type: { type: 'string', enum: ['step', 'section'], description: 'Whether this is a step or a section header. Defaults to step.' },
        position: { type: 'number', description: 'Position to insert at (0-indexed). If omitted, appends at end.' },
      },
      required: ['text'],
    },
  },
  {
    name: 'add_tag',
    description: 'Add a tag to a dish. Creates the tag if it doesn\'t exist. Use when the user says "tag this as summer menu" or "add the brunch tag".',
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {
        dish_id: { type: 'number', description: 'ID of the dish' },
        dish_name: { type: 'string', description: 'Name of the dish (fuzzy matched if no ID)' },
        tag: { type: 'string', description: 'Tag name to add' },
      },
      required: ['tag'],
    },
  },
  {
    name: 'remove_tag',
    description: 'Remove a tag from a dish.',
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {
        dish_id: { type: 'number', description: 'ID of the dish' },
        dish_name: { type: 'string', description: 'Name of the dish (fuzzy matched if no ID)' },
        tag: { type: 'string', description: 'Tag name to remove' },
      },
      required: ['tag'],
    },
  },

  // ─── Database Query Tool ───────────────────────────────────────
  {
    name: 'query_database',
    description: `Run a read-only SQL query against the PlateStack database. Use this for analytical questions, aggregations, or any data question that other tools can't answer directly. Only SELECT statements are allowed — no mutations.

Available tables and key columns:
- dishes: id, name, description, category, chefs_notes, suggested_price, is_favorite, batch_yield, deleted_at, created_at, updated_at
- ingredients: id, name, unit_cost, base_unit, category, in_stock
- dish_ingredients: dish_id, ingredient_id, quantity, unit, prep_note, sort_order (UNIQUE dish_id+ingredient_id)
- dish_section_headers: id, dish_id, label, sort_order
- ingredient_allergens: ingredient_id, allergen, source ('auto'/'manual') — allergens are tracked per ingredient
- dish_allergens: dish_id, allergen, source ('manual') — dish-level manual overrides only
- dish_directions: id, dish_id, type ('step'/'section'), text, sort_order
- dish_substitutions: dish_id, allergen, original_ingredient, substitute_ingredient, notes
- dish_tags: dish_id, tag_id
- tags: id, name
- menus: id, name, description, is_active, sell_price, expected_covers, guest_allergies, menu_type, event_date, deleted_at, created_at
- menu_dishes: menu_id, dish_id, sort_order, servings
- weekly_specials: id, dish_id, week_start, week_end, notes, is_active
- tasks: id, menu_id, source_dish_id, type ('prep'/'custom'), title, description, priority ('high'/'medium'/'low'), due_date, due_time, completed, completed_at, source ('auto'/'manual'), created_at
- service_notes: id, date, shift ('all'/'am'/'lunch'/'pm'/'prep'), title, content, created_at
- allergen_keywords: keyword, allergen
- ai_usage: id, tokens_in, tokens_out, model, tool_used, created_at

IMPORTANT: Always filter dishes/menus with "deleted_at IS NULL" unless specifically looking for deleted items.`,
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'The SELECT query to run. Must be a read-only SELECT statement.' },
        explanation: { type: 'string', description: 'Brief explanation of what this query answers (for the user)' },
      },
      required: ['sql'],
    },
  },

  // ─── Ingredient Management Tools ──────────────────────────────
  {
    name: 'find_duplicate_ingredients',
    description: 'Find potential duplicate ingredients in the database. Returns groups of ingredients that look like the same thing (e.g. "Olive Oil" and "olive oil, extra virgin"). Use when the user wants to clean up or audit their ingredient list.',
    autoApprove: true,
    input_schema: {
      type: 'object',
      properties: {
        threshold: { type: 'string', enum: ['strict', 'moderate', 'loose'], description: 'How aggressively to match. "strict" = near-identical names, "moderate" = likely same ingredient, "loose" = possibly related. Default: moderate.' },
      },
      required: [],
    },
  },
  {
    name: 'merge_ingredients',
    description: 'Merge two ingredients into one. All dish recipes using the source ingredient will be updated to use the target ingredient instead. The source ingredient is then deleted. Use when the user wants to consolidate duplicate ingredients.',
    input_schema: {
      type: 'object',
      properties: {
        source_id: { type: 'number', description: 'ID of the ingredient to merge FROM (will be deleted)' },
        source_name: { type: 'string', description: 'Name of the source ingredient (fuzzy matched if no ID)' },
        target_id: { type: 'number', description: 'ID of the ingredient to merge INTO (will be kept)' },
        target_name: { type: 'string', description: 'Name of the target ingredient (fuzzy matched if no ID)' },
      },
      required: [],
    },
  },
  {
    name: 'delete_ingredient',
    description: 'Delete an ingredient from the system. Only works if the ingredient is not used in any dish recipe. Use merge_ingredients instead if the ingredient is in use.',
    input_schema: {
      type: 'object',
      properties: {
        ingredient_id: { type: 'number', description: 'ID of the ingredient to delete' },
        ingredient_name: { type: 'string', description: 'Name of the ingredient (fuzzy matched if no ID)' },
      },
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
    const menuType = input.menu_type || 'event';
    const eventDate = menuType === 'event' ? (input.event_date || null) : null;

    // Validate event_date format if provided
    if (eventDate && !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
      return {
        description: 'Invalid date format',
        message: 'The date must be in YYYY-MM-DD format (e.g. "2026-03-15").',
      };
    }

    if (opts.preview) {
      let desc = `Create ${menuType} menu: "${input.name}"`;
      if (eventDate) desc += ` on ${eventDate}`;
      if (input.description) desc += ` — ${input.description}`;
      let msg = `I'll create a new ${menuType} menu called "${input.name}"`;
      if (eventDate) msg += ` scheduled for ${eventDate}`;
      msg += '.';
      return { description: desc, message: msg };
    }

    const db = getDb();

    // If creating a standard menu, demote any existing standard menu to event
    if (menuType === 'standard') {
      db.prepare("UPDATE menus SET menu_type = 'event' WHERE menu_type = 'standard' AND deleted_at IS NULL").run();
    }

    const serviceStyle = input.service_style || 'alacarte';
    const result = db.prepare(
      'INSERT INTO menus (name, description, menu_type, event_date, service_style) VALUES (?, ?, ?, ?, ?)'
    ).run(input.name, input.description || '', menuType, eventDate, serviceStyle);
    const id = result.lastInsertRowid;
    const undoId = saveSnapshot('menu', id, 'create', null);

    if (opts.broadcast) opts.broadcast('menu_created', { id });

    return {
      success: true,
      message: `Menu "${input.name}" created${eventDate ? ` for ${eventDate}` : ''}.`,
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

    // Resolve course by name if provided
    let courseId = null;
    let courseName = input.course_name;
    if (courseName) {
      const course = db.prepare(
        "SELECT id, name FROM menu_courses WHERE menu_id = ? AND name LIKE ? LIMIT 1"
      ).get(menuId, `%${courseName}%`);
      if (course) {
        courseId = course.id;
        courseName = course.name;
      }
    }

    if (opts.preview) {
      let desc = `Add "${dishName}" to menu "${menuName}" (${servings} serving${servings !== 1 ? 's' : ''})`;
      if (courseName) desc += ` in "${courseName}"`;
      return {
        description: desc,
        message: `I'll add "${dishName}" to "${menuName}"${courseName ? ` under "${courseName}"` : ''}.`,
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

    // Create course if named but not found
    if (input.course_name && !courseId) {
      const maxCourseOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM menu_courses WHERE menu_id = ?').get(menuId);
      const result = db.prepare('INSERT INTO menu_courses (menu_id, name, sort_order) VALUES (?, ?, ?)').run(
        menuId, input.course_name, maxCourseOrder.next
      );
      courseId = result.lastInsertRowid;
      courseName = input.course_name;
    }

    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM menu_dishes WHERE menu_id = ?').get(menuId);
    db.prepare('INSERT INTO menu_dishes (menu_id, dish_id, servings, sort_order, course_id) VALUES (?, ?, ?, ?, ?)').run(
      menuId, dishId, servings, maxOrder.next, courseId
    );

    if (opts.broadcast) opts.broadcast('menu_updated', { id: menuId });

    return {
      success: true,
      message: `Added "${dishName}" to "${menuName}"${courseName ? ` in "${courseName}"` : ''}.`,
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

    const currentAllergens = getDishAllergens(dishId);

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

    const allergens = getDishAllergens(dish.id);

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
      parts.push('Allergens: ' + allergens.map(a => `${a.allergen} (${a.source})${a.ingredient_name ? ' [from: ' + a.ingredient_name + ']' : ''}`).join(', '));
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
      `SELECT d.id, d.name, d.category, d.suggested_price, d.batch_yield, md.servings, md.course_id, md.notes AS menu_dish_notes
       FROM menu_dishes md JOIN dishes d ON md.dish_id = d.id
       WHERE md.menu_id = ? AND d.deleted_at IS NULL ORDER BY md.sort_order`
    ).all(menu.id);

    const courses = db.prepare('SELECT * FROM menu_courses WHERE menu_id = ? ORDER BY sort_order').all(menu.id);

    const parts = [`Menu: "${menu.name}" (ID: ${menu.id})`];
    if (menu.menu_type) parts.push(`Type: ${menu.menu_type}`);
    if (menu.service_style) parts.push(`Style: ${menu.service_style}`);
    if (menu.event_date) parts.push(`Event date: ${menu.event_date}`);
    if (menu.description) parts.push(`Description: ${menu.description}`);
    if (menu.sell_price) parts.push(`Sell price: ${menu.sell_price}`);
    if (menu.expected_covers) parts.push(`Expected covers: ${menu.expected_covers}`);
    if (menu.guest_allergies) parts.push(`Guest allergies: ${menu.guest_allergies}`);

    if (courses.length) {
      parts.push(`Courses/Sections (${courses.length}):`);
      for (const c of courses) {
        const courseDishes = dishes.filter(d => d.course_id === c.id);
        parts.push(`  [${c.name}] (${courseDishes.length} dishes)${c.notes ? ' — ' + c.notes : ''}`);
        for (const d of courseDishes) {
          const portions = d.servings * (d.batch_yield || 1);
          parts.push(`    - ${d.name} (${d.category || 'other'}) — ${d.servings} batch(es), ${portions} portions`);
        }
      }
    }

    const unassigned = dishes.filter(d => !d.course_id);
    if (unassigned.length) {
      parts.push(`${courses.length ? 'Unassigned d' : 'D'}ishes (${unassigned.length}):`);
      for (const d of unassigned) {
        const portions = d.servings * (d.batch_yield || 1);
        parts.push(`  - ${d.name} (${d.category || 'other'}) — ${d.servings} batch(es), ${portions} portions${d.suggested_price ? ', price: ' + d.suggested_price : ''}`);
      }
    } else if (!courses.length) {
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

    // Upcoming events with dates
    const upcomingEvents = db.prepare(
      "SELECT name, event_date FROM menus WHERE deleted_at IS NULL AND event_date IS NOT NULL AND event_date >= date('now') ORDER BY event_date ASC LIMIT 5"
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

    if (upcomingEvents.length) {
      parts.push('\nUpcoming events:');
      for (const e of upcomingEvents) {
        parts.push(`  - ${e.name} (${e.event_date})`);
      }
    }

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

  // ─── New Data Access Handlers ───────────────────────────────────

  list_menus(_input, opts) {
    const db = getDb();
    const menus = db.prepare(
      `SELECT m.*, COUNT(md.dish_id) as dish_count
       FROM menus m
       LEFT JOIN menu_dishes md ON md.menu_id = m.id
       LEFT JOIN dishes d ON md.dish_id = d.id AND d.deleted_at IS NULL
       WHERE m.deleted_at IS NULL
       GROUP BY m.id
       ORDER BY CASE WHEN m.menu_type = 'standard' THEN 0 ELSE 1 END, m.event_date DESC, m.created_at DESC`
    ).all();

    if (!menus.length) {
      const message = 'No menus in the system yet.';
      if (opts.preview) return { description: 'List menus', message };
      return { success: true, message };
    }

    const parts = [`${menus.length} menu(s):`];
    for (const m of menus) {
      let label = `- "${m.name}" (ID:${m.id})`;
      if (m.menu_type === 'standard') label += ' [HOUSE MENU]';
      if (m.event_date) label += ` — date: ${m.event_date}`;
      label += ` — ${m.dish_count} dish(es)`;
      if (m.sell_price) label += `, sell: ${m.sell_price}`;
      parts.push(label);
    }

    const message = parts.join('\n');
    if (opts.preview) return { description: 'List menus', message };
    return { success: true, message };
  },

  list_dishes(input, opts) {
    const db = getDb();
    let sql = `SELECT d.id, d.name, d.category, d.is_favorite, d.suggested_price, d.batch_yield,
                      COUNT(di.ingredient_id) as ingredient_count
               FROM dishes d
               LEFT JOIN dish_ingredients di ON di.dish_id = d.id
               WHERE d.deleted_at IS NULL`;
    const params = [];

    if (input.category) { sql += ' AND d.category = ?'; params.push(input.category); }
    if (input.favorite) { sql += ' AND d.is_favorite = 1'; }
    if (input.tag) {
      sql += ' AND d.id IN (SELECT dt.dish_id FROM dish_tags dt JOIN tags t ON dt.tag_id = t.id WHERE t.name LIKE ?)';
      params.push(`%${input.tag}%`);
    }

    sql += ' GROUP BY d.id ORDER BY d.name LIMIT 50';
    const dishes = db.prepare(sql).all(...params);

    if (!dishes.length) {
      const message = 'No dishes found matching those criteria.';
      if (opts.preview) return { description: 'List dishes', message };
      return { success: true, message };
    }

    const parts = [`${dishes.length} dish(es):`];
    for (const d of dishes) {
      let label = `- "${d.name}" (ID:${d.id}, ${d.category || 'other'})`;
      if (d.is_favorite) label += ' [FAV]';
      if (d.suggested_price) label += ` — price: ${d.suggested_price}`;
      label += ` — ${d.ingredient_count} ingredients`;
      parts.push(label);
    }

    const message = parts.join('\n');
    if (opts.preview) return { description: 'List dishes', message };
    return { success: true, message };
  },

  lookup_ingredient(input, opts) {
    const db = getDb();
    let ingredient;

    if (input.ingredient_id) {
      ingredient = db.prepare('SELECT * FROM ingredients WHERE id = ?').get(input.ingredient_id);
    } else if (input.ingredient_name) {
      ingredient = db.prepare("SELECT * FROM ingredients WHERE name LIKE ? LIMIT 1").get(`%${input.ingredient_name}%`);
    }

    if (!ingredient) {
      const message = 'Ingredient not found.';
      if (opts.preview) return { description: 'Lookup ingredient', message };
      return { success: true, message };
    }

    // Find which dishes use this ingredient
    const dishUsage = db.prepare(
      `SELECT d.id, d.name, di.quantity, di.unit
       FROM dish_ingredients di
       JOIN dishes d ON di.dish_id = d.id
       WHERE di.ingredient_id = ? AND d.deleted_at IS NULL
       ORDER BY d.name`
    ).all(ingredient.id);

    const parts = [
      `Ingredient: "${ingredient.name}" (ID: ${ingredient.id})`,
      `Unit cost: ${ingredient.unit_cost || 'not set'} per ${ingredient.base_unit || '?'}`,
      `Category: ${ingredient.category || 'uncategorized'}`,
      `In stock: ${ingredient.in_stock ? 'Yes' : 'No'}`,
    ];

    if (dishUsage.length) {
      parts.push(`\nUsed in ${dishUsage.length} dish(es):`);
      for (const d of dishUsage) {
        parts.push(`  - ${d.name} (${d.quantity || '?'} ${d.unit || ''})`);
      }
    } else {
      parts.push('\nNot used in any dishes.');
    }

    const message = parts.join('\n');
    if (opts.preview) return { description: `Lookup ingredient: "${ingredient.name}"`, message };
    return { success: true, message };
  },

  list_specials(input, opts) {
    const db = getDb();
    let sql = `SELECT ws.*, d.name as dish_name, d.category, d.description as dish_description
               FROM weekly_specials ws
               JOIN dishes d ON ws.dish_id = d.id
               WHERE d.deleted_at IS NULL`;
    const params = [];

    if (input.week_start) {
      sql += ' AND ws.week_start = ?';
      params.push(input.week_start);
    }

    sql += ' ORDER BY ws.week_start DESC, d.name LIMIT 20';
    const specials = db.prepare(sql).all(...params);

    if (!specials.length) {
      const message = input.week_start
        ? `No specials found for week of ${input.week_start}.`
        : 'No weekly specials found.';
      if (opts.preview) return { description: 'List specials', message };
      return { success: true, message };
    }

    const parts = [`${specials.length} special(s):`];
    for (const s of specials) {
      let label = `- "${s.dish_name}" (ID:${s.id}) — week: ${s.week_start} to ${s.week_end}`;
      if (s.is_active) label += ' [ACTIVE]';
      if (s.notes) label += ` — ${s.notes}`;
      parts.push(label);
    }

    const message = parts.join('\n');
    if (opts.preview) return { description: 'List specials', message };
    return { success: true, message };
  },

  list_tags(_input, opts) {
    const db = getDb();
    const tags = db.prepare(
      `SELECT t.id, t.name, COUNT(dt.dish_id) as dish_count
       FROM tags t
       LEFT JOIN dish_tags dt ON dt.tag_id = t.id
       GROUP BY t.id
       ORDER BY t.name`
    ).all();

    if (!tags.length) {
      const message = 'No tags exist yet.';
      if (opts.preview) return { description: 'List tags', message };
      return { success: true, message };
    }

    const parts = [`${tags.length} tag(s):`];
    for (const t of tags) {
      parts.push(`- "${t.name}" — used on ${t.dish_count} dish(es)`);
    }

    const message = parts.join('\n');
    if (opts.preview) return { description: 'List tags', message };
    return { success: true, message };
  },

  get_menu_cost_analysis(input, opts) {
    const db = getDb();
    const resolved = resolveMenu(db, input);
    if (!resolved) return { success: true, message: 'Menu not found.' };
    const { menuId, menuName } = resolved;

    const menu = db.prepare('SELECT sell_price, expected_covers FROM menus WHERE id = ?').get(menuId);
    const dishes = db.prepare(
      `SELECT d.id, d.name, d.category, d.suggested_price, d.batch_yield, md.servings
       FROM menu_dishes md JOIN dishes d ON md.dish_id = d.id
       WHERE md.menu_id = ? AND d.deleted_at IS NULL ORDER BY md.sort_order`
    ).all(menuId);

    if (!dishes.length) {
      return { success: true, message: `Menu "${menuName}" has no dishes to analyze.` };
    }

    let totalFoodCost = 0;
    const parts = [`Food Cost Analysis for "${menuName}":`];
    if (menu.sell_price) parts.push(`Menu sell price: ${menu.sell_price}`);
    if (menu.expected_covers) parts.push(`Expected covers: ${menu.expected_covers}`);
    parts.push('');

    for (const d of dishes) {
      const ingredients = db.prepare(
        `SELECT di.quantity, i.unit_cost
         FROM dish_ingredients di JOIN ingredients i ON di.ingredient_id = i.id
         WHERE di.dish_id = ?`
      ).all(d.id);

      let dishCost = 0;
      for (const ing of ingredients) {
        if (ing.quantity && ing.unit_cost) dishCost += ing.quantity * ing.unit_cost;
      }
      const portionCost = d.batch_yield > 0 ? dishCost / d.batch_yield : dishCost;
      const totalPortions = d.servings * (d.batch_yield || 1);
      const lineCost = portionCost * totalPortions;
      totalFoodCost += lineCost;

      let status = '';
      if (d.suggested_price && portionCost > 0) {
        const pct = (portionCost / d.suggested_price) * 100;
        if (pct > 35) status = ' [HIGH COST]';
        else if (pct > 30) status = ' [WATCH]';
        else status = ' [OK]';
        parts.push(`- ${d.name}: cost/portion ${portionCost.toFixed(2)}, price ${d.suggested_price}, food cost ${pct.toFixed(1)}%${status}`);
      } else {
        parts.push(`- ${d.name}: cost/portion ${portionCost.toFixed(2)}, ${totalPortions} portions, line total ${lineCost.toFixed(2)}`);
      }
    }

    parts.push(`\nTotal menu food cost: ${totalFoodCost.toFixed(2)}`);
    if (menu.sell_price && totalFoodCost > 0) {
      const menuPct = (totalFoodCost / (menu.sell_price * (menu.expected_covers || 1))) * 100;
      parts.push(`Overall food cost %: ${menuPct.toFixed(1)}%`);
    }

    const message = parts.join('\n');
    if (opts.preview) return { description: `Cost analysis: "${menuName}"`, message };
    return { success: true, message };
  },

  get_dish_allergens(input, opts) {
    const resolved = resolveDish(getDb(), input);
    if (!resolved) return { success: true, message: 'Dish not found.' };
    const { dishId, dishName } = resolved;

    const allergens = getDishAllergens(dishId);

    if (!allergens.length) {
      const message = `"${dishName}" has no allergens flagged.`;
      if (opts.preview) return { description: `Allergens: "${dishName}"`, message };
      return { success: true, message };
    }

    const fromIngredients = allergens.filter(a => a.ingredient_name);
    const manualDish = allergens.filter(a => !a.ingredient_name && a.source === 'manual');
    const parts = [`Allergens for "${dishName}":`];
    if (fromIngredients.length) {
      parts.push(`From ingredients: ${fromIngredients.map(a => `${a.allergen} (${a.ingredient_name})`).join(', ')}`);
    }
    if (manualDish.length) {
      parts.push(`Manually added (dish-level): ${manualDish.map(a => a.allergen).join(', ')}`);
    }

    const message = parts.join('\n');
    if (opts.preview) return { description: `Allergens: "${dishName}"`, message };
    return { success: true, message };
  },

  get_menu_allergens(input, opts) {
    const db = getDb();
    const resolved = resolveMenu(db, input);
    if (!resolved) return { success: true, message: 'Menu not found.' };
    const { menuId, menuName } = resolved;

    const dishes = db.prepare(
      `SELECT d.id, d.name FROM menu_dishes md
       JOIN dishes d ON md.dish_id = d.id
       WHERE md.menu_id = ? AND d.deleted_at IS NULL ORDER BY md.sort_order`
    ).all(menuId);

    if (!dishes.length) {
      return { success: true, message: `Menu "${menuName}" has no dishes.` };
    }

    const dishIds = dishes.map(d => d.id);
    const dishNameMap = {};
    for (const d of dishes) dishNameMap[d.id] = d.name;

    const batchAllergens = getDishAllergensBatch(dishIds);

    const allergenMap = {};
    for (const d of dishes) {
      const allergens = batchAllergens[d.id] || [];
      for (const a of allergens) {
        if (!allergenMap[a.allergen]) allergenMap[a.allergen] = [];
        allergenMap[a.allergen].push(d.name);
      }
    }

    const parts = [`Allergen breakdown for menu "${menuName}":`];
    const allergenNames = Object.keys(allergenMap).sort();
    if (allergenNames.length) {
      for (const allergen of allergenNames) {
        parts.push(`- ${allergen}: ${allergenMap[allergen].join(', ')}`);
      }
      parts.push(`\nAllergen-free dishes: ${dishes.filter(d => {
        return !(batchAllergens[d.id] && batchAllergens[d.id].length);
      }).map(d => d.name).join(', ') || 'none'}`);
    } else {
      parts.push('No allergens detected on any dish.');
    }

    const message = parts.join('\n');
    if (opts.preview) return { description: `Menu allergens: "${menuName}"`, message };
    return { success: true, message };
  },

  // ─── New Mutation Handlers ──────────────────────────────────────

  create_ingredient(input, opts) {
    if (opts.preview) {
      return {
        description: `Create ingredient: "${input.name}"`,
        message: `I'll add "${input.name}" to the ingredient library.`,
      };
    }

    const db = getDb();
    // Upsert by name (case-insensitive)
    const existing = db.prepare('SELECT id FROM ingredients WHERE name = ? COLLATE NOCASE').get(input.name);
    if (existing) {
      const updates = [];
      const params = [];
      if (input.unit_cost !== undefined) { updates.push('unit_cost = ?'); params.push(input.unit_cost); }
      if (input.base_unit) { updates.push('base_unit = ?'); params.push(input.base_unit); }
      if (input.category) { updates.push('category = ?'); params.push(input.category); }
      if (updates.length) {
        params.push(existing.id);
        db.prepare(`UPDATE ingredients SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      }
      if (opts.broadcast) opts.broadcast('ingredient_updated', { id: existing.id });
      return { success: true, message: `Ingredient "${input.name}" updated (already existed).`, entityType: 'ingredient', entityId: existing.id };
    }

    const result = db.prepare('INSERT INTO ingredients (name, unit_cost, base_unit, category) VALUES (?, ?, ?, ?)').run(
      input.name, input.unit_cost || 0, input.base_unit || '', input.category || ''
    );
    if (opts.broadcast) opts.broadcast('ingredient_created', { id: result.lastInsertRowid });
    return { success: true, message: `Ingredient "${input.name}" created.`, entityType: 'ingredient', entityId: result.lastInsertRowid };
  },

  create_special(input, opts) {
    const db = getDb();
    const resolved = resolveDish(db, input);
    if (!resolved) return { description: 'Dish not found', message: 'Could not find that dish.' };
    const { dishId, dishName } = resolved;

    // Default to next Monday if no week_start
    const weekStart = input.week_start || getNextMonday();
    const weekEnd = getWeekEnd(weekStart);

    if (opts.preview) {
      return {
        description: `Create special: "${dishName}" for week of ${weekStart}`,
        message: `I'll add "${dishName}" as a weekly special for ${weekStart} to ${weekEnd}.`,
      };
    }

    const result = db.prepare(
      'INSERT INTO weekly_specials (dish_id, week_start, week_end, notes, is_active) VALUES (?, ?, ?, ?, 1)'
    ).run(dishId, weekStart, weekEnd, input.notes || '');
    if (opts.broadcast) opts.broadcast('special_created', { id: result.lastInsertRowid });

    return {
      success: true,
      message: `"${dishName}" added as a special for week of ${weekStart}.`,
      entityType: 'special',
      entityId: result.lastInsertRowid,
    };
  },

  update_dish(input, opts) {
    const db = getDb();
    const resolved = resolveDish(db, input);
    if (!resolved) return { description: 'Dish not found', message: 'Could not find that dish.' };
    const { dishId, dishName } = resolved;

    const updates = [];
    const params = [];
    const changes = [];
    if (input.name) { updates.push('name = ?'); params.push(input.name); changes.push(`name → "${input.name}"`); }
    if (input.category) { updates.push('category = ?'); params.push(input.category); changes.push(`category → ${input.category}`); }
    if (input.description !== undefined) { updates.push('description = ?'); params.push(input.description); changes.push('description updated'); }
    if (input.batch_yield !== undefined) { updates.push('batch_yield = ?'); params.push(input.batch_yield); changes.push(`batch yield → ${input.batch_yield}`); }
    if (input.suggested_price !== undefined) { updates.push('suggested_price = ?'); params.push(input.suggested_price); changes.push(`price → ${input.suggested_price}`); }

    if (!updates.length) return { description: 'No changes', message: 'No changes specified.' };

    if (opts.preview) {
      return {
        description: `Update "${dishName}": ${changes.join(', ')}`,
        message: `I'll update "${dishName}": ${changes.join(', ')}.`,
      };
    }

    // Save snapshot for undo
    const current = db.prepare('SELECT * FROM dishes WHERE id = ?').get(dishId);
    const undoId = saveSnapshot('dish', dishId, 'update', current);

    params.push(dishId);
    db.prepare(`UPDATE dishes SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...params);
    if (opts.broadcast) opts.broadcast('dish_updated', { id: dishId });

    return {
      success: true,
      message: `"${dishName}" updated: ${changes.join(', ')}.`,
      entityType: 'dish',
      entityId: dishId,
      undoId,
    };
  },

  update_menu(input, opts) {
    const db = getDb();
    const resolved = resolveMenu(db, input);
    if (!resolved) return { description: 'Menu not found', message: 'Could not find that menu.' };
    const { menuId, menuName } = resolved;

    const updates = [];
    const params = [];
    const changes = [];
    if (input.name) { updates.push('name = ?'); params.push(input.name); changes.push(`name → "${input.name}"`); }
    if (input.description !== undefined) { updates.push('description = ?'); params.push(input.description); changes.push('description updated'); }
    if (input.sell_price !== undefined) { updates.push('sell_price = ?'); params.push(input.sell_price); changes.push(`sell price → ${input.sell_price}`); }
    if (input.expected_covers !== undefined) { updates.push('expected_covers = ?'); params.push(input.expected_covers); changes.push(`covers → ${input.expected_covers}`); }
    if (input.guest_allergies !== undefined) { updates.push('guest_allergies = ?'); params.push(input.guest_allergies); changes.push(`guest allergies → ${input.guest_allergies}`); }
    if (input.event_date) { updates.push('event_date = ?'); params.push(input.event_date); changes.push(`date → ${input.event_date}`); }

    if (!updates.length) return { description: 'No changes', message: 'No changes specified.' };

    if (opts.preview) {
      return {
        description: `Update "${menuName}": ${changes.join(', ')}`,
        message: `I'll update menu "${menuName}": ${changes.join(', ')}.`,
      };
    }

    const current = db.prepare('SELECT * FROM menus WHERE id = ?').get(menuId);
    const undoId = saveSnapshot('menu', menuId, 'update', current);

    params.push(menuId);
    db.prepare(`UPDATE menus SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...params);
    if (opts.broadcast) opts.broadcast('menu_updated', { id: menuId });

    return {
      success: true,
      message: `Menu "${menuName}" updated: ${changes.join(', ')}.`,
      entityType: 'menu',
      entityId: menuId,
      undoId,
    };
  },

  update_task(input, opts) {
    const db = getDb();
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(input.task_id);
    if (!task) return { success: true, message: 'Task not found.' };

    const updates = [];
    const params = [];
    const changes = [];

    if (input.title) { updates.push('title = ?'); params.push(input.title); changes.push(`title → "${input.title}"`); }
    if (input.description !== undefined) { updates.push('description = ?'); params.push(input.description); changes.push('description updated'); }
    if (input.priority) { updates.push('priority = ?'); params.push(input.priority); changes.push(`priority → ${input.priority}`); }
    if (input.due_date) { updates.push('due_date = ?'); params.push(input.due_date); changes.push(`due date → ${input.due_date}`); }
    if (input.due_time !== undefined) { updates.push('due_time = ?'); params.push(input.due_time); changes.push(`due time → ${input.due_time || 'cleared'}`); }
    if (input.completed !== undefined) {
      updates.push('completed = ?');
      params.push(input.completed ? 1 : 0);
      if (input.completed) {
        updates.push("completed_at = datetime('now')");
        changes.push('marked complete');
      } else {
        updates.push('completed_at = NULL');
        changes.push('marked incomplete');
      }
    }

    // Promote auto tasks to manual on content edits
    const contentEdit = input.title || input.description !== undefined || input.priority || input.due_date || input.due_time !== undefined;
    if (task.source === 'auto' && contentEdit) {
      updates.push("source = 'manual'");
    }

    if (!updates.length) return { success: true, message: 'No changes specified.' };

    if (opts.preview) {
      return {
        description: `Update task "${task.title}": ${changes.join(', ')}`,
        message: `I'll update task "${task.title}": ${changes.join(', ')}.`,
      };
    }

    params.push(input.task_id);
    db.prepare(`UPDATE tasks SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...params);
    if (opts.broadcast) opts.broadcast('task_updated', { id: input.task_id });

    return { success: true, message: `Task "${task.title}" updated: ${changes.join(', ')}.` };
  },

  update_ingredient(input, opts) {
    const db = getDb();
    const resolved = resolveIngredient(db, input);
    if (!resolved) return { description: 'Ingredient not found', message: 'Could not find that ingredient.' };
    const { ingredientId, ingredientName } = resolved;

    const updates = [];
    const params = [];
    const changes = [];
    if (input.unit_cost !== undefined) { updates.push('unit_cost = ?'); params.push(input.unit_cost); changes.push(`cost → ${input.unit_cost}`); }
    if (input.base_unit) { updates.push('base_unit = ?'); params.push(input.base_unit); changes.push(`unit → ${input.base_unit}`); }
    if (input.category) { updates.push('category = ?'); params.push(input.category); changes.push(`category → ${input.category}`); }

    if (!updates.length) return { description: 'No changes', message: 'No changes specified.' };

    if (opts.preview) {
      return {
        description: `Update "${ingredientName}": ${changes.join(', ')}`,
        message: `I'll update ingredient "${ingredientName}": ${changes.join(', ')}.`,
      };
    }

    params.push(ingredientId);
    db.prepare(`UPDATE ingredients SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    if (opts.broadcast) opts.broadcast('ingredient_updated', { id: ingredientId });

    return { success: true, message: `Ingredient "${ingredientName}" updated: ${changes.join(', ')}.` };
  },

  update_servings(input, opts) {
    const db = getDb();
    const menuResolved = resolveMenu(db, input);
    if (!menuResolved) return { success: true, message: 'Menu not found.' };
    const dishResolved = resolveDish(db, input);
    if (!dishResolved) return { success: true, message: 'Dish not found.' };

    if (opts.preview) {
      return {
        description: `Set "${dishResolved.dishName}" to ${input.servings} servings on "${menuResolved.menuName}"`,
        message: `I'll update the servings for "${dishResolved.dishName}" on "${menuResolved.menuName}" to ${input.servings}.`,
      };
    }

    const result = db.prepare('UPDATE menu_dishes SET servings = ? WHERE menu_id = ? AND dish_id = ?').run(
      input.servings, menuResolved.menuId, dishResolved.dishId
    );
    if (result.changes === 0) return { success: false, message: `"${dishResolved.dishName}" is not on "${menuResolved.menuName}".` };

    if (opts.broadcast) opts.broadcast('menu_updated', { id: menuResolved.menuId });
    return { success: true, message: `"${dishResolved.dishName}" set to ${input.servings} servings on "${menuResolved.menuName}".` };
  },

  update_service_note(input, opts) {
    const db = getDb();
    const note = db.prepare('SELECT * FROM service_notes WHERE id = ?').get(input.note_id);
    if (!note) return { success: true, message: 'Service note not found.' };

    const updates = [];
    const params = [];
    const changes = [];
    if (input.title) { updates.push('title = ?'); params.push(input.title); changes.push(`title → "${input.title}"`); }
    if (input.content) { updates.push('content = ?'); params.push(input.content); changes.push('content updated'); }
    if (input.shift) { updates.push('shift = ?'); params.push(input.shift); changes.push(`shift → ${input.shift}`); }
    if (input.date) { updates.push('date = ?'); params.push(input.date); changes.push(`date → ${input.date}`); }

    if (!updates.length) return { success: true, message: 'No changes specified.' };

    if (opts.preview) {
      return {
        description: `Update note "${note.title}": ${changes.join(', ')}`,
        message: `I'll update service note "${note.title}": ${changes.join(', ')}.`,
      };
    }

    params.push(input.note_id);
    db.prepare(`UPDATE service_notes SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...params);
    if (opts.broadcast) opts.broadcast('service_note_updated', { id: input.note_id });

    return { success: true, message: `Service note "${note.title}" updated: ${changes.join(', ')}.` };
  },

  // ─── Delete Handlers ──────────────────────────────────────────

  delete_dish(input, opts) {
    const db = getDb();
    const resolved = resolveDish(db, input);
    if (!resolved) return { description: 'Dish not found', message: 'Could not find that dish.' };
    const { dishId, dishName } = resolved;

    if (opts.preview) {
      return {
        description: `Delete dish: "${dishName}"`,
        message: `I'll delete "${dishName}". This is a soft delete — it can be restored within 7 days.`,
      };
    }

    const current = db.prepare('SELECT * FROM dishes WHERE id = ?').get(dishId);
    const undoId = saveSnapshot('dish', dishId, 'delete', current);

    db.prepare("UPDATE dishes SET deleted_at = datetime('now') WHERE id = ?").run(dishId);
    if (opts.broadcast) opts.broadcast('dish_deleted', { id: dishId });

    return { success: true, message: `"${dishName}" deleted.`, entityType: 'dish', entityId: dishId, undoId };
  },

  delete_menu(input, opts) {
    const db = getDb();
    const resolved = resolveMenu(db, input);
    if (!resolved) return { description: 'Menu not found', message: 'Could not find that menu.' };
    const { menuId, menuName } = resolved;

    if (opts.preview) {
      return {
        description: `Delete menu: "${menuName}"`,
        message: `I'll delete menu "${menuName}". This is a soft delete — it can be restored within 7 days.`,
      };
    }

    const current = db.prepare('SELECT * FROM menus WHERE id = ?').get(menuId);
    const undoId = saveSnapshot('menu', menuId, 'delete', current);

    db.prepare("UPDATE menus SET deleted_at = datetime('now') WHERE id = ?").run(menuId);
    if (opts.broadcast) opts.broadcast('menu_deleted', { id: menuId });

    return { success: true, message: `Menu "${menuName}" deleted.`, entityType: 'menu', entityId: menuId, undoId };
  },

  delete_task(input, opts) {
    const db = getDb();
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(input.task_id);
    if (!task) return { description: 'Task not found', message: 'Could not find that task.' };

    if (opts.preview) {
      return {
        description: `Delete task: "${task.title}"`,
        message: `I'll permanently delete the task "${task.title}".`,
      };
    }

    const undoId = saveSnapshot('task', input.task_id, 'delete', task);
    db.prepare('DELETE FROM tasks WHERE id = ?').run(input.task_id);
    if (opts.broadcast) opts.broadcast('task_deleted', { id: input.task_id });

    return { success: true, message: `Task "${task.title}" deleted.`, undoId };
  },

  delete_service_note(input, opts) {
    const db = getDb();
    const note = db.prepare('SELECT * FROM service_notes WHERE id = ?').get(input.note_id);
    if (!note) return { description: 'Note not found', message: 'Could not find that service note.' };

    if (opts.preview) {
      return {
        description: `Delete note: "${note.title}"`,
        message: `I'll permanently delete the service note "${note.title}" (${note.date}).`,
      };
    }

    const undoId = saveSnapshot('service_note', input.note_id, 'delete', note);
    db.prepare('DELETE FROM service_notes WHERE id = ?').run(input.note_id);
    if (opts.broadcast) opts.broadcast('service_note_deleted', { id: input.note_id, date: note.date });

    return { success: true, message: `Service note "${note.title}" deleted.`, undoId };
  },

  remove_dish_from_menu(input, opts) {
    const db = getDb();
    const menuResolved = resolveMenu(db, input);
    if (!menuResolved) return { description: 'Menu not found', message: 'Could not find that menu.' };
    const dishResolved = resolveDish(db, input);
    if (!dishResolved) return { description: 'Dish not found', message: 'Could not find that dish.' };

    if (opts.preview) {
      return {
        description: `Remove "${dishResolved.dishName}" from "${menuResolved.menuName}"`,
        message: `I'll remove "${dishResolved.dishName}" from menu "${menuResolved.menuName}".`,
      };
    }

    const result = db.prepare('DELETE FROM menu_dishes WHERE menu_id = ? AND dish_id = ?').run(
      menuResolved.menuId, dishResolved.dishId
    );
    if (result.changes === 0) return { success: false, message: `"${dishResolved.dishName}" is not on "${menuResolved.menuName}".` };

    if (opts.broadcast) opts.broadcast('menu_updated', { id: menuResolved.menuId });
    return { success: true, message: `Removed "${dishResolved.dishName}" from "${menuResolved.menuName}".` };
  },

  add_course_to_menu(input, opts) {
    const db = getDb();
    const menuResolved = resolveMenu(db, input);
    if (!menuResolved) return { description: 'Menu not found', message: 'Could not find that menu.' };

    if (opts.preview) {
      return {
        description: `Add course "${input.name}" to "${menuResolved.menuName}"`,
        message: `I'll add a course/section called "${input.name}" to "${menuResolved.menuName}".`,
      };
    }

    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM menu_courses WHERE menu_id = ?').get(menuResolved.menuId);
    db.prepare('INSERT INTO menu_courses (menu_id, name, notes, sort_order) VALUES (?, ?, ?, ?)').run(
      menuResolved.menuId, input.name, input.notes || '', maxOrder.next
    );

    if (opts.broadcast) opts.broadcast('menu_updated', { id: menuResolved.menuId });
    return { success: true, message: `Added course "${input.name}" to "${menuResolved.menuName}".` };
  },

  move_dish_to_course(input, opts) {
    const db = getDb();
    const menuResolved = resolveMenu(db, input);
    if (!menuResolved) return { description: 'Menu not found', message: 'Could not find that menu.' };
    const dishResolved = resolveDish(db, input);
    if (!dishResolved) return { description: 'Dish not found', message: 'Could not find that dish.' };

    const course = db.prepare(
      "SELECT id, name FROM menu_courses WHERE menu_id = ? AND name LIKE ? LIMIT 1"
    ).get(menuResolved.menuId, `%${input.course_name}%`);

    if (!course) {
      return { description: 'Course not found', message: `Could not find a course matching "${input.course_name}" on "${menuResolved.menuName}".` };
    }

    if (opts.preview) {
      return {
        description: `Move "${dishResolved.dishName}" to "${course.name}"`,
        message: `I'll move "${dishResolved.dishName}" to the "${course.name}" course on "${menuResolved.menuName}".`,
      };
    }

    const result = db.prepare('UPDATE menu_dishes SET course_id = ? WHERE menu_id = ? AND dish_id = ?').run(
      course.id, menuResolved.menuId, dishResolved.dishId
    );
    if (result.changes === 0) return { success: false, message: `"${dishResolved.dishName}" is not on "${menuResolved.menuName}".` };

    if (opts.broadcast) opts.broadcast('menu_updated', { id: menuResolved.menuId });
    return { success: true, message: `Moved "${dishResolved.dishName}" to "${course.name}".` };
  },

  // ─── Quick Action Handlers ────────────────────────────────────

  toggle_favorite(input, opts) {
    const db = getDb();
    const resolved = resolveDish(db, input);
    if (!resolved) return { success: true, message: 'Dish not found.' };
    const { dishId, dishName } = resolved;

    const dish = db.prepare('SELECT is_favorite FROM dishes WHERE id = ?').get(dishId);
    const newVal = dish.is_favorite ? 0 : 1;

    if (opts.preview) {
      return {
        description: `${newVal ? 'Favorite' : 'Unfavorite'} "${dishName}"`,
        message: `I'll ${newVal ? 'add' : 'remove'} "${dishName}" ${newVal ? 'to' : 'from'} favorites.`,
      };
    }

    db.prepare('UPDATE dishes SET is_favorite = ? WHERE id = ?').run(newVal, dishId);
    if (opts.broadcast) opts.broadcast('dish_updated', { id: dishId });

    return { success: true, message: `"${dishName}" ${newVal ? 'added to' : 'removed from'} favorites.` };
  },

  toggle_ingredient_stock(input, opts) {
    const db = getDb();
    const resolved = resolveIngredient(db, input);
    if (!resolved) return { success: true, message: 'Ingredient not found.' };
    const { ingredientId, ingredientName } = resolved;

    const current = db.prepare('SELECT in_stock FROM ingredients WHERE id = ?').get(ingredientId);
    const newVal = input.in_stock !== undefined ? (input.in_stock ? 1 : 0) : (current.in_stock ? 0 : 1);

    if (opts.preview) {
      return {
        description: `Mark "${ingredientName}" as ${newVal ? 'in stock' : 'out of stock'}`,
        message: `I'll mark "${ingredientName}" as ${newVal ? 'in stock' : 'out of stock'}.`,
      };
    }

    db.prepare('UPDATE ingredients SET in_stock = ? WHERE id = ?').run(newVal, ingredientId);
    if (opts.broadcast) opts.broadcast('ingredient_updated', { id: ingredientId });

    return { success: true, message: `"${ingredientName}" marked as ${newVal ? 'in stock' : 'out of stock'}.` };
  },

  complete_task(input, opts) {
    const db = getDb();
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(input.task_id);
    if (!task) return { success: true, message: 'Task not found.' };

    const completed = input.completed !== undefined ? input.completed : true;

    if (opts.preview) {
      return {
        description: `${completed ? 'Complete' : 'Uncomplete'} task: "${task.title}"`,
        message: `I'll mark "${task.title}" as ${completed ? 'complete' : 'incomplete'}.`,
      };
    }

    if (completed) {
      db.prepare("UPDATE tasks SET completed = 1, completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(input.task_id);
    } else {
      db.prepare("UPDATE tasks SET completed = 0, completed_at = NULL, updated_at = datetime('now') WHERE id = ?").run(input.task_id);
    }
    if (opts.broadcast) opts.broadcast('task_updated', { id: input.task_id });

    return { success: true, message: `"${task.title}" marked as ${completed ? 'complete' : 'incomplete'}.` };
  },

  batch_complete_tasks(input, opts) {
    const db = getDb();
    const completed = input.completed !== undefined ? input.completed : true;
    const ids = input.task_ids || [];

    if (!ids.length) return { success: true, message: 'No task IDs provided.' };

    if (opts.preview) {
      return {
        description: `${completed ? 'Complete' : 'Uncomplete'} ${ids.length} task(s)`,
        message: `I'll mark ${ids.length} task(s) as ${completed ? 'complete' : 'incomplete'}.`,
      };
    }

    const placeholders = ids.map(() => '?').join(',');
    if (completed) {
      db.prepare(`UPDATE tasks SET completed = 1, completed_at = datetime('now'), updated_at = datetime('now') WHERE id IN (${placeholders})`).run(...ids);
    } else {
      db.prepare(`UPDATE tasks SET completed = 0, completed_at = NULL, updated_at = datetime('now') WHERE id IN (${placeholders})`).run(...ids);
    }
    if (opts.broadcast) opts.broadcast('tasks_batch_updated', { ids, completed });

    return { success: true, message: `${ids.length} task(s) marked as ${completed ? 'complete' : 'incomplete'}.` };
  },

  duplicate_dish(input, opts) {
    const db = getDb();
    const resolved = resolveDish(db, input);
    if (!resolved) return { description: 'Dish not found', message: 'Could not find that dish.' };
    const { dishId, dishName } = resolved;

    if (opts.preview) {
      return {
        description: `Duplicate "${dishName}"`,
        message: `I'll create a copy of "${dishName}" with all ingredients, directions, allergens, and tags.`,
      };
    }

    const dish = db.prepare('SELECT * FROM dishes WHERE id = ?').get(dishId);
    const newName = `${dish.name} (Copy)`;
    const result = db.prepare(
      'INSERT INTO dishes (name, description, category, chefs_notes, suggested_price, batch_yield) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(newName, dish.description, dish.category, dish.chefs_notes, dish.suggested_price, dish.batch_yield);
    const newId = result.lastInsertRowid;

    // Copy ingredients
    const ingredients = db.prepare('SELECT * FROM dish_ingredients WHERE dish_id = ?').all(dishId);
    for (const ing of ingredients) {
      db.prepare('INSERT INTO dish_ingredients (dish_id, ingredient_id, quantity, unit, prep_note, sort_order) VALUES (?, ?, ?, ?, ?, ?)').run(
        newId, ing.ingredient_id, ing.quantity, ing.unit, ing.prep_note, ing.sort_order
      );
    }

    // Copy section headers
    const headers = db.prepare('SELECT * FROM dish_section_headers WHERE dish_id = ?').all(dishId);
    for (const h of headers) {
      db.prepare('INSERT INTO dish_section_headers (dish_id, label, sort_order) VALUES (?, ?, ?)').run(newId, h.label, h.sort_order);
    }

    // Copy directions
    const directions = db.prepare('SELECT * FROM dish_directions WHERE dish_id = ?').all(dishId);
    for (const dir of directions) {
      db.prepare('INSERT INTO dish_directions (dish_id, type, text, sort_order) VALUES (?, ?, ?, ?)').run(newId, dir.type, dir.text, dir.sort_order);
    }

    // Run ingredient allergen detection for the new dish
    const { updateDishAllergens: detectAllergens } = require('../allergenDetector');
    detectAllergens(newId);

    // Copy dish-level manual allergen overrides
    const manualAllergens = db.prepare("SELECT allergen FROM dish_allergens WHERE dish_id = ? AND source = 'manual'").all(dishId);
    for (const a of manualAllergens) {
      db.prepare("INSERT OR IGNORE INTO dish_allergens (dish_id, allergen, source) VALUES (?, ?, 'manual')").run(newId, a.allergen);
    }

    // Copy tags
    const tags = db.prepare('SELECT * FROM dish_tags WHERE dish_id = ?').all(dishId);
    for (const t of tags) {
      db.prepare('INSERT INTO dish_tags (dish_id, tag_id) VALUES (?, ?)').run(newId, t.tag_id);
    }

    const undoId = saveSnapshot('dish', newId, 'create', null);
    if (opts.broadcast) opts.broadcast('dish_created', { id: newId });

    return {
      success: true,
      message: `"${dishName}" duplicated as "${newName}".`,
      entityType: 'dish',
      entityId: newId,
      undoId,
      navigateTo: `#/dishes/${newId}/edit`,
    };
  },

  // ─── Allergen Handlers ─────────────────────────────────────────

  add_allergen(input, opts) {
    const db = getDb();
    const resolved = resolveDish(db, input);
    if (!resolved) return { success: true, message: 'Dish not found.' };
    const { dishId, dishName } = resolved;

    if (opts.preview) {
      return {
        description: `Add ${input.allergen} allergen to "${dishName}"`,
        message: `I'll flag "${dishName}" as containing ${input.allergen}.`,
      };
    }

    // Check if already exists
    const existing = db.prepare('SELECT 1 FROM dish_allergens WHERE dish_id = ? AND allergen = ?').get(dishId, input.allergen);
    if (existing) return { success: true, message: `"${dishName}" already has ${input.allergen} flagged.` };

    db.prepare("INSERT INTO dish_allergens (dish_id, allergen, source) VALUES (?, ?, 'manual')").run(dishId, input.allergen);
    if (opts.broadcast) opts.broadcast('dish_updated', { id: dishId });

    return { success: true, message: `Added ${input.allergen} allergen to "${dishName}".` };
  },

  remove_allergen(input, opts) {
    const db = getDb();
    const resolved = resolveDish(db, input);
    if (!resolved) return { success: true, message: 'Dish not found.' };
    const { dishId, dishName } = resolved;

    if (opts.preview) {
      return {
        description: `Remove ${input.allergen} from "${dishName}"`,
        message: `I'll remove the ${input.allergen} allergen flag from "${dishName}".`,
      };
    }

    const result = db.prepare('DELETE FROM dish_allergens WHERE dish_id = ? AND allergen = ?').run(dishId, input.allergen);
    if (result.changes === 0) return { success: true, message: `"${dishName}" didn't have ${input.allergen} flagged.` };

    if (opts.broadcast) opts.broadcast('dish_updated', { id: dishId });
    return { success: true, message: `Removed ${input.allergen} from "${dishName}".` };
  },

  // ─── Prep Task Generation Handler ─────────────────────────────

  generate_prep_tasks(input, opts) {
    const db = getDb();
    const resolved = resolveMenu(db, input);
    if (!resolved) return { description: 'Menu not found', message: 'Could not find that menu.' };
    const { menuId, menuName } = resolved;

    const dishCount = db.prepare(
      'SELECT COUNT(*) as cnt FROM menu_dishes md JOIN dishes d ON md.dish_id = d.id WHERE md.menu_id = ? AND d.deleted_at IS NULL'
    ).get(menuId).cnt;

    if (opts.preview) {
      return {
        description: `Generate prep tasks for "${menuName}" (${dishCount} dishes)`,
        message: `I'll generate prep tasks for all ${dishCount} dishes on "${menuName}". Existing auto-generated tasks will be replaced; manually edited tasks will be preserved.`,
      };
    }

    // Use the task generator service
    const { generateAndPersistTasks } = require('../taskGenerator');
    const result = generateAndPersistTasks(menuId);

    if (opts.broadcast) opts.broadcast('tasks_generated', { menu_id: menuId });

    return {
      success: true,
      message: `Generated ${result.prep_count} prep task(s) for "${menuName}".`,
      entityType: 'menu',
      entityId: menuId,
    };
  },

  // ─── Advisory Tool Handlers (text-only, Haiku provides the advice) ──

  suggest_dish_pairings(input, opts) {
    const db = getDb();
    let dishInfo = '';
    if (input.dish_id || input.dish_name) {
      const resolved = resolveDish(db, input);
      if (resolved) {
        const dish = db.prepare('SELECT name, category, description FROM dishes WHERE id = ?').get(resolved.dishId);
        const ingredients = db.prepare(
          'SELECT i.name FROM dish_ingredients di JOIN ingredients i ON di.ingredient_id = i.id WHERE di.dish_id = ?'
        ).all(resolved.dishId);
        dishInfo = `Dish: "${dish.name}" (${dish.category || 'other'}). ${dish.description || ''}. Ingredients: ${ingredients.map(i => i.name).join(', ')}`;
      }
    }

    // Get available dishes for context
    const available = db.prepare(
      "SELECT name, category FROM dishes WHERE deleted_at IS NULL ORDER BY name LIMIT 30"
    ).all();

    if (opts.preview) {
      return {
        description: 'Suggest dish pairings',
        message: 'I\'ll suggest dishes that pair well together.',
        needsAiProcessing: true,
        dishInfo,
        availableDishes: available.map(d => `${d.name} (${d.category})`).join(', '),
        context: input.context || '',
      };
    }

    return { success: true, message: 'Pairing suggestions provided.', dishInfo, availableDishes: available };
  },

  dietary_analysis(input, opts) {
    const db = getDb();
    const resolved = resolveMenu(db, input);
    if (!resolved) return { success: true, message: 'Menu not found.' };
    const { menuId, menuName } = resolved;

    // Gather full menu data for Haiku
    const dishes = db.prepare(
      `SELECT d.id, d.name, d.category FROM menu_dishes md
       JOIN dishes d ON md.dish_id = d.id WHERE md.menu_id = ? AND d.deleted_at IS NULL`
    ).all(menuId);

    const menuData = [];
    for (const d of dishes) {
      const ingredients = db.prepare(
        'SELECT i.name FROM dish_ingredients di JOIN ingredients i ON di.ingredient_id = i.id WHERE di.dish_id = ?'
      ).all(d.id);
      const allergens = getDishAllergens(d.id);
      menuData.push({
        name: d.name,
        category: d.category,
        ingredients: ingredients.map(i => i.name),
        allergens: allergens.map(a => a.allergen),
      });
    }

    if (opts.preview) {
      return {
        description: `Dietary analysis for "${menuName}"${input.diet ? ` (${input.diet})` : ''}`,
        message: `I'll analyze "${menuName}" for dietary suitability.`,
        needsAiProcessing: true,
        menuData,
        diet: input.diet || 'general',
      };
    }

    return { success: true, message: 'Dietary analysis provided.', menuData };
  },

  suggest_substitution(input, opts) {
    if (opts.preview) {
      return {
        description: `Suggest substitution for "${input.ingredient_name}"`,
        message: `I'll suggest alternatives for "${input.ingredient_name}"${input.reason ? ` (reason: ${input.reason})` : ''}.`,
        needsAiProcessing: true,
      };
    }
    return { success: true, message: 'Substitution suggestions provided.' };
  },

  suggest_price(input, opts) {
    const db = getDb();
    const resolved = resolveDish(db, input);
    if (!resolved) return { success: true, message: 'Dish not found.' };
    const { dishId, dishName } = resolved;

    const dish = db.prepare('SELECT batch_yield, suggested_price FROM dishes WHERE id = ?').get(dishId);
    const ingredients = db.prepare(
      `SELECT di.quantity, i.unit_cost, i.name
       FROM dish_ingredients di JOIN ingredients i ON di.ingredient_id = i.id WHERE di.dish_id = ?`
    ).all(dishId);

    let totalCost = 0;
    for (const ing of ingredients) {
      if (ing.quantity && ing.unit_cost) totalCost += ing.quantity * ing.unit_cost;
    }
    const portionCost = dish.batch_yield > 0 ? totalCost / dish.batch_yield : totalCost;
    const targetPct = input.target_food_cost_percent || 30;
    const suggestedPrice = portionCost > 0 ? (portionCost / (targetPct / 100)) : 0;

    const parts = [
      `Pricing analysis for "${dishName}":`,
      `Total batch cost: ${totalCost.toFixed(2)}`,
      `Batch yield: ${dish.batch_yield || 1} portions`,
      `Cost per portion: ${portionCost.toFixed(2)}`,
      `Current price: ${dish.suggested_price || 'not set'}`,
      `Target food cost: ${targetPct}%`,
      `Suggested price: ${suggestedPrice.toFixed(2)}`,
    ];

    if (dish.suggested_price && portionCost > 0) {
      const currentPct = (portionCost / dish.suggested_price) * 100;
      parts.push(`Current food cost %: ${currentPct.toFixed(1)}%`);
      if (currentPct > 35) parts.push('Warning: current price gives food cost over 35%');
    }

    const message = parts.join('\n');
    if (opts.preview) return { description: `Pricing: "${dishName}"`, message };
    return { success: true, message };
  },

  // ─── Recipe Building Handlers ──────────────────────────────────

  add_ingredient_to_dish(input, opts) {
    const db = getDb();
    const resolved = resolveDish(db, input);
    if (!resolved) return { description: 'Dish not found', message: 'Could not find that dish.' };
    const { dishId, dishName } = resolved;

    // Find or create the ingredient
    let ingredient = db.prepare('SELECT id, name FROM ingredients WHERE name LIKE ? LIMIT 1').get(`%${input.ingredient_name}%`);

    if (opts.preview) {
      const qty = input.quantity ? `${input.quantity} ${input.unit || ''}` : '';
      const prep = input.prep_note ? ` (${input.prep_note})` : '';
      const ingLabel = ingredient ? ingredient.name : input.ingredient_name;
      return {
        description: `Add ${qty} ${ingLabel}${prep} to "${dishName}"`,
        message: `I'll add ${qty ? qty + ' ' : ''}${ingLabel}${prep} to "${dishName}".${!ingredient ? ` This will also create "${input.ingredient_name}" as a new ingredient.` : ''}`,
      };
    }

    // Create ingredient if it doesn't exist
    if (!ingredient) {
      db.prepare('INSERT INTO ingredients (name) VALUES (?)').run(input.ingredient_name);
      ingredient = db.prepare('SELECT id, name FROM ingredients WHERE name = ? COLLATE NOCASE').get(input.ingredient_name);
      if (opts.broadcast) opts.broadcast('ingredient_created', { id: ingredient.id });
    }

    // Check if already on this dish (UNIQUE constraint)
    const existing = db.prepare('SELECT 1 FROM dish_ingredients WHERE dish_id = ? AND ingredient_id = ?').get(dishId, ingredient.id);
    if (existing) {
      return { success: false, message: `"${ingredient.name}" is already on "${dishName}". Update the quantity in the dish form instead.` };
    }

    // Get next sort_order
    const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as mx FROM dish_ingredients WHERE dish_id = ?').get(dishId).mx;

    db.prepare(
      'INSERT INTO dish_ingredients (dish_id, ingredient_id, quantity, unit, prep_note, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(dishId, ingredient.id, input.quantity || null, input.unit || null, input.prep_note || null, maxSort + 1);

    // Re-run allergen detection
    const { updateDishAllergens } = require('../allergenDetector');
    updateDishAllergens(dishId);

    if (opts.broadcast) opts.broadcast('dish_updated', { id: dishId });

    const qty = input.quantity ? `${input.quantity} ${input.unit || ''}` : '';
    return {
      success: true,
      message: `Added ${qty ? qty + ' ' : ''}${ingredient.name} to "${dishName}".`,
      entityType: 'dish',
      entityId: dishId,
    };
  },

  remove_ingredient_from_dish(input, opts) {
    const db = getDb();
    const resolved = resolveDish(db, input);
    if (!resolved) return { success: true, message: 'Dish not found.' };
    const { dishId, dishName } = resolved;

    // Find the ingredient
    let ingredientId = input.ingredient_id;
    let ingredientName = input.ingredient_name;
    if (!ingredientId && ingredientName) {
      const ing = db.prepare(
        'SELECT di.ingredient_id, i.name FROM dish_ingredients di JOIN ingredients i ON di.ingredient_id = i.id WHERE di.dish_id = ? AND i.name LIKE ? LIMIT 1'
      ).get(dishId, `%${ingredientName}%`);
      if (ing) { ingredientId = ing.ingredient_id; ingredientName = ing.name; }
    }

    if (!ingredientId) {
      return { success: true, message: `Could not find "${input.ingredient_name}" on "${dishName}".` };
    }

    if (opts.preview) {
      return {
        description: `Remove ${ingredientName} from "${dishName}"`,
        message: `I'll remove "${ingredientName}" from "${dishName}".`,
      };
    }

    const result = db.prepare('DELETE FROM dish_ingredients WHERE dish_id = ? AND ingredient_id = ?').run(dishId, ingredientId);
    if (result.changes === 0) {
      return { success: false, message: `"${ingredientName}" is not on "${dishName}".` };
    }

    // Re-run allergen detection
    const { updateDishAllergens } = require('../allergenDetector');
    updateDishAllergens(dishId);

    if (opts.broadcast) opts.broadcast('dish_updated', { id: dishId });

    return { success: true, message: `Removed "${ingredientName}" from "${dishName}".`, entityType: 'dish', entityId: dishId };
  },

  add_direction_to_dish(input, opts) {
    const db = getDb();
    const resolved = resolveDish(db, input);
    if (!resolved) return { success: true, message: 'Dish not found.' };
    const { dishId, dishName } = resolved;

    const dirType = input.type || 'step';

    if (opts.preview) {
      const label = dirType === 'section' ? `section header: "${input.text}"` : `step: "${input.text}"`;
      return {
        description: `Add ${label} to "${dishName}"`,
        message: `I'll add a ${label} to "${dishName}".`,
      };
    }

    // Get existing directions to figure out sort_order
    const existing = db.prepare('SELECT sort_order FROM dish_directions WHERE dish_id = ? ORDER BY sort_order DESC LIMIT 1').get(dishId);
    const nextSort = existing ? existing.sort_order + 1 : 0;

    if (input.position !== undefined && input.position !== null) {
      // Shift existing directions to make room
      db.prepare('UPDATE dish_directions SET sort_order = sort_order + 1 WHERE dish_id = ? AND sort_order >= ?').run(dishId, input.position);
      db.prepare('INSERT INTO dish_directions (dish_id, type, text, sort_order) VALUES (?, ?, ?, ?)').run(dishId, dirType, input.text, input.position);
    } else {
      db.prepare('INSERT INTO dish_directions (dish_id, type, text, sort_order) VALUES (?, ?, ?, ?)').run(dishId, dirType, input.text, nextSort);
    }

    // Clear legacy chefs_notes since we now have structured directions
    db.prepare('UPDATE dishes SET chefs_notes = ? WHERE id = ?').run('', dishId);

    if (opts.broadcast) opts.broadcast('dish_updated', { id: dishId });

    const label = dirType === 'section' ? 'section header' : 'step';
    return { success: true, message: `Added ${label} to "${dishName}": "${input.text}".`, entityType: 'dish', entityId: dishId };
  },

  add_tag(input, opts) {
    const db = getDb();
    const resolved = resolveDish(db, input);
    if (!resolved) return { success: true, message: 'Dish not found.' };
    const { dishId, dishName } = resolved;

    const tagName = input.tag.trim();

    if (opts.preview) {
      return {
        description: `Add tag "${tagName}" to "${dishName}"`,
        message: `I'll tag "${dishName}" with "${tagName}".`,
      };
    }

    // Find or create the tag
    let tag = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE').get(tagName);
    if (!tag) {
      db.prepare('INSERT INTO tags (name) VALUES (?)').run(tagName);
      tag = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE').get(tagName);
    }

    // Check if already tagged
    const existing = db.prepare('SELECT 1 FROM dish_tags WHERE dish_id = ? AND tag_id = ?').get(dishId, tag.id);
    if (existing) {
      return { success: true, message: `"${dishName}" is already tagged with "${tagName}".` };
    }

    db.prepare('INSERT INTO dish_tags (dish_id, tag_id) VALUES (?, ?)').run(dishId, tag.id);
    if (opts.broadcast) opts.broadcast('dish_updated', { id: dishId });

    return { success: true, message: `Tagged "${dishName}" with "${tagName}".` };
  },

  remove_tag(input, opts) {
    const db = getDb();
    const resolved = resolveDish(db, input);
    if (!resolved) return { success: true, message: 'Dish not found.' };
    const { dishId, dishName } = resolved;

    const tagName = input.tag.trim();

    if (opts.preview) {
      return {
        description: `Remove tag "${tagName}" from "${dishName}"`,
        message: `I'll remove the "${tagName}" tag from "${dishName}".`,
      };
    }

    const tag = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE').get(tagName);
    if (!tag) {
      return { success: true, message: `Tag "${tagName}" doesn't exist.` };
    }

    const result = db.prepare('DELETE FROM dish_tags WHERE dish_id = ? AND tag_id = ?').run(dishId, tag.id);
    if (result.changes === 0) {
      return { success: true, message: `"${dishName}" doesn't have the "${tagName}" tag.` };
    }

    if (opts.broadcast) opts.broadcast('dish_updated', { id: dishId });
    return { success: true, message: `Removed tag "${tagName}" from "${dishName}".` };
  },

  // ─── Database Query Handler ────────────────────────────────────

  query_database(input, opts) {
    const sql = (input.sql || '').trim();

    // Validate: must be a SELECT (read-only)
    const normalised = sql.replace(/\s+/g, ' ').toLowerCase();
    const forbidden = ['insert ', 'update ', 'delete ', 'drop ', 'alter ', 'create ', 'replace ', 'attach ', 'detach ', 'pragma ', 'reindex ', 'vacuum'];
    for (const keyword of forbidden) {
      if (normalised.includes(keyword)) {
        return { success: false, message: `Query rejected: "${keyword.trim().toUpperCase()}" statements are not allowed. Only SELECT queries are permitted.` };
      }
    }
    if (!normalised.startsWith('select') && !normalised.startsWith('with')) {
      return { success: false, message: 'Only SELECT queries (and WITH/CTE) are allowed.' };
    }

    if (opts.preview) {
      return {
        description: input.explanation || 'Run database query',
        message: `I'll run this query: ${sql}`,
      };
    }

    const db = getDb();
    try {
      const rows = db.prepare(sql).all();

      // Cap output to avoid flooding the context
      const maxRows = 50;
      const truncated = rows.length > maxRows;
      const display = truncated ? rows.slice(0, maxRows) : rows;

      if (!display.length) {
        return { success: true, message: input.explanation ? `${input.explanation}: No results found.` : 'Query returned no results.' };
      }

      // Format as a readable table
      const columns = Object.keys(display[0]);
      const lines = display.map(row =>
        columns.map(col => {
          const val = row[col];
          return val === null ? 'NULL' : String(val);
        }).join(' | ')
      );

      const header = columns.join(' | ');
      const separator = columns.map(c => '-'.repeat(Math.max(c.length, 3))).join('-+-');
      let message = `${header}\n${separator}\n${lines.join('\n')}`;

      if (truncated) {
        message += `\n\n(Showing ${maxRows} of ${rows.length} total rows)`;
      } else {
        message += `\n\n(${rows.length} row${rows.length === 1 ? '' : 's'})`;
      }

      if (input.explanation) {
        message = `${input.explanation}:\n\n${message}`;
      }

      return { success: true, message };
    } catch (err) {
      return { success: false, message: `Query error: ${err.message}` };
    }
  },

  // ─── Ingredient Management Handlers ────────────────────────────

  find_duplicate_ingredients(input, _opts) {
    const db = getDb();
    const all = db.prepare('SELECT id, name, unit_cost, base_unit, category FROM ingredients ORDER BY name COLLATE NOCASE').all();

    if (!all.length) return { success: true, message: 'No ingredients in the database.' };

    // Build usage counts
    const usageMap = {};
    const usageRows = db.prepare('SELECT ingredient_id, COUNT(*) as cnt FROM dish_ingredients GROUP BY ingredient_id').all();
    for (const row of usageRows) usageMap[row.ingredient_id] = row.cnt;

    // Normalize name for comparison
    function normalize(name) {
      return name.toLowerCase()
        .replace(/[,\-()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    // Extract core words (remove common qualifiers)
    const qualifiers = new Set(['fresh', 'dried', 'ground', 'whole', 'organic', 'extra', 'virgin', 'fine', 'coarse', 'large', 'small', 'medium', 'raw', 'unsalted', 'salted', 'frozen', 'canned', 'chopped', 'minced', 'sliced', 'diced']);
    function coreWords(name) {
      return normalize(name).split(' ').filter(w => !qualifiers.has(w) && w.length > 1).sort().join(' ');
    }

    const threshold = input.threshold || 'moderate';
    const groups = [];
    const used = new Set();

    for (let i = 0; i < all.length; i++) {
      if (used.has(all[i].id)) continue;
      const group = [all[i]];
      const normI = normalize(all[i].name);
      const coreI = coreWords(all[i].name);

      for (let j = i + 1; j < all.length; j++) {
        if (used.has(all[j].id)) continue;
        const normJ = normalize(all[j].name);
        const coreJ = coreWords(all[j].name);

        let isMatch = false;
        if (threshold === 'strict') {
          // Only near-identical names
          isMatch = normI === normJ;
        } else if (threshold === 'moderate') {
          // Same core words, or one contains the other
          isMatch = coreI === coreJ || normI.includes(normJ) || normJ.includes(normI);
        } else {
          // Loose: share majority of core words
          const wordsI = coreI.split(' ');
          const wordsJ = coreJ.split(' ');
          const shared = wordsI.filter(w => wordsJ.includes(w)).length;
          const maxLen = Math.max(wordsI.length, wordsJ.length);
          isMatch = maxLen > 0 && shared / maxLen >= 0.5;
        }

        if (isMatch) {
          group.push(all[j]);
          used.add(all[j].id);
        }
      }

      if (group.length > 1) {
        used.add(all[i].id);
        groups.push(group);
      }
    }

    if (!groups.length) return { success: true, message: 'No duplicate ingredients found.' };

    const lines = groups.map((group, idx) => {
      const items = group.map(g => {
        const usage = usageMap[g.id] || 0;
        return `  - "${g.name}" (ID:${g.id}, ${g.base_unit || 'no unit'}, cost:${g.unit_cost || 0}, used in ${usage} dish${usage !== 1 ? 'es' : ''})`;
      });
      return `Group ${idx + 1}:\n${items.join('\n')}`;
    });

    return {
      success: true,
      message: `Found ${groups.length} group${groups.length !== 1 ? 's' : ''} of potential duplicates:\n\n${lines.join('\n\n')}\n\nTo merge, use merge_ingredients with the source (to remove) and target (to keep) ingredient IDs.`,
    };
  },

  merge_ingredients(input, opts) {
    const db = getDb();

    // Resolve ingredient by name: exact match first, then LIKE fallback (prefer shorter names)
    function resolveByName(name) {
      // Exact case-insensitive match first
      let ing = db.prepare("SELECT id, name FROM ingredients WHERE LOWER(name) = LOWER(?)").get(name);
      if (ing) return ing;
      // LIKE fallback — prefer shorter names (more likely the canonical one)
      ing = db.prepare("SELECT id, name FROM ingredients WHERE name LIKE ? ORDER BY LENGTH(name) ASC LIMIT 1").get(`%${name}%`);
      return ing || null;
    }

    // Resolve source
    let sourceId = input.source_id;
    let sourceName = input.source_name;
    if (!sourceId && sourceName) {
      const ing = resolveByName(sourceName);
      if (ing) { sourceId = ing.id; sourceName = ing.name; }
    }
    if (sourceId && !sourceName) {
      const ing = db.prepare('SELECT name FROM ingredients WHERE id = ?').get(sourceId);
      if (ing) sourceName = ing.name;
    }
    if (!sourceId) return { success: false, description: 'Source ingredient not found', message: `Could not find source ingredient "${sourceName || input.source_id}". It may have already been merged or deleted. Skip this pair and continue with the next one.` };

    // Resolve target — exclude source to prevent same-ingredient matches
    let targetId = input.target_id;
    let targetName = input.target_name;
    if (!targetId && targetName) {
      // Exact match first, excluding source
      let ing = db.prepare("SELECT id, name FROM ingredients WHERE LOWER(name) = LOWER(?) AND id != ?").get(targetName, sourceId);
      if (!ing) {
        ing = db.prepare("SELECT id, name FROM ingredients WHERE name LIKE ? AND id != ? ORDER BY LENGTH(name) ASC LIMIT 1").get(`%${targetName}%`, sourceId);
      }
      if (ing) { targetId = ing.id; targetName = ing.name; }
    }
    if (targetId && !targetName) {
      const ing = db.prepare('SELECT name FROM ingredients WHERE id = ?').get(targetId);
      if (ing) targetName = ing.name;
    }
    if (!targetId) return { success: false, description: 'Target ingredient not found', message: `Could not find target ingredient "${targetName || input.target_id}". It may have already been merged or deleted. Skip this pair and continue with the next one.` };

    if (sourceId === targetId) return { success: false, description: 'Same ingredient', message: `Source and target resolved to the same ingredient (ID ${sourceId}: "${sourceName}"). Skip this pair and continue with the next one.` };

    // Count affected recipes
    const affectedDishes = db.prepare('SELECT COUNT(*) as cnt FROM dish_ingredients WHERE ingredient_id = ?').get(sourceId).cnt;

    if (opts.preview) {
      return {
        description: `Merge "${sourceName}" → "${targetName}" (${affectedDishes} recipe${affectedDishes !== 1 ? 's' : ''} affected)`,
        message: `I'll merge "${sourceName}" into "${targetName}". ${affectedDishes} dish recipe${affectedDishes !== 1 ? 's' : ''} will be updated to use "${targetName}" instead. "${sourceName}" will be deleted.`,
      };
    }

    // Save snapshot for undo
    const sourceData = db.prepare('SELECT * FROM ingredients WHERE id = ?').get(sourceId);
    const affectedRows = db.prepare('SELECT * FROM dish_ingredients WHERE ingredient_id = ?').all(sourceId);
    const undoId = saveSnapshot('ingredient', sourceId, 'delete', {
      ingredient: sourceData,
      dish_ingredients: affectedRows,
    });

    // Reassign dish_ingredients from source to target
    // Handle UNIQUE constraint: if a dish already has the target ingredient, keep the existing one and remove the source entry
    const dishesWithTarget = new Set(
      db.prepare('SELECT dish_id FROM dish_ingredients WHERE ingredient_id = ?').all(targetId).map(r => r.dish_id)
    );

    for (const row of affectedRows) {
      if (dishesWithTarget.has(row.dish_id)) {
        // Dish already has target ingredient — just remove the source entry
        db.prepare('DELETE FROM dish_ingredients WHERE dish_id = ? AND ingredient_id = ?').run(row.dish_id, sourceId);
      } else {
        // Update to point to target
        db.prepare('UPDATE dish_ingredients SET ingredient_id = ? WHERE dish_id = ? AND ingredient_id = ?').run(targetId, row.dish_id, sourceId);
      }
    }

    // Delete the source ingredient
    db.prepare('DELETE FROM ingredients WHERE id = ?').run(sourceId);

    if (opts.broadcast) {
      opts.broadcast('ingredient_updated', { id: targetId });
    }

    return {
      success: true,
      message: `Merged "${sourceName}" into "${targetName}". ${affectedDishes} recipe${affectedDishes !== 1 ? 's' : ''} updated.`,
      undoId,
      entityType: 'ingredient',
      entityId: targetId,
    };
  },

  delete_ingredient(input, opts) {
    const db = getDb();
    const resolved = resolveIngredient(db, input);
    if (!resolved) return { success: false, description: 'Ingredient not found', message: 'Could not find that ingredient. It may have already been deleted. Skip and continue.' };
    const { ingredientId, ingredientName } = resolved;

    const usage = db.prepare('SELECT COUNT(*) as cnt FROM dish_ingredients WHERE ingredient_id = ?').get(ingredientId).cnt;

    if (usage > 0) {
      return {
        description: `"${ingredientName}" is used in ${usage} dish${usage !== 1 ? 'es' : ''}`,
        message: `Cannot delete "${ingredientName}" — it's used in ${usage} dish recipe${usage !== 1 ? 's' : ''}. Use merge_ingredients to consolidate it with another ingredient instead.`,
      };
    }

    if (opts.preview) {
      return {
        description: `Delete ingredient: "${ingredientName}"`,
        message: `I'll delete "${ingredientName}" from the ingredient list. It's not used in any recipes.`,
      };
    }

    const current = db.prepare('SELECT * FROM ingredients WHERE id = ?').get(ingredientId);
    const undoId = saveSnapshot('ingredient', ingredientId, 'delete', current);

    db.prepare('DELETE FROM ingredients WHERE id = ?').run(ingredientId);

    return {
      success: true,
      message: `Ingredient "${ingredientName}" deleted.`,
      undoId,
      entityType: 'ingredient',
      entityId: ingredientId,
    };
  },
};

// ─── Helper Functions ─────────────────────────────────────────────

function resolveDish(db, input) {
  let dishId = input.dish_id;
  let dishName = input.dish_name;
  if (!dishId && dishName) {
    const dish = db.prepare("SELECT id, name FROM dishes WHERE name LIKE ? AND deleted_at IS NULL LIMIT 1").get(`%${dishName}%`);
    if (dish) { dishId = dish.id; dishName = dish.name; }
  }
  if (dishId && !dishName) {
    const dish = db.prepare('SELECT name FROM dishes WHERE id = ? AND deleted_at IS NULL').get(dishId);
    if (dish) dishName = dish.name;
  }
  if (!dishId) return null;
  return { dishId, dishName };
}

function resolveMenu(db, input) {
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
  if (!menuId) return null;
  return { menuId, menuName };
}

function resolveIngredient(db, input) {
  let ingredientId = input.ingredient_id;
  let ingredientName = input.ingredient_name;
  if (!ingredientId && ingredientName) {
    const ing = db.prepare("SELECT id, name FROM ingredients WHERE name LIKE ? LIMIT 1").get(`%${ingredientName}%`);
    if (ing) { ingredientId = ing.id; ingredientName = ing.name; }
  }
  if (ingredientId && !ingredientName) {
    const ing = db.prepare('SELECT name FROM ingredients WHERE id = ?').get(ingredientId);
    if (ing) ingredientName = ing.name;
  }
  if (!ingredientId) return null;
  return { ingredientId, ingredientName };
}

function getNextMonday() {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function getWeekEnd(weekStart) {
  const d = new Date(weekStart + 'T00:00:00');
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}

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
