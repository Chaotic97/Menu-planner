'use strict';

const { parseMeezText, parseMeezIngredient, isSectionHeader } = require('../services/docxImporter');

// ─── isSectionHeader ─────────────────────────────────────────────────────────

describe('isSectionHeader', () => {
  test('recognises lines ending with colon', () => {
    expect(isSectionHeader('Filling:')).toBe(true);
    expect(isSectionHeader('Sauce mixture:')).toBe(true);
    expect(isSectionHeader('Slurry Mix:')).toBe(true);
  });

  test('rejects lines starting with a digit', () => {
    expect(isSectionHeader('12 lb Shrimp:')).toBe(false);
  });

  test('rejects lines without trailing colon', () => {
    expect(isSectionHeader('Filling')).toBe(false);
    expect(isSectionHeader('Prep Method')).toBe(false);
  });
});

// ─── parseMeezIngredient ─────────────────────────────────────────────────────

describe('parseMeezIngredient', () => {
  test('parses simple ingredient with lb unit', () => {
    const result = parseMeezIngredient('12 lb Ground Pork (Perishable)');
    expect(result.name).toBe('Ground Pork');
    expect(result.quantity).toBe(12);
    expect(result.unit).toBe('lb');
    expect(result.prep_note).toBe('Perishable');
  });

  test('parses ingredient with g unit and comma in name', () => {
    const result = parseMeezIngredient('200 g Ginger, minced (Robocouped)');
    expect(result.name).toBe('Ginger, minced');
    expect(result.quantity).toBe(200);
    expect(result.unit).toBe('g');
    expect(result.prep_note).toBe('Robocouped');
  });

  test('parses ingredient with multiple parenthetical notes', () => {
    const result = parseMeezIngredient('12 lb Shrimp 31/40 (25% Robocouped 75% hand minced)');
    expect(result.name).toBe('Shrimp 31/40');
    expect(result.quantity).toBe(12);
    expect(result.unit).toBe('lb');
    expect(result.prep_note).toBe('25% Robocouped 75% hand minced');
  });

  test('parses ingredient with nested parentheses in prep note', () => {
    const result = parseMeezIngredient('720 g Mushroom Stock ((Can sub water if no stock))');
    expect(result.name).toBe('Mushroom Stock');
    expect(result.quantity).toBe(720);
    expect(result.unit).toBe('g');
    expect(result.prep_note).toContain('Can sub water if no stock');
  });

  test('parses ingredient with no prep note', () => {
    const result = parseMeezIngredient('80 g Salt');
    expect(result.name).toBe('Salt');
    expect(result.quantity).toBe(80);
    expect(result.unit).toBe('g');
    expect(result.prep_note).toBe('');
  });

  test('parses ingredient with oz unit', () => {
    const result = parseMeezIngredient('8 oz Cream Cheese');
    expect(result.name).toBe('Cream Cheese');
    expect(result.quantity).toBe(8);
    expect(result.unit).toBe('oz');
  });

  test('parses ingredient with cup unit', () => {
    const result = parseMeezIngredient('2 cups All Purpose Flour');
    expect(result.name).toBe('All Purpose Flour');
    expect(result.quantity).toBe(2);
    expect(result.unit).toBe('cup');
  });

  test('parses decimal quantity', () => {
    const result = parseMeezIngredient('1.5 kg Chicken Thighs');
    expect(result.name).toBe('Chicken Thighs');
    expect(result.quantity).toBe(1.5);
    expect(result.unit).toBe('kg');
  });
});

// ─── parseMeezText ───────────────────────────────────────────────────────────

describe('parseMeezText', () => {
  const sampleText = `Siu Mai Filling
Filling:
12 lb Shrimp 31/40 (25% Robocouped 75% hand minced)
12 lb Ground Pork (Perishable)
200 g Ginger, minced (Robocouped)
400 g Scallions (Thinly chopped)
720 g Shiitake Mushrooms (Robocouped)
Sauce mixture:
600 g Sesame Oil
900 g Oyster Sauce
104 g Sugar
24 g Ground White Pepper
80 g Salt
Slurry Mix:
720 g Mushroom Stock ((Can sub water if no stock))
20 g Chicken Base
360 g Corn Starch
Prep Method
( (Mushroom stock is made from dehydrated mushrooms soaked in hot water w/weighted pan on top for at least 20 mins.) )
Sauce mixture:
In a bowl, combine sesame oil, oyster sauce, sugar, white pepper, and salt. Mix thoroughly and set aside.
Slurry mix:
In a separate bowl, create slurry by first mixing chicken base and mushroom stock. Once chicken base is dissolved, add corn starch and mix thoroughly. Set aside.
Filling:
Thaw shrimp in bags under cool water, or for a faster thaw, can open one bag at a time into cone strainer and run under cool water.`;

  test('extracts recipe name from first line', () => {
    const recipe = parseMeezText(sampleText);
    expect(recipe.name).toBe('Siu Mai Filling');
  });

  test('extracts section headers', () => {
    const recipe = parseMeezText(sampleText);
    const sections = recipe.ingredients.filter(i => i.section_header);
    expect(sections.map(s => s.section_header)).toEqual(['Filling', 'Sauce mixture', 'Slurry Mix']);
  });

  test('extracts all ingredients (not section headers)', () => {
    const recipe = parseMeezText(sampleText);
    const ingredients = recipe.ingredients.filter(i => !i.section_header);
    expect(ingredients.length).toBe(13);
  });

  test('first ingredient is Shrimp 31/40 with correct quantity', () => {
    const recipe = parseMeezText(sampleText);
    const ingredients = recipe.ingredients.filter(i => !i.section_header);
    expect(ingredients[0].name).toBe('Shrimp 31/40');
    expect(ingredients[0].quantity).toBe(12);
    expect(ingredients[0].unit).toBe('lb');
  });

  test('extracts instructions from after Prep Method', () => {
    const recipe = parseMeezText(sampleText);
    expect(recipe.instructions).toContain('Sauce mixture:');
    expect(recipe.instructions).toContain('combine sesame oil');
    expect(recipe.instructions).toContain('Slurry mix:');
    expect(recipe.instructions).toContain('Filling:');
    expect(recipe.instructions).toContain('Thaw shrimp');
  });

  test('guesses category from recipe name', () => {
    const recipe = parseMeezText(sampleText);
    expect(recipe.category).toBe('starter');
  });

  test('throws on empty text', () => {
    expect(() => parseMeezText('')).toThrow('empty');
    expect(() => parseMeezText('   \n  \n  ')).toThrow('empty');
  });

  test('handles recipe with no Prep Method section', () => {
    const text = `Simple Sauce
Base:
500 g Tomatoes
200 ml Olive Oil
10 g Salt`;

    const recipe = parseMeezText(text);
    expect(recipe.name).toBe('Simple Sauce');
    expect(recipe.ingredients.filter(i => !i.section_header).length).toBe(3);
    expect(recipe.instructions).toBe('');
    expect(recipe.category).toBe('sauce');
  });

  test('handles recipe with no section headers', () => {
    const text = `Quick Marinade
500 g Soy Sauce
200 g Rice Vinegar
50 g Sugar
Prep Method
Combine all ingredients and whisk.`;

    const recipe = parseMeezText(text);
    expect(recipe.name).toBe('Quick Marinade');
    const ings = recipe.ingredients.filter(i => !i.section_header);
    expect(ings.length).toBe(3);
    expect(recipe.instructions).toContain('Combine all');
  });
});
