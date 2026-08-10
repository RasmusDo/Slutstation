/* =========================================================
   SLUTSTATION, interactions (migrated to module)
   ========================================================= */
"use strict";

import { initI18n, t, getLang } from "./i18n.js";
import { initGlassLight } from "./liquid-glass.js";

// Imported rather than written as a path string so the build emits and
// fingerprints them. A runtime "/assets/hero-720.mp4" would be invisible to
// Rollup, the file would never be copied into dist, and the hero would be a
// black rectangle in production and nowhere else — the worst kind of bug.
import HERO_720 from "../assets/hero-720.mp4?url";
import HERO_480 from "../assets/hero-480.mp4?url";

/* ---- announcement bar ---- */
const announceX = document.getElementById("announceX");
try {
  if (localStorage.getItem("ss-announce") === "off") document.body.classList.add("no-announce");
} catch (e) {}
announceX?.addEventListener("click", () => {
  document.body.classList.add("no-announce");
  try { localStorage.setItem("ss-announce", "off"); } catch (e) {}
});

/* ---- language ----
   Mounted before anything renders so the first paint is already right. */
initI18n(".nav-cta");
initGlassLight();

/* ---- sticky nav state ---- */
const nav = document.getElementById("nav");
const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 30);
onScroll();
window.addEventListener("scroll", onScroll, { passive: true });

/* ---- mobile menu ---- */
const toggle = document.getElementById("navToggle");
const links = document.getElementById("navLinks");
toggle?.addEventListener("click", () => nav.classList.toggle("open"));
links?.querySelectorAll("a").forEach((a) =>
  a.addEventListener("click", () => nav.classList.remove("open"))
);

/* ---- event tabs ---- */
const tabs = document.querySelectorAll(".tab");
const upcoming = document.getElementById("upcomingGrid");
const past = document.getElementById("pastGrid");
tabs.forEach((tab) =>
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const isUpcoming = tab.dataset.tab === "upcoming";
    upcoming.style.display = isUpcoming ? "" : "none";
    past.style.display = isUpcoming ? "none" : "";
    // Stagger the incoming cards rather than hard-swapping the grids. The
    // reflow read between remove and add is what restarts the animation.
    // rv-in is forced on because a grid that was display:none at load never
    // fired the reveal observer, and this is the moment it becomes visible.
    const shown = isUpcoming ? upcoming : past;
    shown.classList.add("rv-in");
    shown.classList.remove("tab-swap");
    void shown.offsetWidth;
    shown.classList.add("tab-swap");
  })
);

/* ---- DJ switch ---- */
const djSwitch = document.getElementById("djSwitch");
const djFields = document.getElementById("djFields");
djSwitch?.addEventListener("click", () => {
  const on = djSwitch.classList.toggle("on");
  djSwitch.setAttribute("aria-pressed", String(on));
  djFields.classList.toggle("show", on);
});

/* ---- accordion ----
   Class toggle only. The open/close animation is the stylesheet's grid-rows
   transition, so nothing here measures scrollHeight — which also means a
   language swap that changes the text can never strand an open panel at a
   stale measured height. */
document.querySelectorAll(".acc-head").forEach((head) =>
  head.addEventListener("click", () => {
    head.parentElement.classList.toggle("open");
  })
);

/* =========================================================
   SLUTSTATION APIs

   The Billetto block that used to live here has been removed. It was dead
   code, nothing on the page ever called it, but because Vite inlines every
   VITE_* variable at build time, it was publishing the Billetto API key AND
   client secret in the public bundle on every deploy. Rotate that keypair in
   Billetto; nothing here needs it any more.

   EmailJS keys are public by design (that's how EmailJS works from a browser).
   ========================================================= */
const SS_API = {
  emailjs: {
    publicKey: import.meta.env.VITE_EMAILJS_PUBLIC_KEY,
    service: import.meta.env.VITE_EMAILJS_SERVICE_ID,
    template: import.meta.env.VITE_EMAILJS_TEMPLATE_ID,
  },
};
if (window.emailjs) emailjs.init({ publicKey: SS_API.emailjs.publicKey });

