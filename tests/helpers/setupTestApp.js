'use strict';

const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');

// Use the same wrapper classes from db/database.js
// But we inline a simplified version for test isolation

function convertPlaceholders(sql) {
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
}

// Tables whose primary key is not a column named `id` — `RETURNING id` is invalid.
const NO_ID_TABLES = new Set([
  'settings', 'dish_tags', 'dish_allergens', 'ingredient_allergens',
]);

class StmtWrapper {
  constructor(queryFn, sql) {
    this._query = queryFn;
    this._sql = convertPlaceholders(sql);
    this._isInsert = /^\s*INSERT\s/i.test(sql);
  }

  async get(...params) {
    const result = await this._query(this._sql, params);
    return result.rows[0] || undefined;
  }

  async all(...params) {
    const result = await this._query(this._sql, params);
    return result.rows;
  }

  async run(...params) {
    let sql = this._sql;
    const tableMatch = /^\s*INSERT\s+INTO\s+"?([a-z_][a-z0-9_]*)"?/i.exec(sql);
    const tableName = tableMatch ? tableMatch[1].toLowerCase() : '';
    const needsReturning = this._isInsert &&
      !/RETURNING/i.test(sql) &&
      !/ON\s+CONFLICT/i.test(sql) &&
      !NO_ID_TABLES.has(tableName);
    if (needsReturning) {
      sql = sql.replace(/;?\s*$/, '') + ' RETURNING id';
    }
    const result = await this._query(sql, params);
    return {
      lastInsertRowid: needsReturning && result.rows.length ? result.rows[0].id : 0,
      changes: result.rowCount,
    };
  }
}

class TxWrapper {
  constructor(client) { this._client = client; }
  prepare(sql) { return new StmtWrapper((s, p) => this._client.query(s, p), sql); }
  async exec(sql) { await this._client.query(sql); }
}

class DbWrapper {
  constructor(pool, schema) {
    this._pool = pool;
    this._schema = schema;
  }
  prepare(sql) { return new StmtWrapper((s, p) => this._pool.query(s, p), sql); }
  async exec(sql) { await this._pool.query(sql); }
  async transaction(fn) {
    const client = await this._pool.connect();
    try {
      await client.query('BEGIN');
      const tx = new TxWrapper(client);
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  cancelPendingSave() {}
}

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://localhost:5432/platestack_test';
const fs = require('fs');
const path = require('path');

async function createTestApp() {
  // Create a unique schema for this test suite to isolate parallel runs
  const schemaName = 'test_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

  // Pin search_path at connection startup (via PGOPTIONS) so EVERY pooled
  // connection deterministically targets the isolated schema, with `public`
  // kept on the path so the citext type (installed in public) still resolves.
  // Doing this in a `connect` event handler instead races the pool (the SET is
  // not awaited before the first query runs), which silently drops the schema
  // and makes seed-data-dependent tests fail intermittently.
  const pool = new Pool({
    connectionString: TEST_DATABASE_URL,
    options: `-c search_path=${schemaName},public`,
  });

  // Create isolated schema. The startup search_path points here already; a
  // not-yet-existing schema on the path is harmless until a table is queried.
  await pool.query(`CREATE SCHEMA ${schemaName}`);

  // Ensure citext extension exists (in public schema)
  try { await pool.query('CREATE EXTENSION IF NOT EXISTS citext'); } catch {}

  // Run the PostgreSQL schema
  const schemaPath = path.join(__dirname, '..', '..', 'db', 'schema-pg.sql');
  let schemaSql = fs.readFileSync(schemaPath, 'utf-8');
  // Remove CREATE EXTENSION since it might fail without superuser, and we try to do it above safely
  schemaSql = schemaSql.replace(/CREATE EXTENSION IF NOT EXISTS citext;/gi, '');
  await pool.query(schemaSql);

  // Run seed data
  const seedPath = path.join(__dirname, '..', '..', 'db', 'seed-pg.sql');
  if (fs.existsSync(seedPath)) {
    const seedSql = fs.readFileSync(seedPath, 'utf-8');
    await pool.query(seedSql);
  }

  const wrapper = new DbWrapper(pool, schemaName);

  // Monkey-patch getDb
  const modulesToClear = [
    '../../routes/auth', '../../routes/dishes', '../../routes/ingredients',
    '../../routes/menus', '../../routes/todos', '../../routes/today',
    '../../routes/serviceNotes', '../../routes/notifications',
    '../../services/allergenDetector', '../../services/shoppingListGenerator',
    '../../services/prepTaskGenerator', '../../services/taskGenerator',
    '../../services/specialsExporter',
  ];
  for (const mod of modulesToClear) {
    try { delete require.cache[require.resolve(mod)]; } catch {}
  }

  const dbModule = require('../../db/database');
  const originalGetDb = dbModule.getDb;
  dbModule.getDb = () => wrapper;

  // Build Express app
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false, cookie: { secure: false } }));

  const authMiddleware = require('../../middleware/auth');
  app.use(authMiddleware);

  const broadcasts = [];
  app.use((req, res, next) => {
    req.broadcast = (type, payload, excludeClientId) => {
      broadcasts.push({ type, payload, excludeClientId });
    };
    next();
  });

  app.use('/api/auth', require('../../routes/auth'));
  app.use('/api/dishes', require('../../routes/dishes'));
  app.use('/api/ingredients', require('../../routes/ingredients'));
  app.use('/api/menus', require('../../routes/menus'));
  app.use('/api/todos', require('../../routes/todos'));
  app.use('/api/today', require('../../routes/today'));
  app.use('/api/service-notes', require('../../routes/serviceNotes'));
  app.use('/api/notifications', require('../../routes/notifications'));

  app.use((err, req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });

  return {
    app,
    db: wrapper,
    broadcasts,
    async cleanup() {
      dbModule.getDb = originalGetDb;
      await pool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
      await pool.end();
    },
  };
}

module.exports = { createTestApp };
