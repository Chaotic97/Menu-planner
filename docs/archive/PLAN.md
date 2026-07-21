# GCP Migration Plan: DigitalOcean + SQLite → Google Cloud + PostgreSQL

---

## What's Done

### Phase 2: SQLite → PostgreSQL Code Migration ✅
All application code has been converted from SQLite (sql.js) to PostgreSQL (pg).

**35 files modified, 5 new files created:**

- **`db/database.js`** — Rewritten: sql.js → pg Pool with async `DbWrapper`/`StmtWrapper`/`TxWrapper`
- **`db/schema-pg.sql`** — Full PostgreSQL schema (all tables + indexes, citext extension)
- **`db/seed-pg.sql`** — Allergen keywords with `ON CONFLICT DO NOTHING`
- **`package.json`** — `sql.js` replaced with `pg`
- **All routes/** — `await` on every db call, `asyncHandler` on all handlers, PG SQL syntax
- **All services/** — All functions made async, PG SQL syntax
- **`tests/helpers/setupTestApp.js`** — Rewritten for pg Pool with isolated schema per test suite
- **`tests/aiHistory.test.js`**, **`tests/aiTools.test.js`**, **`tests/integration/ai.test.js`** — Converted to async + PG
- **`playwright.config.js`** — `DB_PATH` → `DATABASE_URL`
- **`.github/workflows/ci.yml`** — PostgreSQL 16 service container added

**SQL conversions applied everywhere:**
- `datetime('now')` → `NOW()`
- `INSERT OR REPLACE` → `ON CONFLICT (pk) DO UPDATE SET ...`
- `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`
- `COLLATE NOCASE` → removed (citext handles it)
- `strftime()` → `TO_CHAR()`
- `BEGIN/COMMIT/ROLLBACK` → `db.transaction(async (tx) => {...})`
- All `db.prepare().get/all/run()` → `await`

### Phase 1: Infrastructure Files ✅
- **`public/service-worker.js`** — Cache version bumped 6 → 7
- **`ecosystem.config.js`** — PM2 config with all env vars
- **`nginx/platestack.conf`** — Reverse proxy + WebSocket support
- **`scripts/migrate-sqlite-to-pg.js`** — One-time SQLite → PG data migration script

### GCP Setup (in progress) ✅
- GCP project `platestack-prod` created
- Billing linked
- Compute Engine + Cloud SQL APIs enabled
- **Cloud SQL instance `platestack-db` created** — PostgreSQL 16, db-f1-micro, us-east1
  - Public IP: `34.75.214.150` (will lock down to private-only after migration)

### Local Prep ✅
- SQLite database file (`menu-planner.db`) downloaded from DO droplet
- Uploads directory backed up

---

## What's Done (Deployment)

### 1. Cloud SQL Setup ✅
- [x] Set postgres user password
- [x] Create `platestack_app` user with password
- [x] Create `platestack` database
- [x] Enable citext extension
- [x] Grant privileges: `GRANT ALL ON SCHEMA public TO platestack_app` + default privileges on tables/sequences

### 2. Data Migration ✅
- [x] All 26 tables migrated, every row count verified ✓
- [x] Sequences reset to correct values

### 3. GCE VM Provisioned ✅
- [x] `e2-small` VM (`platestack-vm`) in `us-east1-b`, Ubuntu 22.04 LTS, 25GB SSD
- [x] Static external IP: **34.148.149.170**
- [x] HTTP + HTTPS firewall rules created
- [x] Node.js 20.20.1, PM2 6.0.14, nginx 1.18.0, certbot installed
- [x] Repo cloned to `/opt/menu-planner` via SSH deploy key
- [x] `npm install --production` complete
- [x] Directories created: `uploads/`, `sessions/`, `logs/`
- [x] nginx configured (HTTP-only temp config, ready for SSL)
- [x] SSH deploy key configured for `git pull`

---

## What's Done (Deployment)

### 4. Configure VM ✅
- [x] `ecosystem.config.js` configured with DATABASE_URL, SESSION_SECRET
- [x] App started with PM2, connected to Cloud SQL
- [x] PM2 startup configured for auto-restart on reboot
- [x] VM IP authorized in Cloud SQL

### 5. SSL Certificate ✅
- [x] Let's Encrypt cert via DNS challenge (expires 2026-06-21)
- [x] nginx configured with HTTPS + HTTP→HTTPS redirect

### 6. DNS Cutover ✅
- [x] Migrated DNS from DigitalOcean to Google Cloud DNS (`platestack-zone`)
- [x] A record → `34.148.149.170`, MX → Zoho, TXT → SPF + Zoho verification
- [x] App live at https://platestack.app

---

## What's Done (Post-Deployment)

### 7. Remaining Setup ✅
- [x] Set up certbot auto-renewal (certbot-dns-google plugin + cron at `/etc/cron.d/certbot-renew`)
- [x] Copy `uploads/` directory — skipped (no dish photos uploaded yet)
- [x] Verify: WebSocket sync ✓, PWA installs ✓

### 8. Lock Down Cloud SQL ✅
- [x] Added private IP via VPC peering (`10.26.0.3`)
- [x] Updated `DATABASE_URL` in ecosystem.config.js to use private IP
- [x] Removed public IP from Cloud SQL instance
- [x] `pm2 restart menu-planner`

### 9. Decommission DO ✅
- [x] DO droplet destroyed

---

## What's Left

### 10. Optional / Deferred
- [ ] Add GMAIL_USER, GMAIL_APP_PASSWORD to ecosystem.config.js (email sending)
- [ ] Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET to ecosystem.config.js (Google Calendar OAuth)
- [ ] Add Anthropic API key in app Settings (AI command bar)

---

## New Environment Variables
| Variable | Description |
|----------|------------|
| `DATABASE_URL` | `postgresql://platestack_app:PASSWORD@PRIVATE_IP:5432/platestack` |
| `DB_PATH` | **No longer used** — remove from any configs |

## Key Files
| File | Purpose |
|------|---------|
| `db/database.js` | pg Pool wrapper (async DbWrapper) |
| `db/schema-pg.sql` | Full PostgreSQL schema |
| `db/seed-pg.sql` | Allergen keyword seed data |
| `scripts/migrate-sqlite-to-pg.js` | One-time SQLite → PG migration |
| `ecosystem.config.js` | PM2 production config |
| `nginx/platestack.conf` | nginx reverse proxy config |