/* ---- membership ----
   Account creation lives on /account.html now: one form, one code path, so the
   two can't drift apart. The #apply section here is just a link to it, and the
   eBas call happens server-side in the `ebas` Edge Function, which is why the
   eBas key is no longer built into this bundle. */

/* ---- scroll reveal ----

   Removed once, rebuilt at the end of this file. The original hid every
   .reveal block in CSS at opacity 0 and waited on an observer with a
   threshold of 0.12 — 12% of the ELEMENT on screen — which a tall section
   can never satisfy, so whole sections stayed invisible for good (17 of 17
   hidden at load when it was measured), and with JavaScript off, everything.

   The rebuild inverts the failure mode: the page ships visible, the hiding
   class is only ever added by the same module that owns the observer that
   unhides it, and the threshold is 0. See initReveal() below. */

/* =========================================================
   HERO BACKGROUND

   Two jobs: decide whether this device should be playing a video at all, and
   drive the scroll cross-fade. The expensive half of what used to be here now
   lives in CSS as an opacity, so all this does is set one custom property.
   ========================================================= */
const heroBg = document.getElementById("heroBg");
const heroVideo = document.getElementById("heroVideo");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const tier = document.documentElement.dataset.tier || "high";
let heroPastHero = false;

/* ---- which video, if any ----
   The markup ships the <video> with no src and preload="none", so nothing is
   fetched until this runs. That matters more than it sounds: with a src in the
   markup the browser starts pulling the video during head parsing, in front of
   the stylesheet and the fonts, and on a phone that is the whole first second.

   h264 only, no webm. VP9 is a smaller file but it is software-decoded on
   older phones, and a full-screen software video decode is precisely the lag
   this whole pass is about. h264 has a hardware decoder in everything.

   Nothing is loaded on the low tier or under reduce-motion — the poster is a
   still of the same frame, and the page is designed around it either way. */
// Asking to play is not the same as playing, and one ask is not enough.
//
// Chrome pauses what it calls "video-only background media" to save power, and
// since this video is muted it qualifies. If the page is not visible at the
// moment we ask, play() rejects with AbortError and the video sits on its
// poster forever. That is not a rare corner: a page opened in a background tab
// — cmd-click, "open link in new tab", a restored session — hits it every
// time, and deferring the load to idle widens the window it happens in.
//
// So this asks again on every event that means "you could start now", and
// refuses to ask when it already knows the answer is no.
function tryPlayHero() {
  if (!heroVideo || heroPastHero || document.hidden) return;
  const p = heroVideo.play();
  if (p && p.catch) p.catch(() => {});
}

