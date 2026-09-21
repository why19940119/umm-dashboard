const COOLDOWN_SECONDS = 30;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-UMM-Publish-Secret",
  };
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}

function publishSecretFromRequest(request) {
  const header = request.headers.get("X-UMM-Publish-Secret");
  if (header) return header.trim();
  const auth = request.headers.get("Authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // 1. GET /api/snapshot
    if (url.pathname === "/api/snapshot" && request.method === "GET") {
      try {
        const row = await env.DB.prepare(
          "SELECT payload_json FROM snapshots ORDER BY generated_at_hkt DESC LIMIT 1"
        ).first();

        if (!row || !row.payload_json) {
          return jsonResponse({
            status: "NO_DATA",
            message: "No snapshot available in D1 database yet."
          }, 404);
        }

        return new Response(row.payload_json, {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            ...corsHeaders(),
          }
        });
      } catch (err) {
        return jsonResponse({ status: "DB_ERROR", message: err.message }, 500);
      }
    }

    // 2. POST /api/snapshot — Apps Script publisher → D1
    if (url.pathname === "/api/snapshot" && request.method === "POST") {
      try {
        // When Worker has UMM_REFRESH_SECRET, require matching publish secret (header).
        // Avoids open write while staying compatible if secret env is temporarily unset.
        if (env.UMM_REFRESH_SECRET) {
          const provided = publishSecretFromRequest(request);
          if (!provided || provided !== env.UMM_REFRESH_SECRET) {
            return jsonResponse({ status: "UNAUTHORIZED", message: "Invalid or missing publish secret." }, 401);
          }
        }

        const payload = await request.json();
        // Prefer publishId so each dashboard refresh gets a distinct D1 row even when
        // latestSnapshot.snapshotId is reused from Daily_Snapshot.
        const snapshotId =
          payload.publishId ||
          payload.latestSnapshot?.snapshotId ||
          `SNAP_${Date.now()}`;
        const generatedAtHkt = payload.generatedAtHkt || new Date().toISOString();
        const marketDateEt =
          payload.marketDateEt ||
          payload.latestSnapshot?.marketDateEt ||
          payload.aiReport?.marketDateEt ||
          null;
        const payloadJson = JSON.stringify(payload);

        await env.DB.prepare(`
          INSERT INTO snapshots (snapshot_id, generated_at_hkt, market_date_et, payload_json)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(snapshot_id) DO UPDATE SET
            generated_at_hkt = excluded.generated_at_hkt,
            market_date_et = excluded.market_date_et,
            payload_json = excluded.payload_json
        `).bind(snapshotId, generatedAtHkt, marketDateEt, payloadJson).run();

        return jsonResponse({ ok: true, status: "STORED", snapshotId, generatedAtHkt });
      } catch (err) {
        return jsonResponse({ status: "WRITE_ERROR", message: err.message }, 500);
      }
    }

    // 3. POST /api/refresh
    if (url.pathname === "/api/refresh" && request.method === "POST") {
      if (!env.UMM_REFRESH_URL || !env.UMM_REFRESH_SECRET) {
        return jsonResponse({
          status: "SERVER_MISCONFIGURED",
          message: "UMM_REFRESH_URL or UMM_REFRESH_SECRET missing in Cloudflare environment."
        }, 500);
      }

      try {
        const upstream = await fetch(env.UMM_REFRESH_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ secret: env.UMM_REFRESH_SECRET }),
        });

        const upstreamData = await upstream.json();
        return jsonResponse(upstreamData, upstream.ok ? 200 : 502);
      } catch (err) {
        return jsonResponse({ status: "REFRESH_FAILED", message: err.message }, 502);
      }
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  }
};
