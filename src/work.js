// ============================================================================
// SLUTSTATION, work with us
//
// Two applications, one page. Both attach to the signed-in account, which is
// why the page asks you to sign in first: we already hold the name, the phone
// number and the address, and asking again would be both rude and a second
// copy of the same personal data to look after.
//
// Nothing here decides anything. Both forms write a row with status 'pending'
// and RLS pins it there — the insert policy has `status = 'pending'` in its
// WITH CHECK, so a member cannot approve themselves however they call it.
// ============================================================================

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase-config.js";
import { initI18n, t, getLang } from "./i18n.js";
import { initGlassLight } from "./liquid-glass.js";

// Language first: it must survive anything that happens below.
initGlassLight();
initI18n();

// The Supabase SDK is imported DYNAMICALLY, inside a try/catch, on purpose.
// An ES module is all-or-nothing: a static `import` from a CDN that fails
// (outage, ad blocker, hotel wifi portal, a phone on a filtered network) stops
// the whole module from ever executing — so the language switch, the menu and
// every static part of the page die with it, silently, with nothing on screen
// to say why. account.js and tickets.js were already written this way; these
// two pages were newer and were not, which is how they got missed.
//
// Timed out rather than simply awaited: a request that is accepted and never
// answered never rejects, so the catch would never fire and the page would
// spin forever.
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
    const box = document.getElementById("workLoading");
    if (box) {
      box.hidden = false;
      box.innerHTML =
        `<div class="form-shell acc-narrow" style="text-align:center;">
           <p style="color:var(--muted);">${t("err.sdkOffline")}</p>
         </div>`;
    }
    return false;
  });

const $ = (id) => document.getElementById(id);

const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// The hamburger. Every other page binds this in its own entry file; work.js
// was new and did not, so the menu on this page never opened at all.
const nav = document.getElementById("nav");
document.getElementById("navToggle")?.addEventListener("click", () => nav?.classList.toggle("open"));

function show(id) {
  ["workLoading", "workAuth", "workMain"].forEach((s) => {
    const el = $(s); if (el) el.hidden = s !== id;
  });
}

function setMsg(el, text, kind = "err") {
  if (!el) return;
  el.textContent = text || "";
  el.className = "form-msg" + (text ? ` ${kind}` : "");
}

function busy(form, on, label) {
  const btn = form?.querySelector('button[type="submit"]');
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.disabled = true; btn.textContent = label; }
  else { btn.disabled = false; btn.textContent = btn.dataset.label || btn.textContent; }
}

const fmtDay = (iso) => iso
  ? new Date(iso).toLocaleDateString(getLang() === "sv" ? "sv-SE" : "en-GB",
      { day: "numeric", month: "long", year: "numeric" })
  : "";

// ---------------------------------------------------------------------------
// Picking which one you are
//
// Both forms are long. Stacked, the second was something you found by
// scrolling past the first, which is a bad way to present a choice between two
// things. Now both sit above the fold as a pair and neither opens until you
// have picked one.
//
// One at a time on purpose: opening the second closes the first, so the page
// never has two long forms and two submit buttons on screen at once.
// ---------------------------------------------------------------------------
let openWhich = null;

