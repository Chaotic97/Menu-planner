/**
 * Seed sample dishes — safe to run multiple times (skips if dishes already exist)
 * Usage: node db/seed-sample.js
 */

const { getDb } = require('./database');

const DISHES = [
  {
    name: 'Pan-Seared Salmon',
    category: 'main',
    description: 'Crispy-skinned salmon fillet with a lemon butter and caper sauce, finished with fresh dill.',
    suggested_price: 26.00,
    chefs_notes: 'Pat the salmon dry before searing — moisture is the enemy of a crispy skin. Start skin-side down on high heat, press gently for the first 30 seconds. Baste with butter and garlic in the final minute.',
    allergens: ['fish', 'milk'],
    ingredients: [
      { name: 'Salmon fillet (skin-on)', qty: 180, unit: 'g',    prep: 'pin-boned, skin on' },
      { name: 'Unsalted butter',         qty: 30,  unit: 'g',    prep: '' },
      { name: 'Garlic',                  qty: 2,   unit: 'each', prep: 'crushed' },
      { name: 'Lemon',                   qty: 1,   unit: 'each', prep: 'zested and juiced' },
      { name: 'Capers',                  qty: 20,  unit: 'g',    prep: 'rinsed' },
      { name: 'Fresh dill',              qty: 3,   unit: 'sprig', prep: '' },
      { name: 'Olive oil',               qty: 15,  unit: 'ml',   prep: '' },
      { name: 'Salt',                    qty: 1,   unit: 'pinch', prep: '' },
      { name: 'Black pepper',            qty: 1,   unit: 'pinch', prep: 'cracked' },
    ],
  },
  {
    name: 'Beef Bourguignon',
    category: 'main',
    description: 'Slow-braised beef chuck in a rich Burgundy wine sauce with lardons, pearl onions, and mushrooms.',
    suggested_price: 28.00,
    chefs_notes: 'Brown the beef in small batches — do not crowd the pan. Deglaze properly for depth of flavour. Best made the day before and reheated; the sauce tightens beautifully overnight.',
    allergens: ['gluten', 'sulphites', 'milk'],
    ingredients: [
      { name: 'Beef chuck',            qty: 800, unit: 'g',    prep: 'cut into 5cm cubes, patted dry' },
      { name: 'Burgundy red wine',     qty: 500, unit: 'ml',   prep: '' },
      { name: 'Plain flour',           qty: 30,  unit: 'g',    prep: 'for dredging' },
      { name: 'Lardons',               qty: 150, unit: 'g',    prep: '' },
      { name: 'Pearl onions',          qty: 200, unit: 'g',    prep: 'blanched and peeled' },
      { name: 'Chestnut mushrooms',    qty: 200, unit: 'g',    prep: 'quartered' },
      { name: 'Carrots',               qty: 2,   unit: 'each', prep: 'cut into 2cm rounds' },
      { name: 'Garlic',                qty: 4,   unit: 'each', prep: 'crushed' },
      { name: 'Tomato paste',          qty: 30,  unit: 'g',    prep: '' },
      { name: 'Beef stock',            qty: 300, unit: 'ml',   prep: '' },
      { name: 'Thyme',                 qty: 4,   unit: 'sprig', prep: '' },
      { name: 'Bay leaf',              qty: 2,   unit: 'each', prep: '' },
      { name: 'Unsalted butter',       qty: 20,  unit: 'g',    prep: 'for finishing' },
      { name: 'Flat-leaf parsley',     qty: 5,   unit: 'g',    prep: 'chopped, to serve' },
    ],
  },
  {
    name: 'Chocolate Fondant',
    category: 'dessert',
    description: 'Warm dark chocolate fondant with a molten centre, served with vanilla bean ice cream.',
    suggested_price: 10.00,
    chefs_notes: 'Butter and cocoa the moulds meticulously — any sticking will ruin the turn-out. Rest batter in the fridge for at least 1 hour (can be made 24hrs ahead). 12 minutes at 180°C fan for a perfectly liquid centre; test one before service.',
    allergens: ['eggs', 'milk', 'gluten'],
    ingredients: [
      { name: '70% dark chocolate', qty: 120, unit: 'g',    prep: 'finely chopped' },
      { name: 'Unsalted butter',    qty: 120, unit: 'g',    prep: 'plus extra for moulds' },
      { name: 'Eggs',               qty: 2,   unit: 'each', prep: '' },
      { name: 'Egg yolks',          qty: 2,   unit: 'each', prep: '' },
      { name: 'Caster sugar',       qty: 60,  unit: 'g',    prep: '' },
      { name: 'Plain flour',        qty: 30,  unit: 'g',    prep: 'plus extra for moulds' },
      { name: 'Cocoa powder',       qty: 10,  unit: 'g',    prep: 'for dusting moulds' },
      { name: 'Vanilla extract',    qty: 1,   unit: 'tsp',  prep: '' },
      { name: 'Sea salt flakes',    qty: 1,   unit: 'pinch', prep: 'to finish' },
    ],
  },
  {
    name: 'Burrata with Heritage Tomatoes',
    category: 'starter',
    description: 'Hand-stretched burrata, heritage tomatoes, aged balsamic, and cold-pressed extra-virgin olive oil.',
    suggested_price: 14.00,
    chefs_notes: 'Remove burrata from the fridge 20 minutes before plating — it should be room temperature. Season the tomatoes with flaky salt 5 minutes ahead to draw out their juices.',
    allergens: ['milk'],
    ingredients: [
      { name: 'Burrata',               qty: 1,   unit: 'each', prep: 'room temperature' },
      { name: 'Heritage tomatoes',     qty: 250, unit: 'g',    prep: 'mixed colours, torn or sliced' },
      { name: 'Extra-virgin olive oil',qty: 30,  unit: 'ml',   prep: '' },
      { name: 'Aged balsamic vinegar', qty: 10,  unit: 'ml',   prep: '' },
      { name: 'Fresh basil',           qty: 5,   unit: 'g',    prep: 'torn' },
      { name: 'Flaky sea salt',        qty: 1,   unit: 'pinch', prep: '' },
      { name: 'Black pepper',          qty: 1,   unit: 'pinch', prep: 'cracked' },
    ],
  },
  {
    name: 'Wild Mushroom Risotto',
    category: 'main',
    description: 'Arborio risotto with a mix of wild mushrooms, finished with aged Parmesan and truffle oil.',
    suggested_price: 22.00,
    chefs_notes: 'Never stop stirring — constant agitation releases the starch. Add stock one ladle at a time. Rest the risotto 1 minute before plating; it will continue to cook from residual heat. Finish with cold butter off the heat for a glossy mantecatura.',
    allergens: ['milk', 'sulphites'],
    ingredients: [
      { name: 'Arborio rice',           qty: 160, unit: 'g',    prep: '' },
      { name: 'Mixed wild mushrooms',   qty: 200, unit: 'g',    prep: 'cleaned and sliced' },
      { name: 'Dried porcini',          qty: 20,  unit: 'g',    prep: 'soaked in 100ml warm water, strained' },
      { name: 'Shallots',               qty: 2,   unit: 'each', prep: 'finely diced' },
      { name: 'Garlic',                 qty: 2,   unit: 'each', prep: 'minced' },
      { name: 'Dry white wine',         qty: 100, unit: 'ml',   prep: '' },
      { name: 'Vegetable stock',        qty: 800, unit: 'ml',   prep: 'kept hot on stove' },
      { name: 'Parmesan',               qty: 50,  unit: 'g',    prep: 'finely grated' },
      { name: 'Unsalted butter',        qty: 40,  unit: 'g',    prep: 'cold, cubed' },
      { name: 'Truffle oil',            qty: 10,  unit: 'ml',   prep: 'to finish' },
      { name: 'Thyme',                  qty: 3,   unit: 'sprig', prep: '' },
      { name: 'Flat-leaf parsley',      qty: 5,   unit: 'g',    prep: 'chopped' },
    ],
  },
];

