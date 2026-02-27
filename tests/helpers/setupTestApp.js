'use strict';

/**
 * Test helper: creates a fully-wired Express app backed by a fresh in-memory
 * SQLite database. Each call returns an isolated app — no shared state between
 * test suites.
 *
 * Usage:
 *   const { createTestApp } = require('./helpers/setupTestApp');
 *   let app;
 *   beforeAll(async () => { app = await createTestApp(); });
 */

const express = require('express');
const session = require('express-session');
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

// ─── In-memory DB wrapper (mirrors db/database.js but without disk I/O) ──────

class DbWrapper {
  constructor(sqlDb) {
    this._db = sqlDb;
  }

  prepare(sql) {
    return new StmtWrapper(this._db, sql);
  }

  exec(sql) {
    this._db.run(sql);
  }
}

class StmtWrapper {
  constructor(db, sql) {
    this._db = db;
    this._sql = sql;
  }

  run(...params) {
    this._db.run(this._sql, params);
    const changes = this._db.getRowsModified();
    const idResult = this._db.exec('SELECT last_insert_rowid() AS id');
    const lastInsertRowid =
      idResult.length && idResult[0].values.length
        ? idResult[0].values[0][0]
        : 0;
    return { lastInsertRowid, changes };
  }

  get(...params) {
    let stmt;
    try {
      stmt = this._db.prepare(this._sql);
      if (params.length) stmt.bind(params);
      if (stmt.step()) {
        const cols = stmt.getColumnNames();
        const vals = stmt.get();
        const row = {};
        cols.forEach((c, i) => (row[c] = vals[i]));
        stmt.free();
        return row;
      }
      stmt.free();
      return undefined;
    } catch (e) {
      if (stmt) try { stmt.free(); } catch {}
      throw e;
    }
  }

  all(...params) {
    const results = [];
    let stmt;
    try {
      stmt = this._db.prepare(this._sql);
      if (params.length) stmt.bind(params);
      while (stmt.step()) {
        const cols = stmt.getColumnNames();
        const vals = stmt.get();
        const row = {};
        cols.forEach((c, i) => (row[c] = vals[i]));
        results.push(row);
      }
      stmt.free();
    } catch (e) {
      if (stmt) try { stmt.free(); } catch {}
      throw e;
    }
    return results;
  }
}

// ─── App factory ──────────────────────────────────────────────────────────────