if (heroVideo) {
  // The video is decided on its own terms, not on the effects tier.
  //
  // tier folds in two accessibility settings: reduce-transparency, and
  // reduce-motion is checked separately below. Neither is a statement about
  // video. Reduce-transparency is about glass. Reduce-motion is about
  // parallax, zoom and things that lurch when you scroll — not a muted,
  // looping, cutless ambient plate, and the scroll cross-fade it is really
  // aimed at already stands down on its own. Between them they were turning
  // the front page into a still photograph for a lot of people who never
  // asked for that, on settings they may not remember switching on.
  //
  // What genuinely makes a background video a bad idea is a metered
  // connection or a device that will software-decode it. So: those, and
  // nothing else.
  const conn = navigator.connection || {};
  const thin = conn.saveData === true || /(^|-)(2g|slow-2g)$/.test(conn.effectiveType || "");
  const weak = (navigator.deviceMemory || 0) > 0 && navigator.deviceMemory <= 4;
  const wantVideo = !thin && !weak;
  // Scheduled, not fired. Two things below conspire against a video in a tab
  // that is not on screen when the page loads — which is a completely ordinary
  // way to open a link: cmd-click, a restored session, or anything that opens
  // behind the window you are looking at.
  //
  //   * requestIdleCallback DOES NOT RUN AT ALL in a hidden tab. Not late —
  //     never, timeout included.
  //   * tryPlayHero() refuses on document.hidden, correctly.
  //
  // So the src was never assigned, and the visibilitychange handler below used
  // to open with `if (!heroVideo.getAttribute("src")) return;` — which meant
  // the one event that could have rescued it bailed out precisely because it
  // had never happened. The video stayed a poster frame for the rest of the
  // page's life. Confirmed on Axel's own machine: readyState 0, networkState
  // 0, no src, no error.
  //
  // Waiting for visible is also the right thing on its own terms: a megabyte
  // of video should not be pulled for a tab nobody has looked at yet.
  let started = false;

  const attach = () => {
    if (started) return;
    started = true;
    heroVideo.src = tier === "mid" ? HERO_480 : HERO_720;
    // Deliberately no load() call. Assigning src already starts loading, and
    // load() aborts any play() already in flight — which is the other half of
    // how this broke.
    //
    // Not { once: true }: if the first attempt is refused because the tab is
    // in the background, the later ones are the ones that land.
    heroVideo.addEventListener("loadeddata", tryPlayHero);
    heroVideo.addEventListener("canplay", tryPlayHero);
    tryPlayHero();
  };

  // After first paint and off the critical path, but only once somebody is
  // actually looking. requestIdleCallback isn't in Safari, hence the timeout.
  const schedule = () => {
    if (!wantVideo || started || document.hidden) return;
    if ("requestIdleCallback" in window) requestIdleCallback(attach, { timeout: 1500 });
    else setTimeout(attach, 400);
  };

  schedule();

  // A background video in a tab nobody is looking at still decodes every frame
  // and still keeps the compositor awake. This is most of what people mean when
  // they say a site "makes the laptop hot". Coming back to the tab is also the
  // moment a refused play() finally becomes possible, so this is both the
  // power saving and the recovery.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (heroVideo.getAttribute("src")) heroVideo.pause();
      return;
    }
    // Becoming visible is both the first chance to load and the first chance
    // to play. Order matters: schedule() is what fixes a page that was opened
    // in a background tab, tryPlayHero() is what fixes a play() that was
    // refused while it was there.
    schedule();
    tryPlayHero();
  });
}

if (heroBg) {
  let ticking = false;
  const update = () => {
    ticking = false;
    const span = Math.max(window.innerHeight * 0.85, 1);
    const hb = Math.min(Math.max(window.scrollY / span, 0), 1);
    heroBg.style.setProperty("--hb", hb.toFixed(3));
    // Mirrored onto <html> for things outside .hero-bg's subtree: the hero
    // parallax reads it there (a custom property set on .hero-bg does not
    // reach a sibling). --sp drives the progress hairline. Same rAF, so the
    // two extra writes cost nothing a profiler can find.
    const doc = document.documentElement;
    doc.style.setProperty("--hb", hb.toFixed(3));
    const spMax = doc.scrollHeight - window.innerHeight;
    doc.style.setProperty("--sp", spMax > 0 ? (window.scrollY / spMax).toFixed(4) : "0");

    // Once the blurred still has fully covered it, the video is painting
    // frames nobody can see. Stop it, and start it again on the way back up.
    if (heroVideo && heroVideo.src) {
      const past = hb >= 0.98;
      if (past !== heroPastHero) {
        heroPastHero = past;
        if (past) heroVideo.pause();
        else tryPlayHero();   // scrolling back up is another chance to start
      }
    }
  };
  const onScrollBlur = () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  };
  update();
  window.addEventListener("scroll", onScrollBlur, { passive: true });
  window.addEventListener("resize", update, { passive: true });
}

/* ---- upcoming events ----
   The page ships in its honest resting state: nothing announced, follow us on
   Instagram. That is what a visitor sees if the fetch below never lands, which
   is the right way round, we would rather say nothing than advertise an event
   nobody can buy.

   When the database says an event IS announced, this draws the card and
   rewrites the announcement bar to match. Announcing is a single flag on the
   event (admin panel, or a scheduled time), and the banner, this card and the
   tickets page all read the same feed, so they cannot disagree. */
