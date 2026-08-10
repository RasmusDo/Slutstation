// ============================================================================
// SLUTSTATION, wallet — the membership card in Apple Wallet, kept alive
//
// Three jobs in one function, because they share every secret and most code:
//
//   1. MINT   POST /functions/v1/wallet         (Supabase session JWT)
//             Builds, signs and returns the caller's .pkpass: dark card, red
//             aura strip, tier in the header, nights + next tier on the face,
//             tonight's perks when there is a tonight, QR = the same account
//             id the door already scans.
//
//   2. SERVE  /functions/v1/wallet/v1/…         (Apple's PassKit web service)
//             The five endpoints iOS calls on its own: register a device,
//             unregister, list stale serials, fetch the latest pass, log.
//             Documented protocol, not ours to design.
//
//   3. PUSH   POST /functions/v1/wallet/push    (x-cron-secret)
//             For every pass flagged needs_push (schema-phase20 triggers:
//             attendance, tier change, perk handed over), send the empty APNs
//             nudge that makes the iPhone re-fetch through (2). The pass's
//             changeMessages then put "Tier: Tier 3" on the lock screen.
//
// Secrets (Supabase → Edge Functions → Secrets; see ROLLOUT.md for where
// each one comes from — all of them require the Apple Developer account):
//   PASS_TYPE_ID        pass.se.slutstation.member
//   APPLE_TEAM_ID       the 10-character team id
//   PASS_CERT_PEM       the Pass Type ID certificate, PEM
//   PASS_KEY_PEM        its private key, PEM
//   PASS_KEY_PASSWORD   only if the key is encrypted; empty otherwise
//   APPLE_WWDR_PEM      Apple's WWDR G4 intermediate certificate, PEM
//   APNS_AUTH_KEY       the .p8 APNs auth key, full PEM contents
//   APNS_KEY_ID         that key's 10-character id
//   CRON_SECRET         the same one every scheduled function already uses
//
// Deploy with --no-verify-jwt: Apple's callbacks carry an ApplePass token,
// not a Supabase JWT, and the per-pass token in wallet_passes is what gates
// them. The mint path checks the Supabase session itself.
//
// npm: specifier on purpose — esm.sh and jsr: both fail to boot on Supabase's
// edge runtime (see the ebas function, which found this the hard way).
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { PKPass } from "npm:passkit-generator@3.2.0";
import { Buffer } from "node:buffer";

const PASS_TYPE_ID = Deno.env.get("PASS_TYPE_ID") ?? "";
const TEAM_ID = Deno.env.get("APPLE_TEAM_ID") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });

