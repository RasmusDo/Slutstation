// ============================================================================
// SLUTSTATION, ticket sales
//
// This file never decides what anything costs. It sends ticket type ids and
// quantities; the database prices the order, holds the stock and hands back a
// Stripe Checkout URL. So a person editing prices in devtools changes nothing.
//
// The redirect back from Stripe is not proof of payment either, it just tells
// us which order to watch. The tickets appear when the webhook confirms the
// money landed, which is why this page waits rather than celebrating early.
// ============================================================================

import { SUPABASE_URL, SUPABASE_ANON_KEY, OWN_TICKET_SALES } from "./supabase-config.js";
import { initI18n, t, getLang } from "./i18n.js";
import { initAnnounce } from "./announce.js";
import { initGlassLight } from "./liquid-glass.js";

const $ = (id) => document.getElementById(id);

// Language first: it must survive anything that happens below.
initI18n(".nav-cta");
initGlassLight();

// The Supabase SDK is BUNDLED — installed from npm and code-split by Vite into
// a chunk served from our own origin, so no third-party CDN sits in this
// page's path any more (it used to load from esm.sh at runtime). It stays a
// DYNAMIC import inside a try/catch on purpose: the split chunk keeps first
// paint light, and a network that dies between the page and the chunk still
// degrades to "the dynamic parts are down" instead of a dead page.
//
// Timed out rather than simply awaited: a request that is accepted and never
// answered (captive portal, wifi dropping mid-load) never rejects, so the catch
// below would never fire and the page would spin forever. See account.js.
const importWithTimeout = (p, ms = 12000) =>
  Promise.race([p, new Promise((_, reject) =>
    setTimeout(() => reject(new Error("SDK load timed out")), ms))]);

// Assigned from a promise rather than a top-level await, and the difference
// matters more than it looks. `await` at the top level suspends the WHOLE
// module until the network answers, so every static thing below it — the
// hamburger, the picker, the announcement bar — stayed unbound until a CDN in
// another country replied, and stayed dead for the full timeout if it never
// did. That is worse than the failure the try/catch was added to survive.
// Nothing here needs the SDK to bind a click handler, so nothing here waits
// for it: the module finishes evaluating immediately and the one function that
// does need a client waits on `sdkReady` instead.
let supabase = null;
const sdkReady = importWithTimeout(
  import("@supabase/supabase-js"))
  .then(({ createClient }) => {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return true;
  })
  .catch((err) => {
    console.error("Supabase SDK failed to load:", err);
    const box = document.getElementById("stateLoading");
    if (box) box.innerHTML =
      `<div class="form-shell acc-narrow" style="text-align:center;">
         <p style="color:var(--muted);">${t("err.sdkOffline")}</p>
       </div>`;
    return false;
  });

const cart = new Map();      // ticket_type_id -> qty
let ownedEntry = new Set();  // event ids where they already hold an entry ticket
let booted = false;

// ---------------------------------------------------------------------------
// chrome (same as the other pages, this one doesn't load main.js either)
// ---------------------------------------------------------------------------
(function initChrome() {
  // Announcement bar: dismissal, the ×, and the live-event wording all come
  // from the shared module now — this page used to bind the × but never
  // learn an event was on, so its bar said "nothing announced" mid-release.
  initAnnounce();
  const nav = $("nav");
  const onScroll = () => nav?.classList.toggle("scrolled", window.scrollY > 30);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
  $("navToggle")?.addEventListener("click", () => nav?.classList.toggle("open"));
  $("navLinks")?.querySelectorAll("a").forEach((a) =>
    a.addEventListener("click", () => nav?.classList.remove("open"))
  );
})();

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function show(id) {
  ["stateLoading", "stateAuth", "stateBuy", "stateDone"].forEach((s) => {
    const el = $(s); if (el) el.hidden = s !== id;
  });
  // The signed-out wall used to hide WHAT was on sale, which made the climb
  // feel unmotivated: you were asked to sign in for something the page would
  // not name. The preview needs no session — the same public RPC the front
  // page uses — so the gate can show the goods and gate only the buying.
  if (id === "stateAuth") renderAuthOnSale();
}

