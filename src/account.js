// ============================================================================
// SLUTSTATION, account page logic
//
// Sign in, sign up (which also registers the member in eBas), password reset,
// profile editing, and the membership check.
//
// No secrets here. Supabase Auth owns password hashing and sessions; the eBas
// API key stays server-side in the `ebas` Edge Function.
// ============================================================================

import { SUPABASE_URL, SUPABASE_ANON_KEY, TURNSTILE_SITE_KEY, ENTRY_CODE } from "./supabase-config.js";
import { initI18n, t, getLang } from "./i18n.js";
import { initGlassLight } from "./liquid-glass.js";


// eBas gender ids: 1 = female, 2 = male, 3 = other / not stated
const GENDER_ID = { Female: 1, Male: 2, "Non-binary": 3, "Prefer not to say": 3 };

const $ = (id) => document.getElementById(id);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// --- page state guards -----------------------------------------------------
let recovering = false;
let loadedOnce = false;
let loading = false;

/* ---------------------------------------------------------------------------
   Chrome shared with the front page (announcement bar, sticky nav, mobile
   menu). Same behaviour as script.js, repeated here because this page does
   not load main.js.
   --------------------------------------------------------------------------- */
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
// The 12-second timeout is not paranoia either. A failed request rejects and is
// caught; a request that is *accepted and then never answered*, a captive
// portal, a phone that has drifted off wifi mid-load, never settles at all, so
// the await above it hangs, everything after it never runs, and the page sits
// on its spinner forever with no error to catch. Racing the import against a
// clock turns that silent hang into the same visible message as any other
// failure. Reproduced in headless Chromium, where the CDN request hung open.
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

  // DJ toggle on the signup form (same behaviour as the old one-pager form)
  const djSwitch = $("djSwitch");
  djSwitch?.addEventListener("click", () => {
    const on = djSwitch.classList.toggle("on");
    djSwitch.setAttribute("aria-pressed", String(on));
    $("djFields")?.classList.toggle("show", on);
  });

  if (window.emailjs && import.meta.env.VITE_EMAILJS_PUBLIC_KEY) {
    window.emailjs.init({ publicKey: import.meta.env.VITE_EMAILJS_PUBLIC_KEY });
  }

  $("navToggle")?.addEventListener("click", () => nav?.classList.toggle("open"));
  $("navLinks")?.querySelectorAll("a").forEach((a) =>
    a.addEventListener("click", () => nav?.classList.remove("open"))
  );
})();

// ---------------------------------------------------------------------------
// Cloudflare Turnstile
//
// Only loads if a site key is configured, so the page is unchanged until you
// set one. Each form gets its own widget; the token is single-use, so it is
// reset after every attempt, otherwise a failed signup can never be retried.
// ---------------------------------------------------------------------------
const captchaIds = {};

function mountCaptcha() {
  if (!TURNSTILE_SITE_KEY) return;
  const slots = document.querySelectorAll("[data-captcha]");
  if (!slots.length) return;

  const render = () => slots.forEach((slot) => {
    if (slot.dataset.rendered) return;
    slot.dataset.rendered = "1";
    captchaIds[slot.dataset.captcha] = window.turnstile.render(slot, {
      sitekey: TURNSTILE_SITE_KEY,
      theme: "dark",
      action: slot.dataset.captcha,
    });
  });

  if (window.turnstile) return render();
  const s = document.createElement("script");
  s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  s.async = true;
  s.defer = true;
  s.onload = render;
  document.head.appendChild(s);
}

function captchaToken(which) {
  const id = captchaIds[which];
  if (!id || !window.turnstile) return undefined;
  return window.turnstile.getResponse(id) || undefined;
}

function resetCaptcha(which) {
  const id = captchaIds[which];
  if (id && window.turnstile) window.turnstile.reset(id);
}

mountCaptcha();

