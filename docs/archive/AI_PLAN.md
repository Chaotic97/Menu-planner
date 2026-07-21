# PlateStack AI Assistant — Implementation Plan

## Vision

A context-aware AI command bar powered by Claude Haiku, embedded in PlateStack's existing quick-capture bar. Handles recipe cleanup, natural language commands, smart ingredient matching, and allergen verification. Designed for zero friction — every AI action requires confirmation and is undoable.

---

## V1 Scope

### Core Features

1. **Universal Command Bar** — Replaces the current quick-add task bar with a dual-mode input:
   - **Online (AI mode):** Input routes through Claude Haiku. Haiku interprets intent, suggests an action, user confirms.
   - **Offline (plain mode):** Falls back to current quick-add task behaviour (title → create task).

2. **Recipe Cleanup** — Context-aware button on dish form/view. Sends directions + ingredients to Haiku, returns cleaned/standardised steps. Shows before/after diff for confirmation.

3. **Function Calling (Tool Use)** — Haiku has access to a defined set of tools. User types natural language, Haiku picks the right tool, user confirms, app executes.

4. **Smart Ingredient Matching** — During recipe import, Haiku matches incoming ingredient names to existing ingredients in the database to prevent duplicates.

5. **Allergen Verification** — "Check allergens" command reads dish ingredients and flags potential allergens the keyword-based detector might miss.

6. **Smart Recipe Scaling** — Beyond simple multiplication: Haiku provides chef-aware scaling advice (salt ratios, batch splitting, timing adjustments).

7. **Settings UI** — API key input, usage tracking display, configurable daily/monthly usage limits, feature toggles.

### V1 Tool Definitions (Function Calling)

| Tool | Description | Parameters |
|------|-------------|------------|
| `create_menu` | Create a new menu | name, description? |
| `create_dish` | Create a new dish | name, category?, description? |
| `add_dish_to_menu` | Add existing dish to a menu | dish_name (fuzzy matched), menu_name (fuzzy matched), servings? |
| `create_task` | Create a task | title, priority?, due_date?, type? |
| `cleanup_recipe` | Clean up directions for current dish | dish_id (from page context) |
| `check_allergens` | Verify allergens for current dish | dish_id (from page context) |
| `scale_recipe` | Smart scaling advice | dish_id (from context), target_portions |
| `convert_units` | Volume-to-weight or unit conversion | ingredient_name, from_qty, from_unit, to_unit? |
| `add_service_note` | Create a service note | title, content, date?, shift? |
| `search_dishes` | Find dishes by description | query |

---

## Architecture

### Backend

```
services/ai/
  aiService.js        — Anthropic SDK wrapper
                        - Single entry point: processCommand(message, context, conversationHistory?)
                        - Handles API calls with retry (3x exponential backoff)
                        - Tracks usage (tokens in/out) per request
                        - Returns structured response: { action, parameters, message, requiresConfirmation }

  aiTools.js          — Tool registry (expandable)
                        - Each tool: { name, description, parameters (JSON schema), handler(params, context) }
                        - handler() returns { preview, execute() }
                        - preview: human-readable description of what will happen
                        - execute(): performs the actual DB mutation, returns result
                        - Adding a new tool = adding one object to the registry array

  aiContext.js        — Builds context payloads
                        - Takes: { page, entityId, entityType } from frontend
                        - Hydrates from DB: current dish details, menu details, ingredient list, etc.
                        - Returns a concise system prompt section with relevant data
                        - Keeps context small: only load what's relevant to the current page

  aiHistory.js        — Undo/snapshot system
                        - saveSnapshot(entityType, entityId, previousData) → history_id
                        - restoreSnapshot(historyId) → applies previous data back
                        - cleanupOld() → purge snapshots older than 24 hours
                        - Called automatically before any AI-initiated mutation

routes/
  ai.js               — AI endpoints
                        POST /api/ai/command        — Main entry: { message, context, conversationHistory? }
                                                      Returns: { response, action?, preview?, confirmationId? }
                        POST /api/ai/confirm/:id    — Execute a confirmed action
                                                      Returns: { result, undoId }
                        POST /api/ai/undo/:id       — Restore snapshot
                                                      Returns: { success }
                        GET  /api/ai/usage          — Current usage stats

  Settings additions:
    POST /api/ai/settings       — Save AI config (API key, limits, feature toggles)
    GET  /api/ai/settings       — Get AI config (key masked for display)
```

