#!/usr/bin/env node
/**
 * One-time migration: SQLite → PostgreSQL
 *
 * Prerequisites: npm install sql.js   (temporarily, for reading the old database)
 * Usage: DATABASE_URL=postgresql://... node scripts/migrate-sqlite-to-pg.js [path-to-sqlite.db]
 */

const initSqlJs = require('sql.js');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const SQLITE_PATH = process.argv[2] || path.join(__dirname, '..', 'menu-planner.db');
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

// Tables in FK dependency order (parents before children)
const TABLES = [
  'dishes',
  'ingredients',
  'allergen_keywords',
  'menus',
  'settings',
  'tags',
  'menu_courses',
  'dish_ingredients',
  'dish_allergens',
  'ingredient_allergens',
  'menu_dishes',
  'weekly_specials',
  'dish_tags',
  'dish_substitutions',
  'dish_section_headers',
  'dish_components',
  'dish_directions',
  'dish_service_directions',
  'tasks',
  'service_notes',
  'passkey_credentials',
  'ai_history',
  'ai_usage',
  'ai_conversations',
  'ai_messages',
  'chefsheets',
];

// Columns to skip per table (removed in migrations)
const SKIP_COLUMNS = {
  ingredients: ['in_stock'],
};

async function main() {
  if (!fs.existsSync(SQLITE_PATH)) {
    console.error(`SQLite file not found: ${SQLITE_PATH}`);
    process.exit(1);
  }

  console.log(`Migrating from ${SQLITE_PATH} to PostgreSQL...`);

  // Open SQLite
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(SQLITE_PATH);
  const sqliteDb = new SQL.Database(buf);

  // Connect to PostgreSQL
  const pool = new Pool({ connectionString: DATABASE_URL });

  // Run schema
  const schemaPath = path.join(__dirname, '..', 'db', 'schema-pg.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  await pool.query(schema);
  console.log('Schema created.');

  // Run seed (allergen keywords)
  const seedPath = path.join(__dirname, '..', 'db', 'seed-pg.sql');
  if (fs.existsSync(seedPath)) {
    await pool.query(fs.readFileSync(seedPath, 'utf-8'));
    console.log('Seed data loaded.');
  }

  // Migrate each table
  for (const table of TABLES) {
    try {
      const result = sqliteDb.exec(`SELECT * FROM ${table}`);
      if (!result.length) {
        console.log(`  ${table}: 0 rows (empty or missing)`);
        continue;
      }

      const { columns, values: rows } = result[0];
      const skip = new Set(SKIP_COLUMNS[table] || []);
      const filteredCols = columns.filter(c => !skip.has(c));
      const colIndices = filteredCols.map(c => columns.indexOf(c));

      if (rows.length === 0) {
        console.log(`  ${table}: 0 rows`);
        continue;
      }

      // Clear existing data (seed data for allergen_keywords)
      if (table === 'allergen_keywords') {
        await pool.query('DELETE FROM allergen_keywords');
      }

      // Batch insert using parameterized queries
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const placeholders = filteredCols.map((_, i) => `$${i + 1}`).join(', ');
        const insertSql = `INSERT INTO ${table} (${filteredCols.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;

        for (const row of rows) {
          const values = colIndices.map(i => row[i]);
          await client.query(insertSql, values);
        }

        await client.query('COMMIT');
        console.log(`  ${table}: ${rows.length} rows migrated`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ${table}: FAILED — ${err.message}`);
      } finally {
        client.release();
      }
    } catch (err) {
      console.log(`  ${table}: skipped (${err.message})`);
    }
  }

  // Reset SERIAL sequences
  console.log('\nResetting sequences...');
  const serialTables = TABLES.filter(t =>
    !['settings', 'dish_allergens', 'ingredient_allergens', 'dish_tags', 'passkey_credentials'].includes(t)
  );

  for (const table of serialTables) {
    try {
      const result = await pool.query(`SELECT MAX(id) as max_id FROM ${table}`);
      const maxId = result.rows[0]?.max_id;
      if (maxId) {
        await pool.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), $1)`, [maxId]);
        console.log(`  ${table}: sequence reset to ${maxId}`);
      }
    } catch {
      // Table might not have a serial id column
    }
  }

  // Verify row counts
  console.log('\nVerification:');
  for (const table of TABLES) {
    try {
      const sqliteResult = sqliteDb.exec(`SELECT COUNT(*) FROM ${table}`);
      const sqliteCount = sqliteResult.length ? sqliteResult[0].values[0][0] : 0;
      const pgResult = await pool.query(`SELECT COUNT(*) as cnt FROM ${table}`);
      const pgCount = parseInt(pgResult.rows[0].cnt);
      const match = sqliteCount === pgCount ? '✓' : '✗';
      console.log(`  ${match} ${table}: SQLite=${sqliteCount}, PG=${pgCount}`);
    } catch {
      // Skip missing tables
    }
  }

  sqliteDb.close();
  await pool.end();
  console.log('\nMigration complete!');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
