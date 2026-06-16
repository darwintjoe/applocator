/**
 * POS Coverage — Cloudflare Worker v3
 * Multi-app support with dynamic app registry
 *
 * ENDPOINTS:
 *   POST /register       ← first-time handshake, assigns hex device ID
 *   POST /ping           ← recurring ping from registered device
 *   GET  /stats          ← summary counts, optional ?app_id=
 *   GET  /devices        ← all device locations, optional ?app_id=
 *   GET  /apps           ← list all known apps with names
 *   PATCH /apps/:app_id  ← rename an app
 *   GET  /health         ← no auth
 */

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const method = request.method;
    const path   = url.pathname;

    const cors = {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
    };
    if (method === 'OPTIONS') return new Response(null, { headers: cors });

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status, headers: { 'Content-Type': 'application/json', ...cors },
      });

    const isDevice    = () => request.headers.get('x-api-key') === env.DEVICE_KEY;
    const isDashboard = () => request.headers.get('x-api-key') === env.DASHBOARD_KEY;

    // ── DEVICE ROUTES ──────────────────────────────────────────────────────────
    if (method === 'POST' && path === '/register') {
      if (!isDevice()) return json({ error: 'Unauthorized' }, 401);
      return handleRegister(request, env, json);
    }
    if (method === 'POST' && path === '/ping') {
      if (!isDevice()) return json({ error: 'Unauthorized' }, 401);
      return handlePing(request, env, json);
    }

    // ── DASHBOARD ROUTES ───────────────────────────────────────────────────────
    if (method === 'GET' && path === '/stats') {
      if (!isDashboard()) return json({ error: 'Unauthorized' }, 401);
      return handleStats(url, env, json);
    }
    if (method === 'GET' && path === '/devices') {
      if (!isDashboard()) return json({ error: 'Unauthorized' }, 401);
      return handleDevices(url, env, json);
    }
    if (method === 'GET' && path === '/apps') {
      if (!isDashboard()) return json({ error: 'Unauthorized' }, 401);
      return handleGetApps(env, json);
    }
    if (method === 'PATCH' && path.startsWith('/apps/')) {
      if (!isDashboard()) return json({ error: 'Unauthorized' }, 401);
      const app_id = decodeURIComponent(path.slice(6));
      return handleRenameApp(request, app_id, env, json);
    }

    // ── HEALTH ─────────────────────────────────────────────────────────────────
    if (path === '/health') return json({ ok: true, ts: new Date().toISOString() });

    return json({ error: 'Not found' }, 404);
  }
};

// ── REGISTER ────────────────────────────────────────────────────────────────────
async function handleRegister(request, env, json) {
  let body = {};
  try { body = await request.json(); } catch {}

  const { store_name, app_id = 'PWA1', latitude, longitude, accuracy } = body;
  const now = new Date().toISOString();

  // Auto-register app if first time seen
  await ensureApp(app_id, env, now);

  // Atomic counter increment → hex ID
  await env.DB.prepare(`UPDATE counter SET value = value + 1 WHERE id = 1`).run();
  const row       = await env.DB.prepare(`SELECT value FROM counter WHERE id = 1`).first();
  const device_id = row.value.toString(16).toUpperCase().padStart(6, '0');

  // Resolve location: GPS from body, else Cloudflare IP geolocation
  const loc = resolveLocation(body, request);

  await env.DB.prepare(`
    INSERT INTO devices
      (device_id, app_id, store_name, latitude, longitude, accuracy, first_seen, last_ping, ping_count)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, 0)
  `).bind(device_id, app_id, store_name || null,
          loc.latitude, loc.longitude, loc.accuracy, now).run();

  return json({ ok: true, device_id, app_id, ts: now });
}

// ── PING ────────────────────────────────────────────────────────────────────────
async function handlePing(request, env, json) {
  let body = {};
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { device_id, store_name, app_id } = body;
  if (!device_id) return json({ error: 'device_id required' }, 400);

  const existing = await env.DB.prepare(
    `SELECT device_id FROM devices WHERE device_id = ?1`
  ).bind(device_id).first();
  if (!existing) return json({ error: 'Unknown device — register first' }, 404);

  const now = new Date().toISOString();
  const loc = resolveLocation(body, request);

  await env.DB.prepare(`
    UPDATE devices SET
      store_name = COALESCE(?2, store_name),
      app_id     = COALESCE(?3, app_id),
      latitude   = COALESCE(?4, latitude),
      longitude  = COALESCE(?5, longitude),
      accuracy   = COALESCE(?6, accuracy),
      last_ping  = ?7,
      ping_count = ping_count + 1
    WHERE device_id = ?1
  `).bind(device_id, store_name || null, app_id || null,
          loc.latitude, loc.longitude, loc.accuracy, now).run();

  return json({ ok: true, device_id, ts: now });
}

