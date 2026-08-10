// ============================================================================
// SLUTSTATION, staff page (door + bar)
//
// Access is per-event and temporary: the server decides, via my_shift().
// Everything here is a convenience layer, staff_check_in / staff_lookup
// re-check the shift and the role on the server, so hiding a button is never
// the thing keeping anyone out.
//
// Staff never read the profiles table. These RPCs return name, membership and
// tier only, no address, phone, birth date or email.
// ============================================================================

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase-config.js";
import { initGlassLight } from "./liquid-glass.js";
import { initI18n, t, getLang } from "./i18n.js";

// Language first: it must survive anything that happens below. This page is
// read on a door at midnight; a blank screen is the worst outcome it has.
initGlassLight();
initI18n();

// The Supabase SDK is BUNDLED — installed from npm and code-split by Vite into
// a chunk served from our own origin, so no third-party CDN sits in this
// page's path any more (it used to load from esm.sh at runtime, which mattered
// most here of anywhere: this page is read on a door at midnight, on whatever
// network the venue has). It stays a DYNAMIC import inside a try/catch on
// purpose: the split chunk keeps first paint light, and a network that dies
// between the page and the chunk still degrades gracefully.
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
  import("@supabase/supabase-js"))
  .then(({ createClient }) => {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return true;
  })
  .catch((err) => {
    console.error("Supabase SDK failed to load:", err);
    const box = document.getElementById("stateLoading");
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

let shift = null;          // { event_id, event_name, venue, role }
let stream = null;         // camera MediaStream
let scanning = false;
let lastCode = null;       // debounce: the same QR sits in frame for many frames
let lastCodeAt = 0;

const QUEUE_KEY = "ss-checkin-queue";

function show(id) {
  ["stateLoading", "stateNoShift", "stateShift"].forEach((s) => {
    const el = $(s); if (el) el.hidden = s !== id;
  });
}

function esc(v) {
  return String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function timeOnly(iso) {
  return new Date(iso).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// Offline queue. Outdoor venues have terrible signal; a failed check-in must
// not mean a lost one. We keep them locally and flush when the network returns.
// ---------------------------------------------------------------------------
const queue = {
  all: () => { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); } catch { return []; } },
  set: (v) => { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(v)); } catch {} },
  add(userId) { const q = this.all(); if (!q.includes(userId)) { q.push(userId); this.set(q); } this.note(); },
  note() {
    const n = this.all().length;
    const el = $("queueNote");
    if (!el) return;
    el.hidden = n === 0;
    el.textContent = n ? `${n} check-in${n === 1 ? "" : "s"} saved offline, they'll send automatically.` : "";
  },
  async flush() {
    const q = this.all();
    if (!q.length) return;
    const left = [];
    for (const id of q) {
      const { error } = await supabase.rpc("staff_check_in", { p_user: id });
      if (error && /fetch|network/i.test(error.message || "")) left.push(id);
    }
    this.set(left);
    this.note();
    if (q.length !== left.length) await loadTonight();
  },
};

window.addEventListener("online", () => queue.flush());

// ---------------------------------------------------------------------------
// Check in
// ---------------------------------------------------------------------------
function renderResult(kind, title, detail) {
  $("scanResult").innerHTML =
    `<div class="scan-result ${kind}"><h4>${esc(title)}</h4><p>${esc(detail)}</p></div>`;
}

// ---------------------------------------------------------------------------
// Tickets. A ticket code is a different thing from a member code: it admits one
// ticket and burns it, and it also counts the person in, so the door never has
// to scan twice.
// ---------------------------------------------------------------------------
const CODE_RE = /^SS-[0-9A-Z]{4}-[0-9A-Z]{4}$/i;

async function redeemTicket(code) {
  const { data, error } = await supabase.rpc("staff_redeem_ticket", { p_code: code });

  if (error) {
    renderResult("bad", t("st.notAdmit"), error.message || t("st.generic"));
    return;
  }
  if (!data?.ok) {
    const kind = data?.reason === "used" ? "warn" : "bad";
    renderResult(kind, data?.name ? `${data.name}, ${data.type_name || t("st.ticketWord")}` : t("st.notAdmit"),
      data?.message || t("st.badTicket"));
    return;
  }

  const extras = (data.other_tickets || []).length
    ? " · " + t("st.alsoHolds", { list: data.other_tickets.join(", ") })
    : "";
  const bits = [data.type_name, `Tier ${data.tier ?? 1}`].filter(Boolean).join(" · ");
  renderResult(
    data.member_ok ? "ok" : "warn",
    t("st.admit", { name: data.name || t("st.holder") }),
    `${bits}${extras}${data.member_ok ? "" : " · " + t("st.notActive")}`,
  );
  await loadTonight();
}

