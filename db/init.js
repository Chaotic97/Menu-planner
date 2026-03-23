const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/platestack';

async function init() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  console.log('Dropping existing tables...');
  // Drop all tables in reverse dependency order
  await pool.query(`
    DROP TABLE IF EXISTS ai_messages CASCADE;
    DROP TABLE IF EXISTS ai_conversations CASCADE;
    DROP TABLE IF EXISTS ai_usage CASCADE;
    DROP TABLE IF EXISTS ai_history CASCADE;
    DROP TABLE IF EXISTS chefsheets CASCADE;
    DROP TABLE IF EXISTS passkey_credentials CASCADE;
    DROP TABLE IF EXISTS service_notes CASCADE;
    DROP TABLE IF EXISTS tasks CASCADE;
    DROP TABLE IF EXISTS dish_service_directions CASCADE;
    DROP TABLE IF EXISTS dish_directions CASCADE;
    DROP TABLE IF EXISTS dish_components CASCADE;
    DROP TABLE IF EXISTS dish_section_headers CASCADE;
    DROP TABLE IF EXISTS dish_substitutions CASCADE;
    DROP TABLE IF EXISTS dish_tags CASCADE;
    DROP TABLE IF EXISTS tags CASCADE;
    DROP TABLE IF EXISTS weekly_specials CASCADE;
    DROP TABLE IF EXISTS menu_dishes CASCADE;
    DROP TABLE IF EXISTS menu_courses CASCADE;
    DROP TABLE IF EXISTS ingredient_allergens CASCADE;
    DROP TABLE IF EXISTS dish_allergens CASCADE;
    DROP TABLE IF EXISTS dish_ingredients CASCADE;
    DROP TABLE IF EXISTS allergen_keywords CASCADE;
    DROP TABLE IF EXISTS menus CASCADE;
    DROP TABLE IF EXISTS ingredients CASCADE;
    DROP TABLE IF EXISTS dishes CASCADE;
    DROP TABLE IF EXISTS settings CASCADE;
    DROP TABLE IF EXISTS schema_version CASCADE;
  `);

  console.log('Creating schema...');
  const schema = fs.readFileSync(path.join(__dirname, 'schema-pg.sql'), 'utf-8');
  await pool.query(schema);
  console.log('Schema created.');

  const seedPath = path.join(__dirname, 'seed-pg.sql');
  if (fs.existsSync(seedPath)) {
    const seed = fs.readFileSync(seedPath, 'utf-8');
    await pool.query(seed);
    console.log('Seed data inserted.');
  }

  await pool.end();
  console.log('Database initialized successfully.');
}

init().catch(err => {
  console.error('Init failed:', err);
  process.exit(1);
});
