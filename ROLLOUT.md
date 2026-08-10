# Rollout — the August 2026 round

Everything in this round is already in the code and builds clean. What remains
is the part only you can do: applying SQL to the live database, deploying the
changed Edge Functions, and a handful of dashboard/DNS steps. This file is the
complete list, in the order to do it, with the "why" kept short because the
long version lives as comments in each file it points to.

## The short path (everything below, compressed)

1. **One paste** — `rollout/apply-phases-15-20.sql` into the Supabase SQL
   editor (phases 15–20 concatenated in order; safe to re-run).
2. **One command** — `./rollout/deploy-functions.sh` in a terminal (checks
   the CLI, deploys the five functions with the right flags, sets
   HEALTH_SECRET, prints the monitor URL).
3. **Two clicks elsewhere** — the GitHub `SUPABASE_DB_URL` secret + first
   backup run (§7), and MFA enrolment in the admin panel (§4).
4. **Publish the site** — deliberately a separate step: pushing to `origin`
   only archives the work; the site goes live when you push to the live
   repo (`rasmusdo`), the way it always has. Doing that also completes the
   Turnstile site-key half.

The sections below are the same steps with their reasoning, plus the ones
that wait for their moment (email off Loopia, Apple Wallet).

Nothing here was applied to the live database or deployed by the tooling that
wrote it. Until you run these steps, the site keeps behaving exactly as
before — every new page feature degrades gracefully when its SQL is missing
and says which file it needs.

---

## 1. First: finish Turnstile

### Move email off Loopia — deprioritized, on purpose (August 2026)

Downgraded from "do first" once the real numbers were on the table: ~1,000
members total, and an event night adds 100–300 signups **across the day**,
not in one hour. Against Loopia's 200/hour ceiling that means the worst
burst waits under an hour for its confirmation email — annoying, survivable.

The one place the ceiling genuinely shows: the announcement email drains at
240/hour (batched, see phase 9), so "tickets are live" takes about four
hours to reach 1,000 opted-in inboxes. If announcements ever need to land
fast — or signups jump an order of magnitude — do the move then; it stays
twenty minutes whenever it happens:

1. Create a [Resend](https://resend.com) account (Postmark works the same
   way). Add the domain `slutstation.se`, add the DNS records it shows you at
   Loopia's DNS panel (SPF + DKIM), wait for verified.
2. In Supabase → Edge Functions → Secrets, replace:
   `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=587`, `SMTP_USER=resend`,
   `SMTP_PASS=<the API key>`. `MAIL_FROM` stays `noreply@slutstation.se`.
3. In Supabase → Authentication → SMTP settings, make the same swap, so the
   confirmation/recovery/magic-link emails move too.
4. Prove it: admin panel → Overview → **Test the emails** → send yourself all
   three (works once step 3 below is done).

### Turn on Turnstile (10 minutes) — site key DONE, secret key remains

The code is fully built and dormant. The order matters — do it backwards and
nobody can sign up (the comment in `src/supabase-config.js` explains why):

1. dash.cloudflare.com → Turnstile → create a site for `slutstation.se`.
2. Paste the **site key** into `TURNSTILE_SITE_KEY` in
   `src/supabase-config.js`, build and deploy the site.
3. Only then: Supabase → Authentication → Attack Protection → enable CAPTCHA,
   choose Turnstile, paste the **secret key**.

---

## 2. SQL to apply (Supabase SQL editor, in this order, each safe to re-run)

| file | what it does |
| --- | --- |
| `supabase/schema-phase15-admin-mfa.sql` | `is_admin()` starts demanding a second factor — but only for admins who have enrolled one, so applying it changes nothing until you enrol (step 4). |
| `supabase/schema-phase16-offline-door.sql` | The offline door roster, narrowed: tonight's ticket-holders + checked-in, falling back to active members only on a Billetto night. Supersedes the commented-out block in phase 9 — the front end already calls it, so applying this file is the whole feature. |
| `supabase/schema-phase17-admin-costs-stats.sql` | `event_costs` (the break-even card on every event) and `admin_stats()` (the Stats tab). |
| `supabase/schema-phase18-door-notes-incidents.sql` | Door notes (12-month auto-retention, member-readable) + incident reports from the door. Also extends `staff_lookup` to carry the note. |
| `supabase/schema-phase19-tier-distribution.sql` | Tier counts (four integers, no names) for the "Top N% of members" line on the tier card. The line stays hidden until this is applied, and also below 25 total members. |

The privacy policy on the front page already describes the phase 18 data —
ship the site build together with (or before) applying that file.

## 3. Edge Functions to deploy

```bash
supabase functions deploy member-emails
```

```bash
supabase functions deploy event-emails
```

```bash
supabase functions deploy weekly-digest
```

These three gained a second door: an **admin session** may now trigger a test
send (that's what the panel's "Test the emails" card uses). The cron secret is
still required for real runs; a member token gets the same 401 it always did.

```bash
supabase functions deploy health --no-verify-jwt
```

```bash
supabase secrets set HEALTH_SECRET=<any long random string>
```

Then point a free monitor (e.g. UptimeRobot, keyword monitor) at
`https://uwawugvatencvzvvfaeq.supabase.co/functions/v1/health?key=<HEALTH_SECRET>`
with the keyword `"ok":true`. The Monday digest keeps its job; this makes
"the announcement emails silently stopped" a same-hour alert instead of a
next-Monday discovery.

