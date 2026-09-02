const COOLDOWN_SECONDS = 30;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight 支援
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // 1. GET /api/snapshot (Dashboard 讀取最新快照)
    if (url.pathname === "/api/snapshot" && request.method === "GET") {
      try {
        const row = await env.DB.prepare(
          "SELECT payload_json FROM snapshots ORDER BY generated_at_hkt DESC LIMIT 1"
        ).first();

        if (!row || !row.payload_json) {
          return new Response(JSON.stringify({
            status: "NO_DATA",
            message: "No snapshot available in D1 database yet."
          }), {
            status: 404,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Access-Control-Allow-Origin": "*",
            }
          });
        }

        return new Response(row.payload_json, {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store",
          }
        });
      } catch (err) {
        return new Response(JSON.stringify({
          status: "DB_ERROR",
          message: err.message
        }), {
          status: 500,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
          }
        });
      }
    }

    // 2. POST /api/snapshot (接收來自 Apps Script 的最新快照並存入 D1)
    if (url.pathname === "/api/snapshot" && request.method === "POST") {
      try {
        const payload = await request.json();
        const snapshotId = payload.latestSnapshot?.snapshotId || `SNAP_${Date.now()}`;
        const generatedAtHkt = payload.generatedAtHkt || new Date().toISOString();
        const marketDateEt = payload.marketDateEt || payload.aiReport?.marketDateEt || null;
        const payloadJson = JSON.stringify(payload);

        await env.DB.prepare(`
          INSERT INTO snapshots (snapshot_id, generated_at_hkt, market_date_et, payload_json)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(snapshot_id) DO UPDATE SET
            generated_at_hkt = excluded.generated_at_hkt,
            market_date_et = excluded.market_date_et,
            payload_json = excluded.payload_json
        `).bind(snapshotId, generatedAtHkt, marketDateEt, payloadJson).run();

        return new Response(JSON.stringify({ ok: true, status: "STORED", snapshotId }), {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
          }
        });
      } catch (err) {
        return new Response(JSON.stringify({ status: "WRITE_ERROR", message: err.message }), {
          status: 500,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
          }
        });
      }
    }

    // 3. POST /api/refresh (觸發 Apps Script 刷新)
    if (url.pathname === "/api/refresh" && request.method === "POST") {
      if (!env.UMM_REFRESH_URL || !env.UMM_REFRESH_SECRET) {
        return new Response(JSON.stringify({
          status: "SERVER_MISCONFIGURED",
          message: "UMM_REFRESH_URL or UMM_REFRESH_SECRET missing in Cloudflare environment."
        }), {
          status: 500,
          headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }
        });
      }

      try {
        const upstream = await fetch(env.UMM_REFRESH_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ secret: env.UMM_REFRESH_SECRET }),
        });

        const upstreamData = await upstream.json();
        return new Response(JSON.stringify(upstreamData), {
          status: upstream.ok ? 200 : 502,
          headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ status: "REFRESH_FAILED", message: err.message }), {
          status: 502,
          headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // 4. 託管的前端靜態檔案
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  }
};