let authOnSaleDrawn = false;
async function renderAuthOnSale() {
  const host = $("authOnSale");
  if (!host || authOnSaleDrawn || !supabase) return;
  authOnSaleDrawn = true;
  try {
    const { data } = await supabase.rpc("tickets_on_sale");
    if (!Array.isArray(data) || !data.length) return;
    const ev = data[0];
    const d = new Date(ev.starts_at);
    const when = d.toLocaleDateString(getLang() === "sv" ? "sv-SE" : "en-GB",
      { day: "numeric", month: "long" });
    const from = (ev.types || []).filter((ty) => ty.open && ty.kind === "entry")
      .map((ty) => ty.price_ore).sort((a, b) => a - b)[0];
    // The preview carries the buy button itself now that purchase is open to
    // everyone: a signed-out visitor who browsed here plainly (no ?buy) can
    // still reach Billetto in one press. With embed.js loaded the press opens
    // Billetto's overlay on this page (its interceptor claims every /select
    // link); with the script blocked, the same href is a working link. The
    // pixel's click handler counts billetto.se hrefs as InitiateCheckout on
    // its own.
    const billettoOnly = ev.billetto_event_id &&
      (!OWN_TICKET_SALES || !(ev.types || []).some((ty) => ty.open));
    if (billettoOnly) loadBillettoWidget();
    const buyBtn = billettoOnly
      ? `<a class="btn btn-primary btn-sm" href="https://billetto.se/e/e-${
          encodeURIComponent(String(ev.billetto_event_id).trim())}/select?color=%23ff2a2a">${esc(t("events.get"))}</a>`
      : "";
    host.innerHTML = `
      <div class="form-shell acc-panel tk-preview">
        ${ev.image_url ? `<img src="${esc(ev.image_url)}" alt="" loading="lazy" decoding="async" />` : ""}
        <div class="tk-preview-txt">
          <span class="eyebrow">${esc(t("tk.previewT"))}</span>
          <h3>${esc(ev.name)}</h3>
          <p>${esc(ev.venue || t("events.tba"))} · ${esc(when)}${from != null
            ? ` · ${esc(t("events.from"))} ${(from / 100).toLocaleString("sv-SE")} kr` : ""}</p>
          ${buyBtn ? `<p style="margin-top:12px;">${buyBtn}</p>` : ""}
        </div>
      </div>`;
  } catch (e) { /* the wall still works without the poster on it */ }
}

const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Prices are integers in öre everywhere. 25000 -> "250". Only ever divide here.
const kr = (ore) => (ore / 100).toLocaleString("sv-SE", { maximumFractionDigits: 2 });

