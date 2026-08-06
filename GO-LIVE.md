# Go-live — Slutstation

Everything that could be done from here is done. This file is the whole picture:
what is already live, what only you can do, and what breaks first at 1,500 users.

Read the three sections in order. Section 3 is the one that matters on the night.

---

## 1. What is already done and live

### Database (Supabase project `uwawugvatencvzvvfaeq`, eu-west-1)

All migrations are applied to the live database:

| File | What it does |
|---|---|
| `schema.sql`, `schema-phase2*.sql` | members, profiles, events, staff, RLS |
| `schema-phase3-tickets.sql` | ticket types, orders, order items, tickets, oversell lock |
| `schema-phase3b-terms-and-float.sql` | terms version stamped on every order, ticket float |
| `schema-phase4-approval-and-import.sql` | delayed approval, welcome-mail queue, Billetto import |
| `schema-phase5-calendar-year-membership.sql` | membership runs to 31 December, every year |

Indexes added for the launch load: `profiles_name_trgm_idx` (staff name search),
`profiles_ebas_status_idx`, `events_published_upcoming_idx`, `tickets_user_event_idx`.
`analyze` has been run.

### Edge Functions — all four deployed and ACTIVE

- `ebas` (v2) — membership check against eBas, with the calendar-year fallback
- `tickets` (v2) — creates the Stripe Checkout session
- `stripe-webhook` — fulfils the order, idempotent on replay
- `member-emails` (v1) — sends the welcome mail over SMTP

### Scheduled jobs — running

- `slutstation-member-emails` — every 5 minutes, sends the "you're in" email to anyone
  whose green check has just appeared
- `slutstation-expire-memberships` — nightly at 04:17, expires memberships past 31 December
- `slutstation-expire-orders` — every 10 minutes, releases seats from abandoned checkouts

### Auth settings changed

- `rate_limit_email_sent`: 120 → **180 per hour** (deliberate — see section 3)
- `password_min_length`: 6 → **8**
- Confirmed correct: `site_url`, redirect allow-list, `mailer_autoconfirm: false`

### Website

- Full English/Swedish toggle on every public page, including the legal prose
- **All tickets go through Billetto.** Our own Stripe sales are switched off with a
  single flag, `OWN_TICKET_SALES` in `src/supabase-config.js`. With it off the site
  never draws a release ladder, never builds a cart and never calls Stripe — a
  member's only route is Billetto. The Stripe side is left built and tested rather
  than deleted, so if Billetto ever stops being the answer it comes back by flipping
  one word.
- The Billetto widget only appears once you are signed in — a logged-out visitor
  doesn't get the script at all
- Green membership check appears 15–55 minutes after email confirmation, at random
- Welcome email on approval: "Your application has been reviewed and accepted"
- Coming Soon tab filled in
- Billetto attendance import in the admin panel — the tier system works without scanning
- Cloudflare Turnstile wiring is in place but dormant (empty site key = nothing renders)
- "Didn't get the confirmation email?" resend button on the account page

Emails are English only, as you asked.

---

## 2. What only you can do

These need your credentials or your signature. Nothing else is blocking.

**Welcome emails — done and confirmed working**

`SMTP_PASS` is set. The 15:00 run returned `sent: 3, failed: 0` and the 15:05 run
returned `sent: 0`, which proves both halves: the mail goes out, and nobody gets it
twice. Nothing left to do here.

**Deploy the site — nothing here is live yet**

1. **The current slutstation.se is still the old one-page site.** None of this exists
   on the server: `/account.html` returns 404. Push to GitHub and let the Actions FTP
   deploy run, or the whole thing stays local. This is now the main thing standing
   between you and being live.
2. **Add the `_dmarc` TXT record** at Loopia. Without it a chunk of Gmail and Outlook
   deliveries go to spam regardless of everything else.

Organisation number: done — 802543-7834, in both the Swedish and English terms.

Nothing to do about Stripe — own ticket sales are off, so no live keys and no webhook
are needed. `STRIPE-SETUP.md` stays in the repo for the day you might want it.

**Keys: rotated — one cleanup left**

Both leaked keys have been rotated (5 August). The new eBas key is installed in the
Supabase Edge Function secret and the function is confirmed up; the new key gets its
first real exercise on the next signup. The new Billetto keypair goes **nowhere in
our stack** — nothing server-side or client-side calls Billetto's API; the widget
doesn't need keys. Keep it wherever you keep passwords.

