'use strict';

const { extractTiming, extractPrepTasks } = require('../services/prepTaskGenerator');

// ─── extractTiming ────────────────────────────────────────────────────────────

describe('extractTiming', () => {
  // day_before bucket
  test('returns day_before for overnight phrasing', () => {
    expect(extractTiming('Marinate overnight in the fridge')).toBe('day_before');
    expect(extractTiming('Brine the duck the night before service')).toBe('day_before');
    expect(extractTiming('Prepare the stock 24h in advance')).toBe('day_before');
    expect(extractTiming('Make the dough day before service')).toBe('day_before');
  });

  // morning_of bucket
  test('returns morning_of for same-day / morning phrasing', () => {
    expect(extractTiming('Reduce the sauce in the morning')).toBe('morning_of');
    expect(extractTiming('Prep vegetables same day for best freshness')).toBe('morning_of');
    expect(extractTiming('Allow 4-6h for the fermentation')).toBe('morning_of');
    expect(extractTiming('Make the hollandaise half day ahead')).toBe('morning_of');
    expect(extractTiming('Prepare 3 hours ahead')).toBe('morning_of');
  });

  // 1_2_hours_before bucket
  test('returns 1_2_hours_before for 1-2 hour phrasing', () => {
    expect(extractTiming('Bring to room temperature 1h before service')).toBe('1_2_hours_before');
    expect(extractTiming('Season and rest 2 hours before plating')).toBe('1_2_hours_before');
    expect(extractTiming('Rest the meat for an hour before')).toBe('1_2_hours_before');
  });

  // last_minute bucket
  test('returns last_minute for 30 min / just before phrasing', () => {
    expect(extractTiming('Dress the salad 30 min before service')).toBe('last_minute');
    expect(extractTiming('Finish the sauce just before plating')).toBe('last_minute');
    expect(extractTiming('Add butter right before service')).toBe('last_minute');
    expect(extractTiming('This dish is à la minute')).toBe('last_minute');
    expect(extractTiming('Last minute garnish with micro herbs')).toBe('last_minute');
  });

  // during_service default
  test('falls back to during_service when no timing keyword is found', () => {
    expect(extractTiming('Season generously with fleur de sel')).toBe('during_service');
    expect(extractTiming('Garnish with fresh herbs')).toBe('during_service');
    expect(extractTiming('Check seasoning before sending')).toBe('during_service');
    expect(extractTiming('')).toBe('during_service');
  });

  // Case-insensitivity
  test('is case-insensitive', () => {
    expect(extractTiming('OVERNIGHT cure required')).toBe('day_before');
    expect(extractTiming('MORNING prep list')).toBe('morning_of');
  });
});

// ─── extractPrepTasks ─────────────────────────────────────────────────────────

describe('extractPrepTasks', () => {
  test('returns empty array for empty or whitespace-only notes', () => {
    expect(extractPrepTasks('', 'Duck Confit')).toEqual([]);
    expect(extractPrepTasks('   ', 'Duck Confit')).toEqual([]);
    expect(extractPrepTasks(null, 'Duck Confit')).toEqual([]);
    expect(extractPrepTasks(undefined, 'Duck Confit')).toEqual([]);
  });

  test('splits on full stops', () => {
    const notes = 'Season the duck. Chill overnight. Render the fat.';
    const tasks = extractPrepTasks(notes, 'Duck Confit');
    expect(tasks).toHaveLength(3);
    expect(tasks[0].task).toBe('Season the duck');
    expect(tasks[1].task).toBe('Chill overnight');
    expect(tasks[2].task).toBe('Render the fat');
  });

  test('splits on newlines', () => {
    const notes = 'Reduce the sauce\nSeason to taste\nGarnish with herbs';
    const tasks = extractPrepTasks(notes, 'Risotto');
    expect(tasks).toHaveLength(3);
  });

  test('splits on semicolons', () => {
    // all three fragments must be >= 8 chars to pass the length filter
    const notes = 'Blanch the vegetables; refresh in ice water; drain well and set aside';
    const tasks = extractPrepTasks(notes, 'Greens');
    expect(tasks).toHaveLength(3);
  });

  test('filters out fragments shorter than 8 characters', () => {
    // "ok" and "yes" are < 8 chars and should be dropped
    const notes = 'ok. yes. Marinate the chicken overnight in buttermilk.';
    const tasks = extractPrepTasks(notes, 'Fried Chicken');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].task).toBe('Marinate the chicken overnight in buttermilk');
  });

  test('attaches the dish name to every task', () => {
    const tasks = extractPrepTasks('Season and rest the meat.', 'Lamb Rack');
    expect(tasks[0].dish).toBe('Lamb Rack');
  });

  test('sets source to chefs_notes for every task', () => {
    const tasks = extractPrepTasks('Blanch and refresh the greens.', 'Salad');
    expect(tasks[0].source).toBe('chefs_notes');
  });

  test('assigns the correct timing bucket via extractTiming', () => {
    const notes = 'Marinate overnight. Season just before service. Garnish with herbs.';
    const tasks = extractPrepTasks(notes, 'Beef');
    expect(tasks[0].timing).toBe('day_before');      // "overnight"
    expect(tasks[1].timing).toBe('last_minute');     // "just before service"
    expect(tasks[2].timing).toBe('during_service'); // no keyword
  });

  test('includes ALL sentences regardless of whether they start with a cooking verb', () => {
    // Previously, a VERB_PATTERN gate would have dropped these
    const notes = [
      'Let the sauce reduce fully.',     // starts with "Let"
      'Allow to rest for 30 minutes.',   // starts with "Allow"
      'The stock needs to be made ahead.',// starts with "The"
      'Cover with cling film.',          // starts with "Cover"
    ].join(' ');

    const tasks = extractPrepTasks(notes, 'Sauce');
    expect(tasks).toHaveLength(4);
  });

  test('trims whitespace from each sentence', () => {
    const notes = '  Season generously .  Serve immediately  .';
    const tasks = extractPrepTasks(notes, 'Steak');
    expect(tasks[0].task).toBe('Season generously');
    expect(tasks[1].task).toBe('Serve immediately');
  });

  test('handles multi-delimiter notes correctly', () => {
    const notes = 'Prep the base\nAdd seasoning; taste. Finish with butter.';
    const tasks = extractPrepTasks(notes, 'Sauce');
    // 4 segments after splitting on \n, ;, and .
    expect(tasks.length).toBeGreaterThanOrEqual(3);
    tasks.forEach(t => expect(t.task.length).toBeGreaterThanOrEqual(8));
  });
});
