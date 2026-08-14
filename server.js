// Static files + a BroadcastChannel-shaped WebSocket relay, so the game can be
// played across real machines. The relay does what BroadcastChannel does for
// tabs: every message a client sends is echoed to every other client, verbatim.
// The game protocol is unchanged — this file knows only three message types.
//
//   node server.js            # serves the game on :8777 and relays /ws
//
// What the server owns (and nothing else):
//   - host election: the world must have exactly one simulator. A 'claim'
//     message takes the role (founding a Season does this); when the host
//     socket dies the oldest surviving client is promoted.
//   - the latest snapshot, in memory, so a late joiner gets the world the
//     moment they connect instead of waiting for the host's next tick.
//     'wipe' clears it. Restarting the server forgets the world.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 8777;
const ROOT = fileURLToPath(new URL('.', import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

const http = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const file = join(ROOT, path === sep || path === '/' ? 'index.html' : path);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

// --- relay -------------------------------------------------------------------

const wss = new WebSocketServer({ server: http, path: '/ws' });
let hostId = null;
let lastSnapshot = null; // the whole {type:'snapshot', world} message
let nextSeat = 0;

const sockets = new Set();
const say = (ws, msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };
const relay = (msg, except) => { for (const ws of sockets) if (ws !== except) say(ws, msg); };

function setHost(id) {
  if (hostId === id) return;
  hostId = id;
  relay({ type: 'host', clientId: id, from: '@server' });
  console.log(`[relay] host -> ${id || 'nobody'}`);
}

/** Oldest connected client whose id we have learned. */
function promote() {
  let best = null;
  for (const ws of sockets) if (ws.clientId && (!best || ws.order < best.order)) best = ws;
  setHost(best ? best.clientId : null);
}

wss.on('connection', (ws) => {
  ws.order = nextSeat++;
  ws.alive = true;
  sockets.add(ws);
  ws.on('pong', () => (ws.alive = true));

  // Bring the newcomer up to speed before they say a word.
  say(ws, { type: 'hello', hasWorld: !!lastSnapshot, from: '@server' });
  if (lastSnapshot) say(ws, lastSnapshot);
  if (hostId) say(ws, { type: 'host', clientId: hostId, from: '@server' });

  ws.on('message', (data, isBinary) => {
    if (isBinary || data.length > 5e6) return;
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg.from !== 'string') return;

    if (!ws.clientId) {
      ws.clientId = msg.from;
      console.log(`[relay] ${ws.clientId} connected (${sockets.size} online)`);
      // A world with no simulator gets one as soon as anyone speaks up.
      if (!hostId && lastSnapshot) promote();
    }

    if (msg.type === 'claim') { setHost(msg.from); return; }
    if (msg.type === 'snapshot') {
      if (msg.from !== hostId) return; // only the host's world is the world
      lastSnapshot = msg;
    }
    if (msg.type === 'wipe') lastSnapshot = null;
    relay(msg, ws);
  });

  ws.on('close', () => {
    sockets.delete(ws);
    if (ws.clientId) console.log(`[relay] ${ws.clientId} left (${sockets.size} online)`);
    if (ws.clientId && ws.clientId === hostId) {
      hostId = null;
      if (lastSnapshot) promote(); // someone still here inherits the world
    }
  });
});

// Dead sockets never fire 'close' on their own; ping so failover actually runs.
setInterval(() => {
  for (const ws of sockets) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 10000);

http.listen(PORT, () => {
  console.log(`SILVER on http://localhost:${PORT} — relay at /ws`);
  console.log('Expose to the internet with: cloudflared tunnel --url http://localhost:' + PORT);
});