function admin() {
  return createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

// ---------------------------------------------------------------------------
// The pass itself. Everything visual lives here; the images ship with the
// function (assets/) and were generated from the site's own art — the strip
// is the front page's red aura, drawn as a PNG, deliberately not a photograph
// (a stranger's face on every member's card is nobody's brand).
// ---------------------------------------------------------------------------
async function asset(name: string): Promise<Buffer> {
  return Buffer.from(await Deno.readFile(new URL(`./assets/${name}`, import.meta.url)));
}

type CardData = {
  userId: string;
  authToken: string;
  name: string;
  tier: number;
  tierName: string;
  nights: number;
  nextLine: string;      // "2 nights to Tier 3" / "Top tier"
  perksLine: string | null;   // "Wardrobe ✓ 23:41 · Soft drink —" or null
  memberOk: boolean;
};

function passJson(d: CardData): Record<string, unknown> {
  const secondary: unknown[] = [
    { key: "nights", label: "NIGHTS · 24 MO", value: String(d.nights) },
    { key: "next", label: "NEXT", value: d.nextLine, changeMessage: "%@" },
  ];
  const auxiliary: unknown[] = [];
  if (d.perksLine) {
    auxiliary.push({ key: "perks", label: "TONIGHT", value: d.perksLine, changeMessage: "Tonight: %@" });
  }
  return {
    formatVersion: 1,
    passTypeIdentifier: PASS_TYPE_ID,
    teamIdentifier: TEAM_ID,
    organizationName: "Slutstation",
    description: "Slutstation membership",
    serialNumber: d.userId,
    webServiceURL: `${SUPABASE_URL}/functions/v1/wallet`,
    authenticationToken: d.authToken,
    sharingProhibited: true,
    backgroundColor: "rgb(10,11,15)",
    foregroundColor: "rgb(244,245,247)",
    labelColor: "rgb(255,92,92)",
    barcodes: [{
      format: "PKBarcodeFormatQR",
      // The exact payload the door and bar scanners already accept.
      message: d.userId,
      messageEncoding: "iso-8859-1",
      altText: d.tierName,
    }],
    storeCard: {
      headerFields: [{
        key: "tier", label: "TIER", value: d.tierName,
        changeMessage: "Tier: %@",
      }],
      secondaryFields: secondary,
      auxiliaryFields: auxiliary,
      backFields: [
        { key: "member", label: "Member", value: d.name },
        { key: "status", label: "Membership", value: d.memberOk ? "Active" : "Lapsed — renew at slutstation.se/account" },
        {
          key: "how", label: "How tiers work",
          value: "Earned by turning up, counted over the last 24 months — so it moves both ways. Every tier keeps everything below it.",
        },
        {
          key: "ladder", label: "The ladder",
          value: "Tier 1: buy tickets to members-only events.\nTier 2: the wardrobe is on us, every night.\nTier 3: a soft drink or Red Bull on us, 20% off your ticket, the announcement first.\nTier 4: our lowest ticket price, always — even on a sold-out night.",
        },
        { key: "site", label: "Your account", value: "https://slutstation.se/account.html" },
        { key: "contact", label: "Contact", value: "info@slutstation.se" },
      ],
    },
  };
}

async function buildPass(d: CardData): Promise<Buffer> {
  const files: Record<string, Buffer> = {
    "pass.json": Buffer.from(JSON.stringify(passJson(d))),
    "icon.png": await asset("icon.png"),
    "icon@2x.png": await asset("icon@2x.png"),
    "icon@3x.png": await asset("icon@3x.png"),
    "logo.png": await asset("logo.png"),
    "logo@2x.png": await asset("logo@2x.png"),
    "strip.png": await asset("strip.png"),
    "strip@2x.png": await asset("strip@2x.png"),
    "strip@3x.png": await asset("strip@3x.png"),
  };
  const pass = new PKPass(files, {
    wwdr: Deno.env.get("APPLE_WWDR_PEM") ?? "",
    signerCert: Deno.env.get("PASS_CERT_PEM") ?? "",
    signerKey: Deno.env.get("PASS_KEY_PEM") ?? "",
    signerKeyPassphrase: Deno.env.get("PASS_KEY_PASSWORD") || undefined,
  });
  return pass.getAsBuffer();
}

// ---------------------------------------------------------------------------
// What the card says, read from the same views everything else trusts.
// ---------------------------------------------------------------------------
async function cardData(db: ReturnType<typeof admin>, userId: string, authToken: string): Promise<CardData | null> {
  const { data: s } = await db.from("member_stats").select("*").eq("id", userId).maybeSingle();
  if (!s) return null;
  const { data: p } = await db.from("profiles")
    .select("first_name, last_name, ebas_status").eq("id", userId).maybeSingle();

  const tier = s.tier ?? 1;
  const need = s.events_to_next_tier;
  const nextLine = s.next_tier_at == null
    ? "Top tier"
    : need === 1 ? `1 night to Tier ${s.next_tier}` : `${need} nights to Tier ${s.next_tier}`;

  // Tonight's perks, only when there is a tonight. Same rule the bar uses:
  // wardrobe from Tier 2, the drink from Tier 3, claims frozen per event.
  let perksLine: string | null = null;
  if (tier >= 2) {
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const { data: ev } = await db.from("events")
      .select("id, starts_at")
      .gte("starts_at", dayStart.toISOString())
      .lt("starts_at", new Date(dayStart.getTime() + 86400000).toISOString())
      .order("starts_at").limit(1).maybeSingle();
    if (ev) {
      const { data: claims } = await db.from("perk_claims")
        .select("perk, claimed_at").eq("user_id", userId).eq("event_id", ev.id);
      const got = new Map((claims || []).map((c) => [c.perk, c.claimed_at]));
      const line = (label: string, perk: string) => {
        const at = got.get(perk);
        return at
          ? `${label} ✓ ${new Date(at).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}`
          : `${label} — ready`;
      };
      const parts = [line("Wardrobe", "wardrobe")];
      if (tier >= 3) parts.push(line("Drink", "drink"));
      perksLine = parts.join(" · ");
    }
  }

  return {
    userId, authToken,
    name: [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "Member",
    tier,
    tierName: s.tier_name || `Tier ${tier}`,
    nights: s.events_window ?? 0,
    nextLine,
    perksLine,
    memberOk: p?.ebas_status === "active",
  };
}

function pkpassResponse(buf: Buffer): Response {
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.apple.pkpass",
      "Content-Disposition": 'attachment; filename="slutstation.pkpass"',
      "Last-Modified": new Date().toUTCString(),
    },
  });
}

