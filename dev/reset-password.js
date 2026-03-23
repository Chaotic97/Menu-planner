/**
 * Dev tool — reset the login password to a known value for local testing.
 *
 * Usage:  npm run dev-reset
 *
 * Sets:
 *   password  → "devpass"
 *   email     → "dev@localhost"
 *
 * Safe to run repeatedly. Only meant for local development.
 */

const bcrypt = require('bcrypt');
const { getDb } = require('../db/database');

const DEV_PASSWORD = 'devpass';
const DEV_EMAIL = 'dev@localhost';
const SALT_ROUNDS = 12;

async function main() {
  const db = await getDb();

  const hash = await bcrypt.hash(DEV_PASSWORD, SALT_ROUNDS);

  await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value').run('password_hash', hash);
  await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value').run('email', DEV_EMAIL);

  console.log('');
  console.log('  Dev credentials set:');
  console.log(`    password : ${DEV_PASSWORD}`);
  console.log(`    email    : ${DEV_EMAIL}`);
  console.log('');

  process.exit(0);
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
