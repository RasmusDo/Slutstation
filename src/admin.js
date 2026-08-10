// ============================================================================
// SLUTSTATION, admin panel
//
// Every RPC this page calls checks is_admin() on the server and raises
// "Not authorised" otherwise, so the page is convenience, not security. If a
// non-admin loads it they see the denied card and every call would fail anyway.
//
// Note: an admin cannot change their own account tag. That's deliberate, it
// stops a single compromised admin session from quietly rearranging itself,
// and it means you can't lock yourself out by accident.
// ============================================================================

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase-config.js";
import { initGlassLight } from "./liquid-glass.js";
initGlassLight();

// Dynamic, timed out, and caught — the same shape as the other four pages.
// The SDK is bundled from npm now (a Vite code-split chunk from our own
// origin, no esm.sh in the path); the guard stays because a network that dies
// between the page and the chunk still deserves a message rather than a blank
// panel. (This one stays in English on purpose, like the rest of the panel.)
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
           <p style="color:var(--muted);">Couldn't load the panel, check your connection and reload.</p>
         </div>`;
    }
    return false;
  });

const $ = (id) => document.getElementById(id);

let me = null;
let events = [];
let userOffset = 0;
let userQuery = "";
let selectedUser = null;

const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtDay = (iso) => iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
const fmtDT = (iso) => iso ? new Date(iso).toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
const kr = (ore) => (Number(ore || 0) / 100).toFixed(0) + " kr";

function show(id) {
  ["stateLoading", "stateDenied", "stateMfa", "stateAdmin"].forEach((s) => {
    const el = $(s); if (el) el.hidden = s !== id;
  });
}
function kpi(label, value) { return `<div class="kpi"><b>${esc(value)}</b><small>${esc(label)}</small></div>`; }
function msg(el, text, kind = "err") { el.textContent = text || ""; el.className = "form-msg" + (text ? ` ${kind}` : ""); }

// ---------------------------------------------------------------------------
// tabs
// ---------------------------------------------------------------------------
document.querySelectorAll("[data-panel]").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("[data-panel]").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    document.querySelectorAll(".admin-panel").forEach((p) => (p.hidden = true));
    $("panel-" + tab.dataset.panel).hidden = false;
    // The crew view is time-sensitive: who is on shift right now changes while
    // the page is open, so it re-reads on every visit rather than at boot only.
    if (tab.dataset.panel === "crew") loadCrew();
    if (tab.dataset.panel === "apply") loadApplications();
    if (tab.dataset.panel === "stats") loadStats();
  });
});

// ---------------------------------------------------------------------------
// OVERVIEW
// ---------------------------------------------------------------------------
async function loadOverview() {
  const { data, error } = await supabase.rpc("admin_overview");
  if (error || !data) return;

  $("kpiAccounts").innerHTML =
    kpi("total accounts", data.accounts_total) +
    kpi("active members", data.members_active) +
    kpi("expired", data.members_expired) +
    kpi("never registered", data.members_unverified) +
    kpi("signups, 30 days", data.signups_30d) +
    kpi("admins", data.admins) +
    kpi("opted in to email", data.marketing_opt_in) +
    kpi("avg events / member", data.avg_events_per_member);

  $("kpiEvents").innerHTML =
    kpi("events", data.events_total) +
    kpi("upcoming", data.events_upcoming) +
    kpi("check-ins all time", data.checkins_total);

  const tiers = data.tier_counts || {};
  const total = Object.values(tiers).reduce((a, b) => a + Number(b), 0) || 1;
  $("tierSpread").innerHTML = [1, 2, 3, 4].map((t) => {
    const n = Number(tiers["tier_" + t] || 0);
    return `<div class="ops-row">
      <div><strong>Tier ${t}</strong><small>${n} member${n === 1 ? "" : "s"}</small></div>
      <div style="flex:1;max-width:260px;">
        <div class="tier-bar"><span style="width:${((n / total) * 100).toFixed(1)}%"></span></div>
      </div>
      <span class="pill">${((n / total) * 100).toFixed(0)}%</span>
    </div>`;
  }).join("");
}

// ---------------------------------------------------------------------------
// THE TICKET FLOAT
//
// Every ticket platform pays the organiser after the doors, not before, and
// that is not an accounting quirk, it is what stops a cancellation turning
// into an insolvency. Selling direct hands you the money up to a year early,
// so this panel keeps the distinction visible by hand.
// ---------------------------------------------------------------------------
async function loadFloat() {
  const host = $("kpiFloat");
  if (!host) return;

  const { data, error } = await supabase.rpc("admin_ticket_float");
  if (error || !data) { host.innerHTML = ""; return; }

  host.innerHTML =
    kpi("held for events not yet held", kr(data.unearned_ore)) +
    kpi("tickets outstanding", data.unearned_tickets ?? 0) +
    kpi("earned (events have happened)", kr(data.earned_ore)) +
    kpi("refunded to date", kr(data.refunded_ore));

  const rows = data.by_event || [];
  $("floatByEvent").innerHTML = rows.length
    ? rows.map((e) => `<div class="ops-row">
        <div><strong>${esc(e.name)}</strong><small>${fmtDT(e.starts_at)} · ${e.orders} order${e.orders === 1 ? "" : "s"}</small></div>
        <div class="ops-actions">
          <span class="pill">${e.days_away} day${e.days_away === 1 ? "" : "s"} away</span>
          <span class="pill ${e.days_away > 60 ? "bad" : ""}">${kr(e.held_ore)} held</span>
        </div>
      </div>`).join("")
    : `<p class="ops-empty">Nothing held, no paid tickets for a future event.</p>`;
}

// ---------------------------------------------------------------------------
// MEMBERS
// ---------------------------------------------------------------------------
// Kept so the CSV export ships what is on screen rather than firing another
// query: what you exported is what you looked at.
let loadedUsers = [];

async function loadUsers(reset = true) {
  if (reset) { userOffset = 0; loadedUsers = []; $("userList").innerHTML = ""; }
  const { data, error } = await supabase.rpc("admin_users", {
    p_search: userQuery, p_limit: 25, p_offset: userOffset,
  });
  if (error) { msg($("userMsg"), error.message); return; }
  if (!data?.length && reset) { $("userList").innerHTML = `<p class="ops-empty">No members yet.</p>`; return; }

  $("userList").insertAdjacentHTML("beforeend", data.map((u) => `
    <div class="ops-row" data-user="${esc(u.user_id)}" style="cursor:pointer;">
      <div>
        <strong>${esc(u.name || u.email)}</strong>
        <small>${esc(u.email)} · joined ${fmtDay(u.created_at)}</small>
      </div>
      <div class="ops-actions">
        <span class="pill">Tier ${u.tier ?? 1}</span>
        <span class="pill">${u.events_total ?? 0} events</span>
        <span class="pill ${u.member_ok ? "ok" : "bad"}">${u.member_ok ? "member" : esc(u.ebas_status)}</span>
        ${u.role === "admin" ? `<span class="pill ok">admin</span>` : ""}
      </div>
    </div>`).join(""));

  loadedUsers = loadedUsers.concat(data);
  userOffset += data.length;
  $("userMore").hidden = data.length < 25;

  $("userList").querySelectorAll("[data-user]").forEach((row) => {
    if (row.dataset.bound) return;
    row.dataset.bound = "1";
    row.addEventListener("click", () => openUser(row.dataset.user));
  });
}

let searchTimer;
$("userSearch")?.addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  userQuery = e.target.value.trim();
  searchTimer = setTimeout(() => loadUsers(true), 250);
});
$("userMore")?.addEventListener("click", () => loadUsers(false));

async function openUser(id) {
  selectedUser = id;
  const { data, error } = await supabase.rpc("admin_user_detail", { p_user: id });
  if (error) { msg($("userMsg"), error.message); return; }

  const p = data.profile || {}, s = data.stats || {};
  $("userDetail").hidden = false;
  $("detailName").textContent = [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email;
  $("detailMeta").innerHTML =
    `${esc(p.email)} · ${esc(p.phone || "no phone")} · ${esc(p.city || "—")} · joined ${fmtDay(p.created_at)}
     · membership <b>${esc(p.ebas_status)}</b>${p.ebas_renewed_on ? ` (renewed ${fmtDay(p.ebas_renewed_on)})` : ""}`;

  $("detailStats").innerHTML =
    kpi("tier", s.tier ?? 1) +
    kpi("events, 24 months", s.events_window ?? 0) +
    kpi("events all time", s.events_total ?? 0) +
    kpi("to next tier", s.events_to_next_tier ?? "—") +
    kpi("first event", fmtDay(s.first_attended_at)) +
    kpi("last event", fmtDay(s.last_attended_at)) +
    kpi("banked credit", kr(s.credit_ore)) +
    kpi("email opt-in", p.marketing_consent ? "yes" : "no");

  const isSelf = p.id === me.id;
  $("detailRole").innerHTML = isSelf
    ? `<span class="pill">${esc(p.role)}</span><span class="ops-empty" style="padding:0 0 0 10px;">You can't change your own tag.</span>`
    : p.role === "admin"
      ? `<span class="pill ok">admin</span><button class="btn btn-ghost btn-sm" data-role="member">Remove admin</button>`
      : `<span class="pill">member</span><button class="btn btn-ghost btn-sm" data-role="admin">Make admin</button>`;

  $("detailRole").querySelectorAll("[data-role]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm(`Set this account to "${b.dataset.role}"?`)) return;
      b.disabled = true;
      const { error: e } = await supabase.rpc("admin_set_role", { p_user: id, p_role: b.dataset.role });
      if (e) alert(e.message); else { await openUser(id); await loadUsers(true); }
    })
  );

  $("detailShifts").innerHTML = data.shifts?.length
    ? data.shifts.map((sh) => `<div class="ops-row">
        <div><strong>${esc(sh.name)}</strong><small>${fmtDT(sh.starts_at)}</small></div>
        <div class="ops-actions">
          <span class="pill">${esc(sh.staff_role)}</span>
          <button class="acc-link" data-revoke="${esc(sh.event_id)}">Remove</button>
        </div></div>`).join("")
    : `<p class="ops-empty">Hasn't worked an event.</p>`;

  $("detailShifts").querySelectorAll("[data-revoke]").forEach((b) =>
    b.addEventListener("click", async () => {
      b.disabled = true;
      const { error: e } = await supabase.rpc("admin_revoke_staff", { p_event: b.dataset.revoke, p_user: id });
      if (e) alert(e.message); else await openUser(id);
    })
  );

  $("detailAttendance").innerHTML = data.attendance?.length
    ? data.attendance.map((a) => `<div class="ops-row">
        <div><strong>${esc(a.name)}</strong><small>${esc(a.venue || "")}${a.venue ? " · " : ""}${fmtDT(a.checked_in_at)}</small></div>
        <span class="pill">${esc(a.source)}</span></div>`).join("")
    : `<p class="ops-empty">Hasn't been to an event yet.</p>`;

  renderTimeline(id);
  renderDoorNote(id);

  $("userDetail").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------------------------------------------------------------------------
