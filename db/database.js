const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'menu-planner.db');

let wrapper = null;
let initPromise = null;

// Save database to disk (atomic write-to-temp-then-rename)
function save(sqlDb) {
  if (sqlDb) {
    const data = sqlDb.export();
    const tmpPath = DB_PATH + '.tmp';
    fs.writeFileSync(tmpPath, Buffer.from(data));
    fs.renameSync(tmpPath, DB_PATH);
  }
}

// Wrapper that provides a synchronous-looking API on top of sql.js
class DbWrapper {
  constructor(sqlDb) {
    this._db = sqlDb;
    this._saveTimer = null;
    this._maxTimer = null;
  }

  _scheduleSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._flushSave(), 500);
    // Guarantee a save within 5 seconds even under sustained writes
    if (!this._maxTimer) {
      this._maxTimer = setTimeout(() => this._flushSave(), 5000);
    }
  }

  _flushSave() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    if (this._maxTimer) { clearTimeout(this._maxTimer); this._maxTimer = null; }
    save(this._db);
  }

  cancelPendingSave() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    if (this._maxTimer) { clearTimeout(this._maxTimer); this._maxTimer = null; }
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
    `ALTER TABLE ingredients ADD COLUMN in_stock INTEGER DEFAULT 0`,
    `ALTER TABLE dishes ADD COLUMN batch_yield INTEGER DEFAULT 1`,
    `ALTER TABLE tasks ADD COLUMN day_phase TEXT DEFAULT NULL`,
    `ALTER TABLE tasks ADD COLUMN is_next INTEGER DEFAULT 0`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_day_phase ON tasks(day_phase)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_is_next ON tasks(is_next)`,
    // Allow decimal batch_yield (e.g. 2.5 portions per batch)
    // SQLite ignores column type changes, but we can update existing integer values
    // and the app validation now accepts any positive number
    `UPDATE dishes SET batch_yield = CAST(batch_yield AS REAL) WHERE typeof(batch_yield) = 'integer'`,
    // Weekly schedule: which days of the week a menu runs (JSON array of day numbers 0=Sun..6=Sat)
    `ALTER TABLE menus ADD COLUMN schedule_days TEXT DEFAULT '[]'`,
    // Per-dish active days within the menu schedule (JSON array of day numbers, NULL = all scheduled days)
    `ALTER TABLE menu_dishes ADD COLUMN active_days TEXT DEFAULT NULL`,
    // Structured service directions (plating/assembly steps at service time)
    `CREATE TABLE IF NOT EXISTS dish_service_directions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      dish_id    INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
      type       TEXT NOT NULL DEFAULT 'step',
      text       TEXT NOT NULL DEFAULT '',
      sort_order INTEGER DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS idx_dish_service_directions_dish_id ON dish_service_directions(dish_id)`,
    // Reverse FK indexes for common joins
    `CREATE INDEX IF NOT EXISTS idx_menu_dishes_dish_id ON menu_dishes(dish_id)`,
    `CREATE INDEX IF NOT EXISTS idx_dish_ingredients_ingredient_id ON dish_ingredients(ingredient_id)`,
    // Menu type: 'standard' (one recurring house menu) vs 'event' (one-off with date/covers)
    `ALTER TABLE menus ADD COLUMN menu_type TEXT DEFAULT 'event'`,
    `ALTER TABLE menus ADD COLUMN event_date TEXT DEFAULT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_menus_menu_type ON menus(menu_type)`,
    // AI assistant: action history for undo
    `CREATE TABLE IF NOT EXISTS ai_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      action_type TEXT NOT NULL,
      previous_data TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    // AI assistant: usage tracking
    `CREATE TABLE IF NOT EXISTS ai_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      model TEXT NOT NULL,
      tool_used TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_ai_usage_created_at ON ai_usage(created_at)`,
    // Chat conversations for the AI chat drawer
    `CREATE TABLE IF NOT EXISTS ai_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS ai_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_id ON ai_messages(conversation_id)`,
    // Performance indexes for search queries
    `CREATE INDEX IF NOT EXISTS idx_dishes_name ON dishes(name)`,
    `CREATE INDEX IF NOT EXISTS idx_ingredients_name ON ingredients(name)`,
    `CREATE INDEX IF NOT EXISTS idx_menus_deleted_at ON menus(deleted_at)`,
    // Google Calendar integration: link menus to Google Calendar event IDs
    `ALTER TABLE menus ADD COLUMN gcal_event_id TEXT DEFAULT NULL`,
    // Performance indexes for foreign keys used in JOINs and WHERE clauses
    `CREATE INDEX IF NOT EXISTS idx_dish_tags_tag_id ON dish_tags(tag_id)`,
    `CREATE INDEX IF NOT EXISTS idx_dish_substitutions_dish_id ON dish_substitutions(dish_id)`,
    `CREATE INDEX IF NOT EXISTS idx_dish_section_headers_dish_id ON dish_section_headers(dish_id)`,
    `CREATE INDEX IF NOT EXISTS idx_dish_components_dish_id ON dish_components(dish_id)`,
    `CREATE INDEX IF NOT EXISTS idx_weekly_specials_dish_id ON weekly_specials(dish_id)`,
    `CREATE INDEX IF NOT EXISTS idx_weekly_specials_week ON weekly_specials(week_start, week_end)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_source_dish_id ON tasks(source_dish_id)`,
    // Menu courses / sections (shared table for coursed and à la carte modes)
    `CREATE TABLE IF NOT EXISTS menu_courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_id INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      notes TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_menu_courses_menu_id ON menu_courses(menu_id)`,
    // Service style: 'coursed' or 'alacarte'
    `ALTER TABLE menus ADD COLUMN service_style TEXT DEFAULT 'alacarte'`,
    // Link dishes to courses and add per-dish notes within a menu
    `ALTER TABLE menu_dishes ADD COLUMN course_id INTEGER DEFAULT NULL REFERENCES menu_courses(id) ON DELETE SET NULL`,
    `ALTER TABLE menu_dishes ADD COLUMN notes TEXT DEFAULT ''`,
    `CREATE INDEX IF NOT EXISTS idx_menu_dishes_course_id ON menu_dishes(course_id)`,
    // Ingredient-level allergens: move allergen tracking from dish to ingredient
    `CREATE TABLE IF NOT EXISTS ingredient_allergens (
      ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
      allergen      TEXT NOT NULL CHECK(allergen IN (
                        'celery','gluten','crustaceans','eggs','fish','lupin',
                        'milk','molluscs','mustard','nuts','peanuts',
                        'sesame','soy','sulphites'
                    )),
      source        TEXT DEFAULT 'auto' CHECK(source IN ('auto','manual')),
      PRIMARY KEY (ingredient_id, allergen)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_ingredient_allergens_ingredient_id ON ingredient_allergens(ingredient_id)`,
    // Migrate existing auto-detected dish_allergens to ingredient_allergens
    // For each dish allergen with source='auto', find ingredients that match and assign
    `INSERT OR IGNORE INTO ingredient_allergens (ingredient_id, allergen, source)
     SELECT DISTINCT i.id, da.allergen, 'auto'
     FROM dish_allergens da
     JOIN dish_ingredients di ON di.dish_id = da.dish_id
     JOIN ingredients i ON i.id = di.ingredient_id
     JOIN allergen_keywords ak ON da.allergen = ak.allergen
     WHERE da.source = 'auto'
       AND LOWER(i.name) LIKE '%' || LOWER(ak.keyword) || '%'`,
    // Remove unused in_stock column (may silently fail on older SQLite without DROP COLUMN support)
    `ALTER TABLE ingredients DROP COLUMN in_stock`,
    // Add is_temporary flag for temp dishes that live within a menu
    `ALTER TABLE dishes ADD COLUMN is_temporary INTEGER DEFAULT 0`,
    // WebAuthn passkey credentials
    `CREATE TABLE IF NOT EXISTS passkey_credentials (
      id         TEXT PRIMARY KEY,
      public_key TEXT NOT NULL,
      counter    INTEGER NOT NULL DEFAULT 0,
      transports TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
  ];

  let migrationErrors = 0;
  for (let i = 0; i < MIGRATIONS.length; i++) {
    try { sqlDb.run(MIGRATIONS[i]); } catch (err) {
      // Expected for already-applied migrations (e.g. duplicate column).
      // Log unexpected failures to aid debugging.
      const snippet = MIGRATIONS[i].substring(0, 80).replace(/\s+/g, ' ');
      if (!/duplicate column|already exists/i.test(err.message)) {
        console.warn(`Migration ${i} failed: ${snippet}… — ${err.message}`);
        migrationErrors++;
      }
    }
  }
  if (migrationErrors) {
    console.warn(`Migrations applied with ${migrationErrors} unexpected error(s).`);
  } else {
    console.log('Migrations applied.');
  }

  // Auto-purge soft-deleted records older than 7 days
  try { sqlDb.run("DELETE FROM dishes WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', '-7 days')"); } catch {}
  try { sqlDb.run("DELETE FROM menus WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', '-7 days')"); } catch {}
  // Auto-purge old chat conversations older than 7 days
  try { sqlDb.run("DELETE FROM ai_conversations WHERE updated_at < datetime('now', '-7 days')"); } catch {}

  wrapper = new DbWrapper(sqlDb);

  // Save on exit
  process.on('exit', () => save(sqlDb));
  process.on('SIGINT', () => { save(sqlDb); process.exit(); });
  process.on('SIGTERM', () => { save(sqlDb); process.exit(); });

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
