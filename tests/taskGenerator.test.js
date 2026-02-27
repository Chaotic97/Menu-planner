'use strict';

const { buildShoppingTaskRows, buildPrepTaskRows } = require('../services/taskGenerator');

// Mock getDb for buildPrepTaskRows (it looks up dish IDs)
jest.mock('../db/database', () => ({
  getDb: () => ({
    prepare: () => ({
      get: () => ({ id: 42 }),
    }),
  }),
}));

describe('buildShoppingTaskRows', () => {
  const shoppingResult = {
    groups: [
      {
        category: 'produce',
        items: [
          { ingredient: 'Romaine', total_quantity: 600, unit: 'g', estimated_cost: 3.0, used_in: ['Caesar Salad (600g)'] },
          { ingredient: 'Tomatoes', total_quantity: 400, unit: 'g', estimated_cost: 2.0, used_in: ['Pasta (200g)', 'Salad (200g)'] },
        ],
      },
      {
        category: 'dairy',
        items: [
          { ingredient: 'Pecorino', total_quantity: 150, unit: 'g', estimated_cost: 6.0, used_in: ['Carbonara (100g)', 'Caesar (50g)'] },
        ],
      },
    ],
  };

  test('transforms shopping list groups into task rows', () => {
    const rows = buildShoppingTaskRows(shoppingResult, 1);
    expect(rows).toHaveLength(3);
  });

  test('sets type to shopping and source to auto', () => {
    const rows = buildShoppingTaskRows(shoppingResult, 1);
    for (const row of rows) {
      expect(row.type).toBe('shopping');
      expect(row.source).toBe('auto');
    }
  });

  test('preserves quantity, unit, and category', () => {
    const rows = buildShoppingTaskRows(shoppingResult, 1);
    const romaine = rows.find(r => r.title === 'Romaine');
    expect(romaine.quantity).toBe(600);
    expect(romaine.unit).toBe('g');
    expect(romaine.category).toBe('produce');
  });

  test('joins used_in array into description', () => {
    const rows = buildShoppingTaskRows(shoppingResult, 1);
    const tomatoes = rows.find(r => r.title === 'Tomatoes');
    expect(tomatoes.description).toBe('Pasta (200g), Salad (200g)');
  });

  test('sets menu_id on all rows', () => {
    const rows = buildShoppingTaskRows(shoppingResult, 5);
    for (const row of rows) {
      expect(row.menu_id).toBe(5);
    }
  });

  test('sets priority to medium by default', () => {
    const rows = buildShoppingTaskRows(shoppingResult, 1);
    for (const row of rows) {
      expect(row.priority).toBe('medium');
    }
  });

  test('handles empty groups', () => {
    const rows = buildShoppingTaskRows({ groups: [] }, 1);
    expect(rows).toHaveLength(0);
  });
});

describe('buildPrepTaskRows', () => {
  const prepResult = {
    task_groups: [
      {
        timing: 'day_before',
        label: 'Day Before Service',
        tasks: [
          { task: 'Dice and render guanciale', dish: 'Pasta Carbonara', timing: 'day_before', source: 'directions' },
        ],
      },
      {
        timing: 'during_service',
        label: 'During Service',
        tasks: [
          { task: 'Boil spaghetti in salted water', dish: 'Pasta Carbonara', timing: 'during_service', source: 'directions' },
          { task: 'Toss with dressing and croutons', dish: 'Caesar Salad', timing: 'during_service', source: 'directions' },
        ],
      },
    ],
  };

  test('transforms prep task groups into task rows', () => {
    const rows = buildPrepTaskRows(prepResult, 1);
    expect(rows).toHaveLength(3);
  });

  test('sets type to prep and source to auto', () => {
    const rows = buildPrepTaskRows(prepResult, 1);
    for (const row of rows) {
      expect(row.type).toBe('prep');
      expect(row.source).toBe('auto');
    }
  });

  test('preserves timing_bucket', () => {
    const rows = buildPrepTaskRows(prepResult, 1);
    const guanciale = rows.find(r => r.title.includes('guanciale'));
    expect(guanciale.timing_bucket).toBe('day_before');
  });

  test('uses dish name as description', () => {
    const rows = buildPrepTaskRows(prepResult, 1);
    const boil = rows.find(r => r.title.includes('Boil'));
    expect(boil.description).toBe('Pasta Carbonara');
  });

  test('looks up dish id via DB', () => {
    const rows = buildPrepTaskRows(prepResult, 1);
    for (const row of rows) {
      expect(row.source_dish_id).toBe(42);
    }
  });

  test('handles empty task_groups', () => {
    const rows = buildPrepTaskRows({ task_groups: [] }, 1);
    expect(rows).toHaveLength(0);
  });
});