### Frontend

```
public/js/
  components/
    commandBar.js      — Replaces quickCapture.js
                          - Same fixed-bottom position and visual style
                          - Online: sparkle/AI icon on send button, input placeholder "Ask AI or add a task..."
                          - Offline: plus icon, placeholder "Quick add a task..."
                          - Detects online/offline via navigator.onLine + event listeners
                          - Sends current page context with every AI request:
                            { page: window.location.hash, entityId, entityType }
                          - Shows inline confirmation card below input on AI response
                          - Handles Enter to submit, Escape to dismiss confirmation

    aiPreview.js       — Confirmation/preview component
                          - Renders below command bar as a card
                          - Shows: AI message + action description + Confirm/Cancel buttons
                          - For recipe cleanup: shows before/after diff view
                          - For creates: shows what will be created
                          - Confirm → POST /api/ai/confirm/:id → success toast with Undo
                          - Cancel → dismiss, no action taken

    chatDrawer.js      — (Level 2 prep) Slide-out chat panel
                          - Not wired up in v1, but file created with basic structure
                          - Will reuse aiService.js with conversationHistory parameter
                          - Triggered by expand button on command bar or keyboard shortcut

  pages/
    settings.js        — Add new "AI Assistant" section:
                          - API key input (password field, with show/hide toggle)
                          - Usage display: requests today / this month, tokens used
                          - Daily limit input (0 = unlimited)
                          - Monthly limit input (0 = unlimited)
                          - Feature toggles: recipe cleanup, smart matching, allergen check
```

### Database

```sql
-- New table: AI action history for undo
CREATE TABLE IF NOT EXISTS ai_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,        -- 'dish', 'menu', 'task', etc.
  entity_id INTEGER NOT NULL,
  action_type TEXT NOT NULL,         -- 'create', 'update', 'delete'
  previous_data TEXT,                -- JSON snapshot of entity before change
  created_at TEXT DEFAULT (datetime('now'))
);

-- New table: AI usage tracking
CREATE TABLE IF NOT EXISTS ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  model TEXT NOT NULL,
  tool_used TEXT,                     -- which tool was called, if any
  created_at TEXT DEFAULT (datetime('now'))
);

-- Settings table additions (existing key-value store):
--   ai_api_key          — encrypted Anthropic API key
--   ai_daily_limit      — max requests per day (0 = unlimited)
--   ai_monthly_limit    — max requests per month (0 = unlimited)
--   ai_features         — JSON { cleanup: true, matching: true, allergens: true, scaling: true }
```

### Confirmation & Undo Flow

```
User types: "create a menu called Friday Dinner"
  │
  ├─► Frontend sends POST /api/ai/command
  │     { message: "create a menu called Friday Dinner", context: { page: "#/menus" } }
  │
  ├─► Backend: Haiku processes with tool definitions
  │     → Haiku calls create_menu tool with { name: "Friday Dinner" }
  │     → Backend does NOT execute yet, stores pending action
  │     → Returns: { preview: "Create menu: 'Friday Dinner'", confirmationId: "abc123" }
  │
  ├─► Frontend shows confirmation card:
  │     "Create menu: 'Friday Dinner'"  [Confirm] [Cancel]
  │
  ├─► User clicks Confirm
  │     → POST /api/ai/confirm/abc123
  │     → Backend executes: INSERT INTO menus ...
  │     → Saves snapshot to ai_history (for creates: just the new ID for deletion on undo)
  │     → Broadcasts 'menu_created'
  │     → Returns: { result: { id: 7 }, undoId: "def456" }
  │
  ├─► Frontend shows toast: "Menu 'Friday Dinner' created" [Undo]
  │     → Undo button visible for 15 seconds
  │
  └─► If Undo clicked:
        → POST /api/ai/undo/def456
        → Backend restores snapshot (for creates: deletes the menu)
        → Broadcasts 'menu_deleted'
        → Toast: "Undone"
```

