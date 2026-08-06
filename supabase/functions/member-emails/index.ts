// ============================================================================
// SLUTSTATION, member-emails
//
// Sends the "your membership has been reviewed and accepted" email to everyone
// whose green check has just been released, then marks them so nobody is ever
// mailed twice. Meant to be called on a schedule (see the cron block in
// schema-phase4b-cron.sql), roughly every five minutes is plenty for a
// 15-55 minute delay.
//
// Callable two ways, both server-side only:
//   * header  x-cron-secret: <CRON_SECRET>   (what the schedule uses)
//   * body    { "action": "test", "to": "you@example.com" } to send one to
//     yourself and check how it renders, without touching anybody's record.
//
// Secrets to set:
//   SMTP_HOST      mailcluster.loopia.se
//   SMTP_PORT      587
//   SMTP_USER      the full mailbox address, e.g. noreply@slutstation.se
//   SMTP_PASS      that mailbox's password
//   MAIL_FROM      noreply@slutstation.se
//   MAIL_FROM_NAME Slutstation
//   CRON_SECRET    any long random string; the schedule sends it back
//
// npm: specifier on purpose. esm.sh and jsr: both fail to boot on Supabase's
// Deno runtime, that cost a debugging cycle on the eBas function. Don't
// "tidy" this into a URL import.
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
// The email.
//
// Table-based, 600px, inline CSS, system fonts, no images at all. That last
// one is deliberate: most clients block images until the reader clicks
// "display images", and Gmail refuses base64 entirely, so the wordmark is
// letterspaced text and the button is a table cell with a background colour.
// It looks like Slutstation with images off, which is how it will first be
// seen by most people.
// ---------------------------------------------------------------------------
function welcomeHtml(firstName: string | null): string {
  const hi = firstName ? `Hi ${esc(firstName)},` : "Hi,";
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<title>Your membership has been accepted</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0b0f;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0a0b0f;">
<tr><td align="center" style="padding:36px 16px;">

  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#101219;border:1px solid #23262f;border-radius:14px;">

    <tr><td align="center" style="padding:34px 32px 8px;">
      <div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;letter-spacing:0.34em;color:#f4f5f7;text-transform:uppercase;">Slutstation</div>
    </td></tr>

    <tr><td align="center" style="padding:0 32px 4px;">
      <div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.16em;color:#ff2a2a;text-transform:uppercase;">Membership</div>
    </td></tr>

    <tr><td style="padding:20px 32px 0;">
      <h1 style="margin:0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:26px;line-height:1.2;font-weight:600;color:#f4f5f7;letter-spacing:-0.02em;">You&rsquo;re in</h1>
    </td></tr>

    <tr><td style="padding:16px 32px 0;">
      <p style="margin:0 0 14px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#c7cad2;">${hi}</p>
      <p style="margin:0 0 14px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#c7cad2;">
        Your application has been reviewed and accepted. You&rsquo;re now a member of <strong style="color:#f4f5f7;">Kulturf&ouml;reningen Musikbopp</strong>, with access to our events. Membership is free and runs to the end of the calendar year, everyone renews in January, whenever they joined.
      </p>
      <p style="margin:0 0 22px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#c7cad2;">
        Your account shows your membership status, your tier, and the entry code you show at the door.
      </p>
    </td></tr>

    <tr><td align="left" style="padding:0 32px 6px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr><td align="center" bgcolor="#ff2a2a" style="border-radius:100px;">
          <a href="${SITE}/account.html" style="display:inline-block;padding:13px 30px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:100px;">Open my account</a>
        </td></tr>
      </table>
    </td></tr>

    <tr><td style="padding:18px 32px 0;">
      <p style="margin:0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#83879a;">
        Button not working? Open <a href="${SITE}/account.html" style="color:#ff2a2a;">${SITE.replace(/^https?:\/\//, "")}/account.html</a>
      </p>
    </td></tr>

    <tr><td style="padding:26px 32px 0;">
      <div style="height:1px;background-color:#23262f;line-height:1px;font-size:0;">&nbsp;</div>
    </td></tr>

    <tr><td style="padding:20px 32px 34px;">
      <p style="margin:0 0 8px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#83879a;">
        <span style="color:#f4f5f7;">Next:</span> tickets for upcoming events are at
        <a href="${SITE}/tickets.html" style="color:#ff2a2a;">${SITE.replace(/^https?:\/\//, "")}/tickets.html</a> once you&rsquo;re signed in.
      </p>
      <p style="margin:0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#6b6f80;">
        Kulturföreningen Musikbopp · Tyresö · <a href="mailto:info@slutstation.se" style="color:#83879a;">info@slutstation.se</a><br />
        You&rsquo;re getting this because you registered a membership with us. To end your membership or have your data deleted, just email us.
      </p>
    </td></tr>

  </table>

</td></tr>
</table>
</body>
</html>`;
}

// Plain-text part. Improves spam scoring and is what some clients show first.
function welcomeText(firstName: string | null): string {
  return [
    firstName ? `Hi ${firstName},` : "Hi,",
    "",
    "Your application has been reviewed and accepted. You're now a member of",
    "Kulturforeningen Musikbopp, with access to our events. Membership is free",
    "and runs to the end of the calendar year - everyone renews in January.",
    "",
    `Your account: ${SITE}/account.html`,
    `Tickets:      ${SITE}/tickets.html`,
    "",
    "Kulturföreningen Musikbopp · Tyresö · info@slutstation.se",
  ].join("\n");
}

function transport() {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    // 465 is implicit TLS; 587 upgrades with STARTTLS. Anything else, assume
    // STARTTLS and let the server decide.
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

  const mailer = transport();
  const from = `"${MAIL_FROM_NAME}" <${MAIL_FROM}>`;

  // ---- one-off test send, changes nothing in the database ------------------
  if (body.action === "test") {
    const to = String(body.to ?? "");
    if (!to) return new Response(JSON.stringify({ error: "Missing 'to'" }), { status: 400 });
    try {
      await mailer.sendMail({
        from, to,
        subject: "You're in, Slutstation membership accepted",
        text: welcomeText("Axel"),
        html: welcomeHtml("Axel"),
      });
      return new Response(JSON.stringify({ ok: true, sent: 1, mode: "test" }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("Test send failed:", err);
      return new Response(JSON.stringify({ ok: false, error: String(err) }), {
        status: 502, headers: { "Content-Type": "application/json" },
      });
    }
  }

  // ---- the scheduled run ---------------------------------------------------
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data: due, error } = await admin.rpc("members_awaiting_welcome", { p_limit: 50 });
  if (error) {
    console.error("Could not read the queue:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
  if (!due?.length) {
    return new Response(JSON.stringify({ ok: true, sent: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Sent one at a time and marked only on success, so a mid-run failure means
  // the rest are retried on the next tick rather than silently skipped.
  const sentIds: string[] = [];
  const failed: string[] = [];

  for (const m of due as Array<{ id: string; email: string; first_name: string | null }>) {
    try {
      await mailer.sendMail({
        from,
        to: m.email,
        subject: "You're in, Slutstation membership accepted",
        text: welcomeText(m.first_name),
        html: welcomeHtml(m.first_name),
      });
      sentIds.push(m.id);
    } catch (err) {
      console.error(`Send failed for ${m.id}:`, err);
      failed.push(m.id);
    }
  }

  if (sentIds.length) {
    const { error: markErr } = await admin.rpc("mark_welcome_sent", { p_ids: sentIds });
    if (markErr) console.error("Sent but could not mark:", markErr);
  }

  return new Response(JSON.stringify({ ok: true, sent: sentIds.length, failed: failed.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