// ---------------------------------------------------------------------------
// Sign in with Google
//
// The button configures itself: it asks Supabase which external providers are
// switched on and only appears when Google is among them. So this ships dark,
// and the moment the Google credentials are saved in the Supabase dashboard
// the button shows up on the live site with no code change. (The alternative,
// a hardcoded flag, is exactly how buttons end up pointing at providers that
// were never configured.)
//
// Google accounts arrive with a verified email, so these signups skip the
// confirmation email entirely, which also means they cannot be hurt by the
// mail server's hourly ceiling on a busy night.
// ---------------------------------------------------------------------------
async function initGoogleSignin() {
  const wrap = $("googleWrap"), actions = $("googleActions"), btn = $("googleBtn");
  if (!btn) return;
  // Waits for the client rather than testing for it. This runs at module level,
  // and once the SDK stopped being a top-level await, `supabase` was still null
  // at this point — so `!supabase` was true every single time, the function
  // returned before it asked Supabase anything, and the button stayed hidden
  // on a site where Google sign-in was in fact switched on. Same mistake as the
  // auth listener; this one just took longer to notice, because a button that
  // is meant to stay hidden until it is configured looks identical to a button
  // that is broken.
  if (!(await sdkReady)) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: SUPABASE_ANON_KEY },
    });
    const settings = await res.json();
    if (!settings?.external?.google) return;   // not configured: stay hidden
  } catch { return; }

  wrap.hidden = false;
  actions.hidden = false;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/account.html` },
    });
    if (error) {
      btn.disabled = false;
      setMsg($("signinMsg"), friendlyAuthError(error));
    }
    // On success the browser is already on its way to Google.
  });
}
initGoogleSignin();

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function show(stateId) {
  ["stateLoading", "stateAuth", "stateAccount", "stateReset"].forEach((id) => {
    const el = $(id);
    if (el) el.hidden = id !== stateId;
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
  if (on) {
    btn.dataset.label = btn.textContent;
    btn.disabled = true;
    btn.textContent = label || t("ui.sending");
  } else {
    btn.disabled = false;
    btn.textContent = btn.dataset.label || btn.textContent;
  }
}

function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(getLang() === "sv" ? "sv-SE" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function friendlyAuthError(error) {
  const m = (error?.message || "").toLowerCase();
  if (m.includes("invalid login")) return t("err.badLogin");
  if (m.includes("email not confirmed")) return t("err.notConfirmed");
  if (m.includes("already registered")) return t("err.exists");
  // The email rate limit is the one that bites on a busy night. Say what has
  // actually happened and what to do, rather than "try again in a minute":
  // the account usually exists by this point and only the email is missing.
  if (m.includes("email rate limit") || m.includes("over_email_send_rate_limit")) return t("err.emailBusy");
  if (m.includes("rate limit") || m.includes("too many")) return t("err.tooMany");
  if (m.includes("captcha")) return t("err.captcha");
  if (m.includes("password")) return t("err.password");
  return error?.message || t("err.generic");
}

// ---------------------------------------------------------------------------
// tabs
// ---------------------------------------------------------------------------
document.querySelectorAll(".acc-tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".acc-tabs .tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".acc-pane").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    $(tab.dataset.pane === "signup" ? "signupForm" : "signinForm")?.classList.add("active");
  });
});

// ---------------------------------------------------------------------------
// SIGN IN
// ---------------------------------------------------------------------------
$("signinForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const msg = $("signinMsg");
  setMsg(msg, "");

  const email = form.email.value.trim();
  const password = form.password.value;

  if (!EMAIL_RE.test(email)) return setMsg(msg, t("err.email"));
  if (!password) return setMsg(msg, t("err.needPw"));

  busy(form, true, t("ui.signingIn"));
  const { error } = await supabase.auth.signInWithPassword({
    email, password, options: { captchaToken: captchaToken("signin") },
  });
  resetCaptcha("signin");
  busy(form, false);

  if (error) return setMsg(msg, friendlyAuthError(error));
  await loadAccount();
});

// ---------------------------------------------------------------------------
// SIGN UP, creates the account AND registers the member in eBas
// ---------------------------------------------------------------------------
$("signupForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const msg = $("signupMsg");
  setMsg(msg, "");

  for (const field of form.querySelectorAll("[required]")) {
    const ok = field.type === "checkbox" ? field.checked : field.value.trim();
    if (!ok) {
      setMsg(msg, t("err.required"));
      field.focus();
      return;
    }
  }

  const d = Object.fromEntries(new FormData(form).entries());

  if (!EMAIL_RE.test((d.email || "").trim())) return setMsg(msg, t("err.email"));
  if ((d.password || "").length < 8) return setMsg(msg, t("err.password"));

  busy(form, true, t("ui.creating"));

  const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
    email: d.email.trim(),
    password: d.password,
    options: {
      emailRedirectTo: `${window.location.origin}/account.html`,
      captchaToken: captchaToken("signup"),
      data: {
        first_name: d.first?.trim(),
        last_name: d.last?.trim(),
        phone: d.phone?.trim(),
        birth_date: d.dob || null,
        gender_id: GENDER_ID[d.gender] ?? 3,
        street: d.street?.trim(),
        zip_code: d.zip?.trim(),
        city: d.city?.trim(),
        marketing_consent: !!d.newsletter,
        terms_accepted: !!d.agree,
      },
    },
  });

  resetCaptcha("signup");

  if (signUpErr) {
    busy(form, false);
    return setMsg(msg, friendlyAuthError(signUpErr));
  }

  // The account exists either way; what this tells us is whether the DJ half
  // of the form actually went anywhere, so we can say so instead of showing a
  // success screen over a submission that vanished.
  const djOk = await maybeSendDjApplication(d);

  // Email confirmation on -> no session yet, so eBas registration happens on
  // their first signed-in visit instead (see loadAccountInner).
  if (!signUpData.session) {
    busy(form, false);
    form.reset();
    return setMsg(msg, djOk === false ? t("acct.djFailed") : t("acct.created"),
                  djOk === false ? "err" : "ok");
  }
  if (djOk === false) setMsg(msg, t("acct.djFailed"), "err");

  await registerWithEbas();
  busy(form, false);
  await loadAccount();
});

// ---------------------------------------------------------------------------
// PASSWORD
// ---------------------------------------------------------------------------
$("forgotBtn")?.addEventListener("click", async () => {
  const msg = $("signinMsg");
  const email = $("signinForm")?.email.value.trim();
  if (!EMAIL_RE.test(email || "")) {
    return setMsg(msg, t("err.needEmailFirst"));
  }
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/account.html`,
    captchaToken: captchaToken("signin"),
  });
  resetCaptcha("signin");
  setMsg(msg, error ? friendlyAuthError(error) : t("acct.resetSent"), error ? "err" : "ok");
});

// If the hourly email limit was hit at signup, the account exists but the
// confirmation email never left. This is the way back in, and it is worth a
// visible button rather than an email to info@, because on a busy night it is
// the single most likely support question.
$("resendBtn")?.addEventListener("click", async () => {
  const msg = $("signinMsg");
  const email = $("signinForm")?.email.value.trim();
  if (!EMAIL_RE.test(email || "")) return setMsg(msg, t("acct.resendNeedEmail"));

  setMsg(msg, t("acct.resendSending"), "ok");
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: {
      emailRedirectTo: `${window.location.origin}/account.html`,
      captchaToken: captchaToken("signin"),
    },
  });
  resetCaptcha("signin");
  setMsg(msg, error ? friendlyAuthError(error) : t("acct.resendSent"), error ? "err" : "ok");
});

$("changePwBtn")?.addEventListener("click", async () => {
  const msg = $("detailsMsg");
  const { data } = await supabase.auth.getUser();
  const email = data?.user?.email;
  if (!email) return;
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/account.html`,
  });
  setMsg(msg, error ? friendlyAuthError(error) : t("acct.resetSent"), error ? "err" : "ok");
});

$("resetForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const msg = $("resetMsg");
  setMsg(msg, "");

  const pw = form.password.value;
  if (pw.length < 8) return setMsg(msg, t("err.password"));
  if (pw !== form.confirm.value) return setMsg(msg, t("err.pwMismatch"));

  busy(form, true, t("ui.updating"));
  const { error } = await supabase.auth.updateUser({ password: pw });
  busy(form, false);

  if (error) return setMsg(msg, friendlyAuthError(error));
  setMsg(msg, t("acct.pwUpdated"), "ok");
  recovering = false;
  await loadAccount();
});

// ---------------------------------------------------------------------------
// SIGN OUT
// ---------------------------------------------------------------------------
$("signoutBtn")?.addEventListener("click", async () => {
  await supabase.auth.signOut();
  show("stateAuth");
});

// ---------------------------------------------------------------------------
// eBas
// ---------------------------------------------------------------------------
async function callEbas(action) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ok: false, error: t("err.notSignedIn") };
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/ebas`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    return await res.json();
  } catch (err) {
    console.error("eBas call failed:", err);
    return { ok: false, error: t("err.noServer") };
  }
}
const registerWithEbas = () => callEbas("register");

