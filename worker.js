export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. API 路由：GET /api/snapshot
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
              "Access-Control-Allow-Origin": "*"
            }
          });
        }

        return new Response(row.payload_json, {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store"
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
            "Access-Control-Allow-Origin": "*"
          }
        });
      }
    }

    // 2. 靜態資源：由 Cloudflare 託管的 HTML/JS/CSS
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  }
};
