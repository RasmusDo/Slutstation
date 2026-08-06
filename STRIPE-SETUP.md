# Selling tickets — what's built, and the five things only you can do

Everything on this page is finished code. Five steps remain that involve keys or
account settings, and I can't do those for you: I'm not allowed to handle a
Stripe secret key, and you shouldn't want me to. They take about ten minutes.

Test mode throughout, as you asked. Nothing here can take real money until you
deliberately swap two keys at the end.

---

## What was built

**Four releases plus an add-on, per event.** Blind Release → Standard Release →
Second Release → Third Release, and Backstage as an add-on that can't be bought
without an entry ticket.

You didn't say how a release should advance, so it does all three, and you pick
per event by what you fill in:

- **By quantity** — give a release an allocation. When it sells out it closes
  itself and the next one opens automatically, at 3am, with nobody watching.
- **By date** — set "Opens" and/or "Closes" on a release and it respects them.
- **By hand** — Open / Pause / Close buttons on every release, any time.

Leave the dates blank and it's purely quantity + manual, which is what I'd start
with.

**Starting prices** (the "Set up the four releases + backstage" button fills
these in; edit before you announce): Blind 180 kr with 40 available, Standard
220 kr, Second 260 kr, Third 300 kr, Backstage 100 kr with 20 available. That
ladder averages out near the 250 kr you quoted, with the early buyers rewarded.

**It cannot oversell.** The database takes a row lock on the release before it
touches any counter, so two people tapping Buy on the last ticket at the same
instant queue up — the second is told there's one left, not two. Stock is held
for 35 minutes during checkout and handed back automatically if they don't pay.

**Tickets appear when Stripe says the money landed**, not when the browser comes
back from the checkout page. A faked redirect gets nobody a ticket.

**The door already handles them.** The scanner takes a ticket code *or* a member
code; scanning a ticket admits it, burns it, and records attendance in one go,
so tiers keep working. There's a type-it-in box for cracked screens and dead
phones. Scanning someone's member QR now also shows what they've bought.

**The front page draws itself.** Put a release on sale and the event appears
under Upcoming with a "Get tickets · from X kr" button. No more editing HTML for
each event.

---

## Step 1 — Database migration — ✅ already done

I applied `supabase/schema-phase3-tickets.sql` to the live project and verified
it: all four tables exist with RLS on and policies attached, all twenty
functions are present, the two new `events` columns are there, and fulfilment
(`finalize_ticket_order`, `refund_ticket_order`, `cancel_ticket_order`) is
granted to `service_role` only — a browser token cannot call them.

Then I ran a full sale through the database inside a transaction that rolls
itself back, so nothing was left behind. It:

- sold the last Blind Release ticket at 180 kr,
- **refused a second buyer** for the same ticket (the oversell guard),
- **refused a backstage add-on** with no entry ticket,
- issued exactly one ticket, code `SS-DQUM-98W9`,
- **replayed the same webhook** and still issued exactly one — the idempotency
  that matters when Stripe retries,
- **closed Blind Release and opened Standard Release by itself**, which is the
  release ladder working,
- and showed the event through `tickets_on_sale`, which is what puts it on the
  front page.

That test caught one real bug before you ever could: `gen_ticket_code()` had a
variable named `code`, which Postgres reads as ambiguous against `tickets.code`
and refuses to resolve — so the very first real sale would have taken the money
and failed to issue the ticket. Fixed, re-applied, re-tested. The corrected file
is the one in your repo.

You only need to re-run the file if you rebuild the database from scratch. It's
safe to run twice.

## Step 2 — Deploy the two Edge Functions

Supabase dashboard → **Edge Functions** → Deploy a new function, twice:

| Name | File | Verify JWT |
|---|---|---|
| `tickets` | `supabase/functions/tickets/index.ts` | **off** |
| `stripe-webhook` | `supabase/functions/stripe-webhook/index.ts` | **off** |

