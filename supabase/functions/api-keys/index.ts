import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Admin endpoint: CORS is restricted to a configured origin, not open wildcard.
// Set ALLOWED_ORIGIN env var to enable browser access from a specific origin.
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN");
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Headers": "x-api-key, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  ...(ALLOWED_ORIGIN ? { "Access-Control-Allow-Origin": ALLOWED_ORIGIN } : {}),
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 8 * 1024;

// Validate required Supabase env vars at startup
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

function isValidUUID(value: string): boolean {
  return UUID_RE.test(value);
}

// Constant-time string comparison to prevent timing attacks on the API key.
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) {
    // Run a dummy comparison to avoid length-based timing leak.
    await crypto.subtle.timingSafeEqual(aBytes, aBytes);
    return false;
  }
  return crypto.subtle.timingSafeEqual(aBytes, bBytes);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing required Supabase env vars");
    return json({ error: "Service misconfigured" }, 500);
  }

  // Auth: timing-safe comparison against ADMIN_API_KEY
  const apiKey = req.headers.get("x-api-key");
  const adminKey = Deno.env.get("ADMIN_API_KEY");
  if (!adminKey) {
    console.error("ADMIN_API_KEY env var is not configured");
    return json({ error: "Service misconfigured" }, 500);
  }
  if (!apiKey || !(await timingSafeEqual(apiKey, adminKey))) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Extract optional ID from path: /functions/v1/api-keys/<id>
  const url = new URL(req.url);
  const parts = url.pathname.split("/");
  const fnIndex = parts.indexOf("api-keys");
  const id = fnIndex !== -1 && parts[fnIndex + 1] ? parts[fnIndex + 1] : undefined;

  // POST /api-keys — create (ID in path is not accepted)
  if (req.method === "POST") {
    if (id) {
      return json({ error: "POST does not accept an ID; use POST /api-keys" }, 400);
    }

    // Enforce body size limit
    const contentLength = req.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
      return json({ error: "Request body too large" }, 413);
    }

    let body: unknown;
    try {
      const rawBody = await req.arrayBuffer();
      if (rawBody.byteLength > MAX_BODY_BYTES) {
        return json({ error: "Request body too large" }, 413);
      }
      body = JSON.parse(new TextDecoder().decode(rawBody));
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return json({ error: "Body must be a JSON object" }, 400);
    }

    const { name, permissions } = body as Record<string, unknown>;

    if (typeof name !== "string" || typeof permissions !== "string") {
      return json({ error: "Fields name and permissions must be strings" }, 400);
    }

    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length > 255) {
      return json({ error: "name must be between 1 and 255 characters" }, 400);
    }

    if (!["READ", "WRITE"].includes(permissions)) {
      return json({ error: "permissions must be READ or WRITE" }, 400);
    }

    const { data, error } = await supabase
      .from("api_keys")
      .insert({ name: trimmedName, permissions })
      .select()
      .single();

    if (error) {
      console.error("Insert error:", error.message);
      return json({ error: "Failed to create API key" }, 500);
    }

    return json({ api_key: data }, 201);
  }

  // GET /api-keys or GET /api-keys/:id — read
  if (req.method === "GET") {
    if (id) {
      if (!isValidUUID(id)) {
        return json({ error: "Invalid ID format" }, 400);
      }

      const { data, error } = await supabase
        .from("api_keys")
        .select()
        .eq("user_id", id)
        .single();

      if (error) {
        if (error.code === "PGRST116") return json({ error: "Not found" }, 404);
        console.error("Select error:", error.message);
        return json({ error: "Failed to fetch API key" }, 500);
      }

      return json({ api_key: data });
    }

    const { data, error } = await supabase
      .from("api_keys")
      .select()
      .limit(100);

    if (error) {
      console.error("Select error:", error.message);
      return json({ error: "Failed to fetch API keys" }, 500);
    }

    return json({ api_keys: data });
  }

  // DELETE /api-keys/:id — delete
  if (req.method === "DELETE") {
    if (!id) {
      return json({ error: "Missing ID in path: DELETE /api-keys/:id" }, 400);
    }

    if (!isValidUUID(id)) {
      return json({ error: "Invalid ID format" }, 400);
    }

    const { data, error } = await supabase
      .from("api_keys")
      .delete()
      .eq("user_id", id)
      .select("user_id");

    if (error) {
      // FK violation: this key still has associated results or input_jobs
      if (error.code === "23503") {
        return json({ error: "Cannot delete: API key has associated results or jobs" }, 409);
      }
      console.error("Delete error:", error.message);
      return json({ error: "Failed to delete API key" }, 500);
    }

    if (!data || data.length === 0) {
      return json({ error: "Not found" }, 404);
    }

    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  return json({ error: "Method not allowed" }, 405);
});