// ---------------------------------------------------------------------------
// APNs. Token-based auth (the .p8 key), HTTP/2 via fetch, empty payload —
// that is the entire protocol for "your pass changed, come and get it".
// ---------------------------------------------------------------------------
let apnsJwtCache: { token: string; at: number } | null = null;

async function apnsToken(): Promise<string> {
  // Apple rejects tokens older than an hour and asks you not to mint one per
  // push; 45 minutes splits the difference.
  if (apnsJwtCache && Date.now() - apnsJwtCache.at < 45 * 60 * 1000) return apnsJwtCache.token;

  const pem = Deno.env.get("APNS_AUTH_KEY") ?? "";
  const der = Uint8Array.from(
    atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")),
    (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);

  const b64url = (b: Uint8Array | string) =>
    btoa(typeof b === "string" ? b : String.fromCharCode(...b))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = b64url(JSON.stringify({ alg: "ES256", kid: Deno.env.get("APNS_KEY_ID") ?? "" }));
  const claims = b64url(JSON.stringify({ iss: TEAM_ID, iat: Math.floor(Date.now() / 1000) }));
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${header}.${claims}`)));
  const token = `${header}.${claims}.${b64url(sig)}`;
  apnsJwtCache = { token, at: Date.now() };
  return token;
}

async function pushDevice(pushToken: string): Promise<number> {
  const res = await fetch(`https://api.push.apple.com/3/device/${pushToken}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${await apnsToken()}`,
      "apns-topic": PASS_TYPE_ID,
      "apns-push-type": "alert",
      "apns-priority": "10",
    },
    body: "{}",
  });
  // Read and discard so the HTTP/2 stream closes cleanly.
  await res.text().catch(() => {});
  return res.status;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  // Path relative to the function: "" | "push" | "v1/…"
  const rel = url.pathname.replace(/^.*\/wallet\/?/, "");
  const db = admin();

  // ---- 3. PUSH (cron) -----------------------------------------------------
  if (rel === "push" && req.method === "POST") {
    if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
      return json({ error: "Not authorised" }, 401);
    }
    const { data: stale } = await db.from("wallet_passes")
      .select("user_id").eq("needs_push", true).limit(200);
    let sent = 0, gone = 0;
    for (const row of stale || []) {
      const { data: regs } = await db.from("wallet_registrations")
        .select("device_library_id, push_token").eq("user_id", row.user_id);
      for (const r of regs || []) {
        const status = await pushDevice(r.push_token);
        if (status === 410) {   // the pass left that device for good
          await db.from("wallet_registrations").delete()
            .eq("device_library_id", r.device_library_id).eq("user_id", row.user_id);
          gone++;
        } else if (status === 200) sent++;
      }
      await db.from("wallet_passes").update({ needs_push: false }).eq("user_id", row.user_id);
    }
    return json({ ok: true, sent, gone, passes: (stale || []).length });
  }

  // ---- 2. PassKit web service --------------------------------------------
  // POST/DELETE /v1/devices/{device}/registrations/{passType}/{serial}
  // GET         /v1/devices/{device}/registrations/{passType}
  // GET         /v1/passes/{passType}/{serial}
  // POST        /v1/log
  if (rel.startsWith("v1/")) {
    const parts = rel.split("/").filter(Boolean);   // ["v1", ...]

    if (parts[1] === "log" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      console.warn("passkit log:", JSON.stringify(body));
      return json({});
    }

    const applePass = (req.headers.get("Authorization") ?? "").replace(/^ApplePass\s+/i, "");

    async function passRow(serial: string) {
      const { data } = await db.from("wallet_passes")
        .select("user_id, auth_token, updated_at").eq("user_id", serial).maybeSingle();
      return data && data.auth_token === applePass ? data : null;
    }

    // Register / unregister a device
    if (parts[1] === "devices" && parts[3] === "registrations" && parts[5]) {
      const [, device, , , , serial] = parts;
      const row = await passRow(serial);
      if (!row) return json({ error: "Not authorised" }, 401);

      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        if (!body.pushToken) return json({ error: "pushToken required" }, 400);
        const { error } = await db.from("wallet_registrations").upsert({
          device_library_id: device, user_id: serial, push_token: body.pushToken,
        });
        if (error) return json({ error: error.message }, 500);
        return json({}, 201);
      }
      if (req.method === "DELETE") {
        await db.from("wallet_registrations").delete()
          .eq("device_library_id", device).eq("user_id", serial);
        return json({});
      }
    }

    // Which of this device's passes changed?
    if (parts[1] === "devices" && parts[3] === "registrations" && !parts[5] && req.method === "GET") {
      const device = parts[2];
      const since = url.searchParams.get("passesUpdatedSince");
      const { data: regs } = await db.from("wallet_registrations")
        .select("user_id, wallet_passes!inner(updated_at)").eq("device_library_id", device);
      if (!regs?.length) return new Response(null, { status: 204 });
      const updated = regs.filter((r) => {
        const at = (r as { wallet_passes: { updated_at: string } }).wallet_passes.updated_at;
        return !since || new Date(at).getTime() > Number(since);
      });
      if (!updated.length) return new Response(null, { status: 204 });
      return json({
        serialNumbers: updated.map((r) => r.user_id),
        lastUpdated: String(Date.now()),
      });
    }

    // The fresh pass itself
    if (parts[1] === "passes" && parts[3] && req.method === "GET") {
      const serial = parts[3];
      const row = await passRow(serial);
      if (!row) return json({ error: "Not authorised" }, 401);
      const d = await cardData(db, serial, row.auth_token);
      if (!d) return json({ error: "No such member" }, 404);
      return pkpassResponse(await buildPass(d));
    }

    return json({ error: "Not found" }, 404);
  }

  // ---- 1. MINT (the button on the account page) ---------------------------
  if (req.method === "POST") {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Sign in first" }, 401);
    const { data: u, error: uErr } = await db.auth.getUser(jwt);
    if (uErr || !u?.user) return json({ error: "Invalid session" }, 401);
    const userId = u.user.id;

    // One stable token per member: re-downloading the card must not orphan
    // the registrations the first download created.
    let { data: row } = await db.from("wallet_passes")
      .select("auth_token").eq("user_id", userId).maybeSingle();
    if (!row) {
      const auth_token = crypto.randomUUID().replace(/-/g, "") +
                         crypto.randomUUID().replace(/-/g, "");
      const { error } = await db.from("wallet_passes")
        .insert({ user_id: userId, auth_token });
      if (error) return json({ error: error.message }, 500);
      row = { auth_token };
    }

    const d = await cardData(db, userId, row.auth_token);
    if (!d) return json({ error: "No membership record yet" }, 404);
    try {
      return pkpassResponse(await buildPass(d));
    } catch (e) {
      console.error("pass build failed:", e);
      return json({ error: "Pass signing is not configured yet" }, 503);
    }
  }

  return json({ error: "Method not allowed" }, 405);
});