// ── STATS ───────────────────────────────────────────────────────────────────────
async function handleStats(url, env, json) {
  const app_id = url.searchParams.get('app_id') || null;
  const now    = Date.now();
  const ts75m  = new Date(now - 75 * 60 * 1000).toISOString();
  const ts30d  = new Date(now - 30 * 86400000).toISOString();

  const where  = app_id ? `WHERE app_id = '${app_id}'` : '';
  const result = await env.DB.prepare(`
    SELECT
      COUNT(*)                                           AS total,
      SUM(CASE WHEN last_ping >= ?1 THEN 1 ELSE 0 END)  AS online,
      SUM(CASE WHEN last_ping <  ?1 THEN 1 ELSE 0 END)  AS offline,
      SUM(CASE WHEN first_seen >= ?2 THEN 1 ELSE 0 END) AS new_this_month
    FROM devices ${where}
  `).bind(ts75m, ts30d).first();

  return json({
    total:          result.total          || 0,
    online:         result.online         || 0,
    offline:        result.offline        || 0,
    new_this_month: result.new_this_month || 0,
  });
}

// ── DEVICES ─────────────────────────────────────────────────────────────────────
async function handleDevices(url, env, json) {
  const app_id = url.searchParams.get('app_id') || null;
  const now    = Date.now();
  const ts75m  = new Date(now - 75 * 60 * 1000).toISOString();
  const ts30d  = new Date(now - 30 * 86400000).toISOString();
  const ts60d  = new Date(now - 60 * 86400000).toISOString();

  const where  = app_id ? `AND app_id = '${app_id}'` : '';
  const { results } = await env.DB.prepare(`
    SELECT
      device_id, app_id, store_name, latitude, longitude, last_ping, first_seen,
      CASE
        WHEN last_ping >= ?1 THEN 'online'
        WHEN last_ping >= ?2 THEN 'active'
        WHEN last_ping >= ?3 THEN 'risk'
        ELSE 'churned'
      END AS status
    FROM devices
    WHERE latitude IS NOT NULL ${where}
    ORDER BY last_ping DESC
    LIMIT 5000
  `).bind(ts75m, ts30d, ts60d).all();

  return json(results || []);
}

// ── APPS ────────────────────────────────────────────────────────────────────────
async function handleGetApps(env, json) {
  const { results } = await env.DB.prepare(`
    SELECT app_id, app_name, created,
      (SELECT COUNT(*) FROM devices d WHERE d.app_id = apps.app_id) AS device_count
    FROM apps
    ORDER BY created ASC
  `).all();
  return json(results || []);
}

async function handleRenameApp(request, app_id, env, json) {
  let body = {};
  try { body = await request.json(); } catch {}
  const { app_name } = body;
  if (!app_name || !app_name.trim()) return json({ error: 'app_name required' }, 400);

  await env.DB.prepare(`UPDATE apps SET app_name = ?1 WHERE app_id = ?2`)
    .bind(app_name.trim(), app_id).run();

  return json({ ok: true, app_id, app_name: app_name.trim() });
}

// ── HELPERS ─────────────────────────────────────────────────────────────────────

// Ensure app exists in registry — auto-creates on first device registration
async function ensureApp(app_id, env, now) {
  await env.DB.prepare(`
    INSERT OR IGNORE INTO apps (app_id, app_name, created)
    VALUES (?1, ?1, ?2)
  `).bind(app_id, now).run();
}

// Resolve location: prefer GPS from body, fall back to Cloudflare IP geolocation
function resolveLocation(body, request) {
  if (body.latitude !== undefined && body.longitude !== undefined) {
    return {
      latitude:  body.latitude,
      longitude: body.longitude,
      accuracy:  body.accuracy || null,
    };
  }
  // Cloudflare provides IP-based lat/lng on every request automatically
  const cf = request.cf || {};
  if (cf.latitude && cf.longitude) {
    return {
      latitude:  parseFloat(cf.latitude),
      longitude: parseFloat(cf.longitude),
      accuracy:  null,   // IP-based, no accuracy value
    };
  }
  return { latitude: null, longitude: null, accuracy: null };
}
