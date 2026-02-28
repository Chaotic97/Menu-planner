'use strict';

const { buildPrepTaskRows, buildWeeklyTaskRows, addDays, getDateForDay } = require('../services/taskGenerator');

// Mock getDb for buildPrepTaskRows and buildWeeklyTaskRows
const mockMenuSchedule = { schedule_days: '[]' };
const mockDishDays = [];
jest.mock('../db/database', () => ({
  getDb: () => ({
    prepare: (sql) => ({
      get: () => {
        if (sql.includes('schedule_days')) return mockMenuSchedule;
        return { id: 42 };
      },
      all: () => mockDishDays,
    }),
  }),
}));

describe('buildPrepTaskRows', () => {
  const prepResult = {
    task_groups: [
      {
        timing: 'during_service',
        label: 'During Service',
        tasks: [
          { task: 'Pasta Carbonara', dish: 'Pasta Carbonara', timing: 'during_service', source: 'dish' },
          { task: 'Caesar Salad', dish: 'Caesar Salad', timing: 'during_service', source: 'dish' },
        ],
      },
    ],
  };

  test('transforms prep task groups into task rows (one per dish)', () => {
    const rows = buildPrepTaskRows(prepResult, 1);
    expect(rows).toHaveLength(2);
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
    for (const row of rows) {
      expect(row.timing_bucket).toBe('during_service');
    }
  });

  test('uses dish name as title', () => {
    const rows = buildPrepTaskRows(prepResult, 1);
    expect(rows[0].title).toBe('Pasta Carbonara');
    expect(rows[1].title).toBe('Caesar Salad');
  });

  test('uses dish name as description', () => {
    const rows = buildPrepTaskRows(prepResult, 1);
    expect(rows[0].description).toBe('Pasta Carbonara');
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

describe('addDays', () => {
  test('adds positive days', () => {
    expect(addDays('2026-03-02', 1)).toBe('2026-03-03');
    expect(addDays('2026-03-02', 7)).toBe('2026-03-09');
  });

  test('adds negative days', () => {
    expect(addDays('2026-03-05', -1)).toBe('2026-03-04');
  });

  test('handles month boundary', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  test('handles zero offset', () => {
    expect(addDays('2026-03-15', 0)).toBe('2026-03-15');
  });
});

describe('getDateForDay', () => {
  // 2026-03-02 is a Monday
  const weekStart = '2026-03-02';

  test('Monday (day 1) is the week start', () => {
    expect(getDateForDay(weekStart, 1)).toBe('2026-03-02');
  });

  test('Wednesday (day 3) is +2', () => {
    expect(getDateForDay(weekStart, 3)).toBe('2026-03-04');
  });

  test('Friday (day 5) is +4', () => {
    expect(getDateForDay(weekStart, 5)).toBe('2026-03-06');
  });

  test('Sunday (day 0) is +6', () => {
    expect(getDateForDay(weekStart, 0)).toBe('2026-03-08');
  });

  test('Saturday (day 6) is +5', () => {
    expect(getDateForDay(weekStart, 6)).toBe('2026-03-07');
  });
});

describe('buildWeeklyTaskRows', () => {
  const prepResult = {
    task_groups: [
      {
        timing: 'during_service',
        label: 'During Service',
        tasks: [
          { task: 'Grilled Lamb', dish: 'Grilled Lamb', timing: 'during_service', source: 'dish' },
          { task: 'Pasta Special', dish: 'Pasta Special', timing: 'during_service', source: 'dish' },
        ],
      },
    ],
  };

  beforeEach(() => {
    // Reset mock to Wed-Sun schedule (days 3,4,5,6,0)
    mockMenuSchedule.schedule_days = JSON.stringify([3, 4, 5, 6, 0]);
    mockDishDays.length = 0;
    mockDishDays.push(
      { dish_id: 42, active_days: null }, // Grilled Lamb — all days
      { dish_id: 42, active_days: null }, // Pasta Special — all days
    );
  });

  test('assigns due_date based on timing bucket and first service day', () => {
    // Week of 2026-03-02 (Monday), schedule Wed-Sun
    // First service day = Wed 2026-03-04
    // during_service offset = 0, so due_date = Wed 2026-03-04
    const rows = buildWeeklyTaskRows(prepResult, 1, '2026-03-02');

    const lamb = rows.find(r => r.title === 'Grilled Lamb');
    expect(lamb.due_date).toBe('2026-03-04'); // during_service Wed = Wed

    const pasta = rows.find(r => r.title === 'Pasta Special');
    expect(pasta.due_date).toBe('2026-03-04'); // during_service Wed = Wed
  });

  test('all rows have type prep and source auto', () => {
    const rows = buildWeeklyTaskRows(prepResult, 1, '2026-03-02');
    for (const r of rows) {
      expect(r.type).toBe('prep');
      expect(r.source).toBe('auto');
    }
  });

  test('falls back to non-weekly when schedule_days is empty', () => {
    mockMenuSchedule.schedule_days = '[]';
    const rows = buildWeeklyTaskRows(prepResult, 1, '2026-03-02');
    // Should fall back to buildPrepTaskRows which has no due_date
    for (const r of rows) {
      expect(r.due_date).toBeUndefined();
    }
  });
});