// Swap the announcement bar over to a live event. Untouched while nothing is
// announced, so the hand-written "no events yet / follow us" state stands on
// its own for anyone whose connection or ad blocker stops the fetch below.
// Whole days between now and doors, counted from midnight to midnight so an
// event at 22:00 tonight reads "tonight" all day rather than flipping to
// "tomorrow" at lunchtime.
function daysUntil(iso) {
  const then = new Date(iso); const now = new Date();
  const a = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / 86400000);
}

function announceEvent(ev) {
  const bar = document.getElementById("announce");
  if (!bar || !ev) return;
  const textEl = bar.querySelector('[data-i18n="announce.text"]');
  const linkEl = bar.querySelector('[data-i18n="announce.link"]');
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
}

// The same count, as a line on the card. Empty once the night has started,
// because "0 days" on the morning after is worse than saying nothing.
function countdownLine(iso) {
  const d = daysUntil(iso);
  if (d < 0 || d > 60) return "";
  const key = d === 0 ? "events.tonight" : d === 1 ? "events.tomorrow" : "events.inDays";
  return `<div class="ev-count" data-i18n="${key}" data-i18n-vars='${JSON.stringify({ days: d })}'>${t(key, { days: d })}</div>`;
}

(async function initUpcomingEvents() {
  const cards = document.getElementById("upcomingCards");
  const empty = document.getElementById("upcomingEmpty");
  if (!cards) return;

  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY, OWN_TICKET_SALES } = await import("./supabase-config.js");
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/tickets_on_sale`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    if (!res.ok) return;   // network said no: keep the static card

    const events = await res.json();
    if (!Array.isArray(events) || !events.length) {
      // Nothing announced. The page already says so, so leave it alone.
      cards.hidden = true;
      if (empty) empty.hidden = false;
      return;
    }

    // An event is live. Rewrite the announcement bar from the same feed that
    // draws the card below, so the bar, the card and the tickets page can never
    // disagree about what is on: one flag in the admin panel moves all three.
    announceEvent(events[0]);

    cards.innerHTML = events.map((ev) => {
      const d = new Date(ev.starts_at);
      const open = OWN_TICKET_SALES && (ev.types || []).some((t) => t.open);
      // Sold on Billetto rather than through our own releases, still on sale,
      // we just can't quote a price from here. With own sales off, Billetto is
      // the only route, so it wins over any release row left open by mistake
      // and the card must not advertise a "from" price we won't be charging.
      const viaBilletto = !!ev.billetto_event_id && !open;
      const from = viaBilletto ? undefined
        : (ev.types || []).filter((t) => t.open && t.kind === "entry")
            .map((t) => t.price_ore).sort((a, b) => a - b)[0];

      const when = d.toLocaleString(getLang() === "sv" ? "sv-SE" : "en-GB", {
        day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
      });

      return `
      <article class="event-card">
        <div class="thumb">
          <img src="${esc(ev.image_url || "assets/festival-crowd.jpg")}" alt="${esc(ev.name)}" loading="lazy" decoding="async" />
          <div class="date">
            <div class="d">${d.getDate()}</div>
            <div class="m">${esc(d.toLocaleDateString(getLang() === "sv" ? "sv-SE" : "en-GB", { month: "long" }))} ’${String(d.getFullYear()).slice(2)}</div>
          </div>
        </div>
        <div class="info">
          <h4>${esc(ev.name)}</h4>
          <div class="loc">◷ ${esc(ev.venue || t("events.tba"))} · ${esc(when)}</div>
          ${countdownLine(ev.starts_at)}
          ${open || viaBilletto
            ? `<a class="btn btn-primary btn-sm" href="/tickets.html">${t("events.get")}${!viaBilletto && from != null ? ` · ${t("events.from")} ${(from / 100).toLocaleString("sv-SE")} kr` : ""}</a>`
            : `<a class="btn btn-sm" href="/tickets.html">${t("events.soldout")}</a>`}
          ${ev.description ? `<p class="ev-desc">${esc(ev.description)}</p>` : ""}
        </div>
      </article>`;
    }).join("");

    cards.hidden = false;
    if (empty) empty.hidden = true;
    // Redraw the cards if the visitor switches language later.
    document.addEventListener("ss:lang", () => initUpcomingEvents(), { once: true });
  } catch (err) {
    // Offline, blocked, or the database is unreachable, keep the empty state.
    console.warn("Couldn't load upcoming events:", err);
  }
})();

/* =========================================================
   GDPR COOKIE CONSENT BANNER & LOGIC
   ========================================================= */

(function initCookieConsent() {
  const overlay  = document.getElementById("cookieOverlay");
  const modal    = document.getElementById("cookieBanner");
  const trigger  = document.getElementById("cookieTrigger");
  const chkAnalytics = document.getElementById("cookieAnalytics");
  const chkMarketing = document.getElementById("cookieMarketing");
  const btnAccept = document.getElementById("cookieBtnAccept");
  const btnDeny   = document.getElementById("cookieBtnDeny");
  const btnSave   = document.getElementById("cookieBtnSave");
  const KEY = "ss-cookie-consent";

  function getConsent() {
    try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
  }

  function saveConsent(consent) {
    try { localStorage.setItem(KEY, JSON.stringify(consent)); } catch {}
    loadConsentedScripts();
  }

  function showModal() {
    overlay?.classList.remove("hidden");
    modal?.classList.remove("hidden");
    document.body.style.overflow = "hidden"; // prevent scroll behind modal
  }

  function hideModal() {
    overlay?.classList.add("hidden");
    modal?.classList.add("hidden");
    document.body.style.overflow = "";
    document.body.classList.add("cookie-banner-closed");
  }

  function syncCheckboxes(consent) {
    if (chkAnalytics) chkAnalytics.checked = !!(consent?.analytics);
    if (chkMarketing) chkMarketing.checked = !!(consent?.marketing);
  }

  // Accept all
  btnAccept?.addEventListener("click", () => {
    saveConsent({ necessary: true, analytics: true, marketing: true });
    hideModal();
  });

  // Decline all
  btnDeny?.addEventListener("click", () => {
    saveConsent({ necessary: true, analytics: false, marketing: false });
    clearCookiesForCategory("analytics");
    clearCookiesForCategory("marketing");
    hideModal();
  });

  // Save custom choices
  btnSave?.addEventListener("click", () => {
    const consent = {
      necessary: true,
      analytics: !!chkAnalytics?.checked,
      marketing: !!chkMarketing?.checked,
    };
    saveConsent(consent);
    if (!consent.analytics) clearCookiesForCategory("analytics");
    if (!consent.marketing) clearCookiesForCategory("marketing");
    hideModal();
  });

  // Floating trigger, reopen with current prefs shown
  trigger?.addEventListener("click", () => {
    syncCheckboxes(getConsent());
    showModal();
  });

  // On load
  const existing = getConsent();
  if (existing) {
    syncCheckboxes(existing);
    hideModal();
    loadConsentedScripts();
  } else {
    syncCheckboxes(null);
    showModal();
  }
})();

// Load scripts based on consent state
function loadConsentedScripts() {
  let consent = {};
  try {
    const saved = localStorage.getItem("ss-cookie-consent");
    if (saved) consent = JSON.parse(saved);
  } catch (e) {
    return;
  }

  document.querySelectorAll('script[type="text/plain"][data-category]').forEach(script => {
    const category = script.getAttribute("data-category");
    if (consent[category]) {
      const newScript = document.createElement("script");
      // Copy attributes
      Array.from(script.attributes).forEach(attr => {
        if (attr.name !== "type" && attr.name !== "data-category") {
          newScript.setAttribute(attr.name, attr.value);
        }
      });
      // Copy content
      newScript.textContent = script.textContent;
      // Inject and remove old placeholder
      script.parentNode.insertBefore(newScript, script);
      script.remove();
    }
  });
}

// Cookie cleanup logic
function clearCookiesForCategory(category) {
  if (category === "marketing") {
    // Delete Facebook Pixel cookies
    deleteCookie("_fbp");
    deleteCookie("_fbc");
  }
  if (category === "analytics") {
    // Delete Google Analytics cookies
    deleteCookie("_ga");
    deleteCookie("_gid");
    
    // Also delete any other google analytics cookies starting with _ga_
    document.cookie.split(";").forEach(c => {
      const name = c.trim().split("=")[0];
      if (name.startsWith("_ga_")) {
        deleteCookie(name);
      }
    });
  }
}

function deleteCookie(name) {
  const domain = window.location.hostname;
  const parts = domain.split(".");
  
  // Try deleting on exact domain and various patterns
  document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
  document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=" + domain + ";";
  document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=." + domain + ";";
  
  if (parts.length > 2) {
    const rootDomain = "." + parts.slice(-2).join(".");
    document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=" + rootDomain + ";";
  }
}

/* =========================================================
   PHOTO VIEWER

   The gallery was nine thumbnails you could not open, which is a strange
   thing to do with photographs. Clicking one now opens it full size, with
   arrows, swipe and Escape.

   Past event cards use the same viewer. A card opens on its own night's
   photos when any gallery figure carries a matching data-night, and is left
   inert when none does, so an unattributed night stays a card rather than
   pretending to have an album behind it.
   ========================================================= */
(function initPhotoViewer() {
  const gallery = document.querySelector(".gallery-grid");
  if (!gallery) return;

  const figures = [...gallery.querySelectorAll("figure img")];
  if (!figures.length) return;

  let shots = figures;      // what the viewer is currently showing
  let at = 0;
  let lastFocus = null;

  const box = document.createElement("div");
  box.className = "viewer";
  box.hidden = true;
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.innerHTML = `
    <button class="viewer-x" aria-label="${t("gallery.close")}">×</button>
    <button class="viewer-nav prev" aria-label="${t("gallery.prev")}">‹</button>
    <figure class="viewer-stage"><img alt="" /><figcaption></figcaption></figure>
    <button class="viewer-nav next" aria-label="${t("gallery.next")}">›</button>`;
  document.body.appendChild(box);

  const img = box.querySelector("img");
  const cap = box.querySelector("figcaption");

  // The thumbnails are served through a srcset now, so what the grid loaded is
  // the 400px crop — fine in a column, not fine filling the screen. Take the
  // widest candidate the srcset offers instead.
  //
  // Read off the attribute rather than from a hand-written data-full path:
  // the build fingerprints every asset it can see, and it can see srcset. A
  // path in a data-* attribute is left verbatim and 404s in production.
  function fullSize(el) {
    const set = el.getAttribute("srcset");
    if (!set) return el.currentSrc || el.src;
    let best = null;
    let bestW = -1;
    for (const part of set.split(",")) {
      const [url, desc] = part.trim().split(/\s+/);
      if (!url) continue;
      const w = desc && desc.endsWith("w") ? parseInt(desc, 10) : 0;
      if (w > bestW) { bestW = w; best = url; }
    }
    return best || el.currentSrc || el.src;
  }

  function draw() {
    const src = shots[at];
    img.src = fullSize(src);
    img.alt = src.alt || "";
    cap.textContent = shots.length > 1 ? `${at + 1} / ${shots.length}` : "";
    box.querySelector(".prev").hidden = shots.length < 2;
    box.querySelector(".next").hidden = shots.length < 2;
  }

  function open(list, index) {
    shots = list; at = index;
    lastFocus = document.activeElement;
    draw();
    box.hidden = false;
    document.body.classList.add("viewing");
    document.body.style.overflow = "hidden";
    box.querySelector(".viewer-x").focus();
  }

  function close() {
    box.hidden = true;
    document.body.classList.remove("viewing");
    document.body.style.overflow = "";
    img.removeAttribute("src");   // let a large photo go before the next open
    lastFocus?.focus();
  }

  const step = (n) => { at = (at + n + shots.length) % shots.length; draw(); };

  figures.forEach((el, i) => {
    el.parentElement.classList.add("is-openable");
    el.parentElement.setAttribute("tabindex", "0");
    el.parentElement.setAttribute("role", "button");
    el.parentElement.addEventListener("click", () => open(figures, i));
    el.parentElement.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(figures, i); }
    });
  });

  document.querySelectorAll(".event-card.past[data-night]").forEach((card) => {
    const key = card.dataset.night;
    const own = card.querySelector(".thumb img");
    const mine = [...gallery.querySelectorAll(`figure[data-night="${CSS.escape(key)}"] img`)];
    if (!mine.length) return;            // nothing attributed to this night yet
    const list = own ? [own, ...mine.filter((m) => m !== own)] : mine;
    card.classList.add("is-openable");
    card.setAttribute("tabindex", "0");
    card.addEventListener("click", () => open(list, 0));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); open(list, 0); }
    });
  });

  box.querySelector(".viewer-x").addEventListener("click", close);
  box.querySelector(".prev").addEventListener("click", () => step(-1));
  box.querySelector(".next").addEventListener("click", () => step(1));
  box.addEventListener("click", (e) => { if (e.target === box) close(); });

  document.addEventListener("keydown", (e) => {
    if (box.hidden) return;
    if (e.key === "Escape") close();
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
  });

  // Swipe, which is how this gets used on a phone.
  let x0 = null;
  box.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  box.addEventListener("touchend", (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 45) step(dx < 0 ? 1 : -1);
    x0 = null;
  });
})();

/* =========================================================
   SCROLL REVEAL, SECOND ATTEMPT

   The first version is described at its grave further up: it hid content in
   CSS and waited for an observer that could never fire on a tall block. This
   one inverts the failure mode. The page ships fully visible; classes that
   hide anything are only added HERE, one line before the observer that will
   unhide them is watching, so JS-off, reduced-motion, an exception above
   this line — every failure — lands on a visible page.

   threshold: 0 with a small bottom rootMargin: one pixel of the element
   crossing 8% up from the bottom edge fires it, however tall the element is.
   ========================================================= */
(function initReveal() {
  if (!("IntersectionObserver" in window)) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const els = [...document.querySelectorAll(".reveal")];
  if (!els.length) return;

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add("rv-in");
      io.unobserve(e.target);
    }
  }, { threshold: 0, rootMargin: "0px 0px -8% 0px" });

  els.forEach((el) => {
    // Grids cascade their children; everything else fades as one block.
    el.classList.add("rv");
    if (el.matches(".event-grid, .gallery-grid, .rules, .about-grid")) {
      el.classList.add("rv-grid");
    }
    io.observe(el);
  });
})();

/* =========================================================
   NAV SCROLL-SPY

   The link for the section you are in carries .active. Sections are watched
   through a horizontal band across the middle of the viewport (rootMargin
   trims 45% off the top and 50% off the bottom), so exactly one section is
   "current" at a time and the handover happens mid-screen, where a person
   would say they've moved on. Only sections that actually have a nav link
   are observed — the gallery keeps whatever was active before it.
   ========================================================= */
(function initScrollSpy() {
  if (!("IntersectionObserver" in window)) return;
  const links = new Map();
  document.querySelectorAll('.nav-links a[href^="#"]').forEach((a) => {
    const sec = document.querySelector(a.getAttribute("href"));
    if (sec) links.set(sec, a);
  });
  if (!links.size) return;

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      links.forEach((a) => a.classList.remove("active"));
      links.get(e.target)?.classList.add("active");
    }
  }, { threshold: 0, rootMargin: "-45% 0px -50% 0px" });

  links.forEach((_, sec) => io.observe(sec));
})();
