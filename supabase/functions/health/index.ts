// ============================================================================
// SLUTSTATION, health
//
// One GET, answered in milliseconds, that says whether the invisible half of
// the system is working. The weekly digest already knows what "wrong" looks
// like — eBas failures, welcome emails that never left, an announcement queue
// that is not draining — but it only says so on Mondays. Point a free uptime
// monitor at this endpoint with a keyword check for "\"ok\":true" and the
// Monday report becomes a same-hour alert.
//
// Call:   GET /functions/v1/health?key=<HEALTH_SECRET>
// Deploy: supabase functions deploy health --no-verify-jwt
//         supabase secrets set HEALTH_SECRET=<any long random string>
//
// The key gates it because even counts are nobody else's business; everything
// behind it is numbers only — no names, no emails, nothing personal.
//
// "ok" is deliberately strict about SYSTEM faults and silent about human
// ones: people who haven't confirmed their email yet (stuck_unverified) are
// a normal Tuesday, so they're reported but don't fail the check.
//
// npm: specifier on purpose — esm.sh and jsr: both fail to boot on Supabase's
// edge runtime (see the ebas function).
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

  const HEALTH_SECRET = Deno.env.get("HEALTH_SECRET") ?? "";
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (!HEALTH_SECRET || key !== HEALTH_SECRET) {
    return new Response(JSON.stringify({ error: "Not authorised" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data: d, error } = await admin.rpc("weekly_digest");
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  // How many opted-in members are still waiting for the announcement email of
  // a live announced event. Capped at 50 by the RPC — "50" reads as "50+".
  // A number here minutes after announcing is normal; a number here HOURS
  // after is the cron or the mailbox being broken, which is exactly the
  // failure that is otherwise invisible until someone complains.
  let announce_backlog = 0;
  try {
    const { data: q } = await admin.rpc("members_awaiting_announcement", { p_limit: 50 });
    announce_backlog = Array.isArray(q) ? q.length : 0;
  } catch (_) { /* function is service-role only and exists; belt anyway */ }

  const ebas_failed = Number(d?.ebas_failed ?? 0);
  const welcome_unsent = Number(d?.welcome_unsent ?? 0);
  const ok = ebas_failed === 0 && welcome_unsent === 0;

  return new Response(JSON.stringify({
    ok,
    checked_at: new Date().toISOString(),
    ebas_failed,
    welcome_unsent,
    stuck_unverified: Number(d?.stuck_unverified ?? 0),
    pending_approval: Number(d?.pending_approval ?? 0),
    announce_backlog,
    next_event_announced: d?.next_event?.announced ?? null,
  }), { headers: { "Content-Type": "application/json" } });
});
