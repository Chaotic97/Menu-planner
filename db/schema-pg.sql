-- PlateStack PostgreSQL Schema
-- Full schema combining base tables + all migrations

CREATE EXTENSION IF NOT EXISTS citext;

-- Schema versioning (replaces SQLite try-catch migration approach)
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL
);
INSERT INTO schema_version (version) VALUES (1);

-- ─── Core Tables ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dishes (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT DEFAULT '',
    category        TEXT NOT NULL DEFAULT 'main' CHECK(category IN (
                        'starter','main','dessert','side','soup','salad',
                        'bread','sauce','beverage','other'
                    )),
    photo_path      TEXT DEFAULT NULL,
    chefs_notes     TEXT DEFAULT '',
    suggested_price REAL DEFAULT 0,
    batch_yield     REAL DEFAULT 1,
    is_favorite     INTEGER DEFAULT 0,
    deleted_at      TIMESTAMP DEFAULT NULL,
    manual_costs    TEXT DEFAULT '[]',
    service_notes   TEXT DEFAULT '',
    is_temporary    INTEGER DEFAULT 0,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ingredients (
    id          SERIAL PRIMARY KEY,
    name        CITEXT NOT NULL UNIQUE,
    unit_cost   REAL DEFAULT 0,
    base_unit   TEXT DEFAULT 'g',
    category    TEXT DEFAULT 'other' CHECK(category IN (
                    'produce','dairy','meat','seafood',
                    'dry goods','spices','oils','other'
                )),
    g_per_ml    REAL DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS dish_ingredients (
    id              SERIAL PRIMARY KEY,
    dish_id         INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
    ingredient_id   INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
    quantity        REAL NOT NULL DEFAULT 0,
    unit            TEXT NOT NULL DEFAULT 'g',
    prep_note       TEXT DEFAULT '',
    sort_order      INTEGER DEFAULT 0,
    UNIQUE(dish_id, ingredient_id)
);

CREATE TABLE IF NOT EXISTS allergen_keywords (
    id          SERIAL PRIMARY KEY,
    keyword     CITEXT NOT NULL,
    allergen    TEXT NOT NULL CHECK(allergen IN (
                    'celery','gluten','crustaceans','eggs','fish','lupin',
                    'milk','molluscs','mustard','nuts','peanuts',
                    'sesame','soy','sulphites'
                )),
    UNIQUE(keyword, allergen)
);

CREATE TABLE IF NOT EXISTS dish_allergens (
    dish_id     INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
    allergen    TEXT NOT NULL,
    source      TEXT DEFAULT 'auto' CHECK(source IN ('auto','manual')),
    PRIMARY KEY (dish_id, allergen)
);

CREATE TABLE IF NOT EXISTS ingredient_allergens (
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
    allergen      TEXT NOT NULL CHECK(allergen IN (
                      'celery','gluten','crustaceans','eggs','fish','lupin',
                      'milk','molluscs','mustard','nuts','peanuts',
                      'sesame','soy','sulphites'
                  )),
    source        TEXT DEFAULT 'auto' CHECK(source IN ('auto','manual')),
    PRIMARY KEY (ingredient_id, allergen)
);

-- ─── Menu System ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS menus (
    id              SERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT DEFAULT '',
    is_active       INTEGER DEFAULT 1,
    sell_price      REAL DEFAULT 0,
    expected_covers INTEGER DEFAULT 0,
    guest_allergies TEXT DEFAULT '',
    allergen_covers TEXT DEFAULT '{}',
    schedule_days   TEXT DEFAULT '[]',
    menu_type       TEXT DEFAULT 'event',
    event_date      TEXT DEFAULT NULL,
    gcal_event_id   TEXT DEFAULT NULL,
    service_style   TEXT DEFAULT 'alacarte',
    batch_label     TEXT DEFAULT '',
    deleted_at      TIMESTAMP DEFAULT NULL,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS menu_courses (
    id          SERIAL PRIMARY KEY,
    menu_id     INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    notes       TEXT DEFAULT '',
    sort_order  INTEGER DEFAULT 0,
    created_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS menu_dishes (
    id          SERIAL PRIMARY KEY,
    menu_id     INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
    dish_id     INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
    sort_order  INTEGER DEFAULT 0,
    servings    INTEGER DEFAULT 1,
    active_days TEXT DEFAULT NULL,
    course_id   INTEGER DEFAULT NULL REFERENCES menu_courses(id) ON DELETE SET NULL,
    notes       TEXT DEFAULT '',
    UNIQUE(menu_id, dish_id)
);

CREATE TABLE IF NOT EXISTS weekly_specials (
    id          SERIAL PRIMARY KEY,
    dish_id     INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
    week_start  TEXT NOT NULL,
    week_end    TEXT NOT NULL,
    notes       TEXT DEFAULT '',
    is_active   INTEGER DEFAULT 1,
    created_at  TIMESTAMP DEFAULT NOW()
);

-- ─── Dish Details ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tags (
    id   SERIAL PRIMARY KEY,
    name CITEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS dish_tags (
    dish_id INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY(dish_id, tag_id)
);

CREATE TABLE IF NOT EXISTS dish_substitutions (
    id                    SERIAL PRIMARY KEY,
    dish_id               INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
    allergen              TEXT NOT NULL,
    original_ingredient   TEXT NOT NULL,
    substitute_ingredient TEXT NOT NULL,
    substitute_quantity   REAL,
    substitute_unit       TEXT,
    notes                 TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS dish_section_headers (
    id          SERIAL PRIMARY KEY,
    dish_id     INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
    label       TEXT NOT NULL,
    sort_order  INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dish_components (
    id         SERIAL PRIMARY KEY,
    dish_id    INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dish_directions (
    id         SERIAL PRIMARY KEY,
    dish_id    INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
    type       TEXT NOT NULL DEFAULT 'step',
    text       TEXT NOT NULL DEFAULT '',
    sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dish_service_directions (
    id         SERIAL PRIMARY KEY,
    dish_id    INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
    type       TEXT NOT NULL DEFAULT 'step',
    text       TEXT NOT NULL DEFAULT '',
    sort_order INTEGER DEFAULT 0
);

-- ─── Tasks ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tasks (
    id              SERIAL PRIMARY KEY,
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
    completed_at    TIMESTAMP DEFAULT NULL,
    source          TEXT NOT NULL DEFAULT 'manual',
    sort_order      INTEGER DEFAULT 0,
    day_phase       TEXT DEFAULT NULL,
    is_next         INTEGER DEFAULT 0,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

-- ─── Service Notes ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS service_notes (
    id         SERIAL PRIMARY KEY,
    date       TEXT NOT NULL,
    shift      TEXT DEFAULT 'all',
    title      TEXT DEFAULT '',
    content    TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ─── Settings ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- ─── Auth ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS passkey_credentials (
    id         TEXT PRIMARY KEY,
    public_key TEXT NOT NULL,
    counter    INTEGER NOT NULL DEFAULT 0,
    transports TEXT DEFAULT '[]',
    created_at TIMESTAMP DEFAULT NOW()
);

-- ─── AI System ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_history (
    id            SERIAL PRIMARY KEY,
    entity_type   TEXT NOT NULL,
    entity_id     INTEGER NOT NULL,
    action_type   TEXT NOT NULL,
    previous_data TEXT,
    created_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_usage (
    id         SERIAL PRIMARY KEY,
    tokens_in  INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    model      TEXT NOT NULL,
    tool_used  TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_conversations (
    id         SERIAL PRIMARY KEY,
    title      TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_messages (
    id              SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL,
    created_at      TIMESTAMP DEFAULT NOW()
);

-- ─── ChefSheet ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chefsheets (
    id                SERIAL PRIMARY KEY,
    photo_path        TEXT NOT NULL,
    sheet_date        TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'pending',
    raw_parse         TEXT DEFAULT NULL,
    confirmed_actions TEXT DEFAULT NULL,
    execution_log     TEXT DEFAULT NULL,
    model             TEXT DEFAULT '',
    tokens_in         INTEGER DEFAULT 0,
    tokens_out        INTEGER DEFAULT 0,
    created_at        TIMESTAMP DEFAULT NOW()
);

-- ─── Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_dishes_deleted_at ON dishes(deleted_at);
CREATE INDEX IF NOT EXISTS idx_dishes_name ON dishes(name);
CREATE INDEX IF NOT EXISTS idx_menus_deleted_at ON menus(deleted_at);
CREATE INDEX IF NOT EXISTS idx_menus_menu_type ON menus(menu_type);
CREATE INDEX IF NOT EXISTS idx_menu_dishes_menu_id ON menu_dishes(menu_id);
CREATE INDEX IF NOT EXISTS idx_menu_dishes_dish_id ON menu_dishes(dish_id);
CREATE INDEX IF NOT EXISTS idx_menu_dishes_course_id ON menu_dishes(course_id);
CREATE INDEX IF NOT EXISTS idx_menu_courses_menu_id ON menu_courses(menu_id);
CREATE INDEX IF NOT EXISTS idx_dish_ingredients_dish_id ON dish_ingredients(dish_id);
CREATE INDEX IF NOT EXISTS idx_dish_ingredients_ingredient_id ON dish_ingredients(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_dish_allergens_dish_id ON dish_allergens(dish_id);
CREATE INDEX IF NOT EXISTS idx_ingredient_allergens_ingredient_id ON ingredient_allergens(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_ingredients_name ON ingredients(name);
CREATE INDEX IF NOT EXISTS idx_dish_tags_tag_id ON dish_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_dish_substitutions_dish_id ON dish_substitutions(dish_id);
CREATE INDEX IF NOT EXISTS idx_dish_section_headers_dish_id ON dish_section_headers(dish_id);
CREATE INDEX IF NOT EXISTS idx_dish_components_dish_id ON dish_components(dish_id);
CREATE INDEX IF NOT EXISTS idx_dish_directions_dish_id ON dish_directions(dish_id);
CREATE INDEX IF NOT EXISTS idx_dish_service_directions_dish_id ON dish_service_directions(dish_id);
CREATE INDEX IF NOT EXISTS idx_service_notes_date ON service_notes(date);
CREATE INDEX IF NOT EXISTS idx_tasks_menu_id ON tasks(menu_id);
CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(completed);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
CREATE INDEX IF NOT EXISTS idx_tasks_source_dish_id ON tasks(source_dish_id);
CREATE INDEX IF NOT EXISTS idx_tasks_day_phase ON tasks(day_phase);
CREATE INDEX IF NOT EXISTS idx_tasks_is_next ON tasks(is_next);
CREATE INDEX IF NOT EXISTS idx_weekly_specials_dish_id ON weekly_specials(dish_id);
CREATE INDEX IF NOT EXISTS idx_weekly_specials_week ON weekly_specials(week_start, week_end);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created_at ON ai_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_id ON ai_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chefsheets_sheet_date ON chefsheets(sheet_date);