async function checkIn(userId) {
  const { data, error } = await supabase.rpc("staff_check_in", { p_user: userId });

  if (error) {
    if (/fetch|network|failed to fetch/i.test(error.message || "")) {
      queue.add(userId);
      renderResult("warn", t("st.offlineT"), t("st.offlineB"));
      return;
    }
    renderResult("bad", t("st.notIn"), error.message || t("st.generic"));
    return;
  }

  const name = data?.name || t("st.memberWord");
  const bits = [`Tier ${data?.tier ?? 1}`, t("st.nEvents", { n: data?.events ?? 0 })];

  // What have they actually bought for tonight? Saves asking them to dig the
  // ticket out of their email at the door.
  const { data: held } = await supabase.rpc("staff_member_tickets", { p_user: userId });
  if (held?.length) {
    const valid = held.filter((t) => t.status === "valid").map((t) => t.type_name);
    const used  = held.filter((t) => t.status === "used").map((t) => t.type_name);
    if (valid.length) bits.push(t("st.holds", { list: valid.join(", ") }));
    if (used.length)  bits.push(t("st.scannedList", { list: used.join(", ") }));
  } else {
    bits.push(t("st.noTicketHere"));
  }

  if (data?.already_checked_in) {
    renderResult("warn", t("st.alreadyT", { name }), t("st.alreadyB") + " " + bits.join(" · "));
  } else if (!data?.member_ok) {
    renderResult("warn", t("st.lapsedT", { name }), t("st.lapsedB") + " " + bits.join(" · "));
  } else {
    renderResult("ok", t("st.inT", { name }), bits.join(" · "));
  }
  await loadTonight();
}

// ---------------------------------------------------------------------------
// Camera scanning
// ---------------------------------------------------------------------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function startScan() {
  const video = $("scanVideo");
  const msg = $("scanMsg");
  msg.textContent = "";
  msg.className = "form-msg";

  let jsQR;
  try {
    jsQR = (await import("jsqr")).default;
  } catch {
    msg.textContent = t("st.noScanner");
    msg.classList.add("err");
    return;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" }, audio: false,
    });
  } catch (err) {
    msg.textContent = err?.name === "NotAllowedError" ? t("st.camDenied") : t("st.camNone");
    msg.classList.add("err");
    return;
  }

  video.srcObject = stream;
  await video.play();
  scanning = true;
  $("scanStart").hidden = true;
  $("scanStop").hidden = false;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const tick = async () => {
    if (!scanning) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
      if (code?.data) {
        const value = code.data.trim();
        const now = Date.now();
        // the same code stays in frame for ~30 frames; only act once every 3s
        if (value !== lastCode || now - lastCodeAt > 3000) {
          lastCode = value; lastCodeAt = now;
          if (UUID_RE.test(value)) {
            navigator.vibrate?.(60);
            // A member QR is a TIER code now, not an entry code. Attendance is
            // imported from the Billetto export after the night, so scanning
            // somebody here answers "what are they owed?" rather than "are
            // they in?". checkIn() is still used by the manual search below
            // and by door mode.
            await tierScan(value);
          } else if (CODE_RE.test(value)) {
            navigator.vibrate?.(60);
            await redeemTicket(value.toUpperCase());
          } else {
            renderResult("bad", t("st.notOursT"), t("st.notOursB"));
          }
        }
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function stopScan() {
  scanning = false;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  $("scanVideo").srcObject = null;
  $("scanStart").hidden = false;
  $("scanStop").hidden = true;
}

$("scanStart")?.addEventListener("click", startScan);
$("scanStop")?.addEventListener("click", stopScan);
window.addEventListener("pagehide", stopScan);

// Typed-code fallback. Accepts it with or without the dashes and in any case,
// because nobody types carefully at 2am in the rain.
async function submitTypedCode() {
  const input = $("codeInput");
  if (!input) return;
  const raw = input.value.trim().toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (raw.length < 8) {
    renderResult("bad", t("st.shortT"), t("st.shortB"));
    return;
  }
  const body = raw.startsWith("SS") ? raw.slice(2) : raw;
  const code = `SS-${body.slice(0, 4)}-${body.slice(4, 8)}`;
  await redeemTicket(code);
  input.value = "";
}

$("codeBtn")?.addEventListener("click", submitTypedCode);
$("codeInput")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); submitTypedCode(); }
});

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------
let lookupTimer;
$("lookupInput")?.addEventListener("input", (e) => {
  clearTimeout(lookupTimer);
  const q = e.target.value.trim();
  if (q.length < 2) { $("lookupList").innerHTML = ""; return; }
  lookupTimer = setTimeout(() => runLookup(q), 250);
});

