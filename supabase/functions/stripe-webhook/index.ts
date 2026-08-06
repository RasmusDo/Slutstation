// ============================================================================
// SLUTSTATION — Stripe webhook
//
// This is the only thing that turns money into tickets. The browser is never
// trusted for that: a person can close the tab, lose signal, or fake a
// "success" redirect, and the tickets still appear exactly when Stripe says
// the payment landed, and only then.
//
// Deployed with verify_jwt = false — Stripe does not send a Supabase JWT. The
// signature check below is what keeps it closed: without the signing secret you
// cannot forge a request, and a replayed one is rejected on timestamp.
//
// Secrets to set:
//   STRIPE_WEBHOOK_SECRET   whsec_… from the endpoint you create in Stripe
//
// Events handled:
//   checkout.session.completed          -> issue the tickets (idempotent)
//   checkout.session.async_payment_succeeded
//   checkout.session.expired            -> give the held stock back
//   checkout.session.async_payment_failed
//   charge.refunded                     -> void the tickets, restore stock
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const TOLERANCE_SECONDS = 60 * 5;

const enc = new TextEncoder();

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Stripe signs `${timestamp}.${rawBody}`. The raw body matters — parsing and
// re-serialising the JSON first would change the bytes and break the check.
async function verify(rawBody: string, header: string): Promise<boolean> {
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.trim().split("=") as [string, string]).filter((p) => p.length === 2),
  );
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(t));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return false;

  const key = await crypto.subtle.importKey(
    "raw", enc.encode(WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${rawBody}`));
  return timingSafeEqual(toHex(sig), v1);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!WEBHOOK_SECRET) {
    console.error("STRIPE_WEBHOOK_SECRET is not set");
    return new Response("Not configured", { status: 500 });
  }

  const sigHeader = req.headers.get("stripe-signature") ?? "";
  const raw = await req.text();

  if (!sigHeader || !(await verify(raw, sigHeader))) {
    console.warn("Rejected a webhook with a bad or missing signature");
    return new Response("Bad signature", { status: 400 });
  }

  let event: any;
  try { event = JSON.parse(raw); } catch { return new Response("Bad payload", { status: 400 }); }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const obj = event?.data?.object ?? {};
  const orderId: string | null = obj?.metadata?.order_id ?? obj?.client_reference_id ?? null;

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        if (obj.payment_status !== "paid" && event.type === "checkout.session.completed") {
          // Bank transfers and the like settle later; wait for the async event.
          console.log(`Session ${obj.id} completed but unpaid — waiting`);
          break;
        }
        if (!orderId) { console.error("Paid session with no order_id", obj.id); break; }

        const { data, error } = await admin.rpc("finalize_ticket_order", {
          p_order: orderId,
          p_session: obj.id ?? null,
          p_payment_intent: obj.payment_intent ?? null,
          p_amount_ore: obj.amount_total ?? null,
        });
        if (error) throw error;
        console.log(`Order ${orderId}: ${data?.already ? "already fulfilled" : `${data?.tickets} ticket(s) issued`}`);
        break;
      }

      case "checkout.session.expired":
      case "checkout.session.async_payment_failed": {
        if (!orderId) break;
        const { error } = await admin.rpc("cancel_ticket_order", { p_order: orderId, p_reason: "expired" });
        if (error) throw error;
        console.log(`Order ${orderId} released`);
        break;
      }

      case "charge.refunded": {
        const pi = obj.payment_intent ?? null;
        const fromMeta = obj?.metadata?.order_id ?? null;

        let target = fromMeta;
        if (!target && pi) {
          const { data } = await admin.from("orders").select("id").eq("stripe_payment_intent", pi).maybeSingle();
          target = data?.id ?? null;
        }
        if (!target) { console.error("Refund with no matching order", obj.id); break; }

        const full = (obj.amount_refunded ?? 0) >= (obj.amount ?? 0);
        if (full) {
          const { error } = await admin.rpc("refund_ticket_order", { p_order: target });
          if (error) throw error;
          console.log(`Order ${target} refunded, tickets voided`);
        } else {
          await admin.from("orders")
            .update({ flagged: `Partial refund of ${(obj.amount_refunded ?? 0) / 100} kr — tickets left valid` })
            .eq("id", target);
        }
        break;
      }

      default:
        // Everything else is noise we deliberately don't act on.
        break;
    }
  } catch (err) {
    // A 500 makes Stripe retry, which is what we want for a transient failure.
    console.error(`Handling ${event.type} failed:`, err);
    return new Response("Handler failed", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