// DOOR NOTE — one per member, admin-written, staff-read on shift (phase 18).
// ---------------------------------------------------------------------------
async function renderDoorNote(userId) {
  const box = $("doorNote");
  if (!box) return;
  box.value = "";
  const { data, error } = await supabase.from("profile_notes")
    .select("note, written_at").eq("user_id", userId).maybeSingle();
  if (error) { msg($("doorNoteMsg"), "Notes need schema-phase18 applied."); return; }
  msg($("doorNoteMsg"), data?.written_at ? `Written ${fmtDay(data.written_at)}.` : "", "ok");
  if (data?.note) box.value = data.note;
}

$("doorNoteSave")?.addEventListener("click", async () => {
  if (!selectedUser) return;
  const note = $("doorNote")?.value.trim();
  if (!note) return msg($("doorNoteMsg"), "Nothing to save — use Clear to remove a note.");
  const { error } = await supabase.from("profile_notes").upsert({
    user_id: selectedUser, note, written_by: me?.id, written_at: new Date().toISOString(),
  });
  msg($("doorNoteMsg"), error ? error.message : "Saved. Door staff see it on their next lookup.", error ? "err" : "ok");
});

$("doorNoteClear")?.addEventListener("click", async () => {
  if (!selectedUser) return;
  const { error } = await supabase.from("profile_notes").delete().eq("user_id", selectedUser);
  if ($("doorNote")) $("doorNote").value = "";
  msg($("doorNoteMsg"), error ? error.message : "Cleared.", error ? "err" : "ok");
});

// ---------------------------------------------------------------------------
// MEMBER TIMELINE
//
// Fetched separately from admin_user_detail: that one runs on every row click
// and this is only worth the query once somebody is actually looking at a
// person. Failure here leaves the rest of the detail panel intact.
// ---------------------------------------------------------------------------
const TL = {
  joined:   { icon: "◇", label: () => "Created an account" },
  approved: { icon: "✓", label: () => "Membership approved" },
  attended: { icon: "●", label: (e) => `Came to ${e.event_name || "an event"}` },
  tier_up:  { icon: "▲", label: (e) => `Reached Tier ${e.tier}` },
  referral_qualified: { icon: "◈", label: () => "Someone they invited turned up" },
};

async function renderTimeline(id) {
  const host = $("detailTimeline");
  if (!host) return;
  host.innerHTML = `<p class="ops-empty">Loading…</p>`;

  const { data, error } = await supabase.rpc("admin_member_timeline", { p_user: id });
  if (error) { host.innerHTML = `<p class="ops-empty">${esc(error.message)}</p>`; return; }
  if (!data?.length) { host.innerHTML = `<p class="ops-empty">Nothing recorded yet.</p>`; return; }

  host.innerHTML = data.map((e) => {
    const kind = TL[e.kind] || { icon: "·", label: () => e.kind };
    const how = e.meta?.source && e.meta.source !== "door_scan" ? ` · ${esc(e.meta.source)}` : "";
    return `<div class="tl-row tl-${esc(e.kind)}">
      <span class="tl-dot" aria-hidden="true">${kind.icon}</span>
      <div class="tl-body">
        <strong>${esc(kind.label(e))}</strong>
        <small>${esc(fmtDT(e.occurred_at))}${e.venue ? " · " + esc(e.venue) : ""}${how}</small>
      </div>
    </div>`;
  }).join("");
}

$("assignBtn")?.addEventListener("click", async () => {
  if (!selectedUser) return;
  const ev = $("assignEvent").value;
  if (!ev) return msg($("assignMsg"), "Create an event first.");
  const { error } = await supabase.rpc("admin_assign_staff", {
    p_event: ev, p_user: selectedUser, p_role: $("assignRole").value,
  });
  if (error) return msg($("assignMsg"), error.message);
  msg($("assignMsg"), "Tag given.", "ok");
  await openUser(selectedUser);
});

// ---------------------------------------------------------------------------
// EVENTS
// ---------------------------------------------------------------------------
async function loadEvents() {
  const { data, error } = await supabase.from("events").select("*").order("starts_at", { ascending: false });
  if (error) return;
  events = data || [];

  const options = events.length
    ? events.map((e) => `<option value="${esc(e.id)}">${esc(e.name)}, ${fmtDT(e.starts_at)}</option>`).join("")
    : `<option value="">No events yet</option>`;

  $("assignEvent").innerHTML = options;
  if ($("crewEvent")) {
    const keepCrew = $("crewEvent").value;
    $("crewEvent").innerHTML = options;
    if (keepCrew && events.some((e) => e.id === keepCrew)) $("crewEvent").value = keepCrew;
  }

  // Keep whatever event the tickets panel was already looking at.
  const keep = $("tkEvent")?.value;
  if ($("tkEvent")) {
    $("tkEvent").innerHTML = options;
    if (keep && events.some((e) => e.id === keep)) $("tkEvent").value = keep;
  }

  $("eventList").innerHTML = events.length
    ? events.map((e) => {
        const upcoming = new Date(e.starts_at) > new Date();
        // Announced is the state that actually matters day to day: it is the
        // difference between a private draft and the whole public site
        // talking about it, so it is called out rather than buried.
        const live = e.announced === true;
        const timed = !live && e.announce_at;
        return `<div class="ops-row" data-event="${esc(e.id)}" style="cursor:pointer;">
        <div><strong>${esc(e.name)}</strong><small>${esc(e.venue || "—")} · ${fmtDT(e.starts_at)}</small></div>
        <span class="pill ${live ? "is-live" : ""}">${
          live ? "announced" : timed ? "scheduled" : upcoming ? "hidden" : "past"}</span>
      </div>`;
      }).join("")
    : `<p class="ops-empty">No events yet, create one above.</p>`;

  $("eventList").querySelectorAll("[data-event]").forEach((row) =>
    row.addEventListener("click", () => openEvent(row.dataset.event))
  );
}