async function runLookup(q) {
  const list = $("lookupList");

  // No network: fall straight to the cached copy rather than spending fifteen
  // seconds timing out in front of a queue.
  if (!navigator.onLine) {
    const off = offlineLookup(q);
    if (off) return paintLookup(off, q, true);
    list.innerHTML = `<p class="ops-empty">${esc(t("st.offlineNo"))}</p>`;
    return;
  }

  const { data, error } = await supabase.rpc("staff_lookup", { p_query: q });
  if (error) {
    const off = offlineLookup(q);
    if (off) return paintLookup(off, q, true);
    list.innerHTML = `<p class="ops-empty">${esc(error.message)}</p>`;
    return;
  }
  return paintLookup(data, q, false);
}

function paintLookup(data, q, offline) {
  const list = $("lookupList");
  if (!data?.length) { list.innerHTML = `<p class="ops-empty">${esc(t("st.noMatch"))}</p>`; return; }

  list.innerHTML = (offline ? `<p class="ops-empty">${esc(t("st.offlineUsing"))}</p>` : "") + data.map((m) => `
    <div class="ops-row">
      <div>
        <strong>${esc(m.name || "—")}</strong>
        <small>Tier ${m.tier ?? 1}${m.checked_in ? " · " + esc(t("st.alreadyIn")) : ""}</small>
        ${m.note ? `<small style="display:block;color:var(--accent-soft);">⚑ ${esc(m.note)}</small>` : ""}
      </div>
      <div class="ops-actions">
        <span class="pill ${m.member_ok ? "ok" : "bad"}">${esc(m.member_ok ? t("st.pillMember") : t("st.pillLapsed"))}</span>
        ${shift?.role === "door" && !m.checked_in
          ? `<button class="btn btn-primary btn-sm" data-checkin="${esc(m.user_id)}">${esc(t("st.checkIn"))}</button>` : ""}
      </div>
    </div>`).join("");

  list.querySelectorAll("[data-checkin]").forEach((b) =>
    b.addEventListener("click", async () => {
      b.disabled = true; b.textContent = "…";
      await checkIn(b.dataset.checkin);
      await runLookup(q);
    })
  );
}

// ---------------------------------------------------------------------------
// Report something from the door. Plain insert; RLS pins it to the event on
// shift and to the caller's own id, so nothing here decides anything. If the
// table isn't there yet (phase 18 unapplied) the error message says so and
// the rest of the page is untouched.
// ---------------------------------------------------------------------------
$("reportSend")?.addEventListener("click", async () => {
  const m = $("reportMsg");
  const say = (text, ok) => { m.textContent = text; m.className = "form-msg" + (ok ? " ok" : " err"); };
  const kind = $("reportKind")?.value || "other";
  const note = $("reportNote")?.value.trim() || null;
  if (!shift?.event_id) return say(t("st.reportNoShift"));
  const btn = $("reportSend");
  btn.disabled = true;
  const { error } = await supabase.from("incident_reports").insert({
    event_id: shift.event_id, kind, note,
  });
  btn.disabled = false;
  if (error) return say(t("st.reportFail"));
  $("reportNote").value = "";
  say(t("st.reportOk"), true);
});

