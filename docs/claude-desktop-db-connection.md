# Connecting Claude Desktop to the PlateStack Database

PlateStack stores all data in a single SQLite file (`menu-planner.db`). Claude Desktop can connect directly to this file using the **SQLite MCP server**, giving Claude read (and optionally write) access to your dishes, menus, ingredients, tasks, and everything else in the database.

## Prerequisites

- [Claude Desktop](https://claude.ai/download) installed
- [Node.js](https://nodejs.org/) v18+ (you already have this if you run PlateStack)
- The PlateStack database file on disk (created automatically when you first run `npm start`)

## How It Works

```
Claude Desktop  ──MCP protocol──▶  SQLite MCP Server  ──file I/O──▶  menu-planner.db
```

Claude Desktop communicates with a lightweight MCP (Model Context Protocol) server process that reads and writes the SQLite database file directly. This is a local connection — no network, no API keys, no server required.

## Setup

### 1. Find your database file

By default the database lives at the project root:

```
/path/to/Menu-planner/menu-planner.db
```

If you set the `DB_PATH` environment variable when running the server, use that path instead.

### 2. Configure Claude Desktop

Open Claude Desktop settings and edit the MCP configuration file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Add the SQLite MCP server entry:

```json
{
  "mcpServers": {
    "platestack-db": {
      "command": "npx",
      "args": [
        "-y",
        "@anthropic-ai/mcp-server-sqlite",
        "/absolute/path/to/Menu-planner/menu-planner.db"
      ]
    }
  }
}
```

Replace `/absolute/path/to/Menu-planner/menu-planner.db` with the actual absolute path to your database file.

### 3. Restart Claude Desktop

Close and reopen Claude Desktop. You should see a hammer icon in the chat input indicating MCP tools are available. Click it to confirm the SQLite tools are listed.

## Available MCP Tools

Once connected, Claude Desktop can use these tools against your database:

| Tool | Description |
|------|-------------|
| `read_query` | Run SELECT queries to read data |
| `write_query` | Run INSERT/UPDATE/DELETE statements |
| `create_table` | Create new tables |
| `list_tables` | List all tables in the database |
| `describe_table` | Show column names, types, and constraints for a table |
| `append_insight` | Save analytical insights as a memo resource |

## Example Prompts

Once connected, you can ask Claude things like:

- "Show me all my dishes and their total ingredient costs"
- "Which menus have a food cost percentage above 35%?"
- "List all ingredients that are out of stock"
- "What allergens are present across all dishes on the Friday Dinner menu?"
- "Show me the most expensive dishes by cost per portion"
- "Find all tasks that are still incomplete and due today"

### Example Queries Claude Might Run

```sql
-- All active dishes with cost info
SELECT id, name, category, batch_yield, suggested_price
FROM dishes
WHERE deleted_at IS NULL
ORDER BY name;

-- Ingredient cost breakdown for a dish
SELECT i.name, di.quantity, di.unit, i.unit_cost,
       (di.quantity * i.unit_cost) AS line_cost
FROM dish_ingredients di
JOIN ingredients i ON i.id = di.ingredient_id
WHERE di.dish_id = 1 AND di.row_type = 'ingredient';

-- Allergen summary across a menu
SELECT d.name AS dish, da.allergen, da.source
FROM menu_dishes md
JOIN dishes d ON d.id = md.dish_id
JOIN dish_allergens da ON da.dish_id = d.id
WHERE md.menu_id = 1 AND d.deleted_at IS NULL
ORDER BY d.name, da.allergen;
```

## Important Considerations

### Concurrent access

PlateStack uses **sql.js** (an in-memory SQLite engine) that loads the `.db` file into memory on startup and writes back periodically (500ms debounce). This means:

- **Server running + MCP reading**: The MCP server opens the file separately. It will see the last flushed state, which may lag up to 500ms behind the in-memory state. In practice this is fine for analysis.
- **Server running + MCP writing**: Both processes write to the same file independently. The server's next disk flush will overwrite MCP changes, and vice versa. **Stop the PlateStack server before making writes through Claude Desktop** to avoid data loss.
- **Server stopped + MCP access**: Full read/write access with no conflicts. This is the safest mode for making changes.

### Read-only mode (recommended)

If you only need to query data while the server is running, you can enforce read-only access by telling Claude in your system prompt or conversation: "Only use read_query, never write_query." The MCP server itself doesn't have a read-only flag, so this relies on instruction-following.

### Database schema reference

See the [Database Tables section in CLAUDE.md](../CLAUDE.md) for the full table reference. Key tables:

- `dishes` — Recipes with cost, yield, and category info
- `ingredients` — Master ingredient list with unit costs
- `dish_ingredients` — Links ingredients to dishes with quantities
- `dish_allergens` — EU 14 allergen flags per dish
- `menus` — Menu definitions with pricing and cover counts
- `menu_dishes` — Links dishes to menus with servings
- `tasks` — Prep and custom tasks with priority and timing
- `service_notes` — Daily kitchen notes by shift

### Production (DigitalOcean)

On the production server, the database lives at the path specified by `DB_PATH` in the environment. Since MCP is a local protocol, Claude Desktop can only connect to a database file on your local machine. To analyze production data:

1. Download a backup: visit PlateStack Settings and use the backup/export feature, or `scp` the file from the server.
2. Point the MCP config at the downloaded `.db` file.
3. Query freely — it's a snapshot, so no conflict risk.