async function main() {
  const db = await getDb();

  const existing = db.prepare('SELECT COUNT(*) as count FROM dishes WHERE deleted_at IS NULL').get();
  if (existing && existing.count > 0) {
    console.log(`Database already has ${existing.count} dish(es). Skipping sample seed.`);
    process.exit(0);
  }

  console.log('Inserting sample dishes...\n');

  for (const dish of DISHES) {
    // Insert dish
    const result = db.prepare(
      `INSERT INTO dishes (name, category, description, suggested_price, chefs_notes)
       VALUES (?, ?, ?, ?, ?)`
    ).run(dish.name, dish.category, dish.description, dish.suggested_price, dish.chefs_notes);

    const dishId = result.lastInsertRowid;
    if (!dishId) {
      console.warn(`  ✗ Failed to insert: ${dish.name}`);
      continue;
    }

    // Insert allergens
    for (const allergen of dish.allergens) {
      db.prepare(
        `INSERT OR IGNORE INTO dish_allergens (dish_id, allergen, source) VALUES (?, ?, 'manual')`
      ).run(dishId, allergen);
    }

    // Insert ingredients
    for (const ing of dish.ingredients) {
      let ingRow = db.prepare('SELECT id FROM ingredients WHERE LOWER(name) = LOWER(?)').get(ing.name);
      if (!ingRow) {
        const ingResult = db.prepare('INSERT INTO ingredients (name) VALUES (?)').run(ing.name);
        ingRow = { id: ingResult.lastInsertRowid };
      }
      db.prepare(
        `INSERT OR IGNORE INTO dish_ingredients (dish_id, ingredient_id, quantity, unit, prep_note)
         VALUES (?, ?, ?, ?, ?)`
      ).run(dishId, ingRow.id, ing.qty, ing.unit, ing.prep || '');
    }

    console.log(`  ✓ ${dish.name}  [${dish.category}]  £${dish.suggested_price.toFixed(2)}  — ${dish.ingredients.length} ingredients, allergens: ${dish.allergens.join(', ')}`);
  }

  console.log(`\n✓ ${DISHES.length} sample dishes inserted successfully.`);
  process.exit(0);
}

main().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
