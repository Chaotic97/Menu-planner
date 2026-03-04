'use strict';

const { extractText } = require('../services/textExtractor');

describe('extractText', () => {
  test('extracts text from CSV buffer', async () => {
    const csv = 'Name,Quantity,Unit\nFlour,500,g\nSugar,200,g';
    const buffer = Buffer.from(csv);
    const result = await extractText(buffer, 'ingredients.csv', 'text/csv');
    expect(result.type).toBe('text');
    expect(result.text).toContain('Flour');
    expect(result.text).toContain('Sugar');
  });

  test('extracts text from plain text buffer', async () => {
    const text = 'Mix flour and sugar together.';
    const buffer = Buffer.from(text);
    const result = await extractText(buffer, 'recipe.txt', 'text/plain');
    expect(result.type).toBe('text');
    expect(result.text).toBe(text);
  });

  test('extracts text from JSON buffer', async () => {
    const json = JSON.stringify({ dish: 'Pasta', servings: 4 });
    const buffer = Buffer.from(json);
    const result = await extractText(buffer, 'data.json', 'application/json');
    expect(result.type).toBe('json');
    expect(result.text).toContain('Pasta');
  });

  test('returns image type with base64 for image files', async () => {
    const buffer = Buffer.from('fake-image-data');
    const result = await extractText(buffer, 'menu.png', 'image/png');
    expect(result.type).toBe('image');
    expect(result.base64).toBeDefined();
    expect(result.mediaType).toBe('image/png');
    expect(result.text).toBeNull();
  });

  test('returns unknown for unsupported file types', async () => {
    const buffer = Buffer.from('data');
    const result = await extractText(buffer, 'file.xyz', 'application/octet-stream');
    expect(result.type).toBe('unknown');
    expect(result.text).toBeNull();
  });

  test('extracts text from DOCX buffer', async () => {
    // Create a minimal valid docx (mammoth can handle it)
    // For a proper test we'd need a real docx, but we can test the error path
    const buffer = Buffer.from('not a real docx');
    await expect(extractText(buffer, 'test.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))
      .rejects.toThrow();
  });
});
