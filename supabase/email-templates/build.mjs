import fs from 'node:fs';

// Shell of a Slutstation email. Table-based 600px, inline CSS, system fonts,
// no images at all — most clients block images until the reader asks for them,
// and Gmail refuses base64 outright, so the wordmark is letterspaced text and
// the button is a table cell with a background colour. It looks right with
// images off, which is how it will first be seen.
const shell = ({ eyebrow, heading, lead, cta, ctaText, note, url }) => `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark" />
<title>${heading}</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0b0f;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${lead.replace(/<[^>]+>/g, '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0a0b0f;">
<tr><td align="center" style="padding:36px 16px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#101219;border:1px solid #23262f;border-radius:14px;">
    <tr><td align="center" style="padding:34px 32px 8px;">
      <div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;letter-spacing:0.34em;color:#f4f5f7;text-transform:uppercase;">Slutstation</div>
    </td></tr>
    <tr><td align="center" style="padding:0 32px 4px;">
      <div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.16em;color:#ff2a2a;text-transform:uppercase;">${eyebrow}</div>
    </td></tr>
    <tr><td style="padding:20px 32px 0;">
      <h1 style="margin:0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:26px;line-height:1.2;font-weight:600;color:#f4f5f7;letter-spacing:-0.02em;">${heading}</h1>
    </td></tr>
    <tr><td style="padding:16px 32px 22px;">
      <p style="margin:0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#c7cad2;">${lead}</p>
    </td></tr>
    <tr><td align="left" style="padding:0 32px 6px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr><td align="center" bgcolor="#ff2a2a" style="border-radius:100px;">
          <a href="${cta}" style="display:inline-block;padding:13px 30px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:100px;">${ctaText}</a>
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:18px 32px 0;">
      <p style="margin:0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#83879a;word-break:break-all;">
        Button not working? Copy this link:<br /><a href="${cta}" style="color:#ff2a2a;">${url}</a>
      </p>
    </td></tr>
    <tr><td style="padding:26px 32px 0;"><div style="height:1px;background-color:#23262f;line-height:1px;font-size:0;">&nbsp;</div></td></tr>
    <tr><td style="padding:20px 32px 34px;">
      <p style="margin:0 0 10px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#83879a;">${note}</p>
      <p style="margin:0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#6b6f80;">
        Kulturf&ouml;reningen Musikbopp &middot; Tyres&ouml; &middot; <a href="mailto:info@slutstation.se" style="color:#83879a;">info@slutstation.se</a>
      </p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;

const CU = '{{ .ConfirmationURL }}';
const IGNORE = 'Didn&rsquo;t request this? Ignore this email and nothing happens.';

const templates = {
  confirmation: {
    subject: 'Confirm your email — Slutstation',
    html: shell({
      eyebrow: 'Membership',
      heading: 'Confirm your email',
      lead: 'One step left. Click below to activate your account &mdash; that also registers your membership of Kulturf&ouml;reningen Musikbopp. Membership is free and runs to the end of the calendar year; everyone renews in January, whenever they joined.',
      cta: CU, ctaText: 'Confirm my email', url: CU, note: IGNORE,
    }),
  },
  recovery: {
    subject: 'Reset your password — Slutstation',
    html: shell({
      eyebrow: 'Password',
      heading: 'Choose a new password',
      lead: 'Click below to set a new password for your account. The link works once and expires shortly.',
      cta: CU, ctaText: 'Set a new password', url: CU, note: IGNORE,
    }),
  },
  magic_link: {
    subject: 'Your sign-in link — Slutstation',
    html: shell({
      eyebrow: 'Sign in',
      heading: 'Sign in to your account',
      lead: 'Here is your sign-in link. It works once and expires shortly.',
      cta: CU, ctaText: 'Sign in', url: CU, note: IGNORE,
    }),
  },
  email_change: {
    subject: 'Confirm your new email — Slutstation',
    html: shell({
      eyebrow: 'Account',
      heading: 'Confirm your new email',
      lead: 'You asked us to change the email address on your account to <strong style="color:#f4f5f7;">{{ .NewEmail }}</strong>. Click below to confirm the change.',
      cta: CU, ctaText: 'Confirm the change', url: CU,
      note: 'Didn&rsquo;t ask for this? Email us straight away at info@slutstation.se &mdash; somebody may be trying to take over your account.',
    }),
  },
};

const payload = {};
for (const [k, v] of Object.entries(templates)) {
  fs.writeFileSync(`${k}.html`, v.html);
  payload[`mailer_subjects_${k}`] = v.subject;
  payload[`mailer_templates_${k}_content`] = v.html;
}
fs.writeFileSync('payload.json', JSON.stringify(payload));
console.log(Object.keys(payload).join('\n'));
console.log('payload bytes', JSON.stringify(payload).length);
