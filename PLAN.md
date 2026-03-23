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

## What's Left

### 4. Configure VM
- [ ] Edit `ecosystem.config.js` on the VM with real env vars:
  ```bash
  gcloud compute ssh platestack-vm --zone=us-east1-b
  nano /opt/menu-planner/ecosystem.config.js
  ```
  Fill in:
  - `DATABASE_URL`: `postgresql://platestack_app:PASSWORD@34.75.214.150:5432/platestack` (public IP for now)
  - `SESSION_SECRET`: any random string
  - `GMAIL_USER`, `GMAIL_APP_PASSWORD`
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- [ ] Copy `uploads/` directory from DO droplet to VM:
  ```bash
  scp -r root@DO_IP:/opt/menu-planner/uploads/ /tmp/uploads/
  gcloud compute scp --zone=us-east1-b --recurse /tmp/uploads/ platestack-vm:/opt/menu-planner/uploads/
  ```
- [ ] Start app: `cd /opt/menu-planner && pm2 start ecosystem.config.js && pm2 save && pm2 startup`
- [ ] Test app works on HTTP at `http://34.148.149.170`

### 5. SSL Certificate
- [ ] Get cert (before DNS cutover, use DNS challenge):
  ```bash
  sudo certbot certonly --manual --preferred-challenges dns -d platestack.app
  ```
- [ ] Swap nginx to full HTTPS config:
  ```bash
  sudo cp /opt/menu-planner/nginx/platestack.conf /etc/nginx/sites-available/platestack
  sudo nginx -t && sudo systemctl reload nginx
  ```
  (Or write the config from the template already on the VM at `/etc/nginx/sites-available/platestack`)

### 6. DNS Cutover
- [ ] Update A record for `platestack.app` → `34.148.149.170`
- [ ] Switch certbot to `certbot --nginx` for auto-renewal
- [ ] Verify: app loads, login works, WebSocket sync, photos display, AI works, PWA installs

### 7. Lock Down Cloud SQL
- [ ] Remove public IP from Cloud SQL instance
- [ ] Add private IP (same VPC as VM): `gcloud sql instances patch platestack-db --no-assign-ip --network=default`
- [ ] Update `DATABASE_URL` in ecosystem.config.js to use private IP
- [ ] `pm2 restart menu-planner`

### 8. Decommission DO
- [ ] Confirm everything works for a few days
- [ ] Take final backup from DO (just in case)
- [ ] Destroy DO droplet

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