// ---------------------------------------------------------------------------
// Tonight's check-ins
// ---------------------------------------------------------------------------
async function loadTonight() {
  if (shift?.role !== "door") return;
  const { data, error } = await supabase.rpc("staff_tonight");
  const list = $("tonightList");
  if (error) { list.innerHTML = `<p class="ops-empty">${esc(error.message)}</p>`; return; }
  if (!data?.length) {
    if ($("doorCount")) $("doorCount").textContent = "0";
    list.innerHTML = `<p class="ops-empty">${esc(t("st.noneYet"))}</p>`;
    return;
  }

  const hud = $("doorCount");
  if (hud) hud.textContent = data.length;

  list.innerHTML = `<p class="ops-empty" style="padding:0 0 6px;">${esc(t("st.nInTonight", { n: data.length }))}</p>` +
    data.map((m) => `
      <div class="ops-row">
        <div><strong>${esc(m.name || "—")}</strong><small>${timeOnly(m.checked_in_at)} · Tier ${m.tier ?? 1}</small></div>
        <button class="acc-link" data-undo="${esc(m.user_id)}">${esc(t("st.undo"))}</button>
      </div>`).join("");

  list.querySelectorAll("[data-undo]").forEach((b) =>
    b.addEventListener("click", async () => {
      b.disabled = true;
      const { error: e } = await supabase.rpc("staff_undo_check_in", { p_user: b.dataset.undo });
      if (e) alert(e.message);
      await loadTonight();
    })
  );
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
$("signoutBtn")?.addEventListener("click", async () => {
  stopScan();
  clearRoster();
  await supabase?.auth.signOut();
  window.location.href = "/account.html";
});

async function boot() {
  // The SDK arrives on its own schedule. Waiting for it HERE rather than at
  // the top of the file is the whole point: the page is interactive while
  // this is still in flight. `false` means it never came and the message is
  // already on screen.
  if (!(await sdkReady)) return;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "/account.html"; return; }

  const [{ data: shiftData }, { data: profile }] = await Promise.all([
    supabase.rpc("my_shift"),
    supabase.from("profiles").select("role").eq("id", session.user.id).single(),
  ]);

  if (profile?.role === "admin") $("navAdmin")?.removeAttribute("hidden");

  if (!shiftData) { show("stateNoShift"); showUpcomingShifts(); return; }
  shift = shiftData;

  $("shiftEvent").textContent = shift.event_name || t("st.tonight");
  const doorsAt = new Date(shift.starts_at)
    .toLocaleString(getLang() === "sv" ? "sv-SE" : "en-GB",
      { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  $("shiftMeta").innerHTML =
    `${esc(shift.venue || "")}${shift.venue ? " · " : ""}${esc(t("st.doors"))} <b>${esc(doorsAt)}</b>`;
  $("shiftRole").textContent = shift.role === "door" ? t("st.roleDoor") : t("st.roleBar");

  if (shift.role === "door") {
    $("doorPanel").hidden = false;
    $("tonightPanel").hidden = false;
    $("doorMode").hidden = false;
    noteRoster();
    await loadTonight();
    queue.note();
    queue.flush();
    let saved = false;
    try { saved = localStorage.getItem(DOOR_KEY) === "1"; } catch {}
    if (saved) setDoorMode(true);
    holdScreenAwake();
  } else {
    $("lookupHint").textContent = t("st.findLBar");
  }

  show("stateShift");
}

boot();


// ---------------------------------------------------------------------------
// DOOR MODE
//
// The ordinary page is designed for reading. This one is designed for someone
// standing outside in the dark, holding a phone in one hand, with a queue in
// front of them. Big result, big colour, everything else out of the way, and a
// running count so you know what is inside without opening anything.
//
// It is a body class and nothing more: the same scanner, the same RPCs, the
// same result markup. Nothing here can change who gets in.
// ---------------------------------------------------------------------------
const DOOR_KEY = "ss-door-mode";

function setDoorMode(on) {
  document.body.classList.toggle("door-mode", on);
  const hud = $("doorHud");
  if (hud) hud.hidden = !on;
  try { on ? localStorage.setItem(DOOR_KEY, "1") : localStorage.removeItem(DOOR_KEY); } catch {}
  // The count is only meaningful for door staff, and loadTonight already
  // refuses for anyone else.
  if (on) loadTonight();
}

$("doorMode")?.addEventListener("click", () => setDoorMode(true));
$("doorExit")?.addEventListener("click", () => setDoorMode(false));

// Keep the screen awake while the door is open. Politely optional: Safari and
// Firefox on iOS do not have this and the page works fine without it.
let wakeLock = null;
async function holdScreenAwake() {
  try {
    if (!navigator.wakeLock) return;
    wakeLock = await navigator.wakeLock.request("screen");
    document.addEventListener("visibilitychange", async () => {
      if (document.visibilityState === "visible" && document.body.classList.contains("door-mode")) {
        try { wakeLock = await navigator.wakeLock.request("screen"); } catch {}
      }
    });
  } catch { /* denied or unsupported, not worth telling anyone about */ }
}

// ---------------------------------------------------------------------------
// NOT ON SHIFT, BUT ON THE ROSTER
//
// "You're not on shift" was the whole answer, which is true and unhelpful: the
// question underneath it is "when am I". my_shift() only returns the tag that
// is live right now; my_shifts() returns all of them, so the page can say
// which night and how long.
// ---------------------------------------------------------------------------
function untilText(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return t("shift.now");
  const mins = Math.floor(ms / 60000);
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  if (d > 0) return t("shift.inDH", { d, h });
  if (h > 0) return t("shift.inHM", { h, m });
  return t("shift.inM", { m: Math.max(m, 1) });
}

async function showUpcomingShifts() {
  const host = $("upcomingShifts");
  if (!host) return;

  const { data } = await supabase.rpc("my_shifts");
  const soon = (data || []).filter((s) => new Date(s.access_until).getTime() > Date.now());
  if (!soon.length) return;

  host.hidden = false;
  const paint = () => {
    host.innerHTML = soon.map((sh) => {
      const role = sh.staff_role === "door" ? t("st.roleDoor") : t("st.roleBar");
      return `<div class="shift-row">
        <div class="shift-when">
          <span class="shift-tag ${esc(sh.staff_role)}">${esc(role)}</span>
          <span class="shift-count">${esc(untilText(sh.starts_at))}</span>
        </div>
        <div class="shift-what">
          <strong>${esc(sh.name)}</strong>
          <small>${esc(new Date(sh.starts_at).toLocaleString(getLang() === "sv" ? "sv-SE" : "en-GB",
            { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }))}${
            sh.venue ? " · " + esc(sh.venue) : ""}</small>
          ${sh.info ? `<p class="shift-info">${esc(sh.info)}</p>` : ""}
        </div>
        <span class="shift-opens">${esc(t("shift.opens", {
          time: new Date(sh.access_from).toLocaleString(getLang() === "sv" ? "sv-SE" : "en-GB",
            { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) }))}</span>
      </div>`;
    }).join("");
  };
  paint();
  setInterval(paint, 60000);
}

// ---------------------------------------------------------------------------
// SEARCHING WITH NO SIGNAL
//
// Check-ins already queue offline and send themselves when the network comes
// back. The lookup did not: it needed the server, so the moment the signal
// dropped, the fallback for a cracked screen or a dead phone stopped working,
// which is exactly when it is wanted. A forest is the worst case and the one
// coming up.
//
// Downloading is an explicit press, not automatic, because the list is every
// member's name on a volunteer's phone. It is scoped to the event on shift,
// carries nothing staff cannot already see one row at a time (name, tier,
// membership), and is thrown away when the shift ends or anyone signs out.
// ---------------------------------------------------------------------------
const ROSTER_KEY = "ss-door-roster";

function readRoster() {
  try {
    const raw = JSON.parse(localStorage.getItem(ROSTER_KEY) || "null");
    if (!raw || raw.event !== shift?.event_id) return null;
    if (Date.parse(raw.expires) < Date.now()) { clearRoster(); return null; }
    return raw;
  } catch { return null; }
}

function clearRoster() { try { localStorage.removeItem(ROSTER_KEY); } catch {} }

function noteRoster() {
  const el = $("offlineNote");
  if (!el) return;
  const r = readRoster();
  el.textContent = r ? t("st.offlineHave", { n: r.rows.length }) : t("st.offlineNone");
}

$("offlineGet")?.addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  const was = btn.textContent;
  btn.textContent = t("st.offlineGetting");

  const { data, error } = await supabase.rpc("staff_roster");
  btn.textContent = was; btn.disabled = false;

  if (error) {
    // Either the function was never applied, or this phone is not on the door.
    // Both mean the same thing here: carry on, online search still works.
    $("offlineNote").textContent = t("st.offlineNo");
    return;
  }
  try {
    localStorage.setItem(ROSTER_KEY, JSON.stringify({
      event: shift?.event_id,
      expires: shift?.starts_at
        ? new Date(Date.parse(shift.starts_at) + 20 * 3600 * 1000).toISOString()
        : new Date(Date.now() + 20 * 3600 * 1000).toISOString(),
      rows: data || [],
    }));
  } catch {
    // Storage full or blocked. Not worth an error: the online path is intact.
  }
  noteRoster();
});