function fmtWhen(iso) {
  return new Date(iso).toLocaleString(getLang() === "sv" ? "sv-SE" : "en-GB", {
    weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Billetto events
//
// The 12 September open air is sold through Billetto, not our own releases. The
// widget script is only ever loaded once somebody is signed in, so a logged-out
// visitor doesn't just see a hidden button, they don't get Billetto's script at
// all, and nothing about the sale is in the page for them to poke at.
// ---------------------------------------------------------------------------
const BILLETTO_HOST = "https://billetto.se";
let billettoLoaded = false;

function loadBillettoWidget() {
  if (billettoLoaded) return;
  billettoLoaded = true;
  const s = document.createElement("script");
  s.src = `${BILLETTO_HOST}/embed.js`;
  s.async = true;
  document.body.appendChild(s);
}

function renderBillettoBlock(ev) {
  const id = String(ev.billetto_event_id).trim();
  return `
    <div class="acc-note" style="margin-bottom:22px;">${t("tk.billetto")}</div>
    <div class="ops-actions">
      <a class="btn btn-primary" href="${BILLETTO_HOST}/e/e-${esc(id)}/select?color=%23ff2a2a">${t("events.get")}</a>
      <a class="acc-link" href="${BILLETTO_HOST}/e/${esc(ev.billetto_slug || `e-${id}`)}" target="_blank" rel="noopener">${t("tk.openBilletto")}</a>
    </div>`;
}

function renderEvents(events) {
  const host = $("eventBlocks");
  host.innerHTML = "";

  // With OWN_TICKET_SALES off, an event we can't send to Billetto has nothing
  // to sell, drop it rather than render an empty shell with no way to buy.
  const sellable = OWN_TICKET_SALES ? events : events.filter((ev) => ev.billetto_event_id);

  if (!sellable.length) { $("emptyBlock").hidden = false; return; }
  $("emptyBlock").hidden = true;

  for (const ev of sellable) {
    const block = document.createElement("div");
    block.className = "form-shell acc-panel tk-event";
    block.dataset.event = ev.event_id;

    // Sold on Billetto: no releases of ours, no cart, no checkout of ours.
    // When own sales are off, Billetto always wins, even if a release row was
    // left open in the database by mistake, it can never render a pay button.
    if (ev.billetto_event_id && (!OWN_TICKET_SALES || !(ev.types || []).some((ty) => ty.open))) {
      block.innerHTML = `
        <div class="acc-card-head">
          <h3>${esc(ev.name)}</h3>
          <p class="tk-when">${esc(ev.venue || t("events.tba"))} · <b>${esc(fmtWhen(ev.starts_at))}</b></p>
        </div>
        ${renderBillettoBlock(ev)}`;
      host.appendChild(block);
      loadBillettoWidget();
      continue;
    }

    const rows = (ev.types || []).map((ty) => renderRow(ev, ty)).join("");

    // Distansavtalslagen 2 kap 9 §: the payment obligation must be made clear
    // before the order and expressly accepted, or the buyer simply isn't
    // bound. Hence the explicit consent tick below and the word "Betala" on
    // the button rather than "Continue". (A JS comment, not an HTML one, so
    // the minifier strips it instead of shipping it into the DOM.)

    block.innerHTML = `
      <div class="acc-card-head">
        <h3>${esc(ev.name)}</h3>
        <p class="tk-when">${esc(ev.venue || t("events.tba"))} · <b>${esc(fmtWhen(ev.starts_at))}</b></p>
      </div>
      <div class="tk-list">${rows}</div>

      <label class="checkbox tk-consent">
        <input type="checkbox" data-agree />
        <span>${t("tk.consent")}
        <small>${t("tk.consentSub")}</small></span>
      </label>

      <div class="tk-total">
        <div class="tk-total-sum">
          <b data-total>0 kr</b>
          <small>${t("tk.total")}</small>
        </div>
        <div class="ops-actions">
          <span class="form-msg" data-msg></span>
          <button class="btn btn-primary" data-checkout disabled>${t("tk.pay")}</button>
        </div>
      </div>`;

    host.appendChild(block);
    wireBlock(block, ev);
  }

  updateTotals();
}

function renderRow(ev, ty) {
  const owned = ownedEntry.has(ev.event_id);
  const needsEntry = ty.kind === "addon" && !owned;

  let flag = "";
  if (!ty.open) {
    if (ty.status === "closed" || (ty.left !== null && ty.left <= 0)) {
      flag = `<span class="tk-flag">${t("tk.soldout")}</span>`;
    } else if (ty.status === "paused") {
      flag = `<span class="tk-flag">${t("tk.paused")}</span>`;
    } else if (ty.sales_start && new Date(ty.sales_start) > new Date()) {
      flag = `<span class="tk-flag">${t("tk.opens", { date: esc(new Date(ty.sales_start).toLocaleDateString(getLang() === "sv" ? "sv-SE" : "en-GB", { day: "numeric", month: "short" })) })}</span>`;
    } else {
      flag = `<span class="tk-flag">${t("tk.notyet")}</span>`;
    }
  } else if (ty.left !== null && ty.left <= 10) {
    flag = `<span class="tk-flag hot">${t("tk.left", { n: ty.left })}</span>`;
  } else if (ty.kind === "addon") {
    flag = `<span class="tk-flag ok">${t("tk.addon")}</span>`;
  }

  const sub = [
    ty.description || "",
    needsEntry ? t("tk.needEntry") : "",
  ].filter(Boolean).join(" ");

  const controls = ty.open
    ? `<div class="tk-qty" data-type="${esc(ty.id)}" data-kind="${esc(ty.kind)}" data-max="${ty.max_per_order}"
            data-stock="${ty.left === null ? 9999 : ty.left}" data-price="${ty.price_ore}">
         <button type="button" data-step="-1" aria-label="${esc(t("tk.less"))}" disabled>−</button>
         <span data-count>0</span>
         <button type="button" data-step="1" aria-label="${esc(t("tk.more"))}">+</button>
       </div>`
    : "";

  return `
    <div class="tk-row ${ty.open ? "is-live" : "is-shut"}" data-row="${esc(ty.id)}">
      <div class="tk-info">
        <strong>${esc(ty.name)}</strong>
        ${sub ? `<small>${esc(sub)}</small>` : ""}
      </div>
      <div class="tk-right">
        ${flag}
        <span class="tk-price">${kr(ty.price_ore)} kr</span>
        ${controls}
      </div>
    </div>`;
}

function wireBlock(block, ev) {
  block.querySelectorAll(".tk-qty").forEach((qty) => {
    qty.querySelectorAll("button[data-step]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = qty.dataset.type;
        const step = Number(btn.dataset.step);
        const max = Math.min(Number(qty.dataset.max), Number(qty.dataset.stock));
        const next = Math.min(Math.max((cart.get(id) || 0) + step, 0), max);
        if (next === 0) cart.delete(id); else cart.set(id, next);
        updateTotals();
      });
    });
  });

  block.querySelector("[data-agree]")?.addEventListener("change", updateTotals);
  block.querySelector("[data-checkout]")?.addEventListener("click", () => checkout(block, ev));
}

