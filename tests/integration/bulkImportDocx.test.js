'use strict';

jest.mock('../../middleware/rateLimit', () => ({
  createRateLimit: () => (_req, _res, next) => next(),
}));

jest.mock('../../services/docxImporter', () => ({
  importDocx: jest.fn(),
}));

const { importDocx } = require('../../services/docxImporter');
const { createTestApp } = require('../helpers/setupTestApp');
const { loginAgent } = require('../helpers/auth');

let app, broadcasts, cleanup, agent;

beforeAll(async () => {
  const ctx = await createTestApp();
  app = ctx.app;
  broadcasts = ctx.broadcasts;
  cleanup = ctx.cleanup;
  agent = await loginAgent(app);
});

afterAll(() => cleanup());
afterEach(() => jest.clearAllMocks());

// ─── BULK IMPORT DOCX ───────────────────────────────────────────────────────

describe('POST /api/dishes/bulk-import-docx', () => {
  const fakeRecipe = (name = 'Test Dish') => ({
    name,
    description: '',
    category: 'main',
    ingredients: [
      { name: 'Butter', quantity: 100, unit: 'g' },
    ],
    instructions: 'Melt butter.',
    directions: [
      { type: 'step', text: 'Melt butter.' },
    ],
  });

  test('imports multiple .docx files and creates dishes', async () => {
    importDocx
      .mockResolvedValueOnce(fakeRecipe('Dish One'))
      .mockResolvedValueOnce(fakeRecipe('Dish Two'));

    const res = await agent
      .post('/api/dishes/bulk-import-docx')
      .attach('files', Buffer.from('fake-docx-1'), 'recipe1.docx')
      .attach('files', Buffer.from('fake-docx-2'), 'recipe2.docx')
      .expect(201);

    expect(res.body.created).toHaveLength(2);
    expect(res.body.errors).toHaveLength(0);
    expect(res.body.created[0].name).toBe('Dish One');
    expect(res.body.created[1].name).toBe('Dish Two');
    expect(typeof res.body.created[0].id).toBe('number');
  });

  test('created dishes are retrievable via GET', async () => {
    importDocx.mockResolvedValueOnce(fakeRecipe('Retrievable Dish'));

    const res = await agent
      .post('/api/dishes/bulk-import-docx')
      .attach('files', Buffer.from('fake'), 'dish.docx')
      .expect(201);

    const dish = await agent
      .get(`/api/dishes/${res.body.created[0].id}`)
      .expect(200);

    expect(dish.body.name).toBe('Retrievable Dish');
    expect(dish.body.category).toBe('main');
    const ingredients = dish.body.ingredients.filter(i => i.row_type === 'ingredient');
    expect(ingredients).toHaveLength(1);
    expect(ingredients[0].ingredient_name).toBe('Butter');
  });

  test('saves directions from imported recipes', async () => {
    importDocx.mockResolvedValueOnce(fakeRecipe('Directions Dish'));

    const res = await agent
      .post('/api/dishes/bulk-import-docx')
      .attach('files', Buffer.from('fake'), 'dir.docx')
      .expect(201);

    const dish = await agent
      .get(`/api/dishes/${res.body.created[0].id}`)
      .expect(200);

    expect(dish.body.directions).toHaveLength(1);
    expect(dish.body.directions[0].text).toBe('Melt butter.');
  });

  test('reports errors for files that fail to parse', async () => {
    importDocx
      .mockResolvedValueOnce(fakeRecipe('Good Dish'))
      .mockRejectedValueOnce(new Error('Could not extract any text from the .docx file.'));

    const res = await agent
      .post('/api/dishes/bulk-import-docx')
      .attach('files', Buffer.from('good'), 'good.docx')
      .attach('files', Buffer.from('bad'), 'bad.docx')
      .expect(201);

    expect(res.body.created).toHaveLength(1);
    expect(res.body.created[0].name).toBe('Good Dish');
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0].filename).toBe('bad.docx');
    expect(res.body.errors[0].error).toMatch(/extract/i);
  });

  test('returns 422 when all files fail', async () => {
    importDocx
      .mockRejectedValueOnce(new Error('Parse error 1'))
      .mockRejectedValueOnce(new Error('Parse error 2'));

    const res = await agent
      .post('/api/dishes/bulk-import-docx')
      .attach('files', Buffer.from('bad1'), 'bad1.docx')
      .attach('files', Buffer.from('bad2'), 'bad2.docx')
      .expect(422);

    expect(res.body.created).toHaveLength(0);
    expect(res.body.errors).toHaveLength(2);
  });

  test('returns 400 when no files are attached', async () => {
    const res = await agent
      .post('/api/dishes/bulk-import-docx')
      .expect(400);

    expect(res.body.error).toMatch(/file/i);
  });

  test('broadcasts dish_created for each imported dish', async () => {
    importDocx
      .mockResolvedValueOnce(fakeRecipe('Broadcast A'))
      .mockResolvedValueOnce(fakeRecipe('Broadcast B'));

    const before = broadcasts.length;

    await agent
      .post('/api/dishes/bulk-import-docx')
      .attach('files', Buffer.from('a'), 'a.docx')
      .attach('files', Buffer.from('b'), 'b.docx')
      .expect(201);

    const newBroadcasts = broadcasts.slice(before);
    const dishCreated = newBroadcasts.filter(b => b.type === 'dish_created');
    expect(dishCreated).toHaveLength(2);
  });

  test('imports single file', async () => {
    importDocx.mockResolvedValueOnce(fakeRecipe('Solo Dish'));

    const res = await agent
      .post('/api/dishes/bulk-import-docx')
      .attach('files', Buffer.from('single'), 'solo.docx')
      .expect(201);

    expect(res.body.created).toHaveLength(1);
    expect(res.body.created[0].name).toBe('Solo Dish');
    expect(res.body.errors).toHaveLength(0);
  });

  test('includes filename in created results', async () => {
    importDocx.mockResolvedValueOnce(fakeRecipe('Named File'));

    const res = await agent
      .post('/api/dishes/bulk-import-docx')
      .attach('files', Buffer.from('data'), 'my-recipe.docx')
      .expect(201);

    expect(res.body.created[0].filename).toBe('my-recipe.docx');
  });

  test('detects allergens for imported dishes', async () => {
    importDocx.mockResolvedValueOnce({
      name: 'Shrimp Pasta',
      description: '',
      category: 'main',
      ingredients: [
        { name: 'Shrimp', quantity: 200, unit: 'g' },
        { name: 'Pasta', quantity: 300, unit: 'g' },
      ],
      instructions: 'Cook pasta. Add shrimp.',
      directions: [{ type: 'step', text: 'Cook pasta. Add shrimp.' }],
    });

    const res = await agent
      .post('/api/dishes/bulk-import-docx')
      .attach('files', Buffer.from('shrimp'), 'shrimp.docx')
      .expect(201);

    const dish = await agent
      .get(`/api/dishes/${res.body.created[0].id}`)
      .expect(200);

    expect(dish.body.allergens.some(a => a.allergen === 'crustaceans')).toBe(true);
  });
});
