# Slutstation — Account System (Phase 1)

Accounts, email/password login, a separate account page at `/account.html`, and
the membership check against eBas.

## ✅ Supabase is already set up and tested

I did steps 1–5 below against your live project (`uwawugvatencvzvvfaeq`,
AWS eu-west-1 / Ireland — EU, good for GDPR). What is already done:

- **Schema applied** — `profiles`, the `membership_status` view, RLS, all three
  triggers, and `expire_lapsed_memberships()`. Verified on the live database.
- **Auth configured** — email provider on, email confirmation ON, Site URL set
  to `https://www.slutstation.se`, redirect URLs allow both apex and `www`
  plus `localhost:5173` and `localhost:3000`.
- **Edge Function `ebas` deployed** and reachable.
- **`EBAS_API_KEY` secret set** (your current key — rotate it, see below).
- **`src/supabase-config.js` filled in** with your project URL and publishable key.

Tested end-to-end against the live project with `supabase-js@2.45.4`:

| Test | Result |
|------|--------|
| Signup writes a profile row via the trigger (all metadata mapped) | pass |
| Sign in with the publishable key | pass |
| CORS preflight from `https://www.slutstation.se` | pass |
| Request with no auth → 401 "Not signed in" | pass |
| Request with only the publishable key → 401 "Invalid session" | pass |
| Signed-in `verify` → `{ok:true, source:"stored"}` | pass |
| Logged-out read of `profiles` → zero rows | pass |
| Member **cannot** forge `ebas_status` or change their email | pass |
| Member **can** edit their own details | pass |
| Active membership → green check, correct expiry date | pass |
| 13-month-old membership → reads as lapsed | pass |
| `expire_lapsed_memberships()` flips it to expired | pass |
| Deleting the auth user cascades the profile away | pass |

The test user was deleted afterwards — the database is empty (0 users, 0 profiles).

**Not tested: the actual eBas write.** `register` submits a real member into your
Kulturföreningen Musikbopp registry, and I was not going to put a fake person in
it. That is the one path to try yourself, with your own real details — see
"What's left for you" at the bottom.

---

## ⚠️ Still do this: rotate your keys

Your built bundle (`dist/assets/index-*.js`, served from slutstation.se)
contains in readable plaintext:

- your **eBas API key**
- your **Billetto API key *and* client secret**
- your CORS proxy URL

Anyone can open devtools and copy them. The Billetto secret can act on your
ticketing account.

The cause is worth understanding, because it will happen again otherwise:
**Vite inlines every `VITE_*` variable into the public bundle at build time.**
Putting a secret in `.env` as `VITE_API_KEY` does not hide it — it is a
build-time text substitution, so `import.meta.env.VITE_API_KEY` becomes the
literal key string in the shipped file. `.env` only protects it from git.

So:

1. Rotate the eBas key (via Svensk Live / eBas support).
2. Rotate the Billetto keypair in your organiser settings.
3. The new eBas key goes **only** into the Edge Function secret (step 4).

The one key that is safe in the browser is the **Supabase anon key** — it is
designed to be public and does nothing on its own, because every table is
behind Row Level Security.

---

## What was added

```
account.html                        the account page  (new)
account.css                         additions only — no fonts or styles
                                    redefined  (new)
src/account.js                      auth + membership logic  (new)
src/supabase-config.js              your project URL + anon key  (new — fill in)
src/membership-signup.js            front-page form → account  (new, INERT)
supabase/schema.sql                 the database  (new)
supabase/functions/ebas/index.ts    server-side eBas calls  (new)
vite.config.js                      + account.html as a build entry  (edited)
index.html                          + 2 nav/footer links  (edited, 95 bytes)
```

### On preserving the look

`account.css` deliberately defines **no colours, fonts or component styles**.
It reads your tokens (`--ink`, `--glass`, `--accent`, `--line`, `--r-lg`, …) and
reuses your existing components — `.form-shell`, `.tabs`/`.tab`, `.field`,
`.form-grid`, `.checkbox`, `.form-actions`, `.btn`, `.section-head`, `.eyebrow`.
It only adds layout for things that didn't exist (the account header, the
membership status strip). If `styles.css` changes, the account page follows
automatically.

Three additions were unavoidable and each reuses a value already in your CSS:

- the green status badge uses `#34c759`, the same green as `.switch.on` and
  `.form-success .check`
- the expired state uses amber `#ff9f0a`; the failed state uses your own
  `var(--accent)` red
- `.field input:disabled` — your stylesheet has no `:disabled` rule, so the
  read-only email field would otherwise look editable

