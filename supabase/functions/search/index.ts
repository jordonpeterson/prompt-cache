import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "x-api-key, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Auth: validate x-api-key header
  const apiKey = req.headers.get("x-api-key");
  const expectedKey = Deno.env.get("SEARCH_API_KEY");
  if (!expectedKey) {
    console.error("SEARCH_API_KEY env var is not configured");
    return json({ error: "Service misconfigured" }, 500);
  }
  if (!apiKey || apiKey !== expectedKey) {
    return json({ error: "Unauthorized" }, 401);
  }

  // Parse body
  let body: { query?: string; match_count?: number; match_threshold?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { query, match_count = 10, match_threshold = 0.7 } = body;
  if (!query || typeof query !== "string") {
    return json({ error: "Missing required field: query" }, 400);
  }

  // Generate embedding via OpenAI
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  const embeddingRes = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      dimensions: 1536,
      input: query,
    }),
  });

  if (!embeddingRes.ok) {
    const err = await embeddingRes.text();
    console.error("OpenAI embedding error:", err);
    return json({ error: "Failed to generate embedding" }, 502);
  }

  const embeddingData = await embeddingRes.json();
  const embedding: number[] | undefined = embeddingData?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    console.error("Unexpected OpenAI response shape:", JSON.stringify(embeddingData));
    return json({ error: "Unexpected response from embedding service" }, 502);
  }

  // Query Supabase via RPC
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await supabase.rpc("match_documents", {
    query_embedding: embedding,
    match_count,
    match_threshold,
  });

  if (error) {
    console.error("match_documents RPC error:", error.message);
    return json({ error: "Database query failed" }, 500);
  }

  return json({ results: data });
});
