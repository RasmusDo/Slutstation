// ============================================================================
// SLUTSTATION — eBas Edge Function
//
// This is the ONLY place the eBas API key exists. It never reaches a browser.
// (Your current site inlines it into the JS bundle via VITE_API_KEY — Vite
// bakes every VITE_* variable into the public bundle at build time, which is
// why the key is readable on slutstation.se today. This replaces that.)
//
// Actions:
//   POST { action: "register" } -> submit/renew the caller in eBas
//   POST { action: "verify"   } -> re-check the caller's membership
//
// The caller must send a valid Supabase session JWT, so only logged-in
// members can trigger eBas calls — no open proxy, no spam surface.
// ============================================================================

// Must be the `npm:` specifier. Supabase's Deno edge runtime resolves npm: and
// boots fine; the esm.sh build fails at startup with BOOT_ERROR (verified live
// on this project) and jsr: fails too. Don't "tidy" this into a URL import.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// ---------------------------------------------------------------------------
// Config (set with: supabase secrets set KEY=value)
// ---------------------------------------------------------------------------
const EBAS_SUBMIT_URL =
  Deno.env.get("EBAS_SUBMIT_URL") ??
  "https://ebas.svensklive.se/apis/submit_member.json";

// Optional. eBas (built by Sverok Admin) publishes no member-lookup endpoint,
// so live verification is off until Svensk Live confirms one exists. Set this
// secret and `verify` upgrades from "trust what eBas told us at registration"
// to a real round-trip — no code change needed.
const EBAS_LOOKUP_URL = Deno.env.get("EBAS_LOOKUP_URL") ?? "";

const EBAS_API_KEY = Deno.env.get("EBAS_API_KEY") ?? "";

const ALLOWED_ORIGINS = [
  "https://slutstation.se",
  "https://www.slutstation.se",
  "http://localhost:5173", // vite dev
];

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0];
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

// eBas wants the birth date as YYYYMMDD in the `socialsecuritynumber` field.
// It does NOT need a full personnummer, and we never store one.
function toEbasDate(isoDate: string | null): string {
  if (!isoDate) return "";
  return isoDate.replaceAll("-", "");
}

// Membership runs by CALENDAR YEAR, not as a rolling twelve months. Register
// in August and you are a member until 1 January; everybody renews in January
// regardless of when they joined. The database owns this rule in
// public.membership_expires_on() — this is the same rule, for the one decision
// that happens out here rather than in a query.
function stillValidForThisYear(renewed: string | null): boolean {
  if (!renewed) return false;
  const year = new Date(renewed).getFullYear();
  return Number.isFinite(year) && year >= new Date().getFullYear();
}