// Recomputed from scratch on every click, cheap, and it means the buttons,
// the add-on rule and the total can never drift apart.
function updateTotals() {
  document.querySelectorAll(".tk-event").forEach((block) => {
    // A Billetto block has no rows, no total and no pay button. Without this
    // guard the first `querySelector(...).textContent` below threw on null,
    // which aborted boot() before it could reveal the page, so the tickets
    // page sat on "Loading tickets…" forever for exactly the event we are
    // actually selling. Found by rendering the page with a Billetto event.
    if (!block.querySelector("[data-total]")) return;

    const eventId = block.dataset.event;
    let total = 0;
    let entryPicked = 0;
    let addonPicked = 0;

    block.querySelectorAll(".tk-qty").forEach((qty) => {
      const n = cart.get(qty.dataset.type) || 0;
      total += n * Number(qty.dataset.price);
      if (qty.dataset.kind === "entry") entryPicked += n; else addonPicked += n;
    });

    const hasEntry = entryPicked > 0 || ownedEntry.has(eventId);

    block.querySelectorAll(".tk-qty").forEach((qty) => {
      const n = cart.get(qty.dataset.type) || 0;
      const max = Math.min(Number(qty.dataset.max), Number(qty.dataset.stock));
      const blocked = qty.dataset.kind === "addon" && !hasEntry;

      qty.querySelector("[data-count]").textContent = n;
      qty.querySelector('[data-step="-1"]').disabled = n <= 0;
      qty.querySelector('[data-step="1"]').disabled = n >= max || blocked;
      qty.closest(".tk-row")?.classList.toggle("is-picked", n > 0);

      if (blocked && n > 0) { cart.delete(qty.dataset.type); }
    });

    block.querySelector("[data-total]").textContent = `${kr(total)} kr`;

    // The button says what it does and costs. "Fortsätt" or "Slutför" is the
    // classic failure under distansavtalslagen 2 kap 9 §, and the sanction
    // isn't a fine, it's that the buyer was never bound and can walk away.
    const agreed = !!block.querySelector("[data-agree]")?.checked;
    const btn = block.querySelector("[data-checkout]");
    btn.disabled = total === 0 || !agreed;
    btn.textContent = total > 0 ? t("tk.payAmount", { amount: kr(total) }) : t("tk.pay");

    const msg = block.querySelector("[data-msg]");
    if (total > 0 && !agreed) {
      msg.textContent = t("tk.mustAgree");
      msg.className = "form-msg";
    } else if (msg.dataset.hint === "agree") {
      msg.textContent = "";
    }
    msg.dataset.hint = total > 0 && !agreed ? "agree" : "";
  });
}