// ---------------------------------------------------------------------------
// MEMBERSHIP CARD
// ---------------------------------------------------------------------------
const CHECK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" width="22" height="22" aria-hidden="true">' +
  '<path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function renderMembership(row) {
  const card = $("membershipCard");
  const icon = $("statusIcon");
  const title = $("statusTitle");
  const detail = $("statusDetail");
  const join = $("joinBtn");

  card.classList.remove("is-active", "is-expired", "is-unverified", "is-failed", "is-pending");

  // Registered in eBas, but the check is held back for a little while. The
  // delay lives in the membership_status view, so this branch is the only thing
  // the page has to know about it.
  if (row?.pending_approval) {
    card.classList.add("is-pending");
    icon.innerHTML = '<span class="pending-dot" aria-hidden="true"></span>';
    title.textContent = t("ms.pendingT");
    detail.textContent = t("ms.pendingB");
    join.hidden = true;
    schedulePendingRefresh();
    return;
  }

  if (row?.is_active_member) {
    card.classList.add("is-active");
    icon.innerHTML = CHECK_SVG;
    title.textContent = t("ms.activeT");
    // Membership runs by calendar year, so the useful thing to say is which
    // year it covers, not a date twelve months out that would be misleading.
    if (row.expires_on) {
      const year = new Date(row.expires_on).getFullYear();
      const left = row.days_left;
      detail.textContent = left != null && left <= 45
        ? t("ms.activeSoon", { year, days: left })
        : t("ms.activeB", { year });
    } else {
      detail.textContent = t("ms.verified");
    }
    join.hidden = true;
    return;
  }

  if (row?.ebas_status === "expired") {
    card.classList.add("is-expired");
    icon.textContent = "!";
    title.textContent = t("ms.expiredT");
    detail.textContent = t("ms.expiredB", { year: row.expires_on ? new Date(row.expires_on).getFullYear() : "" });
    join.hidden = false;
    join.textContent = t("acct.renew");
    return;
  }

  if (row?.ebas_status === "failed") {
    card.classList.add("is-failed");
    icon.textContent = "!";
    title.textContent = t("ms.failedT");
    detail.textContent = row.ebas_message
      ? `eBas: ${row.ebas_message}`
      : t("ms.failedB");
    join.hidden = false;
    join.textContent = t("acct.tryAgain");
    return;
  }

  card.classList.add("is-unverified");
  icon.textContent = "–";
  title.textContent = t("ms.noneT");
  detail.textContent = t("ms.noneB");
  join.hidden = false;
  join.textContent = t("acct.register");
}

$("verifyBtn")?.addEventListener("click", async (e) => {
  const btn = e.target, label = btn.textContent;
  btn.disabled = true; btn.textContent = t("ui.checking");
  await callEbas("verify");
  await refreshMembership();
  btn.disabled = false; btn.textContent = label;
});

$("joinBtn")?.addEventListener("click", async (e) => {
  const btn = e.target, label = btn.textContent;

  // If the address or birth date is missing (the usual case for a Google
  // signup), registering would just bounce off eBas. Send them to the form
  // that fixes it instead of showing an error and leaving them to hunt.
  const incomplete = !$("d-street").value.trim() || !$("d-dob").value
    || ($("dTermsWrap") && !$("dTermsWrap").hidden && !$("d-terms").checked);
  if (incomplete) {
    const finish = $("finishJoin");
    if (finish) finish.hidden = false;
    document.getElementById("detailsForm")?.scrollIntoView({ behavior: "smooth", block: "center" });
    ($("d-dob").value ? $("d-street") : $("d-dob"))?.focus();
    setMsg($("detailsMsg"), t("acct.finishJoin"));
    return;
  }

  btn.disabled = true; btn.textContent = t("ui.registering");
  const result = await registerWithEbas();
  await refreshMembership();
  btn.disabled = false; btn.textContent = label;
  if (result && result.ok === false && result.fields) {
    setMsg($("detailsMsg"), t("acct.finishJoin"));
  }
});

// While the check is pending, look again every 45 seconds so it turns green
// without the member having to reload and wonder. One timer, never stacked.
let pendingTimer = null;
function schedulePendingRefresh() {
  if (pendingTimer) return;
  pendingTimer = setTimeout(async () => {
    pendingTimer = null;
    await refreshMembership();
    await refreshStats();
  }, 45000);
}

// Always scope to the signed-in user's own id, and use maybeSingle().
//
// This is not belt-and-braces, it is a real bug that was live: `membership_status`
// is a security_invoker view over `profiles`, and the RLS policy on `profiles`
// lets admins and staff read everyone. So for a normal member the view returned
// one row and `.single()` was happy, but for an admin it returned every member,
// `.single()` threw PGRST116, `data` came back null, and the page told the admin
// they had no membership. It looked correct for everyone we were not.
async function refreshMembership() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return renderMembership(null);
  const { data, error } = await supabase
    .from("membership_status").select("*").eq("id", user.id).maybeSingle();
  if (error) console.warn("membership_status:", error.message);
  renderMembership(data);
}

// ---------------------------------------------------------------------------
// DETAILS
// ---------------------------------------------------------------------------
$("detailsForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const msg = $("detailsMsg");
  setMsg(msg, "");
  busy(form, true, t("ui.saving"));

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { busy(form, false); return; }

  // An account that has never accepted the terms (created with Google) must
  // tick the membership box before anything is registered anywhere.
  const termsWrap = $("dTermsWrap");
  const needsTerms = termsWrap && !termsWrap.hidden;
  if (needsTerms && !$("d-terms").checked) {
    busy(form, false);
    return setMsg(msg, t("acct.termsFirst"));
  }

  const genderVal = $("d-gender")?.value;
  const patch = {
    first_name: $("d-first").value.trim() || null,
    last_name:  $("d-last").value.trim()  || null,
    phone:      $("d-phone").value.trim() || null,
    birth_date: $("d-dob").value || null,
    gender_id:  genderVal ? Number(genderVal) : null,
    street:     $("d-street").value.trim() || null,
    zip_code:   $("d-zip").value.trim()    || null,
    city:       $("d-city").value.trim()   || null,
    marketing_consent: $("d-newsletter").checked,
    notify_lastminute: $("d-lastminute") ? $("d-lastminute").checked : true,
  };
  if (needsTerms) patch.terms_accepted_at = new Date().toISOString();

  const { error } = await supabase.from("profiles").update(patch).eq("id", user.id);

  busy(form, false);
  setMsg(msg, error ? t("err.saveDetails") : t("ui.saved"), error ? "err" : "ok");

  // If that save completed the picture (address, birth date, accepted terms)
  // and the member has never reached eBas, register them now rather than on
  // the next reload, so the pending-approval state appears while they watch.
  if (!error) {
    if (needsTerms) termsWrap.hidden = true;
    const { data: fresh } = await supabase
      .from("profiles").select("ebas_status, street, birth_date, terms_accepted_at")
      .eq("id", user.id).maybeSingle();
    if (fresh?.ebas_status === "unverified" && fresh.street && fresh.birth_date
        && fresh.terms_accepted_at) {
      const res = await registerWithEbas();
      await refreshMembership();
      // Application is in; the "finish your membership" prompt has done its job.
      if (res?.ok !== false) { const f = $("finishJoin"); if (f) f.hidden = true; }
    }
  }
});