// ---------------------------------------------------------------------------
// Announcing an event
//
// One switch. Off, the public site says there is nothing coming and points at
// Instagram; on, the announcement bar, the front page card and the tickets
// page all light up together, because all three read the same feed and that
// feed is gated on this flag.
//
// The scheduled option exists because announcing usually happens at a moment
// somebody has already decided on, and typing that moment in beforehand beats
// remembering to press a button.
// ---------------------------------------------------------------------------
function renderAnnounce(e) {
  const host = $("evAnnounce");
  if (!host) return;
  const live = e.announced === true;
  const when = e.announce_at ? new Date(e.announce_at) : null;
  const local = when && !isNaN(when)
    ? new Date(when.getTime() - when.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    : "";

  host.innerHTML = `
    <div class="acc-card-head">
      <h4>${live ? "Live on the site" : "Not announced"}</h4>
      <p>${live
        ? "The banner, the front page and the tickets page are all showing this event."
        : "The site says there are no upcoming events. Announce it when the Billetto listing is public."}</p>
    </div>
    <div class="ops-actions" style="flex-wrap:wrap; gap:10px; align-items:center;">
      <button class="btn ${live ? "" : "btn-primary"} btn-sm" id="evAnnounceBtn">
        ${live ? "Take it back down" : "Announce now"}</button>
      ${live ? "" : `
        <label style="display:flex;align-items:center;gap:8px;color:var(--muted);font-size:.9rem;">
          or at
          <input type="datetime-local" id="evAnnounceAt" value="${local}"
                 style="background:rgba(255,255,255,.06);border:1px solid var(--line);
                        color:var(--ink);border-radius:8px;padding:7px 10px;" />
        </label>
        <button class="btn btn-ghost btn-sm" id="evAnnounceAtBtn">Schedule</button>`}
      <span class="form-msg" id="evAnnounceMsg"></span>
    </div>`;

  $("evAnnounceBtn")?.addEventListener("click", async () => {
    const btn = $("evAnnounceBtn");
    btn.disabled = true;
    const { error } = await supabase.rpc("admin_set_announced", {
      p_event: currentEvent, p_on: !live,
    });
    btn.disabled = false;
    if (error) return msg($("evAnnounceMsg"), error.message, "err");
    await openEvent(currentEvent);
    await loadEvents();
  });

  $("evAnnounceAtBtn")?.addEventListener("click", async () => {
    const val = $("evAnnounceAt")?.value;
    if (!val) return msg($("evAnnounceMsg"), "Pick a date and time first.", "err");
    const { error } = await supabase.rpc("admin_set_announce_at", {
      p_event: currentEvent, p_when: new Date(val).toISOString(),
    });
    if (error) return msg($("evAnnounceMsg"), error.message, "err");
    msg($("evAnnounceMsg"), "Scheduled. It goes live on its own.", "ok");
    await loadEvents();
  });
}

let currentEvent = null;

async function openEvent(id) {
  const { data, error } = await supabase.rpc("admin_event_detail", { p_event: id });
  if (error) return;
  currentEvent = id;
  const e = data.event || {};
  $("eventDetail").hidden = false;
  $("evName").textContent = e.name || "—";
  $("evMeta").textContent = `${e.venue || "—"} · ${fmtDT(e.starts_at)}${e.ends_at ? " → " + fmtDT(e.ends_at) : ""}`;
  // "412 checked in" means nothing on its own. "412 of 500, 82% full" is the
  // number somebody standing at the door is actually asking for.
  const cap = e.capacity || 0;
  const pct = cap ? Math.round((data.checkins / cap) * 100) : null;
  $("evKpis").innerHTML =
    kpi("checked in", cap ? `${data.checkins} / ${cap}` : data.checkins) +
    kpi("how full", pct == null ? "no capacity set" : `${pct}%`) +
    kpi("room left", cap ? Math.max(cap - data.checkins, 0) : "—") +
    kpi("working it", (data.staff || []).length);

  if (e.info) {
    $("evMeta").innerHTML += `<br /><span style="color:var(--faint);">${esc(e.info)}</span>`;
  }

  renderAnnounce(e);

  $("evStaff").innerHTML = data.staff?.length
    ? data.staff.map((s) => `<div class="ops-row">
        <div><strong>${esc(s.name || "—")}</strong></div>
        <div class="ops-actions"><span class="pill">${esc(s.staff_role)}</span>
        <button class="acc-link" data-rm="${esc(s.user_id)}">Remove</button></div></div>`).join("")
    : `<p class="ops-empty">Nobody assigned yet, give someone a tag from the Members tab.</p>`;

  $("evStaff").querySelectorAll("[data-rm]").forEach((b) =>
    b.addEventListener("click", async () => {
      b.disabled = true;
      const { error: err } = await supabase.rpc("admin_revoke_staff", { p_event: id, p_user: b.dataset.rm });
      if (err) alert(err.message); else await openEvent(id);
    })
  );
  renderCosts(id);
  renderIncidents(id);
  $("eventDetail").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------------------------------------------------------------------------
// REPORTS FROM THE DOOR (phase 18) — read-only here; the writing end is one
// button on the staff page. Reporter names come from a second small query
// because incident_reports carries ids, not names.
// ---------------------------------------------------------------------------
const INCIDENT_LABEL = {
  refused_entry: "Refused entry", incident: "Incident",
  capacity: "Capacity reached", other: "Other",
};

async function renderIncidents(eventId) {
  const host = $("evIncidents");
  if (!host) return;
  const { data, error } = await supabase.from("incident_reports")
    .select("kind, note, created_at, reported_by").eq("event_id", eventId)
    .order("created_at", { ascending: false });
  if (error) {
    host.innerHTML = `<p class="ops-empty">Reports need schema-phase18-door-notes-incidents.sql applied.</p>`;
    return;
  }
  if (!data?.length) {
    host.innerHTML = `<p class="ops-empty">Nothing filed. A quiet night is a good night.</p>`;
    return;
  }
  const ids = [...new Set(data.map((r) => r.reported_by).filter(Boolean))];
  const names = {};
  if (ids.length) {
    const { data: ppl } = await supabase.from("profiles")
      .select("id, first_name, last_name").in("id", ids);
    (ppl || []).forEach((p) => {
      names[p.id] = [p.first_name, p.last_name].filter(Boolean).join(" ");
    });
  }
  host.innerHTML = data.map((r) => `
    <div class="ops-row">
      <div><strong>${esc(INCIDENT_LABEL[r.kind] || r.kind)}</strong>
        <small>${fmtDT(r.created_at)}${r.reported_by ? " · " + esc(names[r.reported_by] || "staff") : ""}</small>
        ${r.note ? `<small style="display:block;">${esc(r.note)}</small>` : ""}
      </div>
    </div>`).join("");
}

// ---------------------------------------------------------------------------
// WHAT THE NIGHT COST
//
// Plain table access under admin RLS (schema-phase17): line items in ore,
// cost or income, with the net at the bottom. Billetto's money never touches
// this database, so the payout is entered as income by hand — this card is
// bookkeeping for the board, not a payment system.
// ---------------------------------------------------------------------------
async function renderCosts(eventId) {
  const host = $("evCosts");
  if (!host) return;
  const { data, error } = await supabase.from("event_costs")
    .select("id, kind, label, amount_ore").eq("event_id", eventId)
    .order("created_at");
  if (error) {
    host.innerHTML = `<p class="ops-empty">Costs need schema-phase17-admin-costs-stats.sql applied.</p>`;
    return;
  }
  const rows = data || [];
  if (!rows.length) {
    host.innerHTML = `<p class="ops-empty">No lines yet. Venue, sound, artists, security — and the payout as income.</p>`;
    return;
  }
  const net = rows.reduce((a, r) => a + (r.kind === "income" ? 1 : -1) * Number(r.amount_ore), 0);
  host.innerHTML = rows.map((r) => `
    <div class="ops-row">
      <div><strong>${esc(r.label)}</strong><small>${r.kind === "income" ? "income" : "cost"}</small></div>
      <div class="ops-actions">
        <span class="pill">${r.kind === "income" ? "+" : "−"}${kr(r.amount_ore)}</span>
        <button class="acc-link" data-cost-rm="${esc(r.id)}">Remove</button>
      </div>
    </div>`).join("") + `
    <div class="ops-row">
      <div><strong>${net >= 0 ? "Surplus" : "Shortfall"}</strong><small>income minus costs</small></div>
      <span class="pill">${net >= 0 ? "+" : "−"}${kr(Math.abs(net))}</span>
    </div>`;
  host.querySelectorAll("[data-cost-rm]").forEach((b) =>
    b.addEventListener("click", async () => {
      b.disabled = true;
      const { error: err } = await supabase.from("event_costs").delete().eq("id", b.dataset.costRm);
      if (err) alert(err.message); else renderCosts(eventId);
    })
  );
}

$("costAdd")?.addEventListener("click", async () => {
  const m = $("costMsg");
  const label = $("costLabel")?.value.trim();
  const amountKr = Number($("costAmount")?.value);
  const kind = $("costKind")?.value === "income" ? "income" : "cost";
  if (!currentEvent) return msg(m, "Open an event first.");
  if (!label || !(amountKr > 0)) return msg(m, "A line and an amount, both.");
  msg(m, "");
  const { error } = await supabase.from("event_costs").insert({
    event_id: currentEvent, kind, label,
    amount_ore: Math.round(amountKr * 100), created_by: me?.id,
  });
  if (error) return msg(m, error.message);
  $("costLabel").value = ""; $("costAmount").value = "";
  renderCosts(currentEvent);
});

// ---------------------------------------------------------------------------
// STATS — aggregates of what the database has known all along. The bars are
// the same .tier-bar component the Overview's tier spread already uses.
// ---------------------------------------------------------------------------
async function loadStats() {
  const su = $("statSignups"), at = $("statAttendance");
  if (!su || !at) return;
  const { data, error } = await supabase.rpc("admin_stats");
  if (error || !data) {
    su.innerHTML = `<p class="ops-empty">Stats need schema-phase17-admin-costs-stats.sql applied.</p>`;
    at.innerHTML = "";
    return;
  }

  const weeks = data.signups_by_week || [];
  const maxW = Math.max(...weeks.map((w) => w.n), 1);
  su.innerHTML = weeks.length ? weeks.map((w) => `
    <div class="ops-row">
      <div style="min-width:110px;"><strong>${esc(w.wk)}</strong><small>week starting</small></div>
      <div style="flex:1;max-width:300px;"><div class="tier-bar"><span style="width:${((w.n / maxW) * 100).toFixed(0)}%"></span></div></div>
      <span class="pill">${w.n}</span>
    </div>`).join("") : `<p class="ops-empty">No signups in the last twelve weeks.</p>`;

  const evs = (data.attendance_by_event || []).slice().reverse();   // newest first
  const maxA = Math.max(...evs.map((e) => e.n), ...evs.map((e) => e.capacity || 0), 1);
  at.innerHTML = evs.length ? evs.map((e) => `
    <div class="ops-row">
      <div style="min-width:150px;"><strong>${esc(e.name)}</strong><small>${esc(fmtDay(e.starts_at))}</small></div>
      <div style="flex:1;max-width:300px;"><div class="tier-bar"><span style="width:${((e.n / maxA) * 100).toFixed(0)}%"></span></div></div>
      <span class="pill">${e.n}${e.capacity ? " / " + e.capacity : ""}</span>
    </div>`).join("") : `<p class="ops-empty">No past events yet.</p>`;
}

// ---------------------------------------------------------------------------
// TEST EMAILS — one copy to the address in the box, marking nobody. The
// functions verify the session's admin role server-side (see the "second
// door" comment in each function); the cron secret never leaves the server.
// ---------------------------------------------------------------------------
async function sendTestEmail(fn, body, btn) {
  const m = $("testEmailMsg");
  const to = $("testEmailTo")?.value.trim();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return msg(m, "Enter an address first.");
  btn.disabled = true;
  msg(m, "Sending…", "ok");
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session?.access_token || ""}`,
      },
      body: JSON.stringify({ ...body, to }),
    });
    const j = await res.json().catch(() => ({}));
    msg(m, res.ok ? "Sent — check that inbox." : (j.error || `Failed (${res.status})`), res.ok ? "ok" : "err");
  } catch (e) {
    msg(m, "Couldn't reach the function.");
  }
  btn.disabled = false;
}
$("testDigest")?.addEventListener("click", (e) => sendTestEmail("weekly-digest", {}, e.currentTarget));
$("testWelcome")?.addEventListener("click", (e) => sendTestEmail("member-emails", { action: "test" }, e.currentTarget));
$("testAnnounce")?.addEventListener("click", (e) => sendTestEmail("event-emails", {}, e.currentTarget));

// ---------------------------------------------------------------------------
// ATTENDANCE IMPORT (Billetto export)
//
// Everything is parsed in the browser and only a list of email addresses is
// sent. That keeps the attendees' names, phone numbers and order values out of
// our database entirely, we don't need them, so we don't take them.
//
// Column detection is deliberately forgiving: Billetto's export headers differ
// between event types and languages. We look for an email-ish header first and
// fall back to scanning every cell for something shaped like an address.
// ---------------------------------------------------------------------------
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const EMAIL_HEADER_RE = /\b(e-?mail|e-?post|mail(adress)?)\b/i;

function emailsFromRows(rows) {
  if (!rows.length) return [];

  // Header row: find a column that announces itself as the email one.
  const header = rows[0].map((c) => String(c ?? "").trim());
  const col = header.findIndex((h) => EMAIL_HEADER_RE.test(h));

  if (col >= 0) {
    const picked = rows.slice(1)
      .map((r) => String(r[col] ?? "").trim().toLowerCase())
      .filter((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
    if (picked.length) return [...new Set(picked)];
  }

  // No usable header, sweep the whole sheet.
  const all = rows.flat().join(" ").match(EMAIL_RE) || [];
  return [...new Set(all.map((v) => v.toLowerCase()))];
}

function parseDelimited(text) {
  // Billetto exports comma-separated; some locales give semicolons, and a
  // copy-paste out of Sheets gives tabs. Pick whichever appears most on the
  // first line rather than guessing from the file extension.
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch]++;
  }
  const delim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];

  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

async function parseFile(file) {
  const name = (file.name || "").toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, raw: false });
  }
  return parseDelimited(await file.text());
}

let importEmails = [];

$("importFile")?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  const el = $("importMsg");
  $("importResult").innerHTML = "";
  importEmails = [];
  $("importBtn").disabled = true;
  if (!file) return;

  msg(el, "Reading…", "");
  try {
    importEmails = emailsFromRows(await parseFile(file));
  } catch (err) {
    console.error("parse failed:", err);
    return msg(el, "Couldn't read that file. Try exporting it from Billetto as CSV.");
  }

  if (!importEmails.length) {
    return msg(el, "No email addresses found in that file.");
  }
  msg(el, `Found ${importEmails.length} email address${importEmails.length === 1 ? "" : "es"}. Nothing recorded yet, press Import.`, "ok");
  $("importBtn").disabled = false;
  $("importDry").disabled = false;
});

// A dry run. Same arithmetic, nothing written, so a file nobody has checked
// can be pointed at a real event without holding your breath.
$("importDry")?.addEventListener("click", async () => {
  const ev = currentEvent;
  if (!ev || !importEmails.length) return;
  const btn = $("importDry");
  btn.disabled = true; btn.textContent = "Checking…";

  const { data, error } = await supabase.rpc("admin_import_attendance", {
    p_event: ev, p_emails: importEmails, p_source: "billetto_import", p_dry_run: true,
  });

  btn.textContent = "Check the file first"; btn.disabled = false;
  if (error) return msg($("importMsg"), error.message);

  msg($("importMsg"), `Nothing written. This would record ${data.added} of ${data.submitted}.`, "ok");
  renderImportReceipt(data);
});

$("importBtn")?.addEventListener("click", async () => {
  const ev = currentEvent;
  if (!ev || !importEmails.length) return;
  const btn = $("importBtn");
  btn.disabled = true;
  btn.textContent = "Importing…";

  const { data, error } = await supabase.rpc("admin_import_attendance", {
    p_event: ev, p_emails: importEmails, p_source: "billetto_import",
  });

  btn.textContent = "Import attendance";
  if (error) {
    msg($("importMsg"), error.message);
    btn.disabled = false;
    return;
  }

  msg($("importMsg"), `${data.added} recorded, ${data.already} already there.`, "ok");
  renderImportReceipt(data);

  await openEvent(ev);
  await loadOverview();
});

// A receipt, not a status code. A bulk write over other people's accounts is
// only trustworthy if you can see exactly what it did and to whom. The dry run
// and the real thing render identically on purpose: what you checked is what
// you get.
function renderImportReceipt(data) {
  const dry = !!data.dry_run;
  const rec = data.recorded || [];
  const miss = data.unmatched || [];
  $("importResult").innerHTML = `
    ${dry ? `<p class="ap-note" style="margin-top:16px;">Nothing has been written. This is what pressing Import would do.</p>` : ""}
    <div class="kpi-grid" style="margin-top:16px;">
      ${kpi("in the file", data.submitted)}
      ${kpi("matched an account", data.matched)}
      ${kpi(dry ? "would be recorded" : "newly recorded", data.added)}
      ${kpi("already recorded", data.already)}
      ${kpi("no account", miss.length)}
    </div>

    ${rec.length ? `
      <div class="acc-card-head" style="margin-top:24px;">
        <h3 style="font-size:1rem;">${dry ? "Would be recorded as here" : "Recorded as here"}</h3>
        <p>Their tier moves as if they had been scanned at the door.</p>
      </div>
      <div class="ops-list">${rec.map((m) => `
        <div class="ops-row">
          <div><strong>${esc(m.name || m.email)}</strong>${m.name ? `<small>${esc(m.email)}</small>` : ""}</div>
        </div>`).join("")}</div>` : ""}

    ${miss.length ? `
      <div class="acc-card-head" style="margin-top:24px;">
        <h3 style="font-size:1rem;">Bought a ticket, has no account</h3>
        <p>They came but will not get a tier until they sign up. Worth a mail after the event.</p>
      </div>
      <div class="ops-actions" style="margin-bottom:12px;">
        <button type="button" class="btn btn-ghost btn-sm" id="copyUnmatched">Copy all ${miss.length} addresses</button>
        <span class="form-msg" id="copyMsg"></span>
      </div>
      <div class="ops-list">${miss.map((e) => `
        <div class="ops-row"><div><strong>${esc(e)}</strong></div></div>`).join("")}</div>` : ""}`;

  $("copyUnmatched")?.addEventListener("click", async (e) => {
    try {
      await navigator.clipboard.writeText(miss.join(", "));
      msg($("copyMsg"), "Copied, paste into the Bcc field.", "ok");
    } catch {
      msg($("copyMsg"), "Clipboard blocked, select the list by hand.");
    }
  });
}

$("importUndo")?.addEventListener("click", async () => {
  const ev = currentEvent;
  if (!ev) return;
  if (!confirm("Remove every attendance record this import created for this event?")) return;
  const { data, error } = await supabase.rpc("admin_undo_import", { p_event: ev, p_source: "billetto_import" });
  if (error) return msg($("importMsg"), error.message);
  msg($("importMsg"), `Removed ${data} imported check-in${data === 1 ? "" : "s"}.`, "ok");
  $("importResult").innerHTML = "";
  await openEvent(ev);
});

$("eventForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const row = {
    name: f.get("name")?.trim(),
    venue: f.get("venue")?.trim() || null,
    starts_at: f.get("starts_at") ? new Date(f.get("starts_at")).toISOString() : null,
    ends_at: f.get("ends_at") ? new Date(f.get("ends_at")).toISOString() : null,
    capacity: f.get("capacity") ? Number(f.get("capacity")) : null,
    billetto_event_id: f.get("billetto_event_id")?.trim() || null,
  };
  if (!row.name || !row.starts_at) return msg($("eventMsg"), "Name and doors are required.");

  row.image_url = f.get("image_url")?.trim() || null;
  row.description = f.get("description")?.trim() || null;
  row.info = f.get("info")?.trim() || null;

  const { error } = await supabase.from("events").insert(row);
  if (error) return msg($("eventMsg"), error.message);
  msg($("eventMsg"), "Event created.", "ok");
  e.target.reset();
  await loadEvents();
  await loadOverview();
});

// ---------------------------------------------------------------------------
// TICKETS
//
// Nothing here can oversell: the quantity you type is a ceiling the database
// enforces under a row lock, and it refuses to be set below what has already
// gone out. Everything on this panel goes through an RPC that re-checks
// is_admin() server-side.
// ---------------------------------------------------------------------------
let tkTypes = [];
let tkEditing = null;      // ticket_type id, or null for a new one

const toOre = (v) => Math.round(Number(v || 0) * 100);
const forInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function tkEventId() { return $("tkEvent")?.value || ""; }

async function loadTickets() {
  const id = tkEventId();
  if (!id) {
    $("tkTypes").innerHTML = `<p class="ops-empty">Create an event first, on the Events tab.</p>`;
    $("tkKpis").innerHTML = "";
    $("tkOrders").innerHTML = "";
    return;
  }

  const [{ data, error }, { data: orders }] = await Promise.all([
    supabase.rpc("admin_event_sales", { p_event: id }),
    supabase.rpc("admin_orders", { p_event: id, p_limit: 40 }),
  ]);
  if (error) { msg($("tkMsg"), error.message); return; }

  tkTypes = data.types || [];
  const t = data.totals || {}, o = data.orders || {};

  $("tkKpis").innerHTML =
    kpi("tickets sold", t.sold ?? 0) +
    kpi("revenue", kr(t.revenue_ore)) +
    kpi("held in checkout", t.held ?? 0) +
    kpi("scanned at the door", data.scanned ?? 0) +
    kpi("paid orders", o.paid ?? 0) +
    kpi("in checkout now", o.pending ?? 0) +
    kpi("refunded", o.refunded ?? 0) +
    kpi("flagged", o.flagged ?? 0);

  $("tkSeed").hidden = tkTypes.length > 0;

  $("tkTypes").innerHTML = tkTypes.length ? tkTypes.map((t) => {
    const cap = t.quantity == null ? "unlimited" : `${t.sold} / ${t.quantity} sold`;
    const state = t.open ? `<span class="pill ok">on sale</span>`
      : t.status === "closed" ? `<span class="pill">closed</span>`
      : t.status === "paused" ? `<span class="pill">paused</span>`
      : `<span class="pill">draft</span>`;
    return `<div class="ops-row">
      <div>
        <strong>${esc(t.name)}${t.kind === "addon" ? " · add-on" : ""}</strong>
        <small>${kr(t.price_ore)} · ${esc(cap)}${t.reserved ? ` · ${t.reserved} held` : ""} · ${kr(t.revenue_ore)} taken</small>
      </div>
      <div class="ops-actions">
        ${state}
        ${t.status !== "on_sale" ? `<button class="btn btn-ghost btn-sm" data-open="${esc(t.id)}">Open</button>` : ""}
        ${t.status === "on_sale" ? `<button class="btn btn-ghost btn-sm" data-pause="${esc(t.id)}">Pause</button>` : ""}
        ${t.status !== "closed" ? `<button class="acc-link" data-close="${esc(t.id)}">Close</button>` : ""}
        <button class="acc-link" data-edit="${esc(t.id)}">Edit</button>
      </div>
    </div>`;
  }).join("") : `<p class="ops-empty">No releases yet. Use the button below to lay out the standard four plus the backstage add-on, then edit the prices.</p>`;

  const setStatus = async (id, status) => {
    const { error: e } = await supabase.rpc("admin_set_ticket_status", { p_id: id, p_status: status });
    if (e) msg($("tkMsg"), e.message); else { msg($("tkMsg"), ""); await loadTickets(); }
  };
  $("tkTypes").querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => setStatus(b.dataset.open, "on_sale")));
  $("tkTypes").querySelectorAll("[data-pause]").forEach((b) => b.addEventListener("click", () => setStatus(b.dataset.pause, "paused")));
  $("tkTypes").querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => setStatus(b.dataset.close, "closed")));
  $("tkTypes").querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openTicketForm(b.dataset.edit)));

  $("tkOrders").innerHTML = (orders || []).length ? orders.map((r) => `
    <div class="ops-row">
      <div>
        <strong>${esc(r.buyer || r.email)}</strong>
        <small>${esc((r.items || []).join(", "))} · ${fmtDT(r.created_at)}${r.flagged ? ` · ⚠ ${esc(r.flagged)}` : ""}</small>
      </div>
      <div class="ops-actions">
        <span class="pill">${kr(r.total_ore)}</span>
        <span class="pill ${r.status === "paid" ? "ok" : r.status === "refunded" ? "bad" : ""}">${esc(r.status)}</span>
      </div>
    </div>`).join("") : `<p class="ops-empty">No orders yet.</p>`;
}

function openTicketForm(id) {
  tkEditing = id || null;
  const t = tkTypes.find((x) => x.id === id);
  const form = $("tkForm");

  $("tkEditPanel").hidden = false;
  $("tkEditTitle").textContent = t ? `Edit, ${t.name}` : "New release";
  $("tkDelete").hidden = !t;
  msg($("tkFormMsg"), "");

  form.name.value = t?.name || "";
  form.kind.value = t?.kind || "entry";
  form.price.value = t ? (t.price_ore / 100) : "";
  form.quantity.value = t?.quantity ?? "";
  form.release_order.value = t?.release_order ?? (tkTypes.length + 1);
  form.max_per_order.value = t?.max_per_order ?? 4;
  form.status.value = t?.status || "draft";
  form.sales_start.value = forInput(t?.sales_start);
  form.sales_end.value = forInput(t?.sales_end);
  form.description.value = t?.description || "";

  $("tkEditPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

$("tkEvent")?.addEventListener("change", () => { $("tkEditPanel").hidden = true; loadTickets(); });
$("tkNew")?.addEventListener("click", () => openTicketForm(null));
$("tkCancel")?.addEventListener("click", () => { $("tkEditPanel").hidden = true; });

$("tkSeed")?.addEventListener("click", async (e) => {
  const id = tkEventId();
  if (!id) return msg($("tkMsg"), "Pick an event first.");
  e.target.disabled = true;
  const { error } = await supabase.rpc("admin_seed_releases", { p_event: id });
  e.target.disabled = false;
  if (error) return msg($("tkMsg"), error.message);
  msg($("tkMsg"), "Releases created, check the prices before you announce.", "ok");
  await loadTickets();
});

$("tkForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const id = tkEventId();
  if (!id) return msg($("tkFormMsg"), "Pick an event first.");

  const { error } = await supabase.rpc("admin_upsert_ticket_type", {
    p_id: tkEditing,
    p_event: id,
    p_name: f.name.value.trim(),
    p_kind: f.kind.value,
    p_release_order: Number(f.release_order.value || 1),
    p_price_ore: toOre(f.price.value),
    p_quantity: f.quantity.value ? Number(f.quantity.value) : null,
    p_status: f.status.value,
    p_sales_start: f.sales_start.value ? new Date(f.sales_start.value).toISOString() : null,
    p_sales_end: f.sales_end.value ? new Date(f.sales_end.value).toISOString() : null,
    p_max_per_order: Number(f.max_per_order.value || 4),
    p_description: f.description.value.trim() || null,
  });

  if (error) return msg($("tkFormMsg"), error.message);
  msg($("tkFormMsg"), "Saved.", "ok");
  $("tkEditPanel").hidden = true;
  await loadTickets();
});

$("tkDelete")?.addEventListener("click", async () => {
  if (!tkEditing) return;
  if (!confirm("Delete this release? Only possible if nothing has been ordered against it.")) return;
  const { error } = await supabase.rpc("admin_delete_ticket_type", { p_id: tkEditing });
  if (error) return msg($("tkFormMsg"), error.message);
  $("tkEditPanel").hidden = true;
  await loadTickets();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
$("signoutBtn")?.addEventListener("click", async () => {
  await supabase.auth.signOut();
  window.location.href = "/account.html";
});

// ---------------------------------------------------------------------------
// CREW
//
// Door and bar are per-event tags that expire on their own. That is the right
// model and it left one blind spot: there was nowhere to see the people. You
// could give somebody a tag from their member page and that was the end of it.
// No list of who works for you, no way to tell whether Saturday has anybody on
// the door, and no way to find last month's bar crew without opening members
// one at a time.
//
// Three reads, no writes of its own beyond the two assign/revoke calls that
// already existed. Everything is derived from event_staff, events and
// attendance.
// ---------------------------------------------------------------------------
let crewPick = null;      // who the "put someone on a shift" form is aimed at
let crewFindTimer;
let crewSearchTimer;

async function loadCrew() {
  await Promise.all([loadCrewCover(), loadCrewList()]);
}

// ---- cover for what is coming ---------------------------------------------
async function loadCrewCover() {
  const host = $("crewCover");
  if (!host) return;

  const { data, error } = await supabase.rpc("admin_crew_cover", { p_past: 3 });
  if (error) { host.innerHTML = `<p class="ops-empty">${esc(error.message)}</p>`; return; }

  const up = data?.upcoming || [];
  const recent = data?.recent || [];

  const rows = up.map((e) => {
    // No door staff is a problem. No bar staff is a question. Said differently
    // so a glance separates them.
    const gaps = [];
    if (!e.door) gaps.push("nobody on the door");
    if (!e.bar) gaps.push("nobody on the bar");
    const names = (e.crew || []).map((c) =>
      `<span class="crew-chip ${esc(c.role)}">${esc(c.name || "unnamed")}</span>`).join("");

    return `<div class="ops-row crew-cover ${!e.door ? "is-short" : ""}">
      <div>
        <strong>${esc(e.name)}</strong>
        <small>${esc(fmtDT(e.starts_at))}${e.venue ? " · " + esc(e.venue) : ""}${
          e.announced ? "" : " · not announced"}</small>
        ${names ? `<div class="crew-chips">${names}</div>` : ""}
      </div>
      <div class="ops-actions">
        <span class="pill ${e.door ? "ok" : "bad"}">${e.door} door</span>
        <span class="pill ${e.bar ? "ok" : ""}">${e.bar} bar</span>
        <button class="acc-link" data-crew-event="${esc(e.id)}">Open event</button>
      </div>
    </div>
    ${gaps.length ? `<p class="ops-empty crew-gap">${esc(gaps.join(", "))}.</p>` : ""}`;
  }).join("");

  const past = recent.map((e) => `
    <div class="ops-row is-past">
      <div><strong>${esc(e.name)}</strong><small>${esc(fmtDT(e.starts_at))}</small></div>
      <div class="ops-actions">
        <span class="pill">${e.crew_size} on crew</span>
        <span class="pill">${e.checkins} in</span>
      </div>
    </div>`).join("");

  host.innerHTML =
    (rows || `<p class="ops-empty">Nothing in the calendar.</p>`) +
    (past ? `<p class="ops-empty" style="padding:16px 0 6px;">Recently</p>${past}` : "");

  host.querySelectorAll("[data-crew-event]").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelector('[data-panel="events"]')?.click();
      openEvent(b.dataset.crewEvent);
    })
  );
}

// ---- everyone who works here ----------------------------------------------
async function loadCrewList() {
  const host = $("crewList");
  if (!host) return;

  const q = $("crewSearch")?.value.trim() || "";
  const { data, error } = await supabase.rpc("admin_crew", { p_search: q });
  if (error) { msg($("crewMsg"), error.message); return; }
  msg($("crewMsg"), "");

  if (!data?.length) {
    host.innerHTML = `<p class="ops-empty">${q ? "Nobody by that name." : "Nobody has been given a tag yet."}</p>`;
    return;
  }

  host.innerHTML = data.map((c) => {
    const when = c.on_shift_now ? "on shift now"
      : c.next_shift_at ? `next: ${fmtDT(c.next_shift_at)}, ${c.next_shift_role}`
      : c.last_shift_at ? `last worked ${fmtDay(c.last_shift_at)}`
      : "never worked a night";

    return `<div class="ops-row crew-row ${c.on_shift_now ? "is-live" : ""}" data-crew="${esc(c.user_id)}">
      <div>
        <strong>${esc(c.name || c.email)}</strong>
        <small>${esc(when)}${c.checkins_done ? ` · ${c.checkins_done} checked in all time` : ""}</small>
      </div>
      <div class="ops-actions">
        ${c.on_shift_now ? `<span class="pill ok">live</span>` : ""}
        ${c.role === "admin" ? `<span class="pill ok">admin</span>` : ""}
        ${c.door_shifts ? `<span class="pill">${c.door_shifts} door</span>` : ""}
        ${c.bar_shifts ? `<span class="pill">${c.bar_shifts} bar</span>` : ""}
        ${!c.member_ok ? `<span class="pill bad">membership lapsed</span>` : ""}
      </div>
    </div>`;
  }).join("");

  host.querySelectorAll("[data-crew]").forEach((row) =>
    row.addEventListener("click", () => openCrew(row.dataset.crew))
  );
}

$("crewSearch")?.addEventListener("input", () => {
  clearTimeout(crewSearchTimer);
  crewSearchTimer = setTimeout(loadCrewList, 250);
});

// ---- one person's whole working history -----------------------------------
async function openCrew(id) {
  const { data, error } = await supabase.rpc("admin_crew_detail", { p_user: id });
  if (error) { msg($("crewMsg"), error.message); return; }

  const p = data.profile || {}, tot = data.totals || {};
  $("crewDetail").hidden = false;
  $("crewName").textContent = p.name || p.email;
  $("crewMeta").innerHTML =
    `${esc(p.email)}${p.phone ? ` · <a href="tel:${esc(p.phone)}">${esc(p.phone)}</a>` : " · no phone"}
     · ${esc(p.role)} · with us since ${esc(fmtDay(p.created_at))}`;

  $("crewStats").innerHTML =
    kpi("shifts", tot.shifts ?? 0) +
    kpi("people checked in", tot.checkins ?? 0) +
    kpi("account tag", p.role || "member") +
    kpi("membership", p.ebas_status || "—");

  const shifts = data.shifts || [];
  $("crewShifts").innerHTML = shifts.length
    ? shifts.map((sh) => `
      <div class="ops-row ${sh.active_now ? "is-live" : sh.upcoming ? "" : "is-past"}">
        <div>
          <strong>${esc(sh.name)}</strong>
          <small>${esc(fmtDT(sh.starts_at))}${sh.venue ? " · " + esc(sh.venue) : ""}${
            sh.checked_in ? ` · checked in ${sh.checked_in}` : ""}</small>
        </div>
        <div class="ops-actions">
          ${sh.active_now ? `<span class="pill ok">live</span>` : ""}
          <span class="pill">${esc(sh.staff_role)}</span>
          <button class="acc-link" data-crew-revoke="${esc(sh.event_id)}">Remove</button>
        </div>
      </div>`).join("")
    : `<p class="ops-empty">No shifts yet.</p>`;

  $("crewShifts").querySelectorAll("[data-crew-revoke]").forEach((b) =>
    b.addEventListener("click", async () => {
      b.disabled = true;
      const { error: e } = await supabase.rpc("admin_revoke_staff", { p_event: b.dataset.crewRevoke, p_user: id });
      if (e) return alert(e.message);
      await openCrew(id);
      await loadCrew();
    })
  );

  $("crewDetail").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---- put someone on a shift ------------------------------------------------
// Searches every account, not just existing crew, because the whole point is
// adding somebody who has never worked before.
$("crewFind")?.addEventListener("input", (e) => {
  clearTimeout(crewFindTimer);
  const q = e.target.value.trim();
  crewPick = null;
  $("crewAssign").disabled = true;
  if (q.length < 2) { $("crewFindList").innerHTML = ""; return; }
  crewFindTimer = setTimeout(() => findForShift(q), 250);
});

async function findForShift(q) {
  const { data, error } = await supabase.rpc("admin_users", { p_search: q, p_limit: 8, p_offset: 0 });
  const host = $("crewFindList");
  if (error) { host.innerHTML = `<p class="ops-empty">${esc(error.message)}</p>`; return; }
  if (!data?.length) { host.innerHTML = `<p class="ops-empty">Nobody by that name.</p>`; return; }

  host.innerHTML = data.map((u) => `
    <div class="ops-row crew-row" data-pick="${esc(u.user_id)}" data-name="${esc(u.name || u.email)}">
      <div><strong>${esc(u.name || u.email)}</strong><small>${esc(u.email)}</small></div>
      <span class="pill ${u.member_ok ? "ok" : "bad"}">${u.member_ok ? "member" : "not active"}</span>
    </div>`).join("");

  host.querySelectorAll("[data-pick]").forEach((row) =>
    row.addEventListener("click", () => {
      crewPick = row.dataset.pick;
      $("crewFind").value = row.dataset.name;
      host.innerHTML = "";
      $("crewAssign").disabled = false;
      msg($("crewAssignMsg"), "");
    })
  );
}

$("crewAssign")?.addEventListener("click", async () => {
  if (!crewPick) return;
  const ev = $("crewEvent").value;
  if (!ev) return msg($("crewAssignMsg"), "Create an event first.");

  const { error } = await supabase.rpc("admin_assign_staff", {
    p_event: ev, p_user: crewPick, p_role: $("crewRole").value,
  });
  if (error) return msg($("crewAssignMsg"), error.message);

  msg($("crewAssignMsg"), "Tagged. It starts working 4 hours before doors.", "ok");
  $("crewFind").value = "";
  crewPick = null;
  $("crewAssign").disabled = true;
  await loadCrew();
});

// ---------------------------------------------------------------------------
// APPLICATIONS
//
// One queue for both kinds. There is no role column for volunteer or creator:
// an approved application IS the permission, which means undoing it is one
// click back to rejected rather than a migration, and the decision keeps its
// date and its author.
// ---------------------------------------------------------------------------
let appStatus = "pending";

// The answers, rendered as something a person can read in five seconds. The
// payload is deliberately free-form jsonb, so this walks what is there rather
// than assuming a fixed shape, and an older application with different
// questions still renders.
function renderPayload(kind, d) {
  if (!d) return "";
  const line = (label, value) => value
    ? `<div class="ap-line"><span>${esc(label)}</span><b>${esc(value)}</b></div>` : "";

  if (kind === "volunteer") {
    const jobs = { door: "Door", bar: "Bar", build: "Build & strike", media: "Photo & video",
                   social: "Social & design", any: "Anything" };
    const freq = { every: "Every event", most: "Most events", some: "A few a year", once: "Wants to try one" };
    const times = { any: "Any time", build: "Before doors, build", early: "Early, from doors",
                    late: "Late, until close", strike: "After close, pack-down" };
    // d.nights is the old key. Nothing in the database uses it, but reading
    // both costs one `??` and means an application sent from a stale tab still
    // renders rather than showing a blank row.
    const slot = d.time ?? d.nights;
    return `
      ${line("Wants to do", (d.jobs || []).map((j) => jobs[j] || j).join(", "))}
      ${line("How often", freq[d.frequency] || d.frequency)}
      ${line("Preferred time", times[slot] || slot)}
      ${line("Experience", d.experience)}
      ${line("Training", d.training)}
      ${line("Note", d.note)}`;
  }

  const ch = d.channels || {};
  const chans = Object.entries(ch)
    .filter(([, v]) => v && v.handle)
    .map(([k, v]) => `${k}: ${v.handle}${v.followers ? ` (${Number(v.followers).toLocaleString("sv-SE")})` : ""}`)
    .join(" · ");
  return `
    ${line("They are", d.kind)}
    ${line("Wants the code", d.wanted_code)}
    ${line("Channels", chans)}
    ${line("Audience", d.audience)}
    ${line("Plan", d.plan)}`;
}

async function loadApplications() {
  const host = $("applyList");
  if (!host) return;
  host.innerHTML = `<p class="ops-empty">Loading…</p>`;

  const [{ data, error }, codes, audit] = await Promise.all([
    supabase.rpc("admin_applications", { p_status: appStatus }),
    supabase.rpc("admin_promo_codes"),
    supabase.rpc("admin_audit", { p_limit: 60 }),
  ]);

  renderCodes(codes.data || []);
  renderAudit(audit.data || []);

  if (error) { host.innerHTML = `<p class="ops-empty">${esc(error.message)}</p>`; return; }
  if (!data?.length) {
    host.innerHTML = `<p class="ops-empty">${appStatus === "pending" ? "Nothing waiting." : "Nothing here."}</p>`;
    return;
  }

  host.innerHTML = data.map((a) => {
    const held = (a.codes || []).map((c) =>
      `<span class="pill ${c.active ? "ok" : ""}">${esc(c.code)}</span>`).join("");

    return `<div class="ap-card" data-app="${esc(a.id)}">
      <div class="ap-top">
        <div>
          <strong>${esc(a.name || a.email)}</strong>
          <small>${esc(a.email)}${a.phone ? " · " + esc(a.phone) : ""}${a.city ? " · " + esc(a.city) : ""}</small>
          <small>member since ${esc(fmtDay(a.member_since))} · tier ${a.tier ?? 1} · ${a.events_total ?? 0} events${
            a.member_ok ? "" : " · <b>membership not active</b>"}</small>
        </div>
        <div class="ops-actions">
          <span class="pill ${a.kind === "volunteer" ? "" : "ok"}">${esc(a.kind)}</span>
          <span class="pill ${a.status === "approved" ? "ok" : a.status === "rejected" ? "bad" : ""}">${esc(a.status)}</span>
          ${held}
        </div>
      </div>

      <div class="ap-body">${renderPayload(a.kind, a.payload)}</div>

      ${a.admin_note ? `<p class="ap-note">${esc(a.admin_note)}</p>` : ""}

      <div class="form-grid ap-actions">
        <div class="field full">
          <label for="note-${esc(a.id)}">Note back to them (optional, they will see it)</label>
          <input id="note-${esc(a.id)}" data-note placeholder="Why, or what happens next." />
        </div>
        <div class="ops-actions">
          ${a.status !== "approved" ? `<button class="btn btn-primary btn-sm" data-decide="approved">Approve</button>` : ""}
          ${a.status !== "rejected" ? `<button class="btn btn-ghost btn-sm" data-decide="rejected">Turn down</button>` : ""}
          ${a.status !== "pending" ? `<button class="acc-link" data-decide="pending">Put back in the queue</button>` : ""}
        </div>
      </div>

      ${a.kind === "creator" && a.status === "approved" && !(a.codes || []).length ? `
        <div class="ap-code">
          <div class="acc-card-head" style="margin-bottom:12px;"><h3 style="font-size:1rem;">Give them a code</h3></div>
          <div class="form-grid">
            <div class="field">
              <label for="code-${esc(a.id)}">Code</label>
              <input id="code-${esc(a.id)}" data-newcode value="${esc(a.payload?.wanted_code || "")}"
                     maxlength="16" autocapitalize="characters" placeholder="NOVA" />
            </div>
            <div class="field">
              <label for="kind-${esc(a.id)}">Kind</label>
              <select id="kind-${esc(a.id)}" data-newkind>
                <option value="creator">Creator</option>
                <option value="promoter">Promoter</option>
              </select>
            </div>
            <div class="field">
              <label for="rate-${esc(a.id)}">Per person who turns up (kr)</label>
              <input id="rate-${esc(a.id)}" data-newrate type="number" min="0" step="1" value="0" />
              <small class="acc-hint">0 is fine for now. It is frozen onto each signup the moment it qualifies, so changing it later never rewrites what somebody was already owed.</small>
            </div>
            <div class="form-actions">
              <button class="btn btn-primary btn-sm" data-makecode>Create the code</button>
            </div>
          </div>
        </div>` : ""}
    </div>`;
  }).join("");

  host.querySelectorAll("[data-decide]").forEach((b) =>
    b.addEventListener("click", async () => {
      const card = b.closest("[data-app]");
      b.disabled = true;
      const { error: e } = await supabase.rpc("admin_review_application", {
        p_id: card.dataset.app,
        p_status: b.dataset.decide,
        p_note: card.querySelector("[data-note]")?.value || null,
      });
      if (e) { msg($("applyMsg"), e.message); b.disabled = false; return; }
      msg($("applyMsg"), "Saved.", "ok");
      await loadApplications();
      await refreshApplyBadge();
    })
  );

  host.querySelectorAll("[data-makecode]").forEach((b) =>
    b.addEventListener("click", async () => {
      const card = b.closest("[data-app]");
      const id = card.dataset.app;
      const row = data.find((a) => a.id === id);
      b.disabled = true;
      const { data: code, error: e } = await supabase.rpc("admin_create_promo_code", {
        p_user: row.user_id,
        p_code: card.querySelector("[data-newcode]").value,
        p_kind: card.querySelector("[data-newkind]").value,
        p_reward_ore: Math.round(Number(card.querySelector("[data-newrate]").value || 0) * 100),
      });
      if (e) { msg($("applyMsg"), e.message); b.disabled = false; return; }
      msg($("applyMsg"), `Code ${code} created. It is live on their account page now.`, "ok");
      await loadApplications();
    })
  );
}

$("userExport")?.addEventListener("click", () => {
  if (!loadedUsers.length) return msg($("userMsg"), "Nothing loaded to export.");
  downloadCsv("slutstation-members.csv", loadedUsers.map((u) => ({
    name: u.name || "", email: u.email, city: u.city || "",
    membership: u.ebas_status, active: u.member_ok ? "yes" : "no",
    tier: u.tier ?? 1, events_24m: u.events_window ?? 0, events_total: u.events_total ?? 0,
    last_event: u.last_attended_at ? u.last_attended_at.slice(0, 10) : "",
    joined: (u.created_at || "").slice(0, 10),
    email_opt_in: u.marketing_consent ? "yes" : "no",
    role: u.role,
  })));
  msg($("userMsg"), `Exported ${loadedUsers.length}. Load more first if you want the rest.`, "ok");
});

document.querySelectorAll("[data-appstatus]").forEach((tab) =>
  tab.addEventListener("click", () => {
    document.querySelectorAll("[data-appstatus]").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    appStatus = tab.dataset.appstatus;
    loadApplications();
  })
);

// A count on the tab, so a waiting application is visible without opening it.
async function refreshApplyBadge() {
  const { data } = await supabase.rpc("admin_applications", { p_status: "pending" });
  const n = (data || []).length;
  const b = $("applyBadge");
  if (!b) return;
  b.hidden = !n;
  b.textContent = n;
}

function renderCodes(codes) {
  const host = $("codeList");
  if (!host) return;
  if (!codes.length) { host.innerHTML = `<p class="ops-empty">No codes yet.</p>`; return; }

  host.innerHTML = codes.map((c) => `
    <div class="ops-row">
      <div>
        <strong>${esc(c.code)}</strong>
        <small>${esc(c.owner_name || c.owner_email)} · ${esc(c.kind)}${
          c.reward_ore ? ` · ${kr(c.reward_ore)} each` : " · no rate set"}</small>
      </div>
      <div class="ops-actions">
        <span class="pill">${c.signups} signed up</span>
        <span class="pill ok">${c.turned_up} turned up</span>
        ${c.owed_ore ? `<span class="pill">${esc(kr(c.owed_ore))} owed</span>` : ""}
        <button class="acc-link" data-toggle="${esc(c.code)}" data-active="${c.active}">${c.active ? "Pause" : "Resume"}</button>
      </div>
    </div>`).join("");

  host.querySelectorAll("[data-toggle]").forEach((b) =>
    b.addEventListener("click", async () => {
      b.disabled = true;
      const { error: e } = await supabase.rpc("admin_set_promo_code", {
        p_code: b.dataset.toggle, p_active: b.dataset.active !== "true",
      });
      if (e) return msg($("codeMsg"), e.message);
      await loadApplications();
    })
  );

  $("codeExport")?.addEventListener("click", () => downloadCsv("slutstation-codes.csv", codes.map((c) => ({
    code: c.code, kind: c.kind, owner: c.owner_name || "", email: c.owner_email,
    signed_up: c.signups, turned_up: c.turned_up,
    rate_kr: (c.reward_ore / 100).toFixed(0), owed_kr: (c.owed_ore / 100).toFixed(0),
    active: c.active ? "yes" : "no",
  }))), { once: true });
}

const AUDIT_WORDS = {
  application_approved: "Approved an application",
  application_rejected: "Turned down an application",
  application_pending:  "Put an application back in the queue",
  promo_code_created:   "Created a code",
  promo_code_changed:   "Changed a code",
  attendance_imported:  "Imported attendance",
};

function renderAudit(rows) {
  const host = $("auditList");
  if (!host) return;
  if (!rows.length) { host.innerHTML = `<p class="ops-empty">Nothing recorded yet.</p>`; return; }

  host.innerHTML = rows.map((r) => {
    const bits = [];
    if (r.target) bits.push(r.target);
    if (r.meta?.code) bits.push(r.meta.code);
    if (r.meta?.kind) bits.push(r.meta.kind);
    if (r.meta?.added != null) bits.push(`${r.meta.added} recorded of ${r.meta.submitted}`);
    return `<div class="tl-row">
      <span class="tl-dot" aria-hidden="true">·</span>
      <div class="tl-body">
        <strong>${esc(AUDIT_WORDS[r.action] || r.action)}${bits.length ? ": " + esc(bits.join(" · ")) : ""}</strong>
        <small>${esc(r.actor || "someone")} · ${esc(fmtDT(r.occurred_at))}</small>
      </div>
    </div>`;
  }).join("");
}

// ---------------------------------------------------------------------------
// CSV
//
// Everything in this panel was trapped inside it. Built in the browser from
// data already on screen, so it needs no endpoint and leaks nothing that was
// not already fetched. BOM first, because Excel on Windows reads a UTF-8 file
// without one as Latin-1 and turns every å into a mess.
// ---------------------------------------------------------------------------
function downloadCsv(filename, rows) {
  if (!rows?.length) return;
  const cols = Object.keys(rows[0]);
  const cell = (v) => {
    const s = String(v ?? "");
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "\uFEFF" + [cols.join(";"), ...rows.map((r) => cols.map((c) => cell(r[c])).join(";"))].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function boot() {
  // The SDK arrives on its own schedule. Waiting for it HERE rather than at
  // the top of the file is the whole point: the page is interactive while
  // this is still in flight. `false` means it never came and the message is
  // already on screen.
  if (!(await sdkReady)) return;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "/account.html"; return; }

  const { data: profile } = await supabase
    .from("profiles").select("id, role").eq("id", session.user.id).single();

  if (profile?.role !== "admin") { show("stateDenied"); return; }
  me = profile;

  // Two-factor gate. An admin with a verified factor arrives here as aal1
  // (password only), and phase 15 makes every admin RPC refuse that session —
  // so the panel asks for the code up front rather than letting each call
  // fail with "Not authorised". Admins without a factor sail through, which
  // is what makes enrolment opt-in per admin instead of a flag day.
  try {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      show("stateMfa");
      $("mfaCode")?.focus();
      return;   // finishBoot() runs after the code checks out
    }
  } catch (e) { /* no MFA support in this session: the server still decides */ }

  await finishBoot();
}

async function finishBoot() {
  show("stateAdmin");
  await Promise.all([loadOverview(), loadEvents(), loadUsers(true), loadFloat()]);
  await loadTickets();   // needs the event dropdown loadEvents fills in
  showTonight();
  refreshApplyBadge();
  loadMfaCard();
  // Default the test-email box to the admin's own inbox.
  const { data: { session } } = await supabase.auth.getSession();
  if ($("testEmailTo") && !$("testEmailTo").value && session?.user?.email) {
    $("testEmailTo").value = session.user.email;
  }
}

// ---------------------------------------------------------------------------
// MFA — the code prompt at the door, and the Security card inside.
//
// Enrolment and verification are Supabase Auth's own factor machinery; the
// server-side half (is_admin() demanding aal2 once a factor exists) is
// schema-phase15-admin-mfa.sql. A lost authenticator is fixed by the OTHER
// admin deleting the factor row in the dashboard — the same two-can-rescue-
// each-other model the protected-admins rule uses.
// ---------------------------------------------------------------------------
$("mfaForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = $("mfaCode")?.value.trim();
  const m = $("mfaMsg");
  if (!/^\d{6}$/.test(code || "")) return msg(m, "Six digits.");
  msg(m, "Checking…", "ok");
  const { data: f } = await supabase.auth.mfa.listFactors();
  const factor = f?.totp?.[0];
  if (!factor) return msg(m, "No factor on this account. Reload and sign in again.");
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) return msg(m, "Wrong code — try the next one your app shows.");
  msg(m, "");
  await finishBoot();
});

async function loadMfaCard() {
  const host = $("mfaCard");
  if (!host) return;
  let factors = null;
  try { factors = (await supabase.auth.mfa.listFactors()).data; } catch (e) {}
  const totp = factors?.totp?.[0];

  if (totp) {
    host.innerHTML = `
      <div class="ops-row">
        <div><strong>Two-factor is on</strong><small>Enrolled ${esc(fmtDay(totp.created_at))} · every admin action requires the code</small></div>
        <button class="btn btn-ghost btn-sm" id="mfaOff">Remove</button>
      </div>`;
    $("mfaOff").addEventListener("click", async () => {
      if (!confirm("Remove two-factor? Your admin rights go back to password-only.")) return;
      const { error } = await supabase.auth.mfa.unenroll({ factorId: totp.id });
      if (error) return alert("Couldn't remove it: " + error.message);
      loadMfaCard();
    });
    return;
  }

  host.innerHTML = `
    <div class="ops-row">
      <div><strong>Two-factor is off</strong><small>A phished password is currently enough to run this panel</small></div>
      <button class="btn btn-primary btn-sm" id="mfaOn">Turn on</button>
    </div>
    <div id="mfaEnroll"></div>`;
  $("mfaOn").addEventListener("click", startMfaEnroll);
}

async function startMfaEnroll() {
  const box = $("mfaEnroll");

  // An abandoned enrolment leaves an unverified factor behind, and a second
  // enroll() then fails on the duplicate name. Sweep those out first.
  try {
    const { data: f } = await supabase.auth.mfa.listFactors();
    for (const stale of (f?.all || []).filter((x) => x.status === "unverified")) {
      await supabase.auth.mfa.unenroll({ factorId: stale.id });
    }
  } catch (e) {}

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp", friendlyName: "Slutstation admin",
  });
  if (error) { box.innerHTML = `<p class="form-msg err">${esc(error.message)}</p>`; return; }

  box.innerHTML = `
    <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center;margin-top:14px;">
      <img src="${data.totp.qr_code}" alt="Scan this QR with your authenticator app" width="150" height="150" style="border-radius:8px;background:#fff;padding:6px;" />
      <div style="flex:1;min-width:220px;">
        <p style="color:var(--muted);font-size:0.9rem;">Scan with your authenticator app, or paste the secret by hand:</p>
        <code style="word-break:break-all;font-size:0.78rem;">${esc(data.totp.secret)}</code>
        <div class="field" style="max-width:200px;margin-top:10px;">
          <input id="mfaEnrollCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" />
        </div>
        <div class="form-actions" style="margin-top:10px;">
          <button class="btn btn-primary btn-sm" id="mfaEnrollGo">Confirm</button>
          <span class="form-msg" id="mfaEnrollMsg"></span>
        </div>
      </div>
    </div>`;

  $("mfaEnrollGo").addEventListener("click", async () => {
    const code = $("mfaEnrollCode")?.value.trim();
    const m = $("mfaEnrollMsg");
    if (!/^\d{6}$/.test(code || "")) return msg(m, "Six digits.");
    const { error: vErr } = await supabase.auth.mfa.challengeAndVerify({ factorId: data.id, code });
    if (vErr) return msg(m, "That code didn't match — try the next one your app shows.");
    msg(m, "On. From your next sign-in the panel asks for the code.", "ok");
    loadMfaCard();
  });
}

// ---------------------------------------------------------------------------
// TONIGHT
//
// On the day of an event the panel should know it. A list of four tabs is the
// right home page on the other 360 days a year and the wrong one on this one.
// The strip is one tap into that event; it renders nothing at all when there
// is nothing on, rather than sitting there saying "no event today".
// ---------------------------------------------------------------------------
function showTonight() {
  const strip = $("tonightStrip");
  if (!strip || !Array.isArray(events)) return;

  const now = Date.now();
  const ev = events.find((e) => {
    const t = new Date(e.starts_at).getTime();
    // From this morning until six hours after doors the following morning.
    return t > now - 30 * 3600 * 1000 && t < now + 18 * 3600 * 1000;
  });
  if (!ev) return;

  const doors = new Date(ev.starts_at).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  strip.hidden = false;
  strip.innerHTML = `
    <span class="tonight-tag">Tonight</span>
    <span class="tonight-name">${esc(ev.name)}</span>
    <span class="tonight-meta">${esc(ev.venue || "venue tbc")} · doors ${esc(doors)}</span>
    <span class="tonight-go">Open →</span>`;
  strip.addEventListener("click", (e) => {
    e.preventDefault();
    document.querySelector('[data-panel="events"]')?.click();
    openEvent(ev.id);
  });
}

boot();
