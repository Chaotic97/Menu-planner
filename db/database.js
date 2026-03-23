const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/platestack';

let wrapper = null;
let initPromise = null;

/**
 * Convert ? placeholders to $1, $2, ... for PostgreSQL
 */
function convertPlaceholders(sql) {
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
}

/**
 * Statement wrapper — provides .get(), .all(), .run() with async pg queries.
 * Mirrors the old sql.js StmtWrapper API but returns promises.
 */
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
    // For INSERT statements without ON CONFLICT and without RETURNING,
    // append RETURNING id to get the auto-generated id
    const needsReturning = this._isInsert &&
      !/RETURNING/i.test(sql) &&
      !/ON\s+CONFLICT/i.test(sql);

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

/**
 * Transaction wrapper — same API as DbWrapper but uses a dedicated client
 * so BEGIN/COMMIT share a connection.
 */
class TxWrapper {
  constructor(client) {
    this._client = client;
  }

  prepare(sql) {
    return new StmtWrapper((s, p) => this._client.query(s, p), sql);
  }

  async exec(sql) {
    await this._client.query(sql);
  }
}

/**
 * Main database wrapper — pool-based, async API.
 * API shape matches the old sync sql.js wrapper but all methods return promises.
 */
class DbWrapper {
  constructor(pool) {
    this._pool = pool;
  }

  prepare(sql) {
    return new StmtWrapper((s, p) => this._pool.query(s, p), sql);
  }

  async exec(sql) {
    await this._pool.query(sql);
  }

  /**
   * Run a function inside a transaction using a dedicated client.
   * The callback receives a TxWrapper with the same prepare()/exec() API.
   * Usage:
   *   await db.transaction(async (tx) => {
   *     await tx.prepare('INSERT ...').run(...);
   *     await tx.prepare('UPDATE ...').run(...);
   *   });
   */
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

  // No-op — no disk saves with PostgreSQL
  cancelPendingSave() {}

  async close() {
    await this._pool.end();
  }
}

async function initialize() {
  const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  // Test connection
  const client = await pool.connect();
  client.release();

  // Check if schema exists by looking for the schema_version table
  let schemaExists = false;
  try {
    const result = await pool.query("SELECT version FROM schema_version LIMIT 1");
    schemaExists = result.rows.length > 0;
  } catch {
    // Table doesn't exist — need to create schema
  }

  if (!schemaExists) {
    console.log('Creating database schema...');
    const schema = fs.readFileSync(path.join(__dirname, 'schema-pg.sql'), 'utf-8');
    await pool.query(schema);

    // Run seed data (allergen keywords)
    const seedPath = path.join(__dirname, 'seed-pg.sql');
    if (fs.existsSync(seedPath)) {
      const seed = fs.readFileSync(seedPath, 'utf-8');
      await pool.query(seed);
    }

    console.log('Database initialized with schema and seed data.');
  } else {
    console.log('Loaded existing database.');
  }

  // Future migrations would go here, keyed off schema_version.version
  // const currentVersion = (await pool.query('SELECT version FROM schema_version')).rows[0].version;
  // if (currentVersion < 2) { await pool.query(MIGRATION_2); await pool.query('UPDATE schema_version SET version = 2'); }

  // Auto-purge soft-deleted records older than 7 days
  try { await pool.query("DELETE FROM dishes WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '7 days'"); } catch {}
  try { await pool.query("DELETE FROM menus WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '7 days'"); } catch {}
  // Auto-purge old chat conversations older than 7 days
  try { await pool.query("DELETE FROM ai_conversations WHERE updated_at < NOW() - INTERVAL '7 days'"); } catch {}
  // Purge stale OAuth credentials
  try { await pool.query("DELETE FROM settings WHERE key IN ('gcal_client_id', 'gcal_client_secret')"); } catch {}
  // Purge legacy Anthropic API key (migrated to Vertex AI with ADC)
  try { await pool.query("DELETE FROM settings WHERE key = 'ai_api_key'"); } catch {}

  wrapper = new DbWrapper(pool);

  console.log('Migrations applied.');
  return wrapper;
}

/**
 * Returns the cached wrapper directly if initialized,
 * otherwise returns the init promise.
 */
function getDb() {
  if (wrapper) return wrapper;
  if (!initPromise) initPromise = initialize();
  return initPromise;
}

module.exports = { getDb };
