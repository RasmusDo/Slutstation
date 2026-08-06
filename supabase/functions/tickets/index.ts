// ============================================================================
// SLUTSTATION — tickets Edge Function (Stripe Checkout)
//
// The browser never sees a Stripe key, never sends a price, and never decides
// what anything costs. It sends "these ticket type ids, these quantities".
// The database prices them and reserves the stock; this function turns that
// into a Stripe Checkout Session and hands back a URL to redirect to.
//
// Actions:
//   POST { action: "checkout", event_id, items: [{ticket_type_id, qty}] }
//   POST { action: "cancel",   order_id }   — release a hold if they back out
//
// Secrets to set (Supabase → Edge Functions → Secrets):
//   STRIPE_SECRET_KEY   sk_test_… while testing, sk_live_… when you go live
//   SITE_URL            https://slutstation.se  (optional; falls back to Origin)
//
// Stripe is called over plain fetch on purpose. The npm/esm imports are what
// broke the eBas function's boot before — form-encoded HTTPS has no such
// failure mode and the Checkout API is stable.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_API = "https://api.stripe.com/v1";

const ALLOWED_ORIGINS = [
  "https://slutstation.se",
  "https://www.slutstation.se",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

// Stripe's API is form-encoded with bracket notation, so a nested object has to
// be flattened: {a:{b:1}} -> "a[b]=1".
function toForm(obj: Record<string, unknown>, prefix = "", out = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object" && !Array.isArray(v)) {
      toForm(v as Record<string, unknown>, key, out);
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === "object" && item !== null) {
          toForm(item as Record<string, unknown>, `${key}[${i}]`, out);
        } else {
          out.append(`${key}[${i}]`, String(item));
        }
      });
    } else {
      out.append(key, String(v));
    }
  }
  return out;
}

async function stripe(path: string, body: Record<string, unknown>, idempotencyKey?: string) {
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers,
    body: toForm(body).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message ?? `Stripe error (HTTP ${res.status})`);
  }
  return data;
}

