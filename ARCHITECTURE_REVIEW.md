# Menu Planner Architecture Overview

## Introduction
The Menu Planner is a chef-focused web application designed to handle menu planning, allergen detection, costing, and prep task generation. The architecture follows a traditional client-server model, utilizing a monolithic Express.js backend and a Vanilla JavaScript Single Page Application (SPA) frontend, with real-time data synchronization over WebSockets. It also heavily leverages AI integrations to assist users.

## Technology Stack
- **Frontend:** Vanilla HTML, CSS, JavaScript (configured as a Progressive Web App - PWA)
- **Backend:** Node.js with Express
- **Database:** PostgreSQL (with `pg` module)
- **Real-time Communication:** WebSockets (`ws`)
- **Testing:** Jest (Unit/Integration) & Playwright (E2E)
- **AI Integration:** Anthropic Claude (via native SDK & Google Cloud Vertex AI)

---

## 1. Frontend Architecture
The frontend is built without any heavy frameworks (like React or Vue), relying entirely on modular Vanilla JavaScript.

- **Entry Point:** `public/index.html` serves as the application shell.
- **Routing:** Handled entirely client-side via a hash-based router (`#/menus`, `#/dishes/new`, etc.) located in `public/js/app.js`.
- **Modularity:**
  - Code is split into features under `public/js/pages/` (e.g., `menuList.js`, `dishForm.js`).
  - Reusable components reside in `public/js/components/`.
  - API communication happens centrally in `public/js/api.js`.
- **State Management & Sync:** `public/js/sync.js` manages state and integrates WebSocket listeners. When the backend broadcasts updates, the frontend intelligently updates specific DOM elements or refetches data to keep the UI fresh across multiple clients.
- **PWA Features:** It utilizes a `manifest.json` and a `service-worker.js` for offline capabilities and native-like installation.

---

## 2. Backend Architecture
The backend is an Express application structured with a clear separation of concerns into Routes, Services, and Middleware.

- **Entry Point:** `server.js` initializes Express, sets up session management (persisted to file), connects to the database, configures WebSockets, and mounts routes.
- **Routing Layer (`routes/`):**
  - Controllers are mapped directly to Express routes.
  - Typical RESTful API design handles entities like `menus`, `dishes`, `ingredients`, `todos`, etc.
  - Endpoints utilize an `asyncHandler` middleware to gracefully pass async errors to the global Express error handler.
- **Service Layer (`services/`):**
  - Encapsulates complex business logic away from the routes.
  - Key services include:
    - `costCalculator.js`: Calculates dish and menu costs based on ingredient prices.
    - `allergenDetector.js`: Automatically detects potential allergens based on ingredient relationships.
    - `taskGenerator.js` & `prepTaskGenerator.js`: Auto-generate prep lists.
    - `docxImporter.js` / `textExtractor.js`: Handles parsing of uploaded documents (Word, PDF) into structured recipe data.
- **Middleware (`middleware/`):** Handles authentication (`auth.js`) and rate-limiting.
- **Real-Time Engine:**
  - A WebSocket server runs alongside the HTTP server.
  - Express routes are injected with a `req.broadcast(type, payload, excludeClientId)` function, allowing them to notify all connected clients (except the sender) of data mutations (e.g., `menu_updated`).

---

## 3. Database Architecture
- Uses **PostgreSQL**, interacting directly through the `pg` driver using raw parameterized SQL queries (no ORM like Prisma or Sequelize is used, though the query style resembles prepared statements common in SQLite wrappers, adapted for Postgres).
- **Initialization:** `db/init.js` handles dropping existing tables and running schema creation scripts (`schema-pg.sql`).
- **Core Entities:** `menus`, `dishes`, `ingredients`, `menu_dishes` (join table), `tasks`, `ingredient_allergens`.
- **Soft Deletes:** Widely utilizes a `deleted_at` timestamp rather than hard-deleting records to allow for restoration and auditing.

---

## 4. AI Integration (`services/ai/`)
A significant and advanced feature of this architecture is the AI assistant layer.

- **Provider:** Anthropic's Claude (`claude-haiku-4-5-20251001`), optionally routed via Google Cloud Vertex AI or direct Anthropic APIs.
- **Agentic Loop:** The `aiService.js` implements a custom agentic loop. It allows the AI to autonomously chain tool calls (up to `MAX_TOOL_ROUNDS`) without human intervention if the tools are "auto-approved".
- **Context Awareness:** The system builds dynamic context (`aiContext.js`) based on what page the user is currently viewing on the frontend (e.g., passing the currently viewed Menu or Dish into the system prompt).
- **Tooling:** `aiTools.js` defines the schema of tools the AI can use (e.g., lookup menus, calculate costs, suggest pairings) and maps them back to the existing Service Layer functions.
- **Streaming:** Supports Server-Sent Events (SSE) or WebSocket streaming for a real-time Chat Drawer UI experience.

---

## 5. Security & Authentication
- **Session Management:** Standard cookie-based sessions, persisted to disk using `session-file-store`.
- **Authentication:** Integrates modern WebAuthn / Passkeys via `@simplewebauthn` to allow passwordless, biometric logins.
- **Validation:** Relies on manual route-level validation before executing SQL statements.

---

## Conclusion
The application employs a robust, straightforward monolithic architecture. By eschewing heavy frameworks (No React, No ORM) in favor of Vanilla JS and Raw SQL, the codebase remains fast, transparent, and easy to trace. The standout architectural feature is the tight integration of the AI agent loop directly into the backend service layer, allowing it to act as an active participant in manipulating the database via predefined tools, rather than just a passive chat bot.