The one thing left: in the GitHub repo settings, **delete** the old secrets
`VITE_API_KEY`, `VITE_BILLETTO_API_KEY` and `VITE_BILLETTO_CLIENT_SECRET` — don't
update them with the new values. Anything named `VITE_*` is an instruction to Vite
to build it into the public bundle; that is exactly how the old keys leaked. The
code no longer reads them, so deleting them costs nothing and makes the mistake
unrepeatable. (The `VITE_EMAILJS_*` ones stay — those are public by design.)

**Optional but recommended**

3. **Cloudflare Turnstile**: create the widget, put the site key in
   `src/supabase-config.js`, deploy the site, **then** enable CAPTCHA in Supabase.
   In that order. If you enable it in Supabase first, every signup breaks instantly.
4. **Supabase Pro, $25/month** — see section 3.

**Legal / practical, not software**

5. **Police anmälan** for the event (ordningslagen 2 kap 3 §). Details and the
    reasoning are in `LEGAL-AND-RISK.md`. This is the single biggest real-world risk
    in the whole project — much bigger than anything in the code.
6. **Serveringstillstånd** if alcohol is served.
7. **Check the date on Billetto.** Our event row is now Saturday 12 September,
    22:00 → 05:00. When this was set up, the Billetto listing said 5 September. I
    can't see your listing from here, and Billetto is the page people actually buy
    on — if it still says the 5th, that is the date they will believe.

---

## 3. 1,500 users, most signing up on the day

### The email wall — this is the one that will bite

You chose to keep sending through Loopia. Loopia bounces anything past
**200 messages or recipients per hour**, per account. That is documented and it is a
hard bounce, not a queue.

1,500 signups bunched into an evening is roughly **500 an hour**. So in the worst case
**about half the confirmation emails will not arrive**, and a person who does not get a
confirmation email cannot sign in, cannot buy a ticket, and will message you about it.

I could not remove that wall from here, so I built three things around it:

- **Supabase's own email limit is set to 180/hour**, just under Loopia's 200. When the
  wall is hit, the signup fails with a visible 429 and a clear message instead of
  silently vanishing into a bounce. The account is still created — only the email is
  missing — so it is recoverable.
- **A resend button** — "Didn't get the confirmation email?" — on the account page.
  Someone who waits a few minutes and clicks it will get through in the next hour's
  quota.
- **A specific error message** rather than a generic failure: *"Your account was
  created, but we're sending a lot of email right now and yours is queued. Wait a few
  minutes, then use 'Didn't get the confirmation email?' below."*

**The emergency lever.** If the queue jams on the night, one toggle fixes it in seconds:

> Supabase → Authentication → Sign In / Providers → **turn off "Confirm email"**

That takes email out of the critical path entirely. People can sign in and buy the
moment they register. The cost is that unverified addresses get accounts — a
tolerable trade for one evening, and you can turn it back on the next morning. Have
this open in a tab on the night.

### Can you buy your way out of it at Loopia? No.

Checked, because it would be the easy answer. Loopia's own documentation says the
limit is 200 messages or recipients per hour **per account** — it is a property of
the mail platform, not of your hosting package, and there is no upgrade, add-on or
support request listed that lifts it. Loopia's answer to anyone who needs more
volume is to point them at a partner newsletter service, which is a marketing tool
and no use for signup confirmations.

More mailboxes wouldn't help either: the limit is per account, so splitting the
traffic across several addresses means several From: addresses on your
confirmation emails, which is exactly what makes spam filters distrust a domain.

### What actually fixes it

A transactional email provider, pointed at the same domain, set as Supabase's SMTP.
Roughly 20 minutes: verify the domain with a couple of DNS records at Loopia, paste
the credentials into Supabase's SMTP settings, done. Your mail keeps coming from
`noreply@slutstation.se`. Loopia stays exactly as it is for your normal mailboxes.

Costs, for 1,500 emails in one evening:

- **Amazon SES** — $0.10 per 1,000 emails, so about **15 öre** for the whole night.
  The catch is that new accounts start in a sandbox that only sends to addresses you
  have verified, and getting production access is a manual review. Apply well before
  September, not the week of.
