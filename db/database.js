const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'menu-planner.db');

let wrapper = null;
let initPromise = null;

// Save database to disk
function save(sqlDb) {
  if (sqlDb) {
    const data = sqlDb.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  }
}

// Wrapper that provides a synchronous-looking API on top of sql.js
class DbWrapper {
  constructor(sqlDb) {
    this._db = sqlDb;
    this._saveTimer = null;
  }

  _scheduleSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => save(this._db), 500);
  }

  prepare(sql) {
    return new StmtWrapper(this._db, sql, () => this._scheduleSave());
  }

  exec(sql) {
    this._db.run(sql);
    this._scheduleSave();
  }
}

class StmtWrapper {
  constructor(db, sql, onWrite) {
    this._db = db;
    this._sql = sql;
    this._onWrite = onWrite;
  }

  run(...params) {
    this._db.run(this._sql, params);
    const changes = this._db.getRowsModified();
    const idResult = this._db.exec("SELECT last_insert_rowid() AS id");
    const lastInsertRowid = idResult.length && idResult[0].values.length
      ? idResult[0].values[0][0] : 0;
    this._onWrite();
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
        cols.forEach((c, i) => row[c] = vals[i]);
        stmt.free();
        return row;
      }
      stmt.free();
      return undefined;
    } catch (e) {
      if (stmt) try { stmt.free(); } catch {}
      console.error('SQL error in get():', this._sql, e.message);
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
        cols.forEach((c, i) => row[c] = vals[i]);
        results.push(row);
      }
      stmt.free();
    } catch (e) {
      if (stmt) try { stmt.free(); } catch {}
      console.error('SQL error in all():', this._sql, e.message);
      throw e;
    }
    return results;
  }
}

async function initialize() {
  const SQL = await initSqlJs();

  let sqlDb;
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    sqlDb = new SQL.Database(buf);
    console.log('Loaded existing database.');
  } else {
    sqlDb = new SQL.Database();

    // Run schema
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
    sqlDb.run(schema);

    // Run seed line by line
    const seed = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf-8');
    const lines = seed.split('\n').filter(l => l.trim() && !l.trim().startsWith('--'));
    for (const line of lines) {
      try { sqlDb.run(line); } catch {}
    }

    save(sqlDb);
    console.log('Database initialized with schema and seed data.');
  }

  sqlDb.run("PRAGMA foreign_keys = ON");

  // Run migrations for existing databases
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
  ];

  for (const sql of MIGRATIONS) {
    try { sqlDb.run(sql); } catch {}
  }
  console.log('Migrations applied.');

  // Auto-purge soft-deleted records older than 7 days
  try { sqlDb.run("DELETE FROM dishes WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', '-7 days')"); } catch {}
  try { sqlDb.run("DELETE FROM menus WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', '-7 days')"); } catch {}

  wrapper = new DbWrapper(sqlDb);

  // Save on exit
  process.on('exit', () => save(sqlDb));
  process.on('SIGINT', () => { save(sqlDb); process.exit(); });

  return wrapper;
}

// Returns a promise that resolves to the wrapper on first call,
// then returns the cached wrapper directly
function getDb() {
  if (wrapper) return wrapper;
  if (!initPromise) initPromise = initialize();
  return initPromise;
}

module.exports = { getDb };
