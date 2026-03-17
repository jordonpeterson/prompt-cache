import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(request: NextRequest) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature")!;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    return NextResponse.json(
      { error: `Webhook Error: ${err instanceof Error ? err.message : "Unknown error"}` },
      { status: 400 }
    );
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const supabaseUserId = session.metadata?.supabase_user_id;

    if (!supabaseUserId) {
      return NextResponse.json({ error: "No supabase_user_id in metadata" }, { status: 400 });
    }

    // Use service role client to bypass RLS
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Idempotent: only insert if no key exists for this user
    const { data: existing } = await supabase
      .from("api_keys")
      .select("user_id")
      .eq("supabase_user_id", supabaseUserId)
      .single();

    if (!existing) {
      await supabase.from("api_keys").insert({
        name: `Pro subscriber ${supabaseUserId.slice(0, 8)}`,
        permissions: "WRITE",
        supabase_user_id: supabaseUserId,
      });
    }
  }

  return NextResponse.json({ received: true });
}
