/**
 * POS Tracker — Embed Module v5.0
 * ─────────────────────────────────────────────────────────
 * Drop this into your POS app. Zero UI, zero config needed
 * beyond workerUrl and deviceKey. Everything else is automatic.
 *
 * FIRST LAUNCH:
 *   No ID in localStorage → POST /register → server assigns
 *   hex ID (e.g. "00000A") → saved to localStorage forever.
 *
 * EVERY LAUNCH AFTER:
 *   Has ID → POST /ping directly. No registration call.
 *
 * USAGE:
 *   const tracker = new POSTracker({
 *     workerUrl: 'https://pos-coverage.YOUR.workers.dev',
 *     deviceKey:  'your-device-secret-key',
 *     storeName:  'Toko Maju Jaya',   // optional but recommended
 *   });
 *   tracker.start();   // call on app open / user login
 *   tracker.stop();    // call on app close / user logout
 *
 * CALLBACKS (optional):
 *   onRegister(device_id)  — fires once when ID is first assigned
 *   onPing(payload)        — fires on every successful ping
 *   onError(error)         — fires on any failure
 */

class POSTracker {
  constructor(config = {}) {
    if (!config.workerUrl) throw new Error('[POSTracker] workerUrl is required');
    if (!config.deviceKey) throw new Error('[POSTracker] deviceKey is required');

    this._base      = config.workerUrl.replace(/\/$/, '');
    this._key       = config.deviceKey;
    this.storeName  = config.storeName  || '';
    this.interval   = config.interval   || 60 * 60 * 1000; // 1 hour

    this.onRegister = config.onRegister || null;
    this.onPing     = config.onPing     || null;
    this.onError    = config.onError    || null;

    this._timer      = null;
    this._visHandler = null;
    this._running    = false;

    // localStorage keys
    this._ID_KEY = 'pos_device_id';
  }

  // ── PUBLIC ──────────────────────────────────────────────

  async start() {
    if (this._running) return;
    this._running = true;

    // Ensure registered before first ping
    await this._ensureRegistered();

    // First ping immediately
    await this._ping();

    // Recurring ping every interval
    this._timer = setInterval(() => this._ping(), this.interval);

    // Ping when user returns to app after switching away
    this._visHandler = () => {
      if (document.visibilityState === 'visible') this._ping();
    };
    document.addEventListener('visibilitychange', this._visHandler);

    console.log(`[POSTracker] Running — ID: ${this.getDeviceId()}`);
  }

  stop() {
    this._running = false;
    if (this._timer)      { clearInterval(this._timer); this._timer = null; }
    if (this._visHandler) {
      document.removeEventListener('visibilitychange', this._visHandler);
      this._visHandler = null;
    }
    console.log('[POSTracker] Stopped.');
  }

  forcePing()    { return this._ping(); }
  getDeviceId()  { return localStorage.getItem(this._ID_KEY) || null; }

  // ── PRIVATE ─────────────────────────────────────────────

  // Called once on start(). If no ID exists, registers with server.
  async _ensureRegistered() {
    if (this.getDeviceId()) return; // already registered

    console.log('[POSTracker] First launch — registering with server...');
    const payload = { store_name: this.storeName };

    // Attach GPS if available
    try {
      const pos = await this._gps();
      payload.latitude  = pos.coords.latitude;
      payload.longitude = pos.coords.longitude;
      payload.accuracy  = pos.coords.accuracy;
    } catch (_) {}

    try {
      const res = await fetch(`${this._base}/register`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': this._key },
        body:    JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Register HTTP ${res.status}`);
      const data = await res.json();

      // Server assigned hex ID — save permanently
      localStorage.setItem(this._ID_KEY, data.device_id);
      console.log(`[POSTracker] Registered — ID: ${data.device_id}`);
      if (this.onRegister) this.onRegister(data.device_id);

    } catch (err) {
      // Registration failed — will retry next start()
      if (this.onError) this.onError(err);
      console.error('[POSTracker] Registration failed:', err.message);
    }
  }

  async _ping() {
    const device_id = this.getDeviceId();
    if (!device_id) {
      console.warn('[POSTracker] No device ID yet — skipping ping');
      return;
    }

    const payload = { device_id, store_name: this.storeName };

    // Attach GPS silently — no error if unavailable
    try {
      const pos = await this._gps();
      payload.latitude  = pos.coords.latitude;
      payload.longitude = pos.coords.longitude;
      payload.accuracy  = pos.coords.accuracy;
    } catch (_) {}

    try {
      const res = await fetch(`${this._base}/ping`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': this._key },
        body:    JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (this.onPing) this.onPing({ ...payload, ...data });
      console.log(`[POSTracker] ✓ ping — ${device_id}`);
    } catch (err) {
      if (this.onError) this.onError(err);
      console.warn(`[POSTracker] ✗ ping failed — ${err.message}`);
    }
  }

  _gps() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(); return; }
      navigator.geolocation.getCurrentPosition(resolve, reject,
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 3600000 }
      );
    });
  }
}

// Export for all environments
if (typeof module !== 'undefined' && module.exports) module.exports = POSTracker;
if (typeof window  !== 'undefined') window.POSTracker = POSTracker;
