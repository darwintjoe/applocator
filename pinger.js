/**
 * POS Tracker — Ping Module v4.0
 * Cloudflare Worker Edition
 *
 * Direct ping to your Cloudflare Worker.
 * No middleware, no database credentials in client.
 * One upsert per ping. Tiny payload.
 *
 * USAGE:
 *   const tracker = new POSTracker({
 *     workerUrl: 'https://pos-coverage.YOUR-SUBDOMAIN.workers.dev',
 *     deviceKey:  'your-device-secret-key',
 *     deviceId:   'POS-STORE-001',       // optional — auto-generated if omitted
 *     storeName:  'Toko Maju Jaya',      // optional
 *   });
 *   tracker.start();   // on app open / user login
 *   tracker.stop();    // on app close / user logout
 *
 * PING BEHAVIOUR:
 *   - Immediate ping on start()
 *   - Every 1 hour while app is open
 *   - Extra ping when user returns to app (visibility change)
 *   - GPS unavailable? Still pings — server keeps last known location
 *   - One document per device — storage stays minimal
 */

class POSTracker {
  constructor(config = {}) {
    if (!config.workerUrl) throw new Error('[POSTracker] workerUrl is required');
    if (!config.deviceKey) throw new Error('[POSTracker] deviceKey is required');

    this.url       = config.workerUrl.replace(/\/$/, '') + '/ping';
    this.deviceKey = config.deviceKey;
    this.deviceId  = config.deviceId  || this._getOrCreateId();
    this.storeName = config.storeName || '';
    this.interval  = config.interval  || 60 * 60 * 1000; // 1 hour

    this.onSuccess = config.onSuccess || null;
    this.onError   = config.onError   || null;

    this._timer      = null;
    this._visHandler = null;
    this._running    = false;
  }

  // ── PUBLIC ──────────────────────────────────────────────────────────────────

  start() {
    if (this._running) return;
    this._running = true;
    this._ping();
    this._timer = setInterval(() => this._ping(), this.interval);
    this._visHandler = () => {
      if (document.visibilityState === 'visible') this._ping();
    };
    document.addEventListener('visibilitychange', this._visHandler);
    console.log(`[POSTracker] Started — ${this.deviceId}`);
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

  forcePing() { return this._ping(); }

  getDeviceId() { return this.deviceId; }

  // ── PRIVATE ─────────────────────────────────────────────────────────────────

  async _ping() {
    const payload = {
      device_id:  this.deviceId,
      store_name: this.storeName,
    };

    // Try GPS — silently skip if unavailable
    try {
      const pos = await this._gps();
      payload.latitude  = pos.coords.latitude;
      payload.longitude = pos.coords.longitude;
      payload.accuracy  = pos.coords.accuracy;
    } catch (_) {}

    try {
      const res = await fetch(this.url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': this.deviceKey },
        body:    JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (this.onSuccess) this.onSuccess({ ...payload, ...data });
      console.log(`[POSTracker] ✓ ping OK`);
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

  _getOrCreateId() {
    const KEY = 'pos_device_id';
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = 'POS-' + Math.random().toString(36).substring(2, 10).toUpperCase();
      localStorage.setItem(KEY, id);
    }
    return id;
  }
}

// Export for all environments
if (typeof module !== 'undefined' && module.exports) module.exports = POSTracker;
if (typeof window  !== 'undefined') window.POSTracker = POSTracker;
