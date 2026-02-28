# POS Coverage — Cloudflare Setup Guide
## 5 steps, ~10 minutes, zero ongoing cost for most scales

---

## Architecture

```
POS App (App 2)     ── POST /ping    ──►  Cloudflare Worker  ──► D1 SQLite
PWA Tester (App 3)  ── POST /ping    ──►  Cloudflare Worker  ──► D1 SQLite
Dashboard (App 1)   ── GET /stats        Cloudflare Worker  ◄── D1 SQLite
                       GET /devices  ──►
```

No Railway. No Express. No MongoDB. Nothing to host yourself.

---

## Step 1 — Create a Cloudflare Account

1. Go to https://cloudflare.com → Sign Up (free)
2. You don't need to add a domain — Workers work on `*.workers.dev` for free

---

## Step 2 — Install Wrangler CLI

```bash
npm install -g wrangler
wrangler login
# Opens browser to authorize — click Allow
```

---

## Step 3 — Create the D1 Database

```bash
# Create the database
wrangler d1 create pos-coverage

# OUTPUT will show something like:
# ✅ Successfully created DB 'pos-coverage'
# database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

To access your new D1 Database in your Worker, add the following snippet to your configuration file:
[[d1_databases]]
binding = "pos_coverage"
database_name = "pos-coverage"
database_id = "387dba40-5e6a-41b7-9d40-c2184fbfecf7"

#
# COPY that database_id and paste it into wrangler.toml
```

Open `wrangler.toml` and replace `PASTE-YOUR-D1-DATABASE-ID-HERE` with your actual ID:
```toml
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Then create the table:
```bash
wrangler d1 execute pos-coverage --file=./schema.sql
```

Verify it worked:
```bash
wrangler d1 execute pos-coverage --command="SELECT * FROM devices LIMIT 5"
# Should return: 0 rows (empty table, that's correct)
```

---

## Step 4 — Set Secret Keys

These are your API keys — never commit them to git.
Use any long random string for each.

```bash
# Key for POS devices (App 2 / App 3)
wrangler secret put DEVICE_KEY
applocatordevice123
# Prompt: Enter a secret value → type your key → Enter

# Key for the dashboard (App 1)
wrangler secret put DASHBOARD_KEY
applocatordashboard123
# Prompt: Enter a secret value → type your key → Enter
```

Generate strong keys easily:
```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
# Run twice — one for DEVICE_KEY, one for DASHBOARD_KEY
```

---

## Step 5 — Deploy

```bash
wrangler deploy

# OUTPUT:
# ✅ Deployed pos-coverage
# https://pos-coverage.applocator.workers.dev
#
# COPY that URL — you'll need it for all 3 apps
```

Test it:
```bash
curl https://pos-coverage.YOUR-SUBDOMAIN.workers.dev/health
# {"ok":true,"ts":"2026-..."}
```

---

## Step 6 — Configure the Apps

### App 1 — Dashboard
Open `app1-coverage-dashboard.html` → click ⚙ Configure:
- **Worker URL**: `https://pos-coverage.YOUR-SUBDOMAIN.workers.dev`
- **Dashboard API Key**: your `DASHBOARD_KEY`

### App 2 — Embed in your POS app
```javascript
const tracker = new POSTracker({
  workerUrl: 'https://pos-coverage.YOUR-SUBDOMAIN.workers.dev',
  deviceKey:  'your-DEVICE_KEY',
  deviceId:   'POS-STORE-JAKARTA-01',  // unique per device
  storeName:  'Toko Maju Jaya',
});
tracker.start();  // on app open
tracker.stop();   // on app close
```

### App 3 — PWA Tester
Open `app3-pwa-tester.html` on your phone:
- **Worker URL**: `https://pos-coverage.YOUR-SUBDOMAIN.workers.dev`
- **Device API Key**: your `DEVICE_KEY`
- Press **Force Ping Now** to test immediately
- Check App 1 dashboard — your device should appear on the map

---

## Verify End-to-End

```bash
# Send a test ping (replace with your actual values)
curl -X POST https://pos-coverage.YOUR-SUBDOMAIN.workers.dev/ping \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_DEVICE_KEY" \
  -d '{"device_id":"TEST-001","store_name":"Test Store","latitude":-6.2088,"longitude":106.8456}'

# Expected: {"ok":true,"device_id":"TEST-001","ts":"2026-..."}

# Check stats
curl https://pos-coverage.YOUR-SUBDOMAIN.workers.dev/stats \
  -H "x-api-key: YOUR_DASHBOARD_KEY"

# Expected: {"total":1,"online":1,"offline":0,"new_this_month":1}

# Check devices
curl https://pos-coverage.YOUR-SUBDOMAIN.workers.dev/devices \
  -H "x-api-key: YOUR_DASHBOARD_KEY"

# Expected: [{"device_id":"TEST-001","store_name":"Test Store",...}]
```

---

## Free Tier Limits & Capacity

| Resource | Free Limit | Your usage (1M devices, 1hr pings, 10hr/day) |
|---|---|---|
| Worker requests | 100K/day | ~833K/day at full scale ⚠ |
| D1 reads | 5M/day | ~5K/day (dashboard) ✅ |
| D1 writes | 100K/day | ~83K/day (pings) ✅ |
| D1 storage | 5 GB | ~120MB for 1M devices ✅ |

**Worker requests** is the only limit you'll hit at scale.
At 100K requests/day free → supports ~10K concurrently active devices on free tier.

**Paid Workers plan: $5/month → 10M requests/day**
→ Supports all 1M devices comfortably. Best value available.

---

## Project File Structure

```
pos-coverage/
├── worker.js          ← Cloudflare Worker (the "server")
├── wrangler.toml      ← Cloudflare config
├── schema.sql         ← D1 database schema (run once)
├── app1-coverage-dashboard.html   ← Marketing map dashboard
├── app2-pos-tracker.js            ← Embed in your POS app
└── app3-pwa-tester.html           ← Standalone tester PWA
```

---

## Updating the Worker Later

```bash
# Edit worker.js, then:
wrangler deploy
# Done. No downtime, instant deploy.
```