### Recipe Cleanup Flow

```
User on dish edit page (#/dishes/42/edit), types: "clean up the directions"
  │
  ├─► Frontend sends POST /api/ai/command
  │     { message: "clean up the directions",
  │       context: { page: "#/dishes/42/edit", entityType: "dish", entityId: 42 } }
  │
  ├─► Backend: aiContext.js hydrates dish 42 (directions, ingredients, name)
  │     → Haiku receives dish context + cleanup_recipe tool
  │     → Returns cleaned directions array
  │     → Backend stores pending action with before/after
  │     → Returns: { preview: { before: [...], after: [...] }, confirmationId: "xyz" }
  │
  ├─► Frontend shows diff view in aiPreview.js:
  │     Before                          After
  │     ─────────                       ─────────
  │     chop the onions real fine       1. Brunoise the onions
  │     put in pan with oil             2. Sauté in oil over medium heat...
  │     [Confirm] [Cancel]
  │
  ├─► User clicks Confirm
  │     → Snapshot saved: original directions
  │     → Directions replaced in DB
  │     → Dish form re-renders with new directions
  │     → Toast with Undo (15s)
  │
  └─► Undo restores original directions from snapshot
```

### Context Awareness

The command bar always knows what page you're on:

| Page | Context sent | Enables |
|------|-------------|---------|
| `#/dishes/:id/edit` | Dish ID, full dish data | "clean up directions", "check allergens", "scale to 20" |
| `#/dishes/:id` | Dish ID, dish data | "check allergens", "duplicate this" |
| `#/menus/:id` | Menu ID, menu data + dishes | "add salmon to this menu", "what's the food cost?" |
| `#/menus` | List of menus | "create a menu called X" |
| `#/dishes` | Dish list summary | "create a dish called X" |
| `#/todos` | Task list summary | "add a task: call fish supplier" |
| `#/shopping` | Current shopping context | "what do I need for Friday?" |
| Any page | Minimal context | "create a task", "create a menu" (always works) |

---

## Implementation Order

### Phase 1: Foundation (backend infrastructure)
1. Install `@anthropic-ai/sdk` dependency
2. Add DB migrations: `ai_history`, `ai_usage` tables
3. Create `services/ai/aiService.js` — SDK wrapper with retry, usage tracking
4. Create `services/ai/aiHistory.js` — snapshot save/restore/cleanup
5. Create `services/ai/aiContext.js` — context builder
6. Create `services/ai/aiTools.js` — tool registry with initial tools: `create_menu`, `create_task`, `create_dish`
7. Create `routes/ai.js` — `/api/ai/command`, `/confirm/:id`, `/undo/:id`, `/usage`, `/settings`
8. Mount routes in `server.js`
9. Add AI settings to `middleware/auth.js` PUBLIC_PATHS if needed
10. Write integration tests for AI routes

### Phase 2: Command Bar (frontend core)
11. Create `public/js/components/commandBar.js` — replaces `quickCapture.js`
12. Create `public/js/components/aiPreview.js` — confirmation card component
13. Add API functions to `api.js`: `aiCommand()`, `aiConfirm()`, `aiUndo()`, `getAiUsage()`, `getAiSettings()`, `saveAiSettings()`
14. Update `app.js`: replace `initQuickCapture()` with `initCommandBar()`
15. Add CSS for command bar and preview card
16. Handle online/offline mode switching

### Phase 3: Settings UI
17. Add "AI Assistant" section to `settings.js`
18. API key input with masked display
19. Usage stats display
20. Configurable limits (daily/monthly)
21. Feature toggles

### Phase 4: Recipe Cleanup Tool
22. Add `cleanup_recipe` tool to `aiTools.js`
23. Build diff view in `aiPreview.js` for before/after directions
24. Context-aware: works from dish edit page
25. Handles standardisation, readability, timing extraction