function openCard(which) {
  openWhich = which;
  const cards = { vol: $("volCard"), cre: $("creCard") };
  for (const [key, el] of Object.entries(cards)) {
    if (el) el.hidden = key !== which;
  }
  document.querySelectorAll("[data-open]").forEach((b) => {
    const on = b.dataset.open === which;
    b.classList.toggle("is-open", on);
    b.setAttribute("aria-selected", String(on));
  });

  // Scroll only when the choice was made low down the page; on a desktop the
  // form is already visible and moving the page under someone is rude.
  const card = cards[which];
  if (card && card.getBoundingClientRect().top > window.innerHeight - 120) {
    card.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

document.querySelectorAll("[data-open]").forEach((b) =>
  b.addEventListener("click", () => openCard(b.dataset.open))
);

// ---------------------------------------------------------------------------
// Where an application has got to.
//
// Shown above the form rather than instead of it, because somebody whose
// application was turned down should be able to read what they wrote and send
// a better one, not hit a wall.
// ---------------------------------------------------------------------------
function renderStatus(kind, app) {
  const box = $(kind === "volunteer" ? "volStatus" : "creStatus");
  const form = $(kind === "volunteer" ? "volForm" : "creForm");
  if (!box) return;

  if (!app) { box.hidden = true; return; }
  box.hidden = false;

  const when = fmtDay(app.submitted_at);
  const map = {
    pending:  { cls: "is-pending",  title: t("work.stPendingT"),  body: t("work.stPendingB", { date: when }) },
    approved: { cls: "is-approved", title: t("work.stApprovedT"), body: t("work.stApprovedB") },
    rejected: { cls: "is-rejected", title: t("work.stRejectedT"), body: t("work.stRejectedB") },
  };
  const s = map[app.status] || map.pending;

  box.className = "work-status " + s.cls;
  box.innerHTML = `<strong>${esc(s.title)}</strong><p>${esc(s.body)}</p>${
    app.note ? `<p class="work-note">${esc(app.note)}</p>` : ""}`;

  // An approved application is done; there is nothing useful left to send.
  if (form && app.status === "approved") form.hidden = true;
}

// ---------------------------------------------------------------------------
// Submitting
//
// upsert on (user_id, kind) so a second send replaces the first rather than
// filling the admin queue with three copies of the same person. Re-applying
// after a rejection is deliberately allowed, and resets the row to pending.
// ---------------------------------------------------------------------------
async function submitApplication(kind, payload, form, msgEl) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { setMsg(msgEl, t("work.needSignin")); return false; }

  const { error } = await supabase.from("applications").upsert({
    user_id: user.id, kind, payload, status: "pending",
    submitted_at: new Date().toISOString(),
    reviewed_at: null, reviewed_by: null, admin_note: null,
  }, { onConflict: "user_id,kind" });

  if (error) { setMsg(msgEl, error.message); return false; }
  return true;
}

$("volForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const msg = $("volMsg");
  setMsg(msg, "");

  const jobs = [...form.querySelectorAll('input[name="jobs"]:checked')].map((c) => c.value);
  if (!jobs.length) return setMsg(msg, t("work.pickJob"));
  if (!$("volOk").checked) return setMsg(msg, t("work.tickAgree"));

  busy(form, true, t("ui.sending"));
  const ok = await submitApplication("volunteer", {
    jobs,
    frequency: $("volHow").value,
    time: $("volTime").value,
    experience: $("volExp").value.trim(),
    training: $("volTraining").value.trim(),
    note: $("volNote").value.trim(),
  }, form, msg);
  busy(form, false);

  if (ok) { setMsg(msg, t("work.sent"), "ok"); await load(); }
});

$("creForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const msg = $("creMsg");
  setMsg(msg, "");

  const channels = {
    instagram: { handle: $("creIg").value.trim(), followers: Number($("creIgN").value) || null },
    tiktok:    { handle: $("creTt").value.trim(), followers: Number($("creTtN").value) || null },
    youtube:   { handle: $("creYt").value.trim(), followers: Number($("creYtN").value) || null },
    other:     { handle: $("creOther").value.trim(), followers: null },
  };
  // At least one channel, otherwise there is nothing to assess.
  if (!Object.values(channels).some((c) => c.handle)) return setMsg(msg, t("work.needChannel"));
  if (!$("creOk").checked) return setMsg(msg, t("work.tickAgree"));

  busy(form, true, t("ui.sending"));
  const ok = await submitApplication("creator", {
    kind: $("creKind").value,
    wanted_code: $("creWanted").value.trim().toUpperCase().replace(/[^A-Z0-9]/g, ""),
    channels,
    audience: $("creAudience").value.trim(),
    plan: $("crePlan").value.trim(),
  }, form, msg);
  busy(form, false);

  if (ok) { setMsg(msg, t("work.sent"), "ok"); await load(); }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function load() {
  // The SDK arrives on its own schedule. Waiting for it HERE rather than at
  // the top of the file is the whole point: the page is interactive while
  // this is still in flight. `false` means it never came and the message is
  // already on screen.
  if (!(await sdkReady)) return;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return show("workAuth");

  const [{ data: roles }, { data: profile }] = await Promise.all([
    supabase.rpc("my_roles"),
    supabase.from("profiles").select("role").eq("id", session.user.id).maybeSingle(),
  ]);

  if (profile?.role === "admin") {
    $("navAdmin")?.removeAttribute("hidden");
    $("navStaff")?.removeAttribute("hidden");
  }

  const apps = roles?.applications || [];
  const vol = apps.find((a) => a.kind === "volunteer");
  const cre = apps.find((a) => a.kind === "creator");
  renderStatus("volunteer", vol);
  renderStatus("creator", cre);

  show("workMain");

  // load() runs again after a submit, and closing the card somebody has just
  // sent from would take their confirmation off the screen with it. Whatever
  // was open stays open.
  if (openWhich) return openCard(openWhich);

  // Otherwise: somebody who has already applied is here to check on it, so
  // open theirs. Somebody with neither gets the choice, closed, which is the
  // whole point of the picker.
  if (vol && !cre) openCard("vol");
  else if (cre && !vol) openCard("cre");
}

sdkReady.then((ok) => {
  if (!ok) return;
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") show("workAuth");
  });
});

load();
