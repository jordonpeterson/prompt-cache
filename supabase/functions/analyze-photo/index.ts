import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_ANALYSES_PER_DAY = 50;

const SYSTEM_PROMPT = `You are a wildlife identification expert. Analyze the provided photo and identify:

1. **species**: The animal species (use common name, e.g., "Whitetail Deer", "Wild Turkey", "Black Bear")
2. **confidence**: Your confidence level 0-100
3. **alternatives**: Array of up to 3 alternative species with confidence scores
4. **sightingType**: One of: LiveAnimal, Tracks, Scrape, Rub, Scat, Wallow, Bed, Other
5. **count**: Number of animals visible
6. **sex**: If determinable (e.g., "Buck", "Doe", "Tom", "Hen") or null
7. **notes**: Brief notable observations (rack points, age class, behavior, freshness of sign)

Respond ONLY with valid JSON matching this exact schema:
{
  "species": "string",
  "confidence": number,
  "alternatives": [{"species": "string", "confidence": number}],
  "sightingType": "string",
  "count": number,
  "sex": "string or null",
  "notes": "string or null"
}`;

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

async function authenticateUser(req: Request): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Missing authorization" }, 401);
  }

  const token = authHeader.replace("Bearer ", "");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return jsonResponse({ error: "Invalid or expired token" }, 401);
  }

  return { userId: user.id };
}

async function checkRateLimit(userId: string): Promise<boolean> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const since = new Date();
  since.setHours(since.getHours() - 24);

  const { count } = await supabase
    .from("sightings")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .not("ai_species_guess", "is", null)
    .gte("created_at", since.toISOString());

  return (count ?? 0) < MAX_ANALYSES_PER_DAY;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (!ANTHROPIC_API_KEY) {
    return jsonResponse({ error: "ANTHROPIC_API_KEY not configured" }, 500);
  }

  // Authenticate user
  const authResult = await authenticateUser(req);
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  // Check payload size
  const contentLength = parseInt(req.headers.get("content-length") ?? "0");
  if (contentLength > MAX_PAYLOAD_BYTES) {
    return jsonResponse({ error: "Payload too large (max 10MB)" }, 413);
  }

  // Rate limit
  const allowed = await checkRateLimit(userId);
  if (!allowed) {
    return jsonResponse({ error: `Rate limit exceeded (max ${MAX_ANALYSES_PER_DAY}/day)` }, 429);
  }

  try {
    const { image } = await req.json();

    if (!image || typeof image !== "string") {
      return jsonResponse({ error: "No image provided" }, 400);
    }

    // Validate base64 string (rough check — must be valid base64 chars, reasonable size)
    if (image.length > 5_000_000) {
      return jsonResponse({ error: "Image too large (max ~3.75MB)" }, 413);
    }

    // Call Claude Haiku vision
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: image,
                },
              },
              {
                type: "text",
                text: "Identify the wildlife in this photo. Respond with JSON only.",
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error("Anthropic API error status:", response.status);
      return jsonResponse({ error: "AI analysis failed" }, 502);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text ?? "";

    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
      return jsonResponse({ error: "Could not parse AI response" }, 502);
    }

    let raw;
    try {
      raw = JSON.parse(jsonMatch[0]);
    } catch {
      return jsonResponse({ error: "Could not parse AI response" }, 502);
    }

    // Sanitize: only return expected fields with enum validation
    const VALID_SIGHTING_TYPES = ["LiveAnimal", "Tracks", "Scrape", "Rub", "Scat", "Wallow", "Bed", "Other"];
    const result = {
      species: typeof raw.species === "string" ? raw.species.slice(0, 100) : "Unknown",
      confidence: typeof raw.confidence === "number" ? Math.min(100, Math.max(0, Math.round(raw.confidence))) : 0,
      alternatives: Array.isArray(raw.alternatives)
        ? raw.alternatives.slice(0, 3).map((a: { species?: string; confidence?: number }) => ({
            species: typeof a.species === "string" ? a.species.slice(0, 100) : "Unknown",
            confidence: typeof a.confidence === "number" ? Math.min(100, Math.max(0, Math.round(a.confidence))) : 0,
          }))
        : [],
      sightingType: VALID_SIGHTING_TYPES.includes(raw.sightingType) ? raw.sightingType : "LiveAnimal",
      count: typeof raw.count === "number" ? Math.min(99, Math.max(1, Math.round(raw.count))) : 1,
      sex: typeof raw.sex === "string" ? raw.sex.slice(0, 50) : null,
      notes: typeof raw.notes === "string" ? raw.notes.slice(0, 500) : null,
    };

    return jsonResponse(result);
  } catch (err) {
    console.error("Error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
