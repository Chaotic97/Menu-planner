const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'menu-planner.db');

async function init() {
  // Remove existing database
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
    console.log('Removed existing database.');
  }

  const SQL = await initSqlJs();
  const db = new SQL.Database();

  db.run("PRAGMA foreign_keys = ON");

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  db.run(schema);
  console.log('Schema created.');

  const seed = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf-8');
  const lines = seed.split('\n').filter(l => l.trim() && !l.trim().startsWith('--'));
  for (const line of lines) {
    try { db.run(line); } catch {}
  }
  console.log('Seed data inserted.');

  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  db.close();
  console.log('Database initialized successfully.');
}

init().catch(err => {
  console.error('Init failed:', err);
  process.exit(1);
});
