// ============================================================================
// SLUTSTATION, weekly-digest
//
// A Monday summary to ourselves: everything that moved in seven days, and
// everything that looks wrong. The second half is the reason it exists. A
// member stuck on a form, a welcome email that never sent and an eBas error
// are all invisible until somebody complains, which is usually months later
// and usually to us.
//
// Its own function rather than another branch inside member-emails, because
// that one runs every five minutes and sends the "you're in" email that people
// are actually waiting for. Nothing in here should ever be able to break it.
//
// Callable two ways, both server-side only:
//   * header  x-cron-secret: <CRON_SECRET>   (what the Monday schedule uses)
//   * body    { "to": "you@example.com" }    to send one to yourself now
//
// Recipients live in app_settings.digest_to, so changing who gets it is a row
// in the database rather than a deploy. Empty means it does not send.
//
// Secrets are the same ones member-emails uses: SMTP_HOST, SMTP_PORT,
// SMTP_USER, SMTP_PASS, MAIL_FROM, MAIL_FROM_NAME, CRON_SECRET.
//
// npm: specifier on purpose. esm.sh and jsr: both fail to boot on Supabase's
// Deno runtime. Don't "tidy" this into a URL import.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import nodemailer from "npm:nodemailer@6.9.14";

const SMTP_HOST = Deno.env.get("SMTP_HOST") ?? "";
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") ?? "587");
const SMTP_USER = Deno.env.get("SMTP_USER") ?? "";
const SMTP_PASS = Deno.env.get("SMTP_PASS") ?? "";
const MAIL_FROM = Deno.env.get("MAIL_FROM") ?? SMTP_USER;
const MAIL_FROM_NAME = Deno.env.get("MAIL_FROM_NAME") ?? "Slutstation";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const SITE = (Deno.env.get("SITE_URL") ?? "https://slutstation.se").replace(/\/$/, "");

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

// ---------------------------------------------------------------------------
// The weekly digest, to ourselves.
//
// Everything that moved in seven days, and everything that looks wrong. The
// second half is the reason it exists: a member stuck on a form, a welcome
// email that never sent and an eBas error are all currently invisible until
// somebody complains. Fifteen minutes of work that turns "we found out in
// September" into "we found out on Monday".
// ---------------------------------------------------------------------------
type Digest = {
  generated_at: string;
  new_members: number; approved: number; total_active: number; attendance: number;
  next_event: { name: string; venue: string | null; starts_at: string; announced: boolean } | null;
  pending_approval: number; stuck_unverified: number; ebas_failed: number; welcome_unsent: number;
};

