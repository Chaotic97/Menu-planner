'use strict';

const { buildPrepTaskRows } = require('../services/taskGenerator');

// Mock getDb for buildPrepTaskRows (it looks up dish IDs)
jest.mock('../db/database', () => ({
  getDb: () => ({
    prepare: () => ({
      get: () => ({ id: 42 }),
    }),
  }),
}));

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
