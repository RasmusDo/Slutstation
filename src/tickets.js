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
import { initGlassLight } from "./liquid-glass.js";

const $ = (id) => document.getElementById(id);

// Language first: it must survive anything that happens below.
initI18n(".nav-cta");
initGlassLight();

// The Supabase SDK is imported DYNAMICALLY, inside a try/catch, on purpose.
// An ES module is all-or-nothing: a static `import` from a CDN that fails
// (outage, ad blocker, hotel wifi portal) stops the whole module from ever
// executing, taking the language switch and every static bit of the page with
// it. Found by rendering the built page with the network blocked. This way a
// CDN failure degrades to "the dynamic parts are down" instead of a dead page.
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
  import("https://esm.sh/@supabase/supabase-js@2.45.4"))
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
  try {
    if (localStorage.getItem("ss-announce") === "off") document.body.classList.add("no-announce");
  } catch (e) {}
  $("announceX")?.addEventListener("click", () => {
    document.body.classList.add("no-announce");
    try { localStorage.setItem("ss-announce", "off"); } catch (e) {}
  });
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
    const QR = (await import("https://esm.sh/qrcode@1.5.4")).default;
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
}

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

// The event blocks are built in JS, so they have to be rebuilt on a switch.
document.addEventListener("ss:lang", () => { if (booted) load(); });
setTimeout(boot, 1200);