// ---------------------------------------------------------------------------
// checkout
// ---------------------------------------------------------------------------
async function checkout(block, ev) {
  // Second stop. renderEvents() already refuses to draw a pay button when own
  // sales are off, so this can only be reached from the console, but taking
  // money through a path we have deliberately switched off is exactly the kind
  // of thing that should be impossible rather than merely unlikely.
  if (!OWN_TICKET_SALES) return;

  const btn = block.querySelector("[data-checkout]");
  const msg = block.querySelector("[data-msg]");
  msg.className = "form-msg";
  msg.textContent = "";

  const items = [];
  block.querySelectorAll(".tk-qty").forEach((qty) => {
    const n = cart.get(qty.dataset.type) || 0;
    if (n > 0) items.push({ ticket_type_id: qty.dataset.type, qty: n });
  });
  if (!items.length) return;

  // Analytics bridge: the consent-gated pixel script listens for this and
  // maps it to InitiateCheckout. A dispatch with no listener is free, so
  // this costs nothing for visitors who declined marketing cookies.
  document.dispatchEvent(new CustomEvent("ss:checkout", {
    detail: { name: ev.event_name, qty: items.reduce((a, i) => a + i.qty, 0) },
  }));

  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = t("tk.toStripe");

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.href = "/account.html"; return; }

    const res = await fetch(`${SUPABASE_URL}/functions/v1/tickets`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "checkout", event_id: ev.event_id, items }),
    });
    const out = await res.json();

    if (!res.ok || !out?.url) {
      msg.textContent = out?.error || t("tk.noStart");
      msg.className = "form-msg err";
      btn.disabled = false;
      btn.textContent = label;
      await load();          // stock may have moved under us
      return;
    }

    window.location.href = out.url;
  } catch (err) {
    console.error("checkout failed:", err);
    msg.textContent = t("tk.noServer");
    msg.className = "form-msg err";
    btn.disabled = false;
    btn.textContent = label;
  }
}

// ---------------------------------------------------------------------------
// coming back from Stripe
// ---------------------------------------------------------------------------
async function showOrder(orderId) {
  show("stateDone");

  // The webhook usually beats the redirect, but not always. Poll for a bit
  // rather than telling somebody who has paid that they have no ticket.
  const deadline = Date.now() + 40000;
  let order = null;

  while (Date.now() < deadline) {
    const { data } = await supabase.rpc("my_order", { p_order: orderId });
    order = data;
    if (order?.status === "paid" && (order.tickets?.length ?? 0) > 0) break;
    if (order?.status === "refunded" || order?.status === "cancelled") break;
    await new Promise((r) => setTimeout(r, 1800));
  }

  const body = $("doneBody");

  if (!order) {
    $("doneTitle").textContent = t("tk.notFoundT");
    $("doneSub").textContent = "";
    body.innerHTML = `<p class="ops-empty">${t("tk.notFoundB")}</p>`;
    return;
  }

  $("doneEvent").textContent = order.event_name || "";
  $("doneMeta").textContent = order.starts_at ? fmtWhen(order.starts_at) : "";

  if (order.status !== "paid" || !(order.tickets?.length)) {
    $("doneTitle").textContent = t("tk.stillT");
    $("doneSub").textContent = "";
    body.innerHTML = `<p class="ops-empty">${t("tk.stillB")}</p>`;
    return;
  }

  $("doneTitle").textContent = t("tk.doneT");
  $("doneSub").textContent = t("tk.paid", { n: order.tickets.length, amount: kr(order.total_ore) });

  body.innerHTML = `<div class="tk-cards">${order.tickets.map((tk) => `
    <div class="tk-card">
      <h4>${esc(tk.type_name)}</h4>
      <canvas data-qr="${esc(tk.code)}" width="168" height="168"></canvas>
      <span class="tk-code">${esc(tk.code)}</span>
      <span class="tk-sub">${t("ms.showDoor")}</span>
    </div>`).join("")}</div>`;

  await drawQrs(body);
}

export async function drawQrs(root) {
  const canvases = root.querySelectorAll("canvas[data-qr]");
  if (!canvases.length) return;
  try {
    const QR = (await import("qrcode")).default;
    for (const c of canvases) {
      await QR.toCanvas(c, c.dataset.qr, {
        width: 168, margin: 1, color: { dark: "#0a0b0f", light: "#ffffff" },
      });
    }
  } catch (err) {
    // The code underneath the QR is the real ticket; the door can type it in.
    console.error("QR render failed:", err);
  }
}

// ---------------------------------------------------------------------------
// load
// ---------------------------------------------------------------------------
async function load() {
  const [{ data: onSale }, { data: mine }] = await Promise.all([
    supabase.rpc("tickets_on_sale"),
    supabase.rpc("my_tickets"),
  ]);

  ownedEntry = new Set((mine || []).filter((x) => x.kind === "entry").map((x) => x.event_id));
  renderEvents(onSale || []);
  return onSale || [];
}

