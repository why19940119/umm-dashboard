# umm-dashboard

Private Cloudflare Worker + D1 + static UI for **UMM** (US Market Monitor).

This repo is half of one product. Product setup (Apps Script props, Web App deploy, ordered zero→snapshot steps, acceptance checklist) lives in the sister repo:

- Product setup: [why19940119/umm — PRODUCT.md](https://github.com/why19940119/umm/blob/main/PRODUCT.md)
- Ops runbook: [umm OPERATIONS.md](https://github.com/why19940119/umm/blob/main/OPERATIONS.md)
- Acceptance: [umm ACCEPTANCE.md](https://github.com/why19940119/umm/blob/main/ACCEPTANCE.md)

> Existing AI report/email stays in Apps Script. This dashboard displays prior AI summary content from the snapshot; do not add new AI features here without PM + user approval.

## What this repo runs

| Piece | Role |
| --- | --- |
| `worker.js` | Routes `/api/snapshot`, `/api/refresh`; serves static assets |
| `wrangler.toml` | Worker name `umm-dashboard`, assets binding `ASSETS`, D1 binding `DB` → `umm-snapshots` |
| `index.html` | UMM Intelligence Dashboard (sectors, cross-assets, AI summary panel, refresh button) |
| `live-radar.html` | Related radar page (optional) |
| `README-RADAR-BRIDGE.md` | Optional local bridge from us-stock-radar `watchlist.json` → `radar_snapshot.json` |

Production Worker hostname currently referenced by Apps Script: `https://umm-dashboard.65ng8nnrjp.workers.dev`

**Note:** The US Stock Radar table in `index.html` still uses **mock demo rows**. Live radar productization is out of scope for WP-UMM-1; see `README-RADAR-BRIDGE.md` for the local JSON bridge only.

## Cloudflare environment

| Name | Kind | Purpose |
| --- | --- | --- |
| `UMM_REFRESH_URL` | Variable | Apps Script Web App `/exec` URL |
| `UMM_REFRESH_SECRET` | Secret | Must match Apps Script Script Property `UMM_REFRESH_SECRET` |
| `DB` | D1 binding | Database name `umm-snapshots` (id in `wrangler.toml`) |
| `ASSETS` | Assets binding | Serves `index.html` and other static files |

Redeploy after changing variables or secrets.

## Deploy checklist (Worker)

1. Confirm D1 database `umm-snapshots` exists and matches `wrangler.toml` `database_id`.
2. Set `UMM_REFRESH_URL` and `UMM_REFRESH_SECRET` in Worker settings.
3. Deploy with Wrangler from this repo (`npx wrangler deploy` or your usual pipeline).
4. Open the Worker URL; dashboard shell should load.
5. If D1 is empty, expect `GET /api/snapshot` → `NO_DATA` until Apps Script publishes once (see umm PRODUCT.md).
6. Click **刷新 UMM** once and confirm the timestamp updates.

## API contracts (high level)

All JSON responses use `Content-Type: application/json; charset=utf-8`. `GET` allows CORS origin `*`. Mutating `POST` routes use **same-origin CORS only** (not `*`). `OPTIONS` is supported for CORS preflight.

### `GET /api/snapshot`

Dashboard read path. Loads the newest row from D1:

```sql
SELECT payload_json FROM snapshots ORDER BY generated_at_hkt DESC LIMIT 1
```

| Status | Body |
| --- | --- |
| `200` | Raw UMM snapshot JSON (same shape Apps Script posts). Frontend expects `source: "umm"`, plus `generatedAtHkt`, `latestSnapshot`, `sectors`, `crossAssets`, `aiReport`, … |
| `404` | `{ "status": "NO_DATA", "message": "No snapshot available in D1 database yet." }` |
| `500` | `{ "status": "DB_ERROR", "message": "…" }` |

Successful `200` responses set `Cache-Control: no-store`.

### `POST /api/snapshot`

Write path used by Apps Script (`publishUmmSnapshotForDashboard` → `notifyCloudflareD1UmmDashboard_`).

- **Body:** full UMM snapshot JSON.
- **Id:** `payload.latestSnapshot.snapshotId`, or a generated `SNAP_<timestamp>` fallback.
- **Storage:** upsert into D1 `snapshots` on `snapshot_id` (`generated_at_hkt`, `market_date_et`, `payload_json`).

**Auth (fail-closed):** Requires `X-UMM-Publish-Secret` or `Authorization: Bearer <secret>` matching Worker secret `UMM_REFRESH_SECRET`. If the Worker secret is **unset/empty**, the write is **refused** (`503 SERVER_MISCONFIGURED`) — never open writes. Mismatch → `401 UNAUTHORIZED`.

| Status | Body |
| --- | --- |
| `200` | `{ "ok": true, "status": "STORED", "snapshotId": "…", "generatedAtHkt": "…" }` |
| `401` | `UNAUTHORIZED` — missing/wrong secret |
| `503` | `SERVER_MISCONFIGURED` — Worker secret not set |
| `500` | `WRITE_ERROR` |

CORS on this mutating route is **same-origin only** (not `*`). Apps Script UrlFetchApp needs no CORS.

### `POST /api/refresh`

Triggered by the dashboard **刷新 UMM** button (browser prompts once for the secret; stored in `sessionStorage` only).

1. **Auth (fail-closed):** same secret header as `POST /api/snapshot`.
2. Requires `UMM_REFRESH_URL` in the Worker env (secret already validated).
3. Forwards `POST` with JSON `{ "secret": "<UMM_REFRESH_SECRET>" }` to the Apps Script Web App.
4. Returns the upstream JSON body.

| Status | Meaning |
| --- | --- |
| `200` | Upstream OK; body is Apps Script refresh result (e.g. `status: "SUCCESS"`) |
| `401` | `UNAUTHORIZED` — missing/wrong client secret |
| `503` | `SERVER_MISCONFIGURED` — Worker secret unset, or `UMM_REFRESH_URL` missing |
| `502` | Upstream non-OK or network failure (`REFRESH_FAILED` or proxied error body) |

## Frontend wiring

In `index.html`:

- `UMM_ENDPOINT = '/api/snapshot'` (GET on load)
- `REFRESH_ENDPOINT = '/api/refresh'` (POST on button click; then reloads snapshot after a short delay)

## Security

- Never commit refresh secrets, API keys, tokens, or generated snapshots.
- Keep secrets out of `index.html` and `worker.js` source.
- Prefer Cloudflare **Secrets** for `UMM_REFRESH_SECRET`.
- **Fail-closed:** unset Worker secret refuses `POST /api/snapshot` and `POST /api/refresh` (never open writes).
- Dashboard refresh prompts for the secret once per tab (`sessionStorage`); do not hardcode it in `index.html`.
- Rotate immediately if a secret appears in a screenshot, log, commit, or PR.

## Related

- [README-RADAR-BRIDGE.md](./README-RADAR-BRIDGE.md) — optional local radar JSON publish
- [umm PRODUCT.md](https://github.com/why19940119/umm/blob/main/PRODUCT.md)