interface Profile {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  birth_date: string | null;
  gender_id: number | null;
  street: string | null;
  zip_code: string | null;
  city: string | null;
  ebas_status: string;
  ebas_renewed_on: string | null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, origin);
  }
  if (!EBAS_API_KEY) {
    console.error("EBAS_API_KEY is not set");
    return json({ error: "Server not configured" }, 500, origin);
  }

  // -- 1. Who is calling? ----------------------------------------------------
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Not signed in" }, 401, origin);

  // service-role client: needed to write the protected ebas_* columns
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return json({ error: "Invalid session" }, 401, origin);
  }
  const userId = userData.user.id;

  // -- 2. What are they asking for? -----------------------------------------
  let action = "verify";
  try {
    const body = await req.json();
    if (body?.action) action = String(body.action);
  } catch {
    // empty body -> default to verify
  }

  const { data: profile, error: profErr } = await admin
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single<Profile>();

  if (profErr || !profile) {
    return json({ error: "Profile not found" }, 404, origin);
  }

  // -------------------------------------------------------------------------
  // REGISTER — create or renew the member in eBas
  // -------------------------------------------------------------------------
  if (action === "register") {
    const missing = (["first_name", "last_name", "birth_date", "street", "zip_code", "city"] as const)
      .filter((k) => !profile[k]);
    if (missing.length) {
      return json(
        { error: "Missing details", fields: missing },
        400,
        origin,
      );
    }

    const today = new Date().toISOString().slice(0, 10);
    const payload = {
      api_key: EBAS_API_KEY,
      member: {
        firstname: profile.first_name,
        lastname: profile.last_name,
        gender_id: String(profile.gender_id ?? 3),
        socialsecuritynumber: toEbasDate(profile.birth_date),
        email: profile.email,
        phone1: profile.phone ?? "",
        street: profile.street,
        zip_code: profile.zip_code,
        city: profile.city,
        renewed: today,
        subscribe_nyhetsbrev: null,
      },
    };

    let ok = false;
    let message = "";
    try {
      const res = await fetch(EBAS_SUBMIT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await res.json().catch(() => ({}));
      ok = res.ok && result?.stored_member === true;

      if (!ok) {
        if (result?.member_errors) {
          message = Object.values(result.member_errors).flat().join(", ");
        } else if (result?.member_warnings?.length) {
          message = result.member_warnings.join(", ");
        } else {
          message = `eBas rejected the registration (HTTP ${res.status}).`;
        }
      }
    } catch (err) {
      message = "Could not reach eBas. Please try again later.";
      console.error("eBas submit failed:", err);
    }

    await admin
      .from("profiles")
      .update({
        ebas_status: ok ? "active" : "failed",
        ebas_renewed_on: ok ? today : profile.ebas_renewed_on,
        ebas_checked_at: new Date().toISOString(),
        ebas_message: ok ? null : message,
      })
      .eq("id", userId);

    return json(
      ok
        ? { ok: true, status: "active", renewed_on: today }
        : { ok: false, status: "failed", message },
      ok ? 200 : 502,
      origin,
    );
  }

  // -------------------------------------------------------------------------
  // VERIFY — refresh the green check
  // -------------------------------------------------------------------------
  if (action === "verify") {
    // (a) Live round-trip to eBas, if a lookup endpoint has been configured.
    if (EBAS_LOOKUP_URL) {
      try {
        const res = await fetch(EBAS_LOOKUP_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: EBAS_API_KEY,
            email: profile.email,
          }),
        });
        const result = await res.json().catch(() => ({}));

        // eBas response shape is unconfirmed; accept the common variants.
        const found = result?.member ?? result?.data ?? null;
        const renewed: string | null =
          found?.renewed ?? found?.renewed_at ?? null;

        if (res.ok && found) {
          const stillValid = stillValidForThisYear(renewed);
          await admin
            .from("profiles")
            .update({
              ebas_status: stillValid ? "active" : "expired",
              ebas_renewed_on: renewed ?? profile.ebas_renewed_on,
              ebas_checked_at: new Date().toISOString(),
              ebas_message: null,
            })
            .eq("id", userId);

          return json(
            {
              ok: true,
              source: "ebas-live",
              status: stillValid ? "active" : "expired",
              renewed_on: renewed ?? profile.ebas_renewed_on,
            },
            200,
            origin,
          );
        }
        // fall through to stored state if the lookup came back empty
      } catch (err) {
        console.error("eBas lookup failed, falling back to stored state:", err);
      }
    }

    // (b) Fallback: recompute from what eBas told us when they registered.
    const renewedOn = profile.ebas_renewed_on;
    const stillValid = stillValidForThisYear(renewedOn);

    let status = profile.ebas_status;
    if (status === "active" && !stillValid) status = "expired";
    if (status === "expired" && stillValid) status = "active";

    if (status !== profile.ebas_status) {
      await admin
        .from("profiles")
        .update({ ebas_status: status, ebas_checked_at: new Date().toISOString() })
        .eq("id", userId);
    }

    return json(
      {
        ok: true,
        source: EBAS_LOOKUP_URL ? "stored-fallback" : "stored",
        status,
        renewed_on: renewedOn,
      },
      200,
      origin,
    );
  }

  return json({ error: `Unknown action: ${action}` }, 400, origin);
});
