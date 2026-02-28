/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║         POS Location Ping Module v2.1                   ║
 * ║         MongoDB Atlas Edition                           ║
 * ║                                                         ║
 * ║  Embed this in your POS application.                    ║
 * ║  Pings every 15 minutes while the app is open.          ║
 * ║  No ping = store is closed. Simple.                     ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * USAGE:
 *   const tracker = new POSTracker({
 *     apiUrl:    'https://your-api.railway.app',
 *     apiKey:    'your-device-api-key',
 *     deviceId:  'POS-JAKARTA-001',
 *     storeName: 'Toko Maju Jaya',
 *   });
 *   tracker.start();   // on app open / user login
 *   tracker.stop();    // on app close / user logout
 *
 * DESIGN:
 *   - Pings every 15 minutes while the app is running
 *   - No ping for >15 minutes = store considered closed
 *   - GPS uses low-accuracy mode (faster, saves battery)
 *   - Falls back gracefully if GPS unavailable (keeps last known location)
 */

class POSTracker {
  constructor(config = {}) {
    if (!config.apiUrl) throw new Error('[POSTracker] apiUrl is required');
    if (!config.apiKey) throw new Error('[POSTracker] apiKey is required');

    this.apiUrl    = config.apiUrl.replace(/\/$/, '');
    this.apiKey    = config.apiKey;
    this.deviceId  = config.deviceId  || this._getOrCreateDeviceId();
    this.storeName = config.storeName || '';
    this.interval  = config.interval  || 15 * 60 * 1000; // 15 minutes

    this.onSuccess = config.onSuccess || null;
    this.onError   = config.onError   || null;

    this._timer      = null;
    this._running    = false;
    this._visHandler = null;
  }

  // ── PUBLIC ─────────────────────────────────────────────────────────────────

  /** Start pinging. Sends one ping immediately, then every 15 minutes. */
  start() {
    if (this._running) return;
    this._running = true;

    // Ping immediately on start
    this._ping();

    // Then ping on the regular interval
    this._timer = setInterval(() => this._ping(), this.interval);

    // Also ping when user returns to the app after switching away
    this._visHandler = () => {
      if (document.visibilityState === 'visible') this._ping();
    };
    document.addEventListener('visibilitychange', this._visHandler);

    console.log(`[POSTracker] Started. Device: ${this.deviceId}. Interval: ${this.interval / 60000} min`);
  }

  /** Stop pinging — call when POS app closes or user logs out. */
  stop() {
    this._running = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this._visHandler) {
      document.removeEventListener('visibilitychange', this._visHandler);
      this._visHandler = null;
    }
    console.log('[POSTracker] Stopped.');
  }

  /** Force an immediate ping (e.g. for testing). */
  forcePing() {
    return this._ping();
  }

  getDeviceId() { return this.deviceId; }

  // ── PRIVATE ────────────────────────────────────────────────────────────────

  async _ping() {
    const payload = {
      device_id:  this.deviceId,
      store_name: this.storeName,
      timestamp:  new Date().toISOString(),
    };

    try {
      const pos = await this._getLocation();
      payload.latitude  = pos.coords.latitude;
      payload.longitude = pos.coords.longitude;
      payload.accuracy  = pos.coords.accuracy;
    } catch (geoErr) {
      // GPS failed — still ping so server knows app is open.
      // Server will keep the last known location on file.
      payload.geo_error = geoErr.message;
      console.warn('[POSTracker] GPS unavailable, pinging without location.');
    }

    try {
      const res = await fetch(`${this.apiUrl}/ping`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key':    this.apiKey,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Server ${res.status}: ${body}`);
      }

      const result = await res.json();
      if (this.onSuccess) this.onSuccess({ ...payload, ...result });
      console.log(`[POSTracker] Ping OK @ ${payload.timestamp}`);
      return payload;

    } catch (netErr) {
      if (this.onError) this.onError(netErr);
      console.error('[POSTracker] Ping failed:', netErr.message);
    }
  }

  _getLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not available'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        resolve,
        (e) => reject(new Error(`GPS(${e.code}): ${e.message}`)),
        {
          enableHighAccuracy: false, // fast, uses cell/wifi tower, saves battery
          timeout:            8000,
          maximumAge:         600000, // accept 10-min cached position (fine for 15-min pings)
        }
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

if (typeof module !== 'undefined' && module.exports) module.exports = POSTracker;
if (typeof window  !== 'undefined') window.POSTracker = POSTracker;