function digestHtml(d: Digest): string {
  const row = (label: string, value: string | number, warn = false) => `
    <tr>
      <td style="padding:9px 0;border-bottom:1px solid #23262f;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#c7cad2;">${esc(label)}</td>
      <td align="right" style="padding:9px 0;border-bottom:1px solid #23262f;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:${warn && Number(value) > 0 ? "#ff2a2a" : "#f4f5f7"};">${esc(value)}</td>
    </tr>`;

  const when = d.next_event
    ? new Date(d.next_event.starts_at).toLocaleDateString("sv-SE", { day: "numeric", month: "long" })
    : null;

  const problems = d.stuck_unverified + d.ebas_failed + d.welcome_unsent;

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8" /><meta name="color-scheme" content="dark" /><title>Slutstation, this week</title></head>
<body style="margin:0;padding:0;background-color:#0a0b0f;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0a0b0f;">
<tr><td align="center" style="padding:36px 16px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#101219;border:1px solid #23262f;border-radius:14px;">
    <tr><td align="center" style="padding:32px 32px 6px;">
      <div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;letter-spacing:0.34em;color:#f4f5f7;text-transform:uppercase;">Slutstation</div>
    </td></tr>
    <tr><td align="center" style="padding:0 32px 4px;">
      <div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.16em;color:#ff2a2a;text-transform:uppercase;">This week</div>
    </td></tr>

    <tr><td style="padding:22px 32px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        ${row("New accounts", d.new_members)}
        ${row("Memberships approved", d.approved)}
        ${row("Check-ins", d.attendance)}
        ${row("Active members, total", d.total_active)}
      </table>
    </td></tr>

    <tr><td style="padding:26px 32px 0;">
      <div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.16em;color:#83879a;text-transform:uppercase;padding-bottom:6px;">Next event</div>
      <div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#c7cad2;">
        ${d.next_event
          ? `<strong style="color:#f4f5f7;">${esc(d.next_event.name)}</strong>, ${esc(when!)}${d.next_event.venue ? ", " + esc(d.next_event.venue) : ""}<br />
             ${d.next_event.announced ? "Announced and on sale." : "Not announced yet. Nothing about it is public."}`
          : "Nothing in the calendar."}
      </div>
    </td></tr>

    <tr><td style="padding:26px 32px 0;">
      <div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.16em;color:${problems ? "#ff2a2a" : "#83879a"};text-transform:uppercase;padding-bottom:6px;">Needs a look</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        ${row("Signed up, never reached eBas", d.stuck_unverified, true)}
        ${row("eBas registration failed", d.ebas_failed, true)}
        ${row("Approved, welcome email unsent", d.welcome_unsent, true)}
        ${row("Waiting on the approval delay", d.pending_approval)}
      </table>
      ${problems === 0
        ? `<p style="margin:14px 0 0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;color:#83879a;">Nothing stuck. Nothing to do.</p>`
        : `<p style="margin:14px 0 0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;color:#c7cad2;">Anything above zero on the first three is worth ten minutes in the admin panel.</p>`}
    </td></tr>

    <tr><td align="left" style="padding:24px 32px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr><td align="center" bgcolor="#ff2a2a" style="border-radius:100px;">
          <a href="${SITE}/admin.html" style="display:inline-block;padding:12px 28px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:100px;">Open the admin panel</a>
        </td></tr>
      </table>
    </td></tr>

    <tr><td style="padding:26px 32px 32px;">
      <p style="margin:0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#6b6f80;">
        Sent every Monday to the addresses in app_settings.digest_to. Kulturf&ouml;reningen Musikbopp.
      </p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

function digestText(d: Digest): string {
  return [
    "Slutstation, this week",
    "",
    `New accounts:            ${d.new_members}`,
    `Memberships approved:    ${d.approved}`,
    `Check-ins:               ${d.attendance}`,
    `Active members, total:   ${d.total_active}`,
    "",
    d.next_event
      ? `Next event: ${d.next_event.name}, ${new Date(d.next_event.starts_at).toLocaleDateString("sv-SE")}` +
        (d.next_event.announced ? " (announced)" : " (not announced)")
      : "Next event: nothing in the calendar.",
    "",
    "Needs a look",
    `  Signed up, never reached eBas:  ${d.stuck_unverified}`,
    `  eBas registration failed:       ${d.ebas_failed}`,
    `  Approved, welcome email unsent: ${d.welcome_unsent}`,
    `  Waiting on the approval delay:  ${d.pending_approval}`,
    "",
    `${SITE}/admin.html`,
  ].join("\n");
}

function transport() {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const secret = req.headers.get("x-cron-secret") ?? "";
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "Not authorised" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.error("SMTP is not configured");
    return new Response(JSON.stringify({ error: "SMTP not configured" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await admin.rpc("weekly_digest");
  if (error) {
    console.error("digest query failed:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
  const d = data as Digest;

  // An explicit "to" overrides the setting, for testing how it renders without
  // mailing everybody.
  let recipients: string[];
  if (body.to) {
    recipients = [String(body.to)];
  } else {
    const { data: row } = await admin
      .from("app_settings").select("value").eq("key", "digest_to").maybeSingle();
    recipients = String(row?.value ?? "")
      .split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  }

  if (!recipients.length) {
    return new Response(JSON.stringify({ ok: true, sent: 0, reason: "digest_to is empty" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    await transport().sendMail({
      from: `"${MAIL_FROM_NAME}" <${MAIL_FROM}>`,
      to: recipients.join(", "),
      subject: "Slutstation, this week",
      text: digestText(d),
      html: digestHtml(d),
    });
    return new Response(JSON.stringify({ ok: true, sent: recipients.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Digest send failed:", err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 502 });
  }
});