// ---------------------------------------------------------------------------
// One click from the front page — account or not.
//
// Every buy-intent link on the site (event card, announcement bar, the
// phone's sticky bar) carries ?buy=1, and when exactly one event is on sale
// and Billetto is selling it, this page forwards straight to Billetto's
// ticket selection WITHOUT asking who you are. Membership stopped being a
// purchase gate by decision (August 2026): it is still free and still
// required to attend — the wall below, the front page and the Billetto
// event description all say "join before the night, with the same email
// you buy with, so the night counts toward your tier" — but it now happens
// around the purchase instead of in front of it.
//
// Module scope and plain fetch on purpose: the forward must not wait for
// the SDK chunk, and it has no use for a session. No forward when several
// events are on sale or our own releases are open (a cart needs choices);
// the nav's plain "Tickets" link carries no ?buy, so browsing to the
// overview still lands on the page.
//
// location.replace, not href: Back must return to the front page, not to
// an instantly re-forwarding tickets page.
// ---------------------------------------------------------------------------
(function fastOpenBilletto() {
  if (new URLSearchParams(location.search).get("buy") !== "1") return;
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
      if (!Array.isArray(events) || events.length !== 1) return;
      const ev = events[0];
      const billettoOnly = ev.billetto_event_id &&
        (!OWN_TICKET_SALES || !(ev.types || []).some((ty) => ty.open));
      if (!billettoOnly) return;

      // Keep the funnel honest on the fast path: the Billetto button this
      // skips is what the pixel would have counted. Best effort — on a fast
      // network the pixel may still be booting, and that is acceptable.
      document.dispatchEvent(new CustomEvent("ss:checkout", {
        detail: { name: ev.name, qty: 1 },
      }));

      // The checkout opens as Billetto's overlay ON this page rather than a
      // redirect: embed.js installs window.$billetto with a manager whose
      // openCheckout() attaches the iframe overlay (read from the script
      // itself — the same call its own click-interceptor makes when someone
      // presses any of our /select links). The page stays underneath, so
      // closing the overlay lands you back on tickets, not on billetto.se.
      const id = `e-${String(ev.billetto_event_id).trim()}`;
      loadBillettoWidget();
      const t0 = Date.now();
      (function tryOpen() {
        const mgr = window.$billetto && window.$billetto.manager;
        if (mgr && typeof mgr.openCheckout === "function") {
          mgr.openCheckout(id, { color: "#ff2a2a", organization: "billetto.se" });
          return;
        }
        if (Date.now() - t0 > 6000) {
          // embed.js never arrived (ad blocker, outage). The old redirect is
          // the fallback, so one click still ends at a checkout either way.
          location.replace(`https://billetto.se/e/${id}/select?color=%23ff2a2a`);
          return;
        }
        setTimeout(tryOpen, 120);
      })();
    })
    .catch(() => { /* fall through to the normal page */ });
})();

async function boot() {
  if (booted) return;
  if (!(await sdkReady)) return;   // never loaded; the message is already on screen
  if (booted) return;              // a second caller got here while we waited
  booted = true;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return show("stateAuth");

  $("buyerEmail").textContent = session.user.email || "";

  const params = new URLSearchParams(window.location.search);
  const status = params.get("status");
  const orderId = params.get("order");

  if (status === "success" && orderId) return showOrder(orderId);

  if (status === "cancelled" && orderId) {
    // Hand the stock back now instead of making the next person wait out the
    // 35-minute hold.
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/tickets`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", order_id: orderId }),
      });
    } catch (e) { /* the hold lapses on its own anyway */ }
    history.replaceState({}, "", "/tickets.html");
  }

  // Staff / admin convenience links
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", session.user.id).single();
  if (profile?.role === "admin") {
    $("navAdmin")?.removeAttribute("hidden");
    $("navStaff")?.removeAttribute("hidden");
  } else {
    const { data: shift } = await supabase.rpc("my_shift");
    if (shift) $("navStaff")?.removeAttribute("hidden");
  }

  await load();
  show("stateBuy");
}

sdkReady.then((ok) => {
  if (!ok) return;
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "INITIAL_SESSION") boot();
    if (event === "SIGNED_OUT") show("stateAuth");
  });
});

// The event blocks are built in JS, so they have to be rebuilt on a switch —
// and so does the signed-out preview, whose once-guard would otherwise hold
// the old language's render.
document.addEventListener("ss:lang", () => {
  if (booted) load();
  authOnSaleDrawn = false;
  if ($("stateAuth") && !$("stateAuth").hidden) renderAuthOnSale();
});
setTimeout(boot, 1200);
