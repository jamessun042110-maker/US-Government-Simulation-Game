// Multiplayer transport, in two modes behind the same interface.
//
// Local mode (the original): every browser tab is a client syncing over
// BroadcastChannel + localStorage. One tab is elected host via a
// claim-then-confirm on a localStorage key and is the only one that mutates
// the world; everyone else sends actions and renders the snapshots the host
// broadcasts. If the host tab closes, a new host is elected within ~2.5s and
// the world continues from localStorage.
//
// WS mode: if the page's own origin answers a WebSocket at /ws (run
// `node server.js` instead of python http.server), the same messages flow
// through that relay instead, and machines anywhere can share one world. The
// server owns host election and caches the latest snapshot for late joiners;
// localStorage stays out of it entirely. If /ws doesn't answer, everything
// falls back to local mode — the python server still works.

import { uid } from './util.js';

const WORLD_KEY = 'usgov.world';
const HOST_KEY = 'usgov.host';
// A hidden tab has its timers throttled to roughly once a minute, so a live
// host can look dead for a long time. Be generous about how stale a claim may
// get before anyone tries to take it: a slow failover is far better than two
// tabs both believing they own the world and overwriting each other.
const CLAIM_MS = 20000;
const BEAT_MS = 700;

export class Net {
  constructor() {
    this.clientId = sessionStorage.getItem('usgov.clientId') || uid('cl');
    sessionStorage.setItem('usgov.clientId', this.clientId);
    this.isHost = false;
    this.handlers = { action: [], snapshot: [], chat: [], hostchange: [], reset: [] };
    this.peers = new Map(); // clientId -> {ts, seat}
    this.seat = sessionStorage.getItem('usgov.seat') || null;

    this.mode = 'local';
    this.wsBuf = []; // messages that must survive a WS reconnect

    try {
      this.chan = new BroadcastChannel('usgov');
      this.chan.onmessage = (e) => this._recv(e.data);
    } catch {
      this.chan = null; // fall back to storage events only
    }
    if (/^https?:$/.test(location.protocol)) this._connectWS();
    window.addEventListener('storage', (e) => {
      if (e.key === 'usgov.bus' && e.newValue) {
        try { this._recv(JSON.parse(e.newValue)); } catch {}
      }
    });
    window.addEventListener('beforeunload', () => this._release());

    this._beat();
    this.beatTimer = setInterval(() => this._beat(), BEAT_MS);
  }

  on(type, fn) { (this.handlers[type] ||= []).push(fn); return this; }
  _emit(type, ...a) { (this.handlers[type] || []).forEach((f) => f(...a)); }

  // --- WS transport ----------------------------------------------------------
  _connectWS() {
    let sock;
    try {
      sock = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    } catch { return; }
    sock.onopen = () => {
      this.sock = sock;
      this.mode = 'ws';
      // Remembered per tab so that after a reset-reload the very first
      // loadWorld() already knows not to serve the stale local world.
      sessionStorage.setItem('usgov.wsmode', '1');
      // Any host role won in a localStorage election is void here; the relay
      // decides. A deliberate claim (founding) is the one thing we keep.
      if (Date.now() - (this.claimedAt || 0) > 5000) this._setHost(false);
      for (const m of this.wsBuf) sock.send(JSON.stringify(m));
      this.wsBuf = [];
    };
    sock.onmessage = (e) => { try { this._recv(JSON.parse(e.data)); } catch {} };
    sock.onclose = () => {
      if (this.mode === 'ws') {
        // Was connected: hold WS mode (never mix transports mid-session),
        // drop host, and keep trying to get back.
        this.sock = null;
        this._setHost(false);
        setTimeout(() => this._connectWS(), 2000);
      } else {
        // Never connected — plain static server. Stay local.
        sessionStorage.removeItem('usgov.wsmode');
      }
    };
    sock.onerror = () => {}; // close fires right after
  }

  send(msg) {
    msg.from = this.clientId;
    if (this.mode === 'ws') {
      if (this.sock && this.sock.readyState === 1) this.sock.send(JSON.stringify(msg));
      // Mid-reconnect: keep intent (actions, chat), drop chatter (presence,
      // snapshots) — the next beat resends those anyway.
      else if (['action', 'chat', 'claim', 'wipe', 'reset'].includes(msg.type) && this.wsBuf.length < 50) this.wsBuf.push(msg);
      return;
    }
    if (this.chan) this.chan.postMessage(msg);
    else localStorage.setItem('usgov.bus', JSON.stringify({ ...msg, _n: Math.random() }));
  }

  _recv(msg) {
    if (!msg || msg.from === this.clientId) return;
    if (msg.type === 'host') { this._setHost(msg.clientId === this.clientId); return; }
    if (msg.type === 'hello') {
      // Fresh relay, no world — but this tab may be rendering a stale one it
      // read from localStorage before the socket opened. One reload clears it;
      // after that loadWorld() knows to return nothing.
      if (!msg.hasWorld && this.servedLocalWorld) this._emit('reset');
      return;
    }
    if (msg.type === 'presence') {
      this.peers.set(msg.from, { ts: Date.now(), seat: msg.seat });
      return;
    }
    if (msg.type === 'reset') { this._emit('reset'); return; }
    if (msg.type === 'wipe') { this.dead = true; this.wipe(); this._emit('reset'); return; }
    if (msg.type === 'snapshot') {
      // Someone else is publishing. If we also think we're host, one of us is
      // wrong; settle it deterministically rather than forking the world.
      if (this.isHost && !this._yield(msg.from)) return;
      this._emit('snapshot', msg.world);
      return;
    }
    if (msg.type === 'action' && this.isHost) this._emit('action', msg.action, msg.from);
    else if (msg.type === 'chat') this._emit('chat', msg.msg);
  }

