// ============================================================================
// SLUTSTATION — Supabase client config
//
// SAFE TO BE PUBLIC. Unlike the eBas / Billetto keys, this key is *designed*
// to ship in the browser: on its own it can do nothing, because every table is
// locked down by Row Level Security (see supabase/schema.sql). Verified live —
// a request carrying only this key reads zero rows, and the Edge Function
// rejects it with 401 "Invalid session".
//
// Anything that must stay secret (the eBas API key) lives server-side as a
// Supabase secret — see supabase/functions/ebas/index.ts.
//
// This is the modern "publishable" key rather than the older `anon` JWT.
// Both work with supabase-js v2; this one is the current default.
// Dashboard: Project Settings -> API Keys.
// ============================================================================

export const SUPABASE_URL = "https://uwawugvatencvzvvfaeq.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_MeXdRnFvHEwX0fp_Y00bUA_pWTkZ8Nb";

// ---------------------------------------------------------------------------
// Cloudflare Turnstile — bot protection on the signup form.
//
// The SITE key is public by design; the SECRET key goes in the Supabase
// dashboard and must never appear here.
//
// ORDER MATTERS, and getting it wrong breaks every signup:
//   1. Create a Turnstile site at dash.cloudflare.com for slutstation.se
//   2. Paste the site key below and DEPLOY the site
//   3. Only then, in Supabase → Authentication → Attack Protection, enable
//      CAPTCHA, choose Turnstile and paste the SECRET key
// Do it the other way round and Supabase starts demanding a token the page
// isn't sending yet, and nobody can sign up.
//
// Leave this empty and no widget renders — everything works as before.
// ---------------------------------------------------------------------------
export const TURNSTILE_SITE_KEY = "0x4AAAAAAEMGCXhZJ7bX47RI";

// ---------------------------------------------------------------------------
// Own ticket sales (Stripe) — OFF.
//
// Every ticket is sold through Billetto. This flag is the single switch that
// decides it: with it false, the tickets page never renders our own release
// ladder, never builds a cart, and never calls the Stripe Edge Function — the
// only thing a member can do is go to Billetto.
//
// The Stripe side is left fully built and tested rather than deleted: the
// database tables, the oversell lock, the webhook and the legally-checked
// checkout text are all still there and still correct. If Billetto ever stops
// being the answer — their fees, an outage, wanting the ticket data in-house —
// flip this to true, set the Stripe secrets, and the whole flow comes back with
// no code changes. Leaving it false costs nothing and exposes nothing.
// ---------------------------------------------------------------------------
export const OWN_TICKET_SALES = false;

// ---------------------------------------------------------------------------
// The invite code. Dormant: the column and the referral counting stay live in
// the database, so anything collected while it is off is still there when it
// comes back — this only decides whether the panel is drawn. Off because there
// is no reward attached to it yet, and a code with nothing behind it invites
// the question "what do I get?" with no answer.
export const INVITE_CODE = false;

// The member QR. It is no longer an ENTRY code — attendance is imported from
// the Billetto export after the night, not scanned at the door — it is a TIER
// code: the wardrobe and the bar scan it to see what somebody is owed and to
// mark it handed over. Kept under a switch so it can be turned off again
// without a deploy.
export const ENTRY_CODE = true;

// ---------------------------------------------------------------------------
// The Apple Wallet card. Dormant: the wallet Edge Function, the pass art and
// schema-phase20 are all built and stay built — this only decides whether the
// "Add to Apple Wallet" button is drawn on the account page. Off until the
// Apple Developer membership and the signing certificate exist (ROLLOUT.md
// §9), because a button that answers "not switched on yet" invites the
// question "then why is it here?" with no good answer.
export const WALLET_CARD = false;