### Phase 5: Smart Features
26. Add `check_allergens` tool
27. Add `scale_recipe` tool
28. Add `convert_units` tool
29. Smart ingredient matching tool for imports
30. Add `add_dish_to_menu` tool with fuzzy name matching
31. Add `search_dishes` tool
32. Add `add_service_note` tool

### Phase 6: Polish & Chat Drawer Prep
33. Chat drawer component skeleton (`chatDrawer.js`) — not wired up yet
34. Keyboard shortcuts (Cmd/Ctrl+K to focus command bar)
35. Comprehensive error handling and edge cases
36. Usage limit enforcement
37. ai_history auto-purge on startup (24h)

---

## V1 Status: COMPLETE

All V1 features are implemented and tested:
- Command bar with dual mode (AI/plain task)
- 10 function-calling tools with confirmation flow
- Recipe cleanup with before/after diff
- Smart ingredient matching during import
- Undo system with 24h snapshot retention
- Settings UI (API key, usage limits, feature toggles)
- Chat drawer wired up with keyboard shortcut (Ctrl/Cmd+Shift+K)
- 69 tests covering AI routes, tools, and history

---

## V2 Roadmap

### Design Decisions (from stakeholder interview)

**Chat drawer direction:** Keep it as Q&A but make it deeply context-aware. It should be able to load and search any data in the system — not just the current page. Use on-demand tool calls to fetch data (not full DB preload) to keep costs low and latency fast. Haiku's 200K context window could fit ~15-25K tokens of full DB summary, but that wastes tokens on most queries.

**AI autonomy:** Auto-approve read-only actions (search, allergen check, scaling advice, unit conversion) and simple creates (tasks, service notes). Keep confirmation for mutations that are harder to undo (dish/menu creates, recipe cleanup, adding dishes to menus). Add this as a configurable setting.

**Top priorities (in order):**
1. Smart chat with DB search tools
2. Document upload & AI parsing
3. Auto prep timeline with dependency ordering
4. Price point & yield advisor
5. Menu generation from existing dishes

**Offline:** Not a priority. Current plain-task fallback is sufficient.

---

### Phase 7: Smart Chat with Search Tools (NEXT)

**Goal:** The chat drawer becomes a powerful Q&A assistant that can look up any information in the system on demand.

**New chat-specific tools** (added to `aiTools.js`):

| Tool | Description | Returns |
|------|-------------|---------|
| `lookup_dish` | Get full details of a dish by ID or name | Dish with ingredients, allergens, directions, cost |
| `lookup_menu` | Get full details of a menu by ID or name | Menu with dishes, costs, allergens |
| `lookup_ingredient` | Get ingredient details + which dishes use it | Ingredient with usage list |
| `search_ingredients` | Search ingredients by name | List of matching ingredients |
| `search_tasks` | Search tasks by title, type, or status | List of matching tasks |
| `search_service_notes` | Search service notes by date or content | List of matching notes |
| `get_shopping_list` | Get shopping list for a menu | Aggregated ingredient list |
| `get_system_summary` | Get high-level stats about the system | Dish count, menu count, task counts, recent activity |