The page also reuses your fixed video backdrop, with `--hb` pinned to 1 (the
"scrolled past the hero" state). It uses `assets/hero-poster.jpg` rather than
the video: it ends up blurred to 22px either way, so the 3 MB download would buy
nothing. Swap the `<img class="hero-bg-video">` for your `<video>` block if you
want the motion.

---

## 1. Create the Supabase project ✅ done

Sign up at [supabase.com](https://supabase.com), create a project, and pick an
**EU region** (Stockholm or Frankfurt) — you're storing personal data on Swedish
members. Free tier covers 50,000 monthly active users.

## 2. Create the database ✅ done

**SQL Editor** → paste all of `supabase/schema.sql` → Run.

This creates `public.profiles` (one row per member, auto-created on signup),
the `membership_status` view that powers the green check, Row Level Security so
a member can only read/write their own row, and a guard trigger so a member
**cannot** edit their own membership status. Passwords never appear here —
Supabase Auth stores them hashed in its own table.

## 3. Configure Auth ✅ done

**Authentication → Providers** → Email enabled.

**Confirm email** — recommended ON: it stops people signing up with someone
else's address. The flow handles it; they're registered in eBas automatically
on first sign-in. OFF means instant signup but typo emails land in your member
register.

**Authentication → URL Configuration**:

- Site URL: `https://slutstation.se`
- Redirect URLs: `https://slutstation.se/account.html` and
  `http://localhost:5173/account.html`

Without these, confirmation and password-reset links won't come back to the site.

## 4. Deploy the eBas Edge Function ✅ done

```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR-PROJECT-REF

supabase secrets set EBAS_API_KEY="your-NEW-ebas-key"
supabase functions deploy ebas
```

Optional, only once Svensk Live confirms a lookup endpoint exists:

```bash
supabase secrets set EBAS_LOOKUP_URL="https://ebas.svensklive.se/apis/<endpoint>.json"
```

## 5. Fill in the config ✅ done

`src/supabase-config.js` — Project URL and anon key from
**Project Settings → API**. Then `npm run dev` and open
`http://localhost:5173/account.html`.

## 6. Front-page form ✅ done

The "Become a member" form on the one-pager now creates a Slutstation account
as well — there is no membership without an account any more. What changed:

- `index.html` — a required **Password** field after Zip Code; the intro
  mentions the account and links to sign-in; the submit button reads
  "Create account"; the success panel now tells people to check their inbox
  (the old copy said they would get *no* confirmation email, which stopped
  being true once Supabase confirmation was switched on).
- `src/main.js` — the old browser-side eBas handler and the `ebas` entry in
  `SS_API` are gone, replaced by `initMembershipSignup()`.

**Security win:** `VITE_API_KEY` and `VITE_API_ENDPOINT` are no longer
referenced anywhere in the front-end, so the eBas key and endpoint are no
longer inlined into the built bundle. Verified by grepping `dist/`. You can
delete those two (and `VITE_CORS_PROXY`, now unused by eBas) from `.env` and
from your GitHub repo secrets.

**Still in the bundle:** the Billetto keypair, including the client secret.
`billettoFetch` is dead code — the events list is rendered by the official
`<billetto-organiser-widget>` — so it can be deleted, which would remove the
last leaked credential. I left it alone because you didn't ask; say the word.

## 7. Deploy

Your GitHub Actions workflow builds and deploys unchanged. `vite.config.js` now
emits both pages; confirm `dist/account.html` appears after `npm run build`.

---

## The green check — where it actually stands

The badge turns green when eBas confirmed the member **and** the yearly renewal
hasn't lapsed (membership runs one year from eBas's `renewed` date).

You asked for a live lookup on each page load. **I could not confirm eBas
exposes one.** eBas is built by Sverok Admin and distributed via Svensk Live;
there's no public API documentation, and your site only ever calls the
`submit_member.json` *write* endpoint. A member-search endpoint authenticated by
a shared API key would also be a real privacy exposure, so it may not exist by
design.

The function handles both and switches automatically:

- **Today** — status is recorded from eBas's own `stored_member: true` response
  at registration, then re-derived against the one-year window on every check.
  Accurate for everyone who joins through the site.
- **Once an endpoint is confirmed** — set `EBAS_LOOKUP_URL` and `verify` does a
  real round-trip. No code change.

Ask Svensk Live (`info@svensklive.se`) or Sverok Admin whether eBas offers a
member lookup API for member associations, and send me what they say.