// ---------------------------------------------------------------------------
// LOAD
// ---------------------------------------------------------------------------
async function loadAccount() {
  if (loading) return;
  loading = true;
  try {
    await loadAccountInner();
    loadedOnce = true;
  } finally {
    loading = false;
  }
}

async function loadAccountInner() {
  // The SDK arrives on its own schedule. Waiting for it HERE rather than at
  // the top of the file is the whole point: the page is interactive while
  // this is still in flight. `false` means it never came and the message is
  // already on screen.
  if (!(await sdkReady)) return;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return show("stateAuth");

  const { data: profile, error } = await supabase
    .from("profiles").select("*").eq("id", session.user.id).single();

  if (error) {
    console.error("profile load:", error.message);
    return show("stateAuth");
  }

  $("greeting").textContent = profile.first_name ? `${t("acct.welcome")}, ${profile.first_name}` : t("acct.welcome");
  $("accEmail").textContent = profile.email;

  $("d-first").value  = profile.first_name || "";
  $("d-last").value   = profile.last_name  || "";
  $("d-phone").value  = profile.phone      || "";
  $("d-dob").value    = profile.birth_date || "";
  if ($("d-gender")) $("d-gender").value = profile.gender_id != null ? String(profile.gender_id) : "";
  $("d-street").value = profile.street     || "";
  $("d-zip").value    = profile.zip_code   || "";
  $("d-city").value   = profile.city       || "";
  $("d-email").value  = profile.email      || "";
  $("d-newsletter").checked = !!profile.marketing_consent;
  if ($("d-lastminute")) $("d-lastminute").checked = profile.notify_lastminute !== false;

  // A Google-created account has never ticked the membership terms. The box
  // appears once, pre-unticked, and registration with eBas waits for it.
  const termsWrap = $("dTermsWrap");
  if (termsWrap) termsWrap.hidden = !!profile.terms_accepted_at;

  // A member who has not applied yet, most often a Google signup, arrives with
  // no address or birth date. eBas legally needs both (Google hands over only a
  // name and email), so the application can't be sent automatically. Point them
  // straight at the two fields that finish it.
  const finish = $("finishJoin");
  if (finish) {
    const incomplete = profile.ebas_status === "unverified"
      && (!profile.street || !profile.birth_date || !profile.terms_accepted_at);
    finish.hidden = !incomplete;
  }

  applyDetailsState(profile);

  show("stateAccount");

  // Confirmed their email after signing up but never reached eBas, do it now.
  if (profile.ebas_status === "unverified" && profile.street && profile.birth_date
      && profile.terms_accepted_at) {
    await registerWithEbas();
  }

  // Four independent reads, run them together. Serially this was four network
  // round-trips stacked end to end, which is most of the pause between "page
  // shows" and "membership turns green" on a phone connection.
  // Dormant until we scan at the door: the panel is hidden in the markup and
  // only this call would reveal it, so nothing is generated or drawn.
  if (ENTRY_CODE) {
    const qrPanel = $("qrPanel");
    if (qrPanel) qrPanel.hidden = false;
    renderEntryQr(session.user.id);
  }
  await Promise.all([
    refreshMembership(),
    refreshStats(),
    refreshTickets(),
    refreshHistory(),
    refreshShifts(),
    refreshPromo(),
    showRoleLinks(profile),
  ]);
}

sdkReady.then((ok) => {
  if (!ok) return;
  supabase.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") {
      recovering = true;
      return show("stateReset");
    }
    if (recovering) return;
    if (event === "SIGNED_IN" || event === "INITIAL_SESSION") loadAccount();
    if (event === "SIGNED_OUT") show("stateAuth");
  });
});

// Safety net if onAuthStateChange never fires (blocked storage, old SDK).
setTimeout(() => { if (!loadedOnce && !recovering) loadAccount(); }, 1200);


// ---------------------------------------------------------------------------
// TIER + STATS
// ---------------------------------------------------------------------------
function fmtShort(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(getLang() === "sv" ? "sv-SE" : "en-GB", { day: "numeric", month: "short", year: "2-digit" });
}

async function refreshStats() {
  // Scoped by id for the same reason refreshMembership() is, member_stats is
  // also a security_invoker view over profiles, so an admin sees every row and
  // an unscoped .single() would throw instead of returning their own numbers.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data, error } = await supabase
    .from("member_stats").select("*").eq("id", user.id).maybeSingle();
  if (error || !data) { console.warn("member_stats:", error?.message); return; }

  $("statWindow").textContent = data.events_window ?? 0;
  $("statTotal").textContent  = data.events_total ?? 0;
  $("statFirst").textContent  = fmtShort(data.first_attended_at);
  $("statLast").textContent   = fmtShort(data.last_attended_at);

  $("tierBadge").textContent = data.tier_name || "Tier 1";
  renderReferral(data);

  // Light up where they are on the published ladder, and dim what is behind
  // them: what you already have is not the thing worth looking at.
  const ladder = $("tierLadder");
  if (ladder) {
    [...ladder.children].forEach((li, i) => {
      li.classList.toggle("is-you", i + 1 === (data.tier ?? 1));
      li.classList.toggle("is-done", i + 1 < (data.tier ?? 1));
    });
  }

  const floor = data.tier_floor ?? 0;
  const ceil  = data.next_tier_at;          // null once they're at the top
  const have  = data.events_window ?? 0;

  if (ceil == null) {
    $("tierNext").innerHTML = t("ms.topTier");
    $("tierFill").style.width = "100%";
    $("tierScale").innerHTML = `<span>${floor} ${t("ms.eventsWord")}</span><span>${t("ms.max")}</span>`;
  } else {
    const need = data.events_to_next_tier ?? Math.max(ceil - have, 0);
    $("tierNext").innerHTML = need === 0
      ? t("ms.unlocked")
      : t("ms.toNext", { n: need, t: data.next_tier });
    // progress within the current band, not from zero, otherwise Tier 3 at
    // 4/8 events looks like half of nothing.
    const span = Math.max(ceil - floor, 1);
    const pct  = Math.min(Math.max((have - floor) / span, 0), 1) * 100;
    $("tierFill").style.width = pct.toFixed(1) + "%";
    $("tierScale").innerHTML = `<span>${floor} ${t("ms.eventsWord")}</span><span>${t("ms.tierAt", { t: data.next_tier, n: ceil })}</span>`;
  }
}