Verify-JWT must be off on both. On `tickets` it's because the gateway otherwise
rejects the browser's CORS preflight — the function does its own, stricter token
check and refuses anyone who isn't signed in. On `stripe-webhook` it's because
Stripe doesn't send a Supabase token at all; that one is protected by the
signature check instead.

## Step 3 — Put the Stripe test key in Supabase

Stripe dashboard, **Test mode on** (the toggle, top right) → Developers → API
keys → copy the **Secret key** (`sk_test_…`).

Supabase → Edge Functions → **Secrets** → add:

| Secret | Value |
|---|---|
| `STRIPE_SECRET_KEY` | the `sk_test_…` you just copied |
| `SITE_URL` | `https://slutstation.se` |

Never put this in a `VITE_` variable. That's exactly how the eBas key ended up
readable in the public bundle — Vite bakes every `VITE_*` into the JavaScript it
ships to browsers.

## Step 4 — Create the webhook

Stripe → Developers → **Webhooks** → Add endpoint.

- **URL:** `https://uwawugvatencvzvvfaeq.supabase.co/functions/v1/stripe-webhook`
- **Events:** `checkout.session.completed`, `checkout.session.expired`,
  `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, `charge.refunded`

Stripe then shows a **signing secret** (`whsec_…`). Add it in Supabase alongside
the others as `STRIPE_WEBHOOK_SECRET`.

Without this step payments will succeed and no tickets will be issued, so don't
skip it.

## Step 5 — Turn on the payment methods you want

Stripe → Settings → **Payment methods**. Cards are on by default. Turn on
**Swish** here if you want it — the code doesn't name payment methods anywhere,
it uses whatever your dashboard has enabled, so this is a toggle and nothing
else.

Worth knowing on cost: Stripe Sweden is about 1.5% + 1.80 kr on EEA cards, and
1% + 3 kr (capped at 7 kr) on Swish. On a 250 kr ticket that's roughly 5.55 kr
by card. Billetto's fee is paid by the buyer rather than you, so the real gain
here isn't the fee — it's owning the customer relationship, the data, and the
33% commission Billetto takes on tickets that come through their advertising.

---

## Then test it end to end

1. Admin panel → Events → create an event a week from now.
2. Tickets tab → pick it → **Set up the four releases + backstage** → adjust
   prices → make sure Blind Release says *on sale*.
3. Open `/tickets.html` signed in as yourself. Add a ticket, checkout.
4. Pay with Stripe's test card: **4242 4242 4242 4242**, any future expiry, any
   CVC, any postcode.
5. You should land back on the site and see your ticket codes appear within a
   few seconds. They'll also be on your account page.
6. Admin → Tickets → the sale shows up under Orders, and the counters move.
7. Give yourself a door tag for that event, open `/staff.html`, and scan your
   own ticket. It should admit once and refuse the second time.

Set the Blind Release allocation to 1 and try buying twice from two accounts —
that's the oversell test, and the second buyer should be told it's sold out.

## Going live, later

Two changes, nothing else: swap `STRIPE_SECRET_KEY` for the `sk_live_…` key, and
create a second webhook endpoint in live mode (its signing secret is different —
replace `STRIPE_WEBHOOK_SECRET` too). Everything else is identical.

Before you take real money you also need Stripe's account activation done —
organisation number for Kulturföreningen Musikbopp, a bank account, and a named
representative.

---

## Still outstanding from before

- **Rotate the eBas key.** It was in the public bundle for a long time. New key
  goes only into the Supabase secret `EBAS_API_KEY`.
- **Rotate the Billetto keypair.** Same reason. I removed the dead Billetto code
  from `main.js` in this pass, so nothing needs the keypair any more — but the
  old one has been public and should be considered burned.
- **Update the GitHub repo secrets** to match, or the next deploy re-inlines the
  old values.
- `src/membership-signup.js` is orphaned since the signup forms were merged.
  Safe to delete whenever.
- Ask Svensk Live (info@svensklive.se) whether eBas has a member-lookup
  endpoint. If it does, setting `EBAS_LOOKUP_URL` upgrades the green check from
  "what eBas told us at registration" to a live check, with no code change.