// Searching the cached copy. Same shape as runLookup's output so the row
// actions behave identically, minus the check-in button: writing while offline
// is what the queue is for, and it needs a real user id, which we have.
function offlineLookup(q) {
  const r = readRoster();
  if (!r) return null;
  const needle = q.toLowerCase();
  return r.rows.filter((m) => (m.name || "").toLowerCase().includes(needle)).slice(0, 25);
}

// ---------------------------------------------------------------------------
// THE TIER SCAN — what this person is owed, and what they have already taken
//
// The whole point of showing the claimed state is that nobody has to be told
// "no" twice. A second scan says when the first one was, so the answer at the
// bar is "you got that at 23:40" rather than an argument.
//
// Tiers cannot move during a night — attendance goes in from the export
// afterwards — so what this screen says at 22:00 it still says at 03:00.
// ---------------------------------------------------------------------------
const PERK_LABEL = { wardrobe: "st.giveWardrobe", drink: "st.giveDrink" };

function perkRow(userId, p, tier) {
  const label = t(PERK_LABEL[p.perk] || p.perk);
  const when = p.claimed_at
    ? new Date(p.claimed_at).toLocaleTimeString(getLang() === "sv" ? "sv-SE" : "en-GB",
        { hour: "2-digit", minute: "2-digit" })
    : "";
  if (!p.entitled) {
    return `<div class="perk-row is-off"><span>${esc(label)}</span>
              <small>${esc(t("st.perkNotFor", { tier }))}</small></div>`;
  }
  if (p.claimed) {
    return `<div class="perk-row is-used"><span>${esc(label)}</span>
              <small>${esc(t("st.perkAlready", { time: when }))}</small>
              <button class="btn btn-ghost btn-sm" data-unperk="${esc(p.perk)}"
                      data-user="${esc(userId)}">${esc(t("st.perkUndo"))}</button></div>`;
  }
  return `<div class="perk-row"><span>${esc(label)}</span>
            <button class="btn btn-primary btn-sm" data-perk="${esc(p.perk)}"
                    data-user="${esc(userId)}">${esc(t("st.perkDone"))}</button></div>`;
}

