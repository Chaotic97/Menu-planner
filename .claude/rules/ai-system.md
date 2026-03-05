---
globs: ["services/ai/**", "routes/ai.js", "public/js/components/commandBar.js", "public/js/components/chatDrawer.js"]
---
# AI System (Claude Haiku Integration)

## Architecture
- **Command bar** (`commandBar.js`): Fixed-bottom input. Dual mode: AI (online) / plain task (offline). Ctrl/Cmd+K to focus.
- **Chat drawer** (`chatDrawer.js`): Slide-out panel with multi-turn conversations. Ctrl/Cmd+Shift+K. Conversations in `ai_conversations`/`ai_messages` tables, 7-day auto-purge.
- **Confirmation flow**: Every AI tool call shows preview card. No mutation without user confirmation. Pending confirmations expire after 5 minutes.
- **Undo system**: Confirmed mutations snapshot to `ai_history`. 15-second undo window. 24h auto-purge.
- **Context**: Command bar sends `{ page, entityType, entityId }`. `aiContext.js` hydrates into data for system prompt.
- **Multi-step chaining**: Up to 3 auto-approved tools per message (agentic loop in `aiService.js`).

## Adding a new AI tool
1. Add tool definition to `TOOL_REGISTRY` in `services/ai/aiTools.js` (name, description, input_schema).
2. Add handler in the `handlers` object (same file) — implement both `preview` and `execute` paths.
3. Everything else (parsing, confirmation, undo) is automatic.

## Available tools
`create_menu`, `create_dish`, `create_task`, `add_dish_to_menu`, `cleanup_recipe`, `check_allergens`, `scale_recipe`, `convert_units`, `add_service_note`, `search_dishes`, `lookup_dish`, `lookup_menu`, `search_ingredients`, `search_tasks`, `search_service_notes`, `get_shopping_list`, `get_system_summary`

## Future: AI task timing
Schema is structured for `estimated_duration` and `suggested_start_time` columns on `tasks` table — deliberately deferred.