const kr = (ore: number) => (ore / 100).toLocaleString("sv-SE");

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  if (!STRIPE_SECRET_KEY) {
    console.error("STRIPE_SECRET_KEY is not set");
    return json({ error: "Ticketing is not configured yet." }, 500, origin);
  }

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign in to buy tickets" }, 401, origin);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: "Your session expired — sign in again" }, 401, origin);
  const user = userData.user;

  // Acts as the member, so RLS and auth.uid() inside create_ticket_order are
  // the real thing rather than something this function asserts.
  const asUser = createClient(SUPABASE_URL, ANON_KEY || SERVICE_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const action = String(body.action ?? "checkout");

  // -------------------------------------------------------------------------
  // CANCEL — they closed the Stripe page; give the stock back immediately
  // instead of making the next person wait 35 minutes for the hold to lapse.
  // -------------------------------------------------------------------------
  if (action === "cancel") {
    const orderId = String(body.order_id ?? "");
    if (!orderId) return json({ error: "Missing order" }, 400, origin);

    const { data: order } = await admin
      .from("orders").select("id, user_id, status").eq("id", orderId).maybeSingle();
    if (!order || order.user_id !== user.id) return json({ error: "Unknown order" }, 404, origin);
    if (order.status !== "pending") return json({ ok: true, status: order.status }, 200, origin);

    const { error } = await admin.rpc("cancel_ticket_order", { p_order: orderId, p_reason: "cancelled" });
    if (error) return json({ error: error.message }, 400, origin);
    return json({ ok: true, status: "cancelled" }, 200, origin);
  }

  // -------------------------------------------------------------------------
  // CHECKOUT
  // -------------------------------------------------------------------------
  if (action !== "checkout") return json({ error: `Unknown action: ${action}` }, 400, origin);

  const eventId = String(body.event_id ?? "");
  const items = Array.isArray(body.items) ? body.items : [];
  if (!eventId || items.length === 0) return json({ error: "Pick at least one ticket" }, 400, origin);

  const clean = items
    .map((i) => ({ ticket_type_id: String((i as any)?.ticket_type_id ?? ""), qty: Number((i as any)?.qty ?? 0) }))
    .filter((i) => i.ticket_type_id && Number.isInteger(i.qty) && i.qty > 0 && i.qty <= 20);
  if (!clean.length) return json({ error: "Pick at least one ticket" }, 400, origin);

  // 1. The database decides: is it on sale, is there stock, what does it cost.
  const { data: order, error: orderErr } = await asUser.rpc("create_ticket_order", {
    p_event: eventId,
    p_items: clean,
  });
  if (orderErr) return json({ error: orderErr.message }, 400, origin);
  if (!order?.order_id) return json({ error: "Could not start the order" }, 500, origin);

  const site = (Deno.env.get("SITE_URL") ??
    (origin && ALLOWED_ORIGINS.includes(origin) ? origin : "https://slutstation.se")).replace(/\/$/, "");

  // 2. Turn that into a Stripe Checkout Session.
  try {
    const lineItems = (order.items ?? []).map((li: any) => ({
      quantity: li.qty,
      price_data: {
        currency: "sek",
        unit_amount: li.unit_price_ore,
        product_data: {
          name: `${order.event_name} — ${li.name}`,
          description: `Slutstation · ${kr(li.unit_price_ore)} kr`,
        },
      },
    }));

    const payload: Record<string, unknown> = {
      mode: "payment",
      // Says "Betala" rather than "Subscribe"/"Continue". Distansavtalslagen
      // 2 kap 9 § wants the payment obligation unmistakable at the button.
      submit_type: "pay",
      // Payment methods come from the Stripe dashboard, so turning on Swish or
      // Klarna later is a toggle there and no change here.
      locale: "auto",
      customer_email: user.email,
      client_reference_id: order.order_id,
      line_items: lineItems,
      // Stripe requires at least 30 minutes; the database hold is 35, so the
      // window always closes before the stock is released.
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      metadata: { order_id: order.order_id, event_id: eventId, user_id: user.id },
      payment_intent_data: {
        metadata: { order_id: order.order_id, event_id: eventId },
        // An emailed receipt is the durable record of the purchase. The full
        // terms still need to go out by email too — see STRIPE-SETUP.md.
        receipt_email: user.email,
      },
      // Shown right above Stripe's pay button. Swedish first: these are the two
      // facts a buyer is entitled to have in front of them at that moment.
      custom_text: {
        submit: {
          message:
            "Ingen ångerrätt på evenemangsbiljetter. Ställs evenemanget in eller flyttas det får du hela biljettpriset tillbaka, oavsett orsak. " +
            "No right of withdrawal on event tickets. If the event is cancelled or moved you get the full ticket price back, whatever the cause.",
        },
      },
      success_url: `${site}/tickets.html?status=success&order=${order.order_id}`,
      cancel_url: `${site}/tickets.html?status=cancelled&order=${order.order_id}`,
    };

    // Opt-in, because Stripe rejects this unless a Terms of service URL is set
    // under Settings → Public business information. Turn it on with the secret
    // STRIPE_COLLECT_TOS=true once that URL points at slutstation.se/#info, and
    // Stripe records the acceptance alongside the payment.
    if ((Deno.env.get("STRIPE_COLLECT_TOS") ?? "").toLowerCase() === "true") {
      payload.consent_collection = { terms_of_service: "required" };
    }

    const session = await stripe("/checkout/sessions", payload, `order-${order.order_id}`);

    await admin.from("orders").update({ stripe_session_id: session.id }).eq("id", order.order_id);

    return json({
      ok: true,
      url: session.url,
      order_id: order.order_id,
      total_ore: order.total_ore,
    }, 200, origin);
  } catch (err) {
    // Stripe said no — hand the stock straight back rather than leaving it held.
    console.error("Stripe checkout failed:", err);
    await admin.rpc("cancel_ticket_order", { p_order: order.order_id, p_reason: "cancelled" });
    return json({ error: (err as Error).message ?? "Could not reach Stripe" }, 502, origin);
  }
});
