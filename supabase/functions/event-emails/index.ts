// ============================================================================
// SLUTSTATION, event-emails
//
// "Tickets are live." The announce switch already moves the banner, the front
// page and the tickets page together; without this it moved everything except
// the one place people actually look, which is their inbox. Until now the only
// email a member ever received was the welcome one.
//
// Exactly-once in the same way the welcome email is: the queue is everyone who
// opted in and is not yet in event_mail_sent for this event, and marking
// happens only after the mail server has accepted the message. A missed run
// costs nothing, a double run sends nothing twice.
//
// Its own function rather than a branch inside member-emails, which runs every
// five minutes and sends the email people are actually waiting for. Nothing
// here should be able to break that.
//
// Callable two ways, both server-side only:
//   * header  x-cron-secret: <CRON_SECRET>   (what the schedule uses)
//   * body    { "to": "you@example.com" }    sends one to you and marks nobody
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

// Loopia's ceiling is 200 an hour. A batch of 40 every ten minutes is 240 an
// hour of headroom used at most, and in practice the queue drains in one or
// two runs. See GO-LIVE.md for why this matters on the night 1,500 people join.
const BATCH = 40;

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

type Ev = { event_id: string; event_name: string; venue: string | null; starts_at: string; info: string | null };

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long",
  });
}

function announceHtml(ev: Ev, firstName: string | null): string {
  const hi = firstName ? `Hi ${esc(firstName)},` : "Hi,";
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<title>${esc(ev.event_name)}</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0b0f;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0a0b0f;">
<tr><td align="center" style="padding:36px 16px;">

  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#101219;border:1px solid #23262f;border-radius:14px;">

    <tr><td align="center" style="padding:34px 32px 8px;">
      <div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;letter-spacing:0.34em;color:#f4f5f7;text-transform:uppercase;">Slutstation</div>
    </td></tr>

    <tr><td align="center" style="padding:0 32px 4px;">
      <div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.16em;color:#ff2a2a;text-transform:uppercase;">Tickets are live</div>
    </td></tr>

    <tr><td style="padding:20px 32px 0;">
      <h1 style="margin:0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:26px;line-height:1.2;font-weight:600;color:#f4f5f7;letter-spacing:-0.02em;">${esc(ev.event_name)}</h1>
      <p style="margin:10px 0 0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#f4f5f7;">
        ${esc(when(ev.starts_at))}${ev.venue ? ` &middot; ${esc(ev.venue)}` : ""}
      </p>
    </td></tr>

    <tr><td style="padding:16px 32px 0;">
      <p style="margin:0 0 14px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#c7cad2;">${hi}</p>
      <p style="margin:0 0 22px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#c7cad2;">
        You are getting this before anybody else does, because you are a member. Our events sell out, so if you want to be there, now is the moment.
      </p>
    </td></tr>

    <tr><td align="left" style="padding:0 32px 6px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr><td align="center" bgcolor="#ff2a2a" style="border-radius:100px;">
          <a href="${SITE}/tickets.html" style="display:inline-block;padding:13px 30px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:100px;">Get your ticket</a>
        </td></tr>
      </table>
    </td></tr>

    <tr><td style="padding:18px 32px 0;">
      <p style="margin:0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#83879a;">
        Button not working? Open <a href="${SITE}/tickets.html" style="color:#ff2a2a;">${SITE.replace(/^https?:\/\//, "")}/tickets.html</a>
      </p>
    </td></tr>

    ${ev.info ? `
    <tr><td style="padding:26px 32px 0;">
      <div style="height:1px;background-color:#23262f;line-height:1px;font-size:0;">&nbsp;</div>
    </td></tr>
    <tr><td style="padding:20px 32px 0;">
      <div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.16em;color:#83879a;text-transform:uppercase;padding-bottom:8px;">Getting there</div>
      <p style="margin:0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#c7cad2;white-space:pre-line;">${esc(ev.info)}</p>
    </td></tr>` : ""}

    <tr><td style="padding:26px 32px 0;">
      <div style="height:1px;background-color:#23262f;line-height:1px;font-size:0;">&nbsp;</div>
    </td></tr>

    <tr><td style="padding:20px 32px 34px;">
      <p style="margin:0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#6b6f80;">
        Kulturföreningen Musikbopp &middot; Tyresö &middot; <a href="mailto:info@slutstation.se" style="color:#83879a;">info@slutstation.se</a><br />
        You are getting this because you asked to hear about new events. Turn it off any time on your account page: <a href="${SITE}/account.html" style="color:#83879a;">${SITE.replace(/^https?:\/\//, "")}/account.html</a>
      </p>
    </td></tr>
  </table>

</td></tr>
</table>
</body>
</html>`;
}

function announceText(ev: Ev, firstName: string | null): string {
  return [
    firstName ? `Hi ${firstName},` : "Hi,",
    "",
    `${ev.event_name}`,
    `${when(ev.starts_at)}${ev.venue ? ` - ${ev.venue}` : ""}`,
    "",
    "You are getting this before anybody else does, because you are a member.",
    "Our events sell out, so if you want to be there, now is the moment.",
    "",
    `Tickets: ${SITE}/tickets.html`,
    ...(ev.info ? ["", "Getting there:", ev.info] : []),
    "",
    "Kulturföreningen Musikbopp · Tyresö · info@slutstation.se",
    `Turn these off any time: ${SITE}/account.html`,
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

  const { data: due, error } = await admin.rpc("members_awaiting_announcement", { p_limit: BATCH });
  if (error) {
    console.error("Could not read the queue:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
  if (!due?.length) {
    return new Response(JSON.stringify({ ok: true, sent: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const rows = due as Array<Ev & { user_id: string; email: string; first_name: string | null }>;
  const ev: Ev = rows[0];
  const mailer = transport();
  const from = `"${MAIL_FROM_NAME}" <${MAIL_FROM}>`;
  const subject = `${ev.event_name} — tickets are live`;

  // A test send renders the real thing for the real event, and marks nobody.
  if (body.to) {
    await mailer.sendMail({
      from, to: String(body.to), subject,
      text: announceText(ev, "Axel"), html: announceHtml(ev, "Axel"),
    });
    return new Response(JSON.stringify({ ok: true, sent: 1, mode: "test", event: ev.event_name }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // One at a time, marked only on success, so a mid-run failure means the rest
  // are retried on the next tick rather than silently skipped.
  const sentIds: string[] = [];
  const failed: string[] = [];

  for (const m of rows) {
    try {
      await mailer.sendMail({
        from, to: m.email, subject,
        text: announceText(ev, m.first_name),
        html: announceHtml(ev, m.first_name),
      });
      sentIds.push(m.user_id);
    } catch (err) {
      console.error(`Announcement failed for ${m.user_id}:`, err);
      failed.push(m.user_id);
    }
  }

  if (sentIds.length) {
    const { error: markErr } = await admin.rpc("mark_announcement_sent", {
      p_event: ev.event_id, p_ids: sentIds,
    });
    if (markErr) console.error("Sent but could not mark:", markErr);
  }

  return new Response(JSON.stringify({
    ok: true, event: ev.event_name, sent: sentIds.length, failed: failed.length,
  }), { headers: { "Content-Type": "application/json" } });
});