async function tierScan(userId) {
  const { data, error } = await supabase.rpc("staff_tier_scan", { p_user: userId });
  if (error) {
    renderResult("bad", t("st.notIn"), error.message || t("st.generic"));
    return;
  }

  const tier = data?.tier ?? 1;
  const perks = data?.perks || [];
  const usable = perks.filter((p) => p.entitled);
  // Green when there is something to hand over and it is still unclaimed;
  // amber when everything they are owed has already gone. At arm's length on a
  // dark door the colour is read before the words are.
  const kind = !usable.length ? "warn"
    : usable.every((p) => p.claimed) ? "warn" : "ok";

  $("scanResult").innerHTML =
    `<div class="scan-result ${kind}">
       <h4>${esc(data?.name || t("st.memberWord"))} · ${esc(t("st.tierWord"))} ${tier}</h4>
       ${data?.member_ok === false ? `<p>${esc(t("st.notMember"))}</p>` : ""}
       ${usable.length
         ? `<div class="perk-rows">${perks.map((p) => perkRow(userId, p, tier)).join("")}</div>`
         : `<p>${esc(t("st.perkNothing"))}</p>`}
     </div>`;

  $("scanResult").querySelectorAll("[data-perk]").forEach((b) =>
    b.addEventListener("click", async () => {
      b.disabled = true; b.textContent = "…";
      const { error: e } = await supabase.rpc("staff_claim_perk",
        { p_user: b.dataset.user, p_perk: b.dataset.perk });
      if (e) renderResult("bad", t("st.notIn"), e.message);
      else { navigator.vibrate?.(30); await tierScan(b.dataset.user); }
    })
  );
  $("scanResult").querySelectorAll("[data-unperk]").forEach((b) =>
    b.addEventListener("click", async () => {
      b.disabled = true;
      await supabase.rpc("staff_unclaim_perk",
        { p_user: b.dataset.user, p_perk: b.dataset.unperk });
      await tierScan(b.dataset.user);
    })
  );
}
