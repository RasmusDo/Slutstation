// ============================================================================
// SLUTSTATION, the announcement bar — one module for every page that shows it
//
// Three jobs that used to be copy-pasted per page, drifting as they went:
// main.js had all three, account.js and tickets.js had two (the × worked but
// the bar never learned an event was on), and work.js — the newest page —
// had none, which left its bar stuck on "no upcoming events announced yet"
// with a dead dismiss button, precisely while an event WAS announced. The
// classic ending for per-page chrome, and the reason it now lives here:
//
//   1. restore a dismissal saved on any page
//   2. make the × work
//   3. say what is actually announced, from the same feed the event cards
//      and the tickets page already read, so no two surfaces can disagree
//
// Plain fetch rather than the Supabase SDK on purpose: this runs on pages
// that load the SDK late (or not at all), and the bar must not wait for it.
// If the fetch fails the hand-written default stands — we would rather say
// nothing than advertise an event nobody can buy.
// ============================================================================

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase-config.js";
import { t, getLang } from "./i18n.js";

// Whole days between now and doors, counted midnight to midnight so an event
// at 22:00 tonight reads "tonight" all day rather than flipping to
// "tomorrow" at lunchtime.
export function daysUntil(iso) {
  const then = new Date(iso); const now = new Date();
  const a = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / 86400000);
}

export function announceEvent(ev) {
  const bar = document.getElementById("announce");
  if (!bar || !ev) return;
  const textEl = bar.querySelector('[data-i18n^="announce."]');
  const linkEl = bar.querySelector("a");
  if (!textEl || !linkEl) return;

  const when = new Date(ev.starts_at).toLocaleDateString(
    getLang() === "sv" ? "sv-SE" : "en-GB", { day: "numeric", month: "long" });

  // A date tells you when it is. A countdown gives you a reason to come back
  // tomorrow, and it changes on its own, which a date never does.
  const days = daysUntil(ev.starts_at);
  const key  = days === 0 ? "announce.tonight"
             : days === 1 ? "announce.tomorrow"
             : days > 1 && days <= 30 ? "announce.inDays"
             : "announce.live";

  // Re-point the i18n keys as well as the text, so a later language switch
  // re-renders the live wording instead of reverting to "nothing announced".
  const vars = { name: ev.name, date: when, days };
  textEl.dataset.i18n = key;
  textEl.dataset.i18nVars = JSON.stringify(vars);
  textEl.textContent = t(key, vars);

  linkEl.dataset.i18n = "announce.liveLink";
  linkEl.textContent = t("announce.liveLink");
  linkEl.href = "/tickets.html";
  linkEl.removeAttribute("target");
  linkEl.removeAttribute("rel");

  // Arm the phone-only sticky bar where the page has one (index). `tbar`,
  // because `bar` above is the announcement strip — a collision that once
  // took a whole module down as a duplicate declaration.
  const tbar = document.getElementById("ticketBar");
  if (tbar) {
    document.getElementById("ticketBarName").textContent = ev.name;
    tbar.hidden = false;
  }
}

// fetchLive: false on the front page, whose card loader already fetches the
// same feed and calls announceEvent() itself — one request, not two.
export function initAnnounce({ fetchLive = true } = {}) {
  try {
    if (localStorage.getItem("ss-announce") === "off") document.body.classList.add("no-announce");
  } catch (e) {}
  document.getElementById("announceX")?.addEventListener("click", () => {
    document.body.classList.add("no-announce");
    try { localStorage.setItem("ss-announce", "off"); } catch (e) {}
  });

  if (!fetchLive) return;
  fetch(`${SUPABASE_URL}/rest/v1/rpc/tickets_on_sale`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((events) => {
      if (Array.isArray(events) && events.length) announceEvent(events[0]);
    })
    .catch(() => { /* the default text stands, by design */ });
}
