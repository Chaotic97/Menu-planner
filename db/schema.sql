PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS dishes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    description     TEXT DEFAULT '',
    category        TEXT NOT NULL DEFAULT 'main' CHECK(category IN (
                        'starter','main','dessert','side','soup','salad',
                        'bread','sauce','beverage','other'
                    )),
    photo_path      TEXT DEFAULT NULL,
    chefs_notes     TEXT DEFAULT '',
    suggested_price REAL DEFAULT 0,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ingredients (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    unit_cost   REAL DEFAULT 0,
    base_unit   TEXT DEFAULT 'g',
    category    TEXT DEFAULT 'other' CHECK(category IN (
                    'produce','dairy','meat','seafood',
                    'dry goods','spices','oils','other'
                ))
);

CREATE TABLE IF NOT EXISTS dish_ingredients (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    dish_id         INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
    ingredient_id   INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
    quantity        REAL NOT NULL DEFAULT 0,
    unit            TEXT NOT NULL DEFAULT 'g',
    prep_note       TEXT DEFAULT '',
    UNIQUE(dish_id, ingredient_id)
);

CREATE TABLE IF NOT EXISTS allergen_keywords (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword     TEXT NOT NULL COLLATE NOCASE,
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

CREATE TABLE IF NOT EXISTS menus (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT DEFAULT '',
    is_active   INTEGER DEFAULT 1,
    sell_price  REAL DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS weekly_specials (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    dish_id     INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
    week_start  TEXT NOT NULL,
    week_end    TEXT NOT NULL,
    notes       TEXT DEFAULT '',
    is_active   INTEGER DEFAULT 1,
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS menu_dishes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_id     INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
    dish_id     INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
    sort_order  INTEGER DEFAULT 0,
    servings    INTEGER DEFAULT 1,
    UNIQUE(menu_id, dish_id)
);
