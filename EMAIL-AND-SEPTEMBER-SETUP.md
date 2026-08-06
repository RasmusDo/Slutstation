# Email, the September event, and the approval delay

Everything in this round is built and the database changes are applied and
tested. What's left is email — and there's one thing in here you need to read
before the next person signs up.

---

## Read this first: nobody is getting your confirmation emails

Supabase's built-in email service sends **two emails per hour**, and **only to
addresses belonging to your own Supabase team**. That second part is the
problem. Since September 2024 it refuses outright to deliver to anyone else.

So right now, when a stranger signs up on slutstation.se, `signUp()` returns
success, the page says "check your inbox", and **no email is ever sent**. It
fails silently. It looks like it works when you test it, because your own
address is on the team.

This is not a nice-to-have. Until custom SMTP is configured, public signup is
broken. It also blocks the branded templates — Supabase rejected my attempt to
install them with: *"Email template modification is not available for free tier
projects using the default email provider."* SMTP first, then everything else
works.

---

## Step 1 — Point Supabase at your Loopia mailbox

You said Loopia or Supabase, whichever is easier and makes the best-looking
email. The look is entirely down to the template, which is already written — the
SMTP provider only decides whether the mail arrives and who it appears to come
from. So: Loopia, because you already have it and it needs no new account.

Create (or pick) a mailbox at Loopia — `noreply@slutstation.se` is the obvious
one. Then in Supabase: **Authentication → Settings → SMTP Settings**, enable
custom SMTP and fill in:

| Field | Value |
|---|---|
| Sender email | `noreply@slutstation.se` |
| Sender name | `Slutstation` |
| Host | `mailcluster.loopia.se` |
| Port | `587` |
| Username | `noreply@slutstation.se` (the full address) |
| Password | that mailbox's password |

**Type the password yourself.** I don't handle passwords, and you shouldn't want
me to.

Then go to **Authentication → Rate Limits** and raise the email limit. Supabase
starts new custom-SMTP projects at 30 per hour, which is fine day to day but
will throttle you if a release announcement brings a wave of signups.

### Be honest with yourself about Loopia

It will work. It is also a shared outbound IP pool you don't control, with no
delivery logs, no bounce webhooks and no suppression list — so when a signup
email lands in someone's spam, you will have no way to know. Two specific things
raise your odds of that happening: automated bursts from a shared hosting
mailbox look like a compromised account to spam filters, and *"slut"* is an
ordinary Swedish word that reads as English profanity to filters trained mostly
on English.

**Switch to Resend if any of these happens:** members start saying they never
got the email, Loopia throttles or suspends the mailbox after an announcement,
or you go past a few hundred emails a month. It's free at your volume, has an
EU/Ireland region, and Supabase lists it as known-good. The switch is the same
six fields with different values — `smtp.resend.com`, port 465, username
`resend`, password = API key — plus four DNS records at Loopia. Nothing in the
code changes.

Either way, add a **DMARC** record now: a TXT record at `_dmarc.slutstation.se`
with `v=DMARC1; p=none; rua=mailto:info@slutstation.se`. Gmail, Yahoo and
Outlook all expect one; `p=none` costs nothing and makes you a known sender
rather than an unauthenticated one.

## Step 2 — Install the branded emails

Once SMTP is on, Supabase will let the templates through. Four are written and
sitting in `supabase/email-templates/`: confirm signup, password reset, magic
link, and email change. Preview files are alongside them — open
`preview-confirmation.html` in a browser to see exactly what arrives.

They're the site's dark theme: near-black background, the wordmark in
letterspaced caps, red button, Swedish first with a grey English line under it.
No images anywhere — deliberately. Most clients block images until the reader
clicks "display images", and Gmail refuses base64 images entirely, so a logo
image would show as a broken box on first open. Letterspaced text always
renders. The confirm button is a table cell with a background colour rather than
an image, for the same reason.

Paste each into **Authentication → Emails**, or tell me and I'll push all four
through the Management API in one call now that the block is lifted.

## Step 3 — The "you're in" email

`supabase/functions/member-emails/index.ts` sends it. Deploy it with **Verify
JWT OFF**, and set these secrets:

```
SMTP_HOST       mailcluster.loopia.se
SMTP_PORT       587
SMTP_USER       noreply@slutstation.se
SMTP_PASS       (that mailbox's password)
MAIL_FROM       noreply@slutstation.se
MAIL_FROM_NAME  Slutstation
CRON_SECRET     (make up ~40 random characters)
SITE_URL        https://slutstation.se
```

