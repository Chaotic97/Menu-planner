const express = require('express');
const cors = require('cors');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { getDb } = require('./db/database');
const authMiddleware = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads directory exists
const uploadsDir = process.env.UPLOADS_PATH || path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Ensure sessions directory exists
const sessionsDir = process.env.SESSIONS_PATH || path.join(__dirname, 'sessions');
if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());

// Session middleware — persists to disk so logins survive server restarts
app.use(session({
  store: new FileStore({
    path: sessionsDir,
    ttl: 7 * 24 * 60 * 60, // 7 days in seconds
    retries: 1,
    logFn: () => {}, // silence verbose logging
  }),
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production' && process.env.FORCE_HTTPS === '1',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
  },
}));

// Auth middleware (blocks unauthenticated API requests)
app.use(authMiddleware);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

// Create HTTP server for both Express and WebSocket
const server = http.createServer(app);

// WebSocket setup
let WebSocketServer;
try {
  WebSocketServer = require('ws').WebSocketServer;
} catch {
  console.warn('ws package not installed. Real-time sync disabled. Run: npm install ws');
}

const clients = new Map(); // clientId -> ws

function broadcast(type, payload, excludeClientId) {
  const message = JSON.stringify({ type, payload });
  for (const [cid, ws] of clients) {
    if (cid !== excludeClientId && ws.readyState === 1) {
      ws.send(message);
    }
  }
}

if (WebSocketServer) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    let clientId = null;

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'identify' && msg.clientId) {
          clientId = msg.clientId;
          clients.set(clientId, ws);
        }
      } catch {}
    });

    ws.on('close', () => {
      if (clientId) clients.delete(clientId);
    });
  });
}

// Initialize database then start server
async function start() {
  await getDb();
  console.log('Database ready.');

  // Routes
  app.use('/api/auth', require('./routes/auth'));

  const dishesRouter = require('./routes/dishes');
  const menusRouter = require('./routes/menus');

  // Inject broadcast function into routers
  dishesRouter.setBroadcast(broadcast);
  menusRouter.setBroadcast(broadcast);

  app.use('/api/dishes', dishesRouter);
  app.use('/api/ingredients', require('./routes/ingredients'));
  app.use('/api/menus', menusRouter);
  app.use('/api/todos', require('./routes/todos'));

  server.listen(PORT, () => {
    console.log(`Menu Planner running at http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