// ---------------------------------------------------------------------------
// INVITE CODE
//
// This has existed in the database since the first schema and has never once
// been on screen. There is no reward attached to it yet and that is fine: the
// code has to be visible before anybody can use it, and the referrals it
// collects in the meantime are what make a reward worth designing later.
// ---------------------------------------------------------------------------
function renderReferral(data) {
  const wrap = $("referWrap");
  if (!wrap || !data.referral_code) return;
  wrap.hidden = false;
  $("refCode").textContent = data.referral_code;

  const q = data.referrals_qualified ?? 0;
  const p = data.referrals_pending ?? 0;
  const line = $("refStats");
  if (line) line.textContent = (q || p) ? t("acct.refCount", { q, p }) : t("acct.refNone");
}

$("refCopy")?.addEventListener("click", async (e) => {
  const code = $("refCode")?.textContent?.trim();
  if (!code) return;
  const btn = e.currentTarget;
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    // Clipboard is blocked on insecure origins and in some in-app browsers.
    // Selecting the text is a worse experience but it is not a dead button.
    const r = document.createRange();
    r.selectNodeContents($("refCode"));
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(r);
  }
  const was = btn.textContent;
  btn.textContent = t("acct.refCopied");
  setTimeout(() => { btn.textContent = was; }, 1600);
});

// ---------------------------------------------------------------------------
// YOUR NIGHTS
//
// One sentence and a list. Both come from tables that have been sitting there
// the whole time, and neither exists anywhere else a member could go, which is
// the entire argument for putting them here rather than on Instagram.
// ---------------------------------------------------------------------------
function fmtNight(iso) {
  return new Date(iso).toLocaleDateString(getLang() === "sv" ? "sv-SE" : "en-GB",
    { day: "numeric", month: "long", year: "numeric" });
}

function fmtMonthYear(iso) {
  return new Date(iso).toLocaleDateString(getLang() === "sv" ? "sv-SE" : "en-GB",
    { month: "long", year: "numeric" });
}

// Saving the code to the camera roll. The page already works offline once it
// has loaded, but somebody who has never opened it in the forest has nothing,
// and a photo survives a dead signal, a flat battery on someone else's phone,
// and being handed to a friend.
$("qrSave")?.addEventListener("click", () => {
  const canvas = $("memberQr");
  if (!canvas) return;
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = "slutstation-entry-code.png";
  a.click();
});

async function refreshHistory() {
  const panel = $("historyPanel");
  if (!panel) return;

  const { data, error } = await supabase.rpc("my_history");
  if (error) { console.warn("my_history:", error.message); return; }

  const nights = data?.nights || [];
  if (!nights.length) return;          // stays hidden until there is something to say

  panel.hidden = false;

  // "You have been to 7 Slutstation events since May 2025." The since-date is
  // the first night, not the join date: turning up is what the sentence is about.
  const lead = $("histLead");
  if (lead) {
    lead.textContent = nights.length === 1
      ? t("acct.histOne", { date: fmtMonthYear(nights[0].checked_in_at) })
      : t("acct.histMany", { n: nights.length, date: fmtMonthYear(nights[nights.length - 1].checked_in_at) });
  }

  const milestones = data?.milestones || [];
  // Tier promotions are attached to the night that earned them, so the list
  // reads "…and that was the night you reached Tier 3".
  const tierByNight = new Map();
  for (const m of milestones) {
    if (m.kind === "tier_up" && m.occurred_at) tierByNight.set(m.occurred_at, m.tier);
  }

  $("histList").innerHTML = nights.map((n) => {
    const tier = tierByNight.get(n.checked_in_at);
    return `<li class="hist-row">
      <div class="hist-when"><b>${escHtml(fmtNight(n.checked_in_at))}</b></div>
      <div class="hist-what">
        <strong>${escHtml(n.name)}</strong>
        ${n.venue ? `<small>${escHtml(n.venue)}</small>` : ""}
      </div>
      ${tier ? `<span class="hist-tier">${escHtml(t("acct.histTier", { t: tier }))}</span>` : ""}
    </li>`;
  }).join("");

  // my_history caps at 40 so a very long member does not download their whole
  // life on every page load. Say so rather than quietly truncating.
  const more = $("histMore");
  if (more) more.hidden = nights.length < 40;
}

// ---------------------------------------------------------------------------
// ENTRY QR, this is what the door scans.
// The payload is just the account id: a v4 UUID is not guessable, and the
// check-in endpoint refuses anyone who is not door staff on shift, so a
// copied code gets a stranger nothing.
// ---------------------------------------------------------------------------
async function renderEntryQr(userId) {
  const canvas = $("memberQr");
  if (!canvas) return;
  try {
    const QR = (await import("https://esm.sh/qrcode@1.5.4")).default;
    await QR.toCanvas(canvas, userId, {
      width: 220, margin: 1,
      color: { dark: "#0a0b0f", light: "#ffffff" },
    });
  } catch (err) {
    console.error("QR render failed:", err);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 220, 220);
    ctx.fillStyle = "#0a0b0f"; ctx.font = "13px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(t("acct.qrFail1"), 110, 100);
    ctx.fillText(t("acct.qrFail2"), 110, 120);
  }
}