**Implementation:**
- These tools are read-only — they return data as text for Haiku to synthesize into answers
- No confirmation needed (auto-approved since they don't mutate data)
- Chat drawer sends `conversationHistory` for multi-turn context
- Page context still auto-loaded, but now Haiku can also actively search

**Example interactions:**
- "What dishes use truffle?" → `search_ingredients` + `lookup_dish` for each
- "What's the food cost on the Friday menu?" → `lookup_menu` with cost breakdown
- "How many tasks are overdue?" → `search_tasks` with overdue filter
- "Show me all gluten-free starters" → `search_dishes` with allergen filter

### Phase 8: Document Upload & AI Parsing

**Goal:** Users can upload PDFs, text files, or images of event briefs, supplier lists, or menu specs. AI extracts structured data and helps create dishes/menus/tasks from it.

**New endpoint:**
```
POST /api/ai/parse-document
  Body: multipart/form-data { file, intent }
  - file: PDF, .txt, .docx, or image
  - intent: 'event_brief' | 'supplier_list' | 'menu_spec' | 'general'
  Returns: { parsed_data, suggestions[] }
```

**How it works:**
1. Backend extracts text from the uploaded file (PDF → text, docx → text, image → describe to Haiku)
2. Text is sent to Haiku with a structured prompt based on `intent`
3. Haiku returns structured JSON: extracted dishes, ingredient lists, event details, cover counts, etc.
4. Frontend shows a preview of what was extracted with Confirm/Edit/Cancel
5. On confirm, relevant entities are created (menus, tasks, notes)

**Use cases:**
- Upload an event brief PDF → AI extracts date, covers, dietary requirements, creates menu + tasks
- Upload a supplier price list → AI updates ingredient costs
- Upload a competitor's menu → AI creates comparable dish entries
- Paste any text → AI figures out what it is and suggests next steps

**File handling:**
- Max file size: 5MB
- Text extraction: `pdf-parse` for PDFs, `mammoth` for docx (already have docx support)
- Images: sent directly to Haiku as base64 (Haiku is multimodal)
- Extracted text truncated to ~50K tokens to stay within budget

### Phase 9: Auto-Approve for Low-Risk Actions

**Goal:** Skip the confirmation step for actions that don't modify data or are easily undone.

**Auto-approved tools:**
- `search_dishes` — read-only
- `check_allergens` — read-only (returns analysis text)
- `scale_recipe` — read-only (returns advice text)
- `convert_units` — read-only (returns conversion text)
- `create_task` — low-risk create with easy undo
- `add_service_note` — low-risk create with easy undo
- All new chat search tools (Phase 7)

**Still requires confirmation:**
- `create_menu` — moderate impact
- `create_dish` — moderate impact
- `add_dish_to_menu` — modifies existing menu
- `cleanup_recipe` — replaces directions (high impact)

**Implementation:**
- Add `autoApprove: true` flag to tool definitions in `aiTools.js`
- In `processCommand()`, if the tool has `autoApprove: true`, execute immediately and return result (no `confirmationId`)
- Add a "Trust Mode" toggle in AI Settings to let users disable all confirmations
- Auto-approved actions still create undo snapshots

### Phase 10: Auto Prep Timeline

**Goal:** Given a menu and service time, AI generates a backwards-planned prep schedule with dependency ordering.

**New tool: `generate_prep_schedule`**
```
Parameters:
  - menu_id: number (required)
  - service_time: string (HH:MM, required)
  - available_hours: number (optional, total prep hours available)
```

**How it works:**
1. Loads all dishes on the menu with full directions
2. Sends to Haiku with a chef-specific prompt about prep scheduling
3. Haiku analyzes dependencies (stock before sauce, dough rest before baking, etc.)
4. Returns a time-bucketed schedule: `[{ time: "08:00", tasks: [...], dependencies: [...] }]`
5. Creates persistent tasks in the `tasks` table with `due_time` and `timing_bucket`

**Key intelligence:**
- Dependency ordering: "make stock" must come before "make sauce"
- Parallel tasks: "while the stock simmers, prep the veg"
- Rest/cooling time: "dough needs 1h rest — start at 09:00 for 10:00 shaping"
- Equipment conflicts: don't schedule two oven dishes at the same time
- Service time countdown: everything works backwards from the target time

### Phase 11: Price Point & Yield Advisor

**Goal:** AI suggests optimal sell prices and estimates ingredient waste/yield.

**New tools:**

| Tool | Description |
|------|-------------|
| `suggest_price` | Analyzes dish cost, market positioning, and existing pricing patterns to suggest a sell price |
| `estimate_yield` | For a given ingredient, estimates trim waste and usable yield percentage |
| `optimize_food_cost` | Suggests ingredient swaps or portion adjustments to hit a target food cost % |

**Data sources for pricing:**
- Current dish food cost
- Existing dish pricing patterns (what similar dishes sell for)
- Category benchmarks (starters typically priced X, mains Y)
- Target food cost % (configurable, default 30%)

**Yield estimation:**
- Built-in knowledge of common ingredients (e.g., whole chicken = ~65% usable yield)
- Factors in prep method from directions (peeled vs unpeeled, trimmed vs untrimmed)
- Suggests adjusting recipe quantities to account for waste

### Phase 12: Menu Generation from Existing Dishes

**Goal:** AI assembles menus from the dish library based on constraints.

**New tool: `generate_menu`**
```
Parameters:
  - constraints: {
      budget_per_cover?: number,
      allergen_free?: string[],
      courses?: { starter: number, main: number, dessert: number },
      style?: string (e.g., "casual", "fine dining", "family"),
      season?: string
    }
  - base_menu_id?: number (optional, start from existing menu and modify)
```

**How it works:**
1. Loads all available dishes with costs and allergens
2. Haiku selects dishes that fit constraints (budget, allergens, balance)
3. Returns a proposed menu with reasoning for each choice
4. User reviews, swaps dishes, then confirms
5. Menu is created with selected dishes

**AI also helps with:**
- Menu descriptions (customer-facing copy)
- Cover count recommendations based on event docs
- Identifying gaps ("you have no vegetarian main option")

---

## Future Ideas (Post-V2)

### Level 3: Proactive Suggestions
- Haiku monitors actions and offers contextual suggestion chips (non-blocking)
- "This dish has no allergens flagged but contains flour — should I add gluten?"
- "Food cost is 38% — want me to suggest alternatives?"
- "You have 5 dishes with truffle — consider a truffle-themed special?"

### Infrastructure Evolution
- **Conversation persistence** — store chat history in DB for cross-session context
- **Model flexibility** — Sonnet for complex tasks (recipe generation, menu analysis), Haiku for quick commands
- **Prompt caching** — cache system prompts with tool definitions to reduce token costs
- **Streaming responses** — SSE for longer outputs (recipe generation, menu analysis)
- **Custom tool builder** — settings UI to define custom tools ("when I say X, do Y")
- **Voice input** — Web Speech API for hands-free kitchen use

### Additional Tool Ideas
- **Inventory-aware suggestions** — "what can I make with what's in stock?"
- **Supplier order drafting** — generate order emails from shopping list
- **Weekly specials copywriting** — generate specials descriptions for customers
- **Recipe generation** — "create a dish using seasonal ingredients for spring"
- **Menu analysis** — "is this menu balanced? any gaps?"
- **Training assistant** — "explain how to make a beurre blanc to a commis chef"

---

## Key Design Principles

1. **Smart confirmation** — Read-only and low-risk actions auto-approve; high-impact mutations require explicit confirmation. Configurable via "Trust Mode" setting.
2. **Always undoable** — Every AI action creates a snapshot; undo available for 15 seconds via toast, restorable for 24 hours via history
3. **Context-aware by default** — The command bar and chat drawer always know what page you're on. Chat can also actively search the entire DB via tool calls.
4. **Graceful degradation** — Offline = plain task bar. No API key = plain task bar. Rate limited = plain task bar with message.
5. **Expandable** — New tool = new object in the registry. No other changes needed.
6. **Minimal footprint** — AI code is isolated in `services/ai/` and `routes/ai.js`. If you rip it out, nothing else breaks.
7. **Cost-conscious** — Usage tracked per request, configurable limits. On-demand search tools (not full DB preload) keep input tokens low. Haiku for speed and cost.

---

## Dependencies

| Package | Purpose | Size |
|---------|---------|------|
| `@anthropic-ai/sdk` | Official Anthropic SDK for Node.js | ~2MB |

No other new dependencies required. The SDK handles auth, retries, streaming, and tool use natively.

---

## Security Considerations

- API key stored encrypted in `settings` table (not plaintext)
- API key never sent to frontend (masked on GET, full value only on POST)
- All AI endpoints require authentication (behind existing auth middleware)
- Rate limiting on `/api/ai/command` to prevent abuse
- Input sanitisation: user messages are passed to Haiku as-is (Haiku handles arbitrary text) but tool outputs are validated before DB writes
- Pending confirmations expire after 5 minutes (no stale actions)
- SSRF protection: AI cannot make arbitrary HTTP requests; all actions go through defined tool handlers