  // --- host election -------------------------------------------------------
  // Claiming is last-write-wins, so a claim is never trusted immediately: we
  // write, wait out the window in which a rival could overwrite us, and only
  // take the role if the key is still ours. Renewing an existing claim is safe
  // to apply at once.
  _beat() {
    const now = Date.now();
    if (this.mode === 'ws') {
      // The relay owns host election; only presence flows on the beat.
      this.send({ type: 'presence', seat: this.seat });
      for (const [id, p] of this.peers) if (now - p.ts > 5000) this.peers.delete(id);
      return;
    }
    let rec = null;
    try { rec = JSON.parse(localStorage.getItem(HOST_KEY) || 'null'); } catch {}
    const stale = !rec || now - rec.ts > CLAIM_MS;
    const mine = rec && rec.clientId === this.clientId;

    if (mine) {
      localStorage.setItem(HOST_KEY, JSON.stringify({ clientId: this.clientId, ts: now }));
      this._setHost(true);
    } else if (stale && now > (this.yieldUntil || 0) && !this.claiming) {
      this.claiming = true;
      localStorage.setItem(HOST_KEY, JSON.stringify({ clientId: this.clientId, ts: now }));
      setTimeout(() => {
        this.claiming = false;
        // The socket may have opened while we were waiting out the claim
        // window; a localStorage election must never override the relay's.
        if (this.mode === 'ws') return;
        let r = null;
        try { r = JSON.parse(localStorage.getItem(HOST_KEY) || 'null'); } catch {}
        this._setHost(!!r && r.clientId === this.clientId);
      }, 260);
    } else if (!stale && !mine) {
      this._setHost(false);
    }
    this.send({ type: 'presence', seat: this.seat });
    for (const [id, p] of this.peers) if (now - p.ts > 5000) this.peers.delete(id);
  }

  _setHost(v) {
    if (this.isHost === v) return;
    this.isHost = v;
    this._emit('hostchange', v);
  }

  /**
   * Take the host role deliberately, rather than waiting to win an election.
   * Founding a new Season does this: the tab that creates the world has to be
   * the one that owns it, or `publish` would no-op and the Season would never
   * leave that tab.
   */
  claimHost() {
    this.claimedAt = Date.now();
    this.yieldUntil = 0;
    if (this.mode === 'ws') { this.send({ type: 'claim' }); this._setHost(true); return; }
    localStorage.setItem(HOST_KEY, JSON.stringify({ clientId: this.clientId, ts: Date.now() }));
    this._setHost(true);
  }

  /** Renew our claim from any wall-clock-driven path, not just the beat. */
  renewHost() {
    if (!this.isHost || this.mode === 'ws') return; // relay claims don't expire
    localStorage.setItem(HOST_KEY, JSON.stringify({ clientId: this.clientId, ts: Date.now() }));
  }

  /** Tell every other tab that the world underneath them has been replaced. */
  broadcastReset() { this.send({ type: 'reset' }); }

  /** Two hosts is worse than none. The lower client id keeps the world. */
  _yield(toClientId) {
    if (Date.now() - (this.claimedAt || 0) < 5000) return false; // we took it on purpose
    if (toClientId >= this.clientId) return false;
    this.yieldUntil = Date.now() + 4000;
    this._setHost(false);
    return true;
  }

  _release() {
    let rec = null;
    try { rec = JSON.parse(localStorage.getItem(HOST_KEY) || 'null'); } catch {}
    if (rec && rec.clientId === this.clientId) localStorage.removeItem(HOST_KEY);
  }

  // --- world transport -----------------------------------------------------
  dispatch(action) {
    if (this.isHost) this._emit('action', action, this.clientId);
    else this.send({ type: 'action', action });
  }

  publish(world) {
    if (!this.isHost || this.dead) return;
    if (this.mode !== 'ws') { try { localStorage.setItem(WORLD_KEY, JSON.stringify(world)); } catch {} }
    this.send({ type: 'snapshot', world });
  }

  loadWorld() {
    // On the relay, the server's snapshot cache is the source of truth; a
    // world saved by an old local session must not leak into a shared one.
    if (this.mode === 'ws' || sessionStorage.getItem('usgov.wsmode')) return null;
    try {
      const w = JSON.parse(localStorage.getItem(WORLD_KEY) || 'null');
      this.servedLocalWorld = !!w;
      return w;
    } catch { return null; }
  }
  wipe() { localStorage.removeItem(WORLD_KEY); localStorage.removeItem(HOST_KEY); }

  /**
   * Wiping only this tab is not enough: any other tab still holds the world in
   * memory and, if it is host, rewrites it to storage on the very next tick —
   * so the Season appears to come back from the dead. Stop publishing, tell the
   * others to drop it, then clear.
   */
  wipeEverywhere() {
    this.dead = true;
    this.send({ type: 'wipe' });
    this.wipe();
  }

  setSeat(id) { this.seat = id; sessionStorage.setItem('usgov.seat', id); }
  livePeers() { return this.peers.size + 1; }
}