// ---------------------------------------------------------------------------
// TICKETS THEY HOLD
// Past events drop off after the night is over, so the panel shows what's
// actually useful rather than a growing archive.
// ---------------------------------------------------------------------------
const escHtml = (v) => String(v ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function refreshTickets() {
  const panel = $("ticketsPanel");
  const host = $("ticketCards");
  if (!panel || !host) return;

  const { data, error } = await supabase.rpc("my_tickets");
  if (error) { console.warn("my_tickets:", error.message); return; }

  const cutoff = Date.now() - 12 * 3600 * 1000;
  const live = (data || []).filter((row) => new Date(row.starts_at).getTime() > cutoff);

  if (!live.length) { panel.hidden = true; return; }
  panel.hidden = false;

  // On the day itself the page reorders itself around tonight. Tickets and the
  // entry code go above the membership card and everything else, because at
  // 23:40 in a queue that is the only thing anybody opens this page for.
  const tonight = live.some((row) => {
    const d = new Date(row.starts_at);
    const now = new Date();
    return d.toDateString() === now.toDateString()
        || (d < now && d.getTime() > now.getTime() - 12 * 3600 * 1000);
  });
  if (tonight) {
    const first = $("membershipCard");
    const qr = $("qrPanel");
    if (first?.parentNode) {
      first.parentNode.insertBefore(panel, first);
      if (qr && !qr.hidden) first.parentNode.insertBefore(qr, first);
    }
    document.body.classList.add("is-event-day");
  }

  host.innerHTML = live.map((tk) => `
    <div class="tk-card ${tk.status === "used" ? "is-used" : ""}">
      <h4>${escHtml(tk.type_name)}</h4>
      <canvas data-qr="${escHtml(tk.code)}" width="168" height="168"></canvas>
      <span class="tk-code">${escHtml(tk.code)}</span>
      <span class="tk-sub">${escHtml(tk.event_name)}<br />${escHtml(
        new Date(tk.starts_at).toLocaleDateString("sv-SE", { day: "numeric", month: "short" })
      )}${tk.status === "used" ? " · " + t("ms.scanned") : ""}</span>
    </div>`).join("");

  try {
    const QR = (await import("https://esm.sh/qrcode@1.5.4")).default;
    for (const c of host.querySelectorAll("canvas[data-qr]")) {
      await QR.toCanvas(c, c.dataset.qr, {
        width: 168, margin: 1, color: { dark: "#0a0b0f", light: "#ffffff" },
      });
    }
  } catch (err) {
    // The printed code below each QR is the ticket; the door can type it.
    console.error("ticket QR render failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Show the Staff / Admin links only to people who actually have them.
// These are convenience links; the pages themselves re-check server-side.
// ---------------------------------------------------------------------------
async function showRoleLinks(profile) {
  if (profile?.role === "admin") {
    $("navAdmin")?.removeAttribute("hidden");
    $("navStaff")?.removeAttribute("hidden");
    return;
  }
  const { data } = await supabase.rpc("my_shift");
  if (data) $("navStaff")?.removeAttribute("hidden");
}


// ---------------------------------------------------------------------------
// DJ application, emailed, not stored. Never blocks signup: if EmailJS fails
// the account is already created and we don't want to lose the member over it.
// ---------------------------------------------------------------------------
// Returns null when there was no DJ application to send, true when it went,
// false when it did not. The distinction matters: this is the one form on the
// site whose only delivery path is a third-party script from a CDN plus three
// build-time variables, and until now every way it could fail was swallowed —
// EmailJS blocked by an ad blocker, VITE_EMAILJS_* missing from the build, the
// send rejected. The applicant saw "account created" and info@slutstation.se
// got nothing. The account is still never held up by any of that.
async function maybeSendDjApplication(d) {
  if (!$("djSwitch")?.classList.contains("on")) return null;

  const service  = import.meta.env.VITE_EMAILJS_SERVICE_ID;
  const template = import.meta.env.VITE_EMAILJS_TEMPLATE_ID;
  if (!window.emailjs || !service || !template) {
    console.error("DJ application not sent: EmailJS unavailable or not configured.");
    return false;
  }
  try {
    await window.emailjs.send(
      service,
      template,
      {
        to_email: "info@slutstation.se",
        from_name: d.artist || `${d.first || ""} ${d.last || ""}`.trim(),
        from_email: d.email,
        genre: d.genre || "",
        social_media: d.socials || "",
        set_link: d.mix || "",
        message: [
          `DJ application from ${d.first || ""} ${d.last || ""}`.trim(),
          `Artist name: ${d.artist || ""}`,
          d.about ? `About: ${d.about}` : "",
        ].filter(Boolean).join("\n"),
      }
    );
    return true;
  } catch (err) {
    console.error("DJ application email failed (account still created):", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// WHEN YOU WORK
//
// Anyone holding a door or bar tag, which now includes approved volunteers.
// The countdown is the point: a date tells you when the event is, and what a
// volunteer actually wants to know is how long until they have to be there.
// ---------------------------------------------------------------------------
let shiftTimer;

function untilParts(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const mins = Math.floor(ms / 60000);
  return { d: Math.floor(mins / 1440), h: Math.floor((mins % 1440) / 60), m: mins % 60 };
}

// Two units, never three: "3 days 4 hours" reads; "3 days 4 hours 12 minutes"
// is a stopwatch. Under an hour it drops to minutes, where a minute matters.
function countdownText(iso) {
  const p = untilParts(iso);
  if (!p) return null;
  if (p.d > 0) return t("shift.inDH", { d: p.d, h: p.h });
  if (p.h > 0) return t("shift.inHM", { h: p.h, m: p.m });
  return t("shift.inM", { m: Math.max(p.m, 1) });
}

function paintCountdowns() {
  document.querySelectorAll("[data-countdown]").forEach((el) => {
    const txt = countdownText(el.dataset.countdown);
    el.textContent = txt || t("shift.now");
    el.classList.toggle("is-now", !txt);
  });
}

async function refreshShifts() {
  const panel = $("shiftsPanel");
  if (!panel) return;

  const { data, error } = await supabase.rpc("my_shifts");
  if (error) { console.warn("my_shifts:", error.message); return; }
  const shifts = data || [];
  if (!shifts.length) return;      // no tag, no panel

  panel.hidden = false;

  const now = Date.now();
  $("shiftList").innerHTML = shifts.map((sh) => {
    const started = new Date(sh.starts_at).getTime() <= now;
    const over = new Date(sh.access_until).getTime() < now;
    const role = sh.staff_role === "door" ? t("st.roleDoor") : t("st.roleBar");

    return `<div class="shift-row ${sh.active_now ? "is-live" : over ? "is-past" : ""}">
      <div class="shift-when">
        <span class="shift-tag ${escHtml(sh.staff_role)}">${escHtml(role)}</span>
        ${over
          ? `<span class="shift-count">${escHtml(t("shift.done"))}</span>`
          : `<span class="shift-count" data-countdown="${escHtml(started ? sh.access_until : sh.starts_at)}"></span>`}
      </div>
      <div class="shift-what">
        <strong>${escHtml(sh.name)}</strong>
        <small>${escHtml(fmtWhenFull(sh.starts_at))}${sh.venue ? " · " + escHtml(sh.venue) : ""}</small>
        ${sh.info ? `<p class="shift-info">${escHtml(sh.info)}</p>` : ""}
      </div>
      ${sh.active_now
        ? `<a class="btn btn-primary btn-sm" href="/staff.html">${escHtml(t("shift.open"))}</a>`
        : `<span class="shift-opens">${escHtml(t("shift.opens", { time: fmtTime(sh.access_from) }))}</span>`}
    </div>`;
  }).join("");

  paintCountdowns();
  clearInterval(shiftTimer);
  // Once a minute is enough: the smallest unit shown is a minute.
  shiftTimer = setInterval(paintCountdowns, 60000);
}

const fmtWhenFull = (iso) => new Date(iso).toLocaleString(getLang() === "sv" ? "sv-SE" : "en-GB",
  { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
const fmtTime = (iso) => new Date(iso).toLocaleString(getLang() === "sv" ? "sv-SE" : "en-GB",
  { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// ---------------------------------------------------------------------------
// YOUR CODE
//
// Four numbers and one chart. The chart is a stacked bar per week, twelve
// weeks, "turned up" in the accent under "hasn't yet" in gray — the emphasis
// pattern rather than two competing colours, because turning up is the point
// and the rest is context.
//
// Hand-built SVG on purpose. A charting library is 90KB to draw twelve bars,
// and this has to work on a phone on 3G in a queue.
// ---------------------------------------------------------------------------
const CHART = {
  h: 190,
  padL: 30, padR: 8, padT: 14, padB: 26,
  gap: 2,                     // surface gap between the two stacked segments
  radius: 4,                  // rounded data-end, baseline stays square
};

// The viewBox width tracks the real one, so the SVG renders near 1:1 and the
// 10px axis labels stay 10px. A fixed 640 viewBox squeezed into a 340px phone
// rendered them at about 5px, which is not a label, it is a smudge.
const chartWidth = () => Math.round(Math.min(Math.max(window.innerWidth - 96, 300), 720));

function barPath(x, y, w, h, r) {
  // Rounded on top only, so the bar reads as anchored to the axis rather than
  // floating above it. Degenerate heights fall back to a plain rect.
  if (h <= r) return `M${x},${y + h} h${w} v${-h} h${-w} Z`;
  return `M${x},${y + h} v${-(h - r)} q0,${-r} ${r},${-r} h${w - 2 * r} q${r},0 ${r},${r} v${h - r} Z`;
}

function drawPromoChart(weekly) {
  const rows = weekly || [];
  const max = Math.max(1, ...rows.map((r) => r.signups));
  const { h, padL, padR, padT, padB, gap, radius } = CHART;
  const w = chartWidth();
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const step = plotW / Math.max(rows.length, 1);
  const bw = Math.min(step * 0.62, 26);

  // Three gridlines and nothing else. Recessive: they are there to be measured
  // against, not read.
  const ticks = [0, Math.round(max / 2), max].filter((v, i, a) => a.indexOf(v) === i);
  const grid = ticks.map((v) => {
    const y = padT + plotH - (v / max) * plotH;
    return `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" class="cg" />
            <text x="${padL - 6}" y="${y + 3.5}" class="ct ct-y">${v}</text>`;
  }).join("");

  const bars = rows.map((r, i) => {
    const x = padL + i * step + (step - bw) / 2;
    const up = r.turned_up || 0;
    const wait = Math.max((r.signups || 0) - up, 0);
    const hUp = (up / max) * plotH;
    const hWait = (wait / max) * plotH;
    const yUp = padT + plotH - hUp;
    const yWait = yUp - hWait - (hUp && hWait ? gap : 0);

    const label = `${r.week}: ${r.signups || 0} ${t("promo.signups")}, ${up} ${t("promo.turnedUp")}`;
    return `<g class="cb"><title>${escHtml(label)}</title>
      ${hWait > 0 ? `<path d="${barPath(x, yWait, bw, hWait, radius)}" class="c-wait" />` : ""}
      ${hUp > 0 ? `<path d="${barPath(x, yUp, bw, hUp, hWait > 0 ? 0 : radius)}" class="c-up" />` : ""}
      ${!r.signups ? `<rect x="${x}" y="${padT + plotH - 2}" width="${bw}" height="2" class="c-zero" />` : ""}
    </g>`;
  }).join("");

  // Every fourth week gets a date, so the axis is readable at 360px wide.
  const every = w < 460 ? 6 : 4;
  const xlabels = rows.map((r, i) => {
    if (i % every !== 0 && i !== rows.length - 1) return "";
    const d = new Date(r.week);
    const txt = d.toLocaleDateString(getLang() === "sv" ? "sv-SE" : "en-GB", { day: "numeric", month: "short" });
    return `<text x="${padL + i * step + step / 2}" y="${h - 8}" class="ct ct-x">${escHtml(txt)}</text>`;
  }).join("");

  // No preserveAspectRatio override: the viewBox drives the height and nothing
  // gets stretched. "none" scaled the axis text horizontally on a wide screen.
  return `<svg class="chart" viewBox="0 0 ${w} ${h}"
               role="img" aria-label="${escHtml(t("promo.chartAlt"))}">
    ${grid}${bars}
    <line x1="${padL}" y1="${padT + plotH}" x2="${w - padR}" y2="${padT + plotH}" class="ca" />
    ${xlabels}
  </svg>`;
}

async function refreshPromo() {
  const panel = $("creatorPanel");
  if (!panel) return;

  const { data, error } = await supabase.rpc("my_promo_stats");
  if (error) { console.warn("my_promo_stats:", error.message); return; }
  const codes = data || [];
  if (!codes.length) return;      // no code, no panel

  panel.hidden = false;

  $("promoBody").innerHTML = codes.map((c) => {
    const weekly = c.weekly || [];
    const anything = weekly.some((wk) => wk.signups);

    return `<div class="promo-block">
      <div class="promo-head">
        <div>
          <code class="promo-code">${escHtml(c.code)}</code>
          <span class="pill ${c.active ? "ok" : "bad"}">${escHtml(c.active ? t("promo.live") : t("promo.paused"))}</span>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" data-copy="${escHtml(c.code)}">${escHtml(t("acct.refCopy"))}</button>
      </div>

      <div class="stat-grid">
        <div class="stat"><b>${c.signups ?? 0}</b><small>${escHtml(t("promo.signups"))}</small></div>
        <div class="stat"><b>${c.turned_up ?? 0}</b><small>${escHtml(t("promo.turnedUp"))}</small></div>
        <div class="stat"><b>${c.pending ?? 0}</b><small>${escHtml(t("promo.waiting"))}</small></div>
        <div class="stat"><b>${c.earned_ore ? (c.earned_ore / 100).toLocaleString("sv-SE") + " kr" : "&mdash;"}</b><small>${escHtml(t("promo.earned"))}</small></div>
      </div>

      ${anything ? `
        <div class="chart-head">
          <span class="chart-title">${escHtml(t("promo.chartTitle"))}</span>
          <span class="legend">
            <span class="lg"><i class="sw c-up"></i>${escHtml(t("promo.turnedUp"))}</span>
            <span class="lg"><i class="sw c-wait"></i>${escHtml(t("promo.waiting"))}</span>
          </span>
        </div>
        <div class="chart-wrap">${drawPromoChart(weekly)}</div>
        <details class="chart-table">
          <summary>${escHtml(t("promo.showNumbers"))}</summary>
          <table>
            <thead><tr><th>${escHtml(t("promo.week"))}</th><th>${escHtml(t("promo.signups"))}</th><th>${escHtml(t("promo.turnedUp"))}</th></tr></thead>
            <tbody>${weekly.map((wk) => `<tr><td>${escHtml(wk.week)}</td><td>${wk.signups}</td><td>${wk.turned_up}</td></tr>`).join("")}</tbody>
          </table>
        </details>`
      : `<p class="ops-empty">${escHtml(t("promo.nothingYet"))}</p>`}

      <p class="acc-hint promo-foot">${escHtml(t("promo.foot"))}</p>
    </div>`;
  }).join("");

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!$("creatorPanel")?.hidden) refreshPromo();
    }, 250);
  }, { once: true });

  $("promoBody").querySelectorAll("[data-copy]").forEach((b) =>
    b.addEventListener("click", async () => {
      const was = b.textContent;
      try { await navigator.clipboard.writeText(b.dataset.copy); } catch { /* insecure origin */ }
      b.textContent = t("acct.refCopied");
      setTimeout(() => { b.textContent = was; }, 1600);
    })
  );
}


// ---------------------------------------------------------------------------
// "YOUR DETAILS": folded when it is finished, open when it is not
//
// The form is only interesting while something is missing from it. Once it is
// right it is a wall of filled-in inputs sitting between the member and the
// things they actually came for — their tier, their tickets, their nights. So
// a complete account gets it folded with a tick, and an incomplete one gets it
// open, marked, and named at the top of the page.
//
// The list of what counts is the same one eBas enforces, deliberately: there is
// no point calling an account complete here and having the registration bounce.
// ---------------------------------------------------------------------------
function missingDetails(profile) {
  const gap = [];
  if (!(profile.first_name || "").trim() || !(profile.last_name || "").trim()) gap.push("acct.fieldName");
  if (!profile.birth_date) gap.push("acct.fieldDob");
  if (!(profile.street || "").trim())   gap.push("acct.fieldStreet");
  if (!(profile.zip_code || "").trim()) gap.push("acct.fieldZip");
  if (!(profile.city || "").trim())     gap.push("acct.fieldCity");
  if (!profile.terms_accepted_at)       gap.push("acct.fieldTerms");
  return gap;
}

// "a, b and c" in English, "a, b och c" in Swedish. Built rather than
// hardcoded with commas so the last separator is right in both.
function joinList(parts) {
  if (parts.length <= 1) return parts[0] || "";
  return parts.slice(0, -1).join(", ") + " " + t("acct.listAnd") + " " + parts[parts.length - 1];
}

function setDetailsOpen(open) {
  const fold = $("detailsFold"), btn = $("detailsToggle");
  if (!fold || !btn) return;
  fold.dataset.open = open ? "true" : "false";
  btn.setAttribute("aria-expanded", String(open));
  btn.setAttribute("aria-label", t(open ? "acct.detailsHide" : "acct.detailsShow"));
}

// Kept so a language switch can redraw the chip and the banner without going
// back to the database for a profile that has not changed.
let lastProfile = null;

function applyDetailsState(profile) {
  lastProfile = profile;
  const gap = missingDetails(profile);
  const chip = $("detailsChip");
  const alert = $("detailsAlert");

  if (chip) {
    chip.hidden = false;
    chip.className = "acc-chip " + (gap.length ? "is-todo" : "is-done");
    chip.textContent = t(gap.length ? "acct.detailsTodo" : "acct.detailsDone");
  }

  if (alert) {
    alert.hidden = gap.length === 0;
    const body = $("detailsAlertBody");
    if (body && gap.length) body.textContent = t("acct.attentionB", { fields: joinList(gap.map(t)) });
  }

  // Never fold a section somebody is in the middle of typing into. Re-render
  // happens on every refresh, including the 45-second membership poll, and
  // collapsing the form under someone's hands would be its own bug.
  const fold = $("detailsFold");
  if (fold && fold.contains(document.activeElement)) return;
  setDetailsOpen(gap.length > 0);
}

$("detailsToggle")?.addEventListener("click", () => {
  setDetailsOpen($("detailsFold")?.dataset.open !== "true");
});

// The banner's button does the whole job: open the section, put it on screen,
// and land the cursor in the first field that is actually empty.
$("detailsAlertBtn")?.addEventListener("click", () => {
  setDetailsOpen(true);
  $("detailsFold")?.scrollIntoView({ behavior: "smooth", block: "start" });
  const first = ["d-first", "d-dob", "d-street", "d-zip", "d-city"]
    .map((id) => $(id)).find((el) => el && !el.value.trim());
  (first || $("d-terms"))?.focus({ preventScroll: true });
});

// The labels inside are translated, so a language switch has to redraw them.
document.addEventListener("ss:lang", () => { if (lastProfile) applyDetailsState(lastProfile); });
