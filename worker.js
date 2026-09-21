const COOLDOWN_SECONDS = 30;

/** CORS for reads: open. Mutating routes: same-origin only (Apps Script has no Origin). */
function corsHeaders(request, { mutate = false } = {}) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-UMM-Publish-Secret",
  };
  if (mutate) {
    const origin = request.headers.get("Origin");
    const self = new URL(request.url).origin;
    if (origin && origin === self) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Vary"] = "Origin";
    }
    // No Origin (UrlFetchApp / curl) → omit ACAO; browser cross-origin cannot use custom auth header.
  } else {
    headers["Access-Control-Allow-Origin"] = "*";
  }
  return headers;
}

function jsonResponse(request, body, status = 200, { mutate = false } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request, { mutate }),
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

/**
 * Fail-closed: missing Worker secret OR mismatch → refuse write/mutate.
 * Never accept unauthenticated POSTs when secret env is unset.
 */
function requirePublishSecret(request, env) {
  const expected = env.UMM_REFRESH_SECRET;
  if (!expected || !String(expected).trim()) {
    return {
      ok: false,
      response: jsonResponse(
        request,
        {
          status: "SERVER_MISCONFIGURED",
          message: "UMM_REFRESH_SECRET is not set on the Worker; refusing unauthenticated writes.",
        },
        503,
        { mutate: true }
      ),
    };
  }
  const provided = publishSecretFromRequest(request);
  if (!provided || provided !== expected) {
    return {
      ok: false,
      response: jsonResponse(
        request,
        { status: "UNAUTHORIZED", message: "Invalid or missing publish secret." },
        401,
        { mutate: true }
      ),
    };
  }
  return { ok: true };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      const mutate =
        url.pathname === "/api/snapshot" || url.pathname === "/api/refresh";
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request, { mutate }),
      });
    }

    // 1. GET /api/snapshot
    if (url.pathname === "/api/snapshot" && request.method === "GET") {
      try {
        const row = await env.DB.prepare(
          "SELECT payload_json FROM snapshots ORDER BY generated_at_hkt DESC LIMIT 1"
        ).first();

        if (!row || !row.payload_json) {
          return jsonResponse(request, {
            status: "NO_DATA",
            message: "No snapshot available in D1 database yet.",
          }, 404);
        }

        return new Response(row.payload_json, {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            ...corsHeaders(request, { mutate: false }),
          },
        });
      } catch (err) {
        return jsonResponse(request, { status: "DB_ERROR", message: err.message }, 500);
      }
    }

    // 2. POST /api/snapshot — Apps Script publisher → D1 (auth required, fail-closed)
    if (url.pathname === "/api/snapshot" && request.method === "POST") {
      const gate = requirePublishSecret(request, env);
      if (!gate.ok) return gate.response;

      try {
        const payload = await request.json();
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

        return jsonResponse(
          request,
          { ok: true, status: "STORED", snapshotId, generatedAtHkt },
          200,
          { mutate: true }
        );
      } catch (err) {
        return jsonResponse(
          request,
          { status: "WRITE_ERROR", message: err.message },
          500,
          { mutate: true }
        );
      }
    }

    // 3. POST /api/refresh — requires same secret; then proxy to Apps Script
    if (url.pathname === "/api/refresh" && request.method === "POST") {
      const gate = requirePublishSecret(request, env);
      if (!gate.ok) return gate.response;

      if (!env.UMM_REFRESH_URL) {
        return jsonResponse(
          request,
          {
            status: "SERVER_MISCONFIGURED",
            message: "UMM_REFRESH_URL missing in Cloudflare environment.",
          },
          503,
          { mutate: true }
        );
      }

      try {
        const upstream = await fetch(env.UMM_REFRESH_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ secret: env.UMM_REFRESH_SECRET }),
        });

        const upstreamData = await upstream.json();
        return jsonResponse(request, upstreamData, upstream.ok ? 200 : 502, {
          mutate: true,
        });
      } catch (err) {
        return jsonResponse(
          request,
          { status: "REFRESH_FAILED", message: err.message },
          502,
          { mutate: true }
        );
      }
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  },
};
