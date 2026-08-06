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
export const TURNSTILE_SITE_KEY = "";

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
// Entry code (the QR on the account page), OFF.
//
// Attendance for the September event comes from Billetto's attendee list, not
// from scanning people at the door, so the code has nothing to do yet and
// showing it would only raise questions at the entrance. The panel stays in
// the page and the generator stays in account.js; this flag is the only thing
// standing between them. Turn it on the day we scan at the door.
// ---------------------------------------------------------------------------
export const ENTRY_CODE = false;
