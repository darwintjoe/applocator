/**
 * POS Tracker — Ping Module v3.0
 * Direct to MongoDB Atlas Data API. No middleware, no server.
 *
 * SETUP:
 *   1. MongoDB Atlas → App Services → Create App → Enable Data API
 *   2. Create an API key with readWrite on your database
 *   3. Paste your App ID and API key below (or pass via config)
 *
 * USAGE:
 *   const tracker = new POSTracker({
 *     mongoAppId: 'your-atlas-app-id',       // from Atlas App Services
 *     mongoApiKey: 'your-data-api-key',       // from Atlas App Services
 *     database:   'pos_analytics',            // your DB name
 *     deviceId:   'POS-STORE-001',            // unique per device
 *     storeName:  'Toko Maju Jaya',           // optional
 *   });
 *
 *   tracker.start();   // call on app open / user login
 *   tracker.stop();    // call on app close / user logout
 *
 * PING BEHAVIOUR:
 *   - Pings immediately on start()
 *   - Then every 1 hour while app is open
 *   - Also pings when user returns to app (visibility change)
 *   - One document per device (upsert) — storage stays tiny
 *   - Grey dot after 75 min no ping (1 cycle + 15 min tolerance)
 */

class POSTracker {
  constructor(config = {}) {
    this.appId     = config.mongoAppId  || '';
    this.apiKey    = config.mongoApiKey || '';
    this.database  = config.database    || 'pos_analytics';
    this.collection= config.collection  || 'devices';
    this.deviceId  = config.deviceId    || this._getOrCreateDeviceId();
    this.storeName = config.storeName   || '';
    this.interval  = config.interval    || 60 * 60 * 1000; // 1 hour

    this.onSuccess = config.onSuccess   || null;
    this.onError   = config.onError     || null;

    this._timer      = null;
    this._running    = false;
    this._visHandler = null;

    // Base URL for MongoDB Atlas Data API
    this._baseUrl = `https://data.mongodb-api.com/app/${this.appId}/endpoint/data/v1`;
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
    console.log(`[POSTracker] Started — ${this.deviceId} — every ${this.interval/60000} min`);
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
    const now = new Date().toISOString();
    const update = {
      $set: {
        last_ping:  { $date: now },
        store_name: this.storeName,
      },
      $setOnInsert: {
        device_id:  this.deviceId,
        first_seen: { $date: now },
      }
    };

    // Attach location if available
    try {
      const pos = await this._getLocation();
      update.$set.latitude  = pos.coords.latitude;
      update.$set.longitude = pos.coords.longitude;
      update.$set.location  = {
        type: 'Point',
        coordinates: [pos.coords.longitude, pos.coords.latitude]
      };
    } catch (e) {
      // No GPS — that's fine, keep last known location on file
    }

    try {
      const res = await fetch(`${this._baseUrl}/action/updateOne`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey,
        },
        body: JSON.stringify({
          dataSource: 'Cluster0',
          database:   this.database,
          collection: this.collection,
          filter:     { device_id: this.deviceId },
          update,
          upsert:     true,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Atlas ${res.status}: ${err}`);
      }

      const result = await res.json();
      if (this.onSuccess) this.onSuccess({ device_id: this.deviceId, timestamp: now, ...result });
      console.log(`[POSTracker] ✓ ${now}`);

    } catch (err) {
      if (this.onError) this.onError(err);
      console.error('[POSTracker] ✗', err.message);
    }
  }

  _getLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error('GPS N/A')); return; }
      navigator.geolocation.getCurrentPosition(resolve,
        e => reject(new Error(`GPS(${e.code})`)),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 3600000 }
      );
    });
  }

  _getOrCreateDeviceId() {
    const KEY = 'pos_device_id';
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = 'POS-' + Math.random().toString(36).substring(2, 10).toUpperCase();
      localStorage.setItem(KEY, id);
    }
    return id;
  }
}

// Export for Node / Capacitor / browser
if (typeof module !== 'undefined' && module.exports) module.exports = POSTracker;
if (typeof window  !== 'undefined') window.POSTracker = POSTracker;
