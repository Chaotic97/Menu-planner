let ws = null;
let reconnectDelay = 1000;
let clientId = sessionStorage.getItem('syncClientId');
if (!clientId) {
  clientId = 'client_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
  sessionStorage.setItem('syncClientId', clientId);
}

export function getClientId() {
  return clientId;
}

function updateIndicator(connected) {
  const el = document.getElementById('sync-indicator');
  if (!el) return;
  el.classList.toggle('connected', connected);
  el.classList.toggle('disconnected', !connected);
  el.title = connected ? 'Sync: connected' : 'Sync: disconnected';
}

export function connectSync() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}`;

  try {
    ws = new WebSocket(url);
  } catch {
    updateIndicator(false);
    scheduleReconnect();
    return;
  }

  ws.addEventListener('open', () => {
    reconnectDelay = 1000;
    updateIndicator(true);
    // Identify ourselves
    ws.send(JSON.stringify({ type: 'identify', clientId }));
  });

  ws.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type && msg.type !== 'identify') {
        window.dispatchEvent(new CustomEvent(`sync:${msg.type}`, { detail: msg.payload || {} }));
      }
    } catch {}
  });

  ws.addEventListener('close', () => {
    updateIndicator(false);
    scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    updateIndicator(false);
  });
}

function scheduleReconnect() {
  setTimeout(() => {
    connectSync();
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  }, reconnectDelay);
}