**Known gap:** members who joined through the old form exist in eBas but have no
account here, so they read as "not a member yet" until they sign up (which
harmlessly re-registers and refreshes their `renewed` date) or you import them.
No importer written yet.

---

## Test it

1. `/account.html` → **Create account** → fill in → (confirm email) → sign in.
2. Expect the green check and "runs until \<date one year out\>".
3. Supabase **Table Editor → profiles** shows the row with `ebas_status = active`;
   **Authentication → Users** shows the login.
4. eBas: the member appears in your Musikbopp register.
5. Sign out and back in — check persists.
6. "Forgot password?" — email arrives, reset form works.
7. Wrong password → "That email and password don't match", not a raw error.
8. Same email twice → handled, no crash.
9. Edit details → save → reload → persists.

---

## GDPR

- **EU region** if you chose one in step 1.
- **Consent is split** — `terms_accepted_at` (joining) separate from
  `marketing_consent` (emails); the newsletter box is opt-in, unticked.
- **No personnummer.** Date of birth only, because eBas needs `YYYYMMDD` for
  renewals. Don't add a personnummer column later.
- **Access and erasure** — a member is one row in `profiles` plus one in
  `auth.users`; deleting the auth user cascades the profile (tested). eBas is a
  separate register, so remove them there too.
- Your `#info` bylaws text doesn't yet mention that account data is stored on
  Supabase. Worth updating before launch.

---

## Verified

15 tests against a real PostgreSQL 16 instance, all passing: profile
auto-creation from signup metadata, malformed input not breaking signup, the
one-year expiry window, `expire_lapsed_memberships()`, RLS isolation between
members, the anti-forgery trigger (an **expired** member cannot self-promote to
active), anon seeing zero rows, and cascade deletion.

JS and the Edge Function TypeScript compile; every element lookup in
`account.js` resolves to a real id in `account.html`; the page was rendered
against your actual `styles.css` and assets at desktop and mobile widths.

Not tested (needs live credentials): the real eBas round-trip, Supabase auth
email delivery. Expect one iteration on eBas response handling — it was written
from your existing code's assumptions, not from documentation.


---

## What's left for you

1. **Rotate the eBas and Billetto keys** (top of this file), then update the
   Supabase secret:
   `supabase secrets set EBAS_API_KEY="the-new-key"`
   The current secret holds your existing key so everything works today.
2. **Test the real eBas registration** — run `npm run dev`, go to
   `/account.html`, create an account with **your own real details**, and check
   you appear in the Musikbopp register. This is the one untested path.
3. **Deploy** — `npm run build` then your usual GitHub Actions push. Confirm
   `dist/account.html` exists.
4. **Ask Svensk Live** whether eBas has a member lookup endpoint (see below).
5. Optionally, switch the front-page form over (step 6).

---

## Two follow-ups worth knowing

### The browser loads supabase-js from a CDN

`src/account.js` imports supabase-js from `https://esm.sh/...`, so Vite leaves it
external and the browser fetches it at runtime. That works (it's what was
tested), but it makes your login flow depend on a third-party CDN staying up and
uncompromised. Bundling it is better:

```bash
npm install @supabase/supabase-js@2.45.4
# then in src/account.js AND src/membership-signup.js change
#   from "https://esm.sh/@supabase/supabase-js@2.45.4"
# to
#   from "@supabase/supabase-js"
git add package.json package-lock.json && git commit
```

I did **not** do this for you: your GitHub Action runs `npm ci`, which fails if
`package.json` and `package-lock.json` disagree, and I can't regenerate your
lockfile safely from here. Run the install locally so both files update together.

(Note this is the opposite of the Edge Function, which *must* use `npm:` — that
runs in Deno on Supabase, not in the browser.)

### Your GitHub secrets still hold the old keys

`.github/workflows/deploy.yml` injects `VITE_API_KEY`, `VITE_BILLETTO_*` etc. at
build time. After rotating, update those repo secrets too, or the deployed site
keeps shipping the old values.

Once you switch the front-page form over (step 6), `VITE_API_KEY`,
`VITE_API_ENDPOINT` and `VITE_CORS_PROXY` become dead — the Edge Function calls
eBas directly, server-side, with no CORS proxy. Delete them from `.env` and from
the repo secrets at that point.

### Build check

`npm run build` was run against a copy of your project with the new
`vite.config.js`: both `dist/index.html` and `dist/account.html` emit, and the
account page correctly links your compiled `styles.css` plus `account.css`.
Your workflow FTPs `./dist/` to Loopia, so `/account.html` will be live.