Then open `supabase/schema-phase4b-cron.sql`, **replace
`PUT-YOUR-CRON-SECRET-HERE` with the same string**, and run it in the SQL
editor. It schedules three jobs: the welcome email every 5 minutes, the
membership-expiry sweep nightly, and the ticket-hold cleanup every 10 minutes.

To check the email before anyone real gets it, call the function with
`{"action":"test","to":"your@email"}` and the `x-cron-secret` header. It sends
one to you and touches nothing in the database.

---

## The green check now waits

Registration in eBas still happens instantly. What waits is the check.

When a membership becomes active, a database trigger picks a random moment
**15–55 minutes later** and stores it. Until then the account page shows a
quiet pulsing dot and *"Your application is being reviewed"*, and the page
re-checks itself every 45 seconds so it turns green while they're looking at it.
The delay lives in the `membership_status` view, which means the account page,
the door and the ticket gate all see the same answer — a member can't get ahead
of it by reloading or calling the API directly.

Tested end to end on the live database, inside a transaction that rolled itself
back: the trigger picked 19 minutes; during the wait `is_active_member` was
false and `pending_approval` true; after release it flipped; the member appeared
in the email queue exactly once and disappeared after being marked.

Adjustable without touching code — `approval_delay_min_minutes` and
`approval_delay_max_minutes` in `app_settings`.

**One thing I'd flag.** You chose the wording *"Your application has been
reviewed and accepted"*, and that's what the email says. If nobody actually
looks at signups, that sentence describes a process that doesn't exist. It's a
small thing and it's your call — but the honest version is one line away in
`member-emails/index.ts`, and *"Din ansökan har registrerats"* costs you nothing
in atmosphere.

---

## The September event

I created it in the database from your Billetto link, and one events row now
drives three things: the card on the front page, the ticket page, and the
attendance import.

**Corrected 5 August 2026 — the event is Saturday 12 September**, 22:00 → 05:00 on
the 13th, at Skogen, Stockholm. The events row has been moved, so the front page
card and the ticket page both say the 12th now.

**Check Billetto itself.** When I set this up, the Billetto listing said 5
September. I can't see or change your listing from here, and Billetto is where
people actually buy — if it still says the 5th, that is the date every buyer
sees, and nothing on our site overrides it.

The widget is gated properly. A logged-out visitor doesn't get a hidden button —
Billetto's `embed.js` is never loaded at all, so there is nothing about the sale
in the page for them to find. Sign in and the block appears with a **Get
tickets** button that opens Billetto's window over the page, plus a small "or
open it on Billetto" link in case an ad blocker eats the widget.

The front page draws the event card automatically now, with a **Get tickets**
button pointing at `/tickets.html`. Nothing to hand-edit per event any more.

---

## Attendance from the Billetto spreadsheet

Admin → Events → click the event → **Import attendance from a spreadsheet**.

Drop in Billetto's attendee export — `.csv`, `.tsv` or `.xlsx`. It's parsed in
your browser, and **only email addresses are sent to the database.** The names,
phone numbers and order values in that export stay in the file. We don't need
them, so we don't take them.

Column detection is deliberately forgiving, because Billetto's headers change
between event types and languages: it looks for a header containing
email/e-mail/e-post/mailadress, and if it can't find one it scans every cell for
something shaped like an address. Matching is case-insensitive.

After the import you get four numbers — in the file, matched an account, newly
recorded, no account — and a list of the addresses with **no account**. Those
are people who came but won't get a tier until they sign up, which is a good
list to mail after the night. There's an **Undo this import** button that
removes only what the import created, so a wrong file or wrong event costs you
nothing.

Tested live: two valid addresses submitted (a blank one stripped), one matched
and recorded, one correctly reported as having no account, undo removed exactly
what it added.

---

## Also in this round

The **Coming soon** panel on the account page now lists all eight things
actually on the way, roughly in build order — tickets sold here, the automatic
release ladder, the backstage add-on, tier perks, the account balance, premium
membership, referral codes, and passing a ticket to another member — each with
one honest line about what it does.

---

## Your checklist

1. Create the Loopia mailbox and fill in Supabase's SMTP settings. **Until this
   is done, public signup is silently broken.**
2. Raise the email rate limit above 30/hour.
3. Add the `_dmarc` TXT record.
4. Install the four email templates (or say the word and I'll push them).
5. Deploy `member-emails` with Verify JWT off; set its secrets.
6. Edit the cron secret into `schema-phase4b-cron.sql` and run it.
7. Send yourself the test email and check it in Gmail, including dark mode.
8. Confirm the event date — 5 or 12 September.