- **Resend** — the free plan is 3,000 a month but capped at **100 a day**, which is
  useless for one busy evening. The $20/month plan removes the daily cap. Cancel
  after the event if you like.
- **Postmark / Brevo / SendGrid** — same shape: free tiers are day-capped in the
  low hundreds, first paid tier around $15–20/month.

So: about $20 for September, or pennies on SES if you start the approval early. Set
against roughly 750 people not getting the email that lets them sign in, it is the
cheapest thing on this whole list. My recommendation is to do it — but the
"Confirm email" toggle above is a genuine fallback if you would rather not.

### Supabase quotas — you will not hit any of them

I checked each against 1,500 users:

| Limit (Free plan) | Your projected use | Headroom |
|---|---|---|
| 500 MB database | a few MB — 1,500 profiles, orders, tickets | huge |
| 5 GB egress | ~300 MB (JSON API only; the site itself is on Loopia) | huge |
| 50,000 monthly active users | 1,500 | huge |
| 500,000 Edge Function calls | a few thousand | huge |
| Auth: 30 sign-ins per 5 min **per IP** | fine on mobile data | see below |

One caveat on that last row: the per-IP limit is fine when everyone is on their own
phone, but if a crowd signs up on **one shared venue wifi** they share an IP and will
start hitting it. If you are doing door signups, tell people to turn wifi off.

### So do you need Pro?

**Yes, and it is worth the $25 — but not for the quotas.** Three reasons:

1. **No backups on Free.** If the members table gets corrupted or something is deleted
   by mistake, there is no restore point. Pro gives daily backups kept for 7 days. For
   a database that is about to hold 1,500 people's memberships and paid tickets, this
   is the reason on its own.
2. **Free projects pause after one week of inactivity.** Between now and September that
   is a real possibility on a quiet week, and a paused project means the site is simply
   down until someone logs in and unpauses it.
3. **Free limits are hard stops, not overages.** If anything unexpected does blow a
   quota, the API starts returning errors instead of billing you $2. Pro has a spend cap
   on by default, so you can leave it capped and still get the backups and the no-pause
   guarantee.

Nothing else needs upgrading. Stripe is per-transaction, Loopia is already paid, and
the eBas integration has no volume cost.

### What breaks first, in order

1. **Confirmation emails**, at roughly 200 signups in an hour. Lever: turn off
   "Confirm email".
2. **Shared-wifi signups**, if you do door registration on one network. Lever: mobile
   data.
3. Nothing else, at this scale.

---

## 4. Verified before shipping

All of this was tested against the live database inside rolled-back transactions —
no test data was left behind:

- Overselling is impossible under concurrent checkout (row lock proven)
- An add-on cannot be bought without an entry ticket
- Replaying a Stripe webhook does not double-issue tickets
- The release ladder advances automatically when a tier sells out
- Approval delay fired at 19 minutes with correct pending → active transition
- The welcome queue delivers exactly once, never twice
- Attendance import: matched, unmatched and undo all behave
- Calendar-year expiry correct across four dates plus the rollover setting

The built site was also rendered headless with the CDN blocked, to confirm the language
switch and the static content survive a Supabase SDK load failure. They do.

### Three bugs found and fixed on the way

**Admins were told they had no membership.** `membership_status` is a view that runs
with the caller's own permissions, and the security rules let an admin read every
member — so the account page's "give me my row" query got three rows back, threw, and
fell through to "no membership". It was correct for ordinary members and wrong for
exactly the two people who would check it. Both that query and the stats query are now
pinned to the signed-in user's own id.

**The tickets page would have hung on the September event.** Drawing a Billetto event
produced a block with no price total in it, and the code that recalculates totals then
tried to write into something that wasn't there. That error stopped the page before it
ever revealed itself, so it sat on "Loading tickets…" forever — for the one event we
are actually selling. Found by rendering the page with a Billetto event in it.

**A stalled CDN meant a permanent spinner.** The Supabase library is loaded from a CDN
inside a try/catch. A refused connection rejects and is caught; a connection that is
accepted and then never answered — a hotel or venue wifi portal, a phone drifting off
the network — never settles at all, so nothing after it ever ran and no error was
thrown to catch. The load is now raced against a 12-second clock, so that case shows
the same honest "check your connection and reload" as any other failure.