async function createTestApp() {
  // 1. Create an in-memory sql.js database and apply schema + migrations
  const SQL = await initSqlJs();
  const sqlDb = new SQL.Database();

  const schemaPath = path.join(__dirname, '..', '..', 'db', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  sqlDb.run(schema);

  // Run seed data (allergen keywords)
  const seedPath = path.join(__dirname, '..', '..', 'db', 'seed.sql');
  const seed = fs.readFileSync(seedPath, 'utf-8');
  const lines = seed.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--'));
  for (const line of lines) {
    try { sqlDb.run(line); } catch {}
  }

  sqlDb.run('PRAGMA foreign_keys = ON');

  // Apply the same migrations as database.js
  const MIGRATIONS = [
    `ALTER TABLE menus ADD COLUMN sell_price REAL DEFAULT 0`,
    `CREATE TABLE IF NOT EXISTS weekly_specials (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      dish_id     INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
      week_start  TEXT NOT NULL,
      week_end    TEXT NOT NULL,
      notes       TEXT DEFAULT '',
      is_active   INTEGER DEFAULT 1,
      created_at  TEXT DEFAULT (datetime('now'))
    )`,
    `ALTER TABLE dishes ADD COLUMN is_favorite INTEGER DEFAULT 0`,
    `CREATE TABLE IF NOT EXISTS tags (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE
    )`,
    `CREATE TABLE IF NOT EXISTS dish_tags (
      dish_id INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
      tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY(dish_id, tag_id)
    )`,
    `ALTER TABLE dishes ADD COLUMN deleted_at TEXT DEFAULT NULL`,
    `ALTER TABLE menus ADD COLUMN deleted_at TEXT DEFAULT NULL`,
    `CREATE TABLE IF NOT EXISTS dish_substitutions (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      dish_id               INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
      allergen              TEXT NOT NULL,
      original_ingredient   TEXT NOT NULL,
      substitute_ingredient TEXT NOT NULL,
      substitute_quantity   REAL,
      substitute_unit       TEXT,
      notes                 TEXT DEFAULT ''
    )`,
    `ALTER TABLE menus ADD COLUMN expected_covers INTEGER DEFAULT 0`,
    `ALTER TABLE menus ADD COLUMN guest_allergies TEXT DEFAULT ''`,
    `CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS service_notes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      date       TEXT NOT NULL,
      shift      TEXT DEFAULT 'all',
      title      TEXT DEFAULT '',
      content    TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `ALTER TABLE menus ADD COLUMN allergen_covers TEXT DEFAULT '{}'`,
    `ALTER TABLE dishes ADD COLUMN manual_costs TEXT DEFAULT '[]'`,
    `ALTER TABLE dish_ingredients ADD COLUMN sort_order INTEGER DEFAULT 0`,
    `CREATE TABLE IF NOT EXISTS dish_section_headers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dish_id INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS dish_components (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      dish_id    INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
    )`,
    `ALTER TABLE dishes ADD COLUMN service_notes TEXT DEFAULT ''`,
    `CREATE INDEX IF NOT EXISTS idx_dishes_deleted_at ON dishes(deleted_at)`,
    `CREATE INDEX IF NOT EXISTS idx_menu_dishes_menu_id ON menu_dishes(menu_id)`,
    `CREATE INDEX IF NOT EXISTS idx_dish_ingredients_dish_id ON dish_ingredients(dish_id)`,
    `CREATE INDEX IF NOT EXISTS idx_dish_allergens_dish_id ON dish_allergens(dish_id)`,
    `CREATE INDEX IF NOT EXISTS idx_service_notes_date ON service_notes(date)`,
    `CREATE TABLE IF NOT EXISTS dish_directions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      dish_id    INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
      type       TEXT NOT NULL DEFAULT 'step',
      text       TEXT NOT NULL DEFAULT '',
      sort_order INTEGER DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS idx_dish_directions_dish_id ON dish_directions(dish_id)`,
    `CREATE TABLE IF NOT EXISTS tasks (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_id         INTEGER DEFAULT NULL REFERENCES menus(id) ON DELETE SET NULL,
      source_dish_id  INTEGER DEFAULT NULL REFERENCES dishes(id) ON DELETE SET NULL,
      type            TEXT NOT NULL DEFAULT 'custom',
      title           TEXT NOT NULL,
      description     TEXT DEFAULT '',
      category        TEXT DEFAULT '',
      quantity        REAL DEFAULT NULL,
      unit            TEXT DEFAULT '',
      timing_bucket   TEXT DEFAULT '',
      priority        TEXT NOT NULL DEFAULT 'medium',
      due_date        TEXT DEFAULT NULL,
      due_time        TEXT DEFAULT NULL,
      completed       INTEGER DEFAULT 0,
      completed_at    TEXT DEFAULT NULL,
      source          TEXT NOT NULL DEFAULT 'manual',
      sort_order      INTEGER DEFAULT 0,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_menu_id ON tasks(menu_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(completed)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority)`,
  ];

  for (const sql of MIGRATIONS) {
    try { sqlDb.run(sql); } catch {}
  }

  const wrapper = new DbWrapper(sqlDb);

  // 2. Monkey-patch getDb so all route/service modules use the test DB
  //    Also clear require cache for route/service modules so they get the patched getDb
  const modulesToClear = [
    '../../routes/auth', '../../routes/dishes', '../../routes/ingredients',
    '../../routes/menus', '../../routes/todos', '../../routes/serviceNotes',
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

  // 3. Build Express app (mirrors server.js but without listen/WebSocket/session-file-store)
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  // Lightweight in-memory session (no file store needed in tests)
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false },
    })
  );

  // Auth middleware
  const authMiddleware = require('../../middleware/auth');
  app.use(authMiddleware);

  // Broadcast stub (captures calls for assertions)
  const broadcasts = [];
  app.use((req, res, next) => {
    req.broadcast = (type, payload, excludeClientId) => {
      broadcasts.push({ type, payload, excludeClientId });
    };
    next();
  });

  // Mount routes (same as server.js)
  app.use('/api/auth', require('../../routes/auth'));
  app.use('/api/dishes', require('../../routes/dishes'));
  app.use('/api/ingredients', require('../../routes/ingredients'));
  app.use('/api/menus', require('../../routes/menus'));
  app.use('/api/todos', require('../../routes/todos'));
  app.use('/api/service-notes', require('../../routes/serviceNotes'));

  // Global error handler
  app.use((err, req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });

  // Return everything tests need
  return {
    app,
    db: wrapper,
    broadcasts,
    /** Restore the original getDb after tests complete */
    cleanup() {
      dbModule.getDb = originalGetDb;
    },
  };
}

module.exports = { createTestApp };