## 4. Enrol MFA (both admins, 2 minutes each)

Admin panel → Overview → **Security** → Turn on → scan the QR → confirm.
From that admin's next sign-in, the panel asks for the code, and (after
phase 15) every admin RPC refuses a session that hasn't given it. A lost
authenticator is rescued by the *other* admin deleting the factor row under
Authentication → Users in the dashboard.

## 5. Magic link

The sign-in page now has "Email me a sign-in link". It uses the same branded
template already sitting in `supabase/email-templates/magic_link.html` —
install it the same way EMAIL-AND-SEPTEMBER-SETUP.md installed the others if
you haven't. It deliberately refuses addresses with no account
(`shouldCreateUser: false`), so signup stays on the one form that collects
what eBas needs.

## 6. Google sign-in — decision recorded

It's already live (the provider is enabled in the dashboard, and the button
appears by itself). Nothing to do; noted here so nobody wonders whether it
was decided.

## 7. Backups outside Supabase

`.github/workflows/db-backup.yml` dumps the database nightly into this repo's
private GitHub artifacts (14 days kept). One secret to add:
repo Settings → Secrets → Actions → `SUPABASE_DB_URL` = the Session-pooler
connection string from Project Settings → Database. Fire the workflow once by
hand from the Actions tab to prove it, then forget it.

## 8. Migration baseline (when you have a quiet hour)

The `schema-phase*.sql` files applied by hand are how the live database and a
future second environment drift apart. The fix is Supabase's own tool:

```bash
supabase link --project-ref uwawugvatencvzvvfaeq
```

```bash
supabase db pull
```

That writes the real, current production schema as migration 0001 under
`supabase/migrations/`. New SQL from then on goes in as
`supabase migration new <name>` files instead of phase files. The phase files
stay in the repo as history — they document *why* everything is the way it
is, which a generated baseline never will.

---

## 9. Apple Wallet (when you're ready — needs the Apple Developer Program)

The card is fully built: dark pass, red aura strip drawn from the site's own
design language, tier in the header, nights + next tier on the face, tonight's
perks with live "✓ 23:41" states, and the same QR the door already scans. It
keeps itself current: the phase-20 triggers flag the pass when attendance,
tier or a perk claim changes, a five-minute cron nudges Apple, and the phone
re-fetches — tier changes even pop a lock-screen line ("Tier: Tier 3").

The one thing money has to buy: an **Apple Developer Program membership**
($99/year, developer.apple.com). Without it nothing can sign a pass. Then:

1. developer.apple.com → Certificates, Identifiers & Profiles →
   Identifiers → new **Pass Type ID** (e.g. `pass.se.slutstation.member`),
   and create its certificate. Export cert + private key as PEM.
2. Same portal → Keys → new key with **Apple Push Notifications service**
   enabled. Download the `.p8`, note its Key ID and your Team ID.
3. Download Apple's **WWDR G4** intermediate certificate (PEM).
4. Set the secrets:

```bash
supabase secrets set PASS_TYPE_ID=pass.se.slutstation.member APPLE_TEAM_ID=XXXXXXXXXX APNS_KEY_ID=YYYYYYYYYY
```

```bash
supabase secrets set PASS_CERT_PEM="$(cat pass_cert.pem)" PASS_KEY_PEM="$(cat pass_key.pem)" APPLE_WWDR_PEM="$(cat wwdr_g4.pem)" APNS_AUTH_KEY="$(cat AuthKey_YYYYYYYYYY.p8)"
```

5. Apply `supabase/schema-phase20-wallet.sql` (tables, triggers, the cron tick).
6. Deploy:

```bash
supabase functions deploy wallet --no-verify-jwt
```

7. Flip `WALLET_CARD` to `true` in `src/supabase-config.js` and deploy the
   site — this is the switch that draws the button; until then members see
   nothing at all (same dormancy pattern as `INVITE_CODE`).
8. Prove it end to end: account page → Your tier code → **Add to Apple
   Wallet** on an iPhone; then check yourself in via the admin import or a
   perk claim and watch the card update within five minutes.

Two layers of dormancy, on purpose: the `WALLET_CARD` switch decides whether
the button exists, and a server without certificates answers 503 ("not
switched on yet") — a switch flipped early and a certificate that expires
are different failures, and both degrade to words instead of a broken
download.

Google Wallet is deliberately not built yet — different signing scheme,
different console; worth doing only once the Apple card has proven people
actually add it.

---

## What changed in the code this round (no action needed)

* **No third-party CDN at runtime.** supabase-js, qrcode, jsQR and xlsx are
  installed from npm and bundled/code-split by Vite. esm.sh is out of every
  page's path — the door scanner no longer depends on someone else's CDN.
* **Signup is a two-step wizard** (account, then the eBas details) — still
  one form, one submit, one code path. Inline field validation, and the
  resend-confirmation button that already existed.
* **Design pass** on the front page: scroll reveals (rebuilt without the bug
  that killed the old ones), hero entrance + parallax, scroll progress
  hairline, nav scroll-spy, marquee strip, animated tab switch, grid-rows
  accordion, button sheen, styled scrollbar. All compositor-only, all
  standing down under reduced-motion and on the low device tier.
* **Admin panel**: Stats tab, per-event costs card, per-event incident list,
  door-note editor on the member card, test-email card, MFA card.
* **Staff page**: "Report something" card; door notes shown in the lookup
  (once phase 18 is applied).
