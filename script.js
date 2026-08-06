/* =========================================================
   SLUTSTATION — interactions
   ========================================================= */
(function () {
  "use strict";

  /* ---- announcement bar ---- */
  const announceX = document.getElementById("announceX");
  try {
    if (localStorage.getItem("ss-announce") === "off") document.body.classList.add("no-announce");
  } catch (e) {}
  announceX?.addEventListener("click", () => {
    document.body.classList.add("no-announce");
    try { localStorage.setItem("ss-announce", "off"); } catch (e) {}
  });

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

  /* ---- accordion ---- */
  document.querySelectorAll(".acc-head").forEach((head) =>
    head.addEventListener("click", () => {
      const item = head.parentElement;
      const body = head.nextElementSibling;
      const open = item.classList.toggle("open");
      body.style.maxHeight = open ? body.scrollHeight + "px" : null;
    })
  );

  /* =========================================================
     SLUTSTATION APIs — same integrations as the live site.
     These are public client-side keys (as on slutstation.se).
     ========================================================= */
  const SS_API = {
    // eBas (Svensk Live member registry) — the real membership database.
    ebas: {
      // eBas has no CORS headers, so the live site routes through this proxy.
      url: import.meta.env.VITE_API_ENDPOINT,
      apiKey: import.meta.env.VITE_API_KEY,
    },
    // Billetto ticketing API (the widget.js embed is loaded in index.html).
    billetto: {
      base: "https://billetto.se/api/v3",
      proxy: import.meta.env.VITE_CORS_PROXY,
      keypair: `${import.meta.env.VITE_BILLETTO_API_KEY}:${import.meta.env.VITE_BILLETTO_CLIENT_SECRET}`,
    },
    // EmailJS — used for the optional DJ application (same account as live site).
    emailjs: {
      publicKey: import.meta.env.VITE_EMAILJS_PUBLIC_KEY,
      service: import.meta.env.VITE_EMAILJS_SERVICE_ID,
      template: import.meta.env.VITE_EMAILJS_TEMPLATE_ID,
    },
  };
  if (window.emailjs) emailjs.init({ publicKey: SS_API.emailjs.publicKey });

  /* Billetto API helper (mirrors the live site's authenticated fetch).
     Available for wiring live/upcoming events; current events are past so
     the cards just link to their Billetto pages + the widget popup. */
  async function billettoFetch(path, opts = {}) {
    const target = SS_API.billetto.base + path;
    const res = await fetch(SS_API.billetto.proxy + target, {
      headers: {
        accept: "application/json",
        "Api-Keypair": SS_API.billetto.keypair,
        "X-Requested-With": "XMLHttpRequest",
        ...(opts.headers || {}),
      },
      ...opts,
    });
    return res.json();
  }
  window.slutstationBilletto = billettoFetch; // exposed for future event wiring

  /* ---- application form: registers the member in eBas (real database),
     and additionally emails the DJ application via EmailJS when toggled. ---- */
  const form = document.getElementById("applyForm");
  const msg = document.getElementById("formMsg");
  const success = document.getElementById("formSuccess");
  const GENDER_ID = { Female: "1", Male: "2", "Non-binary": "3", "Prefer not to say": "3" };

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.textContent = "";
    msg.className = "form-msg";

    // basic required-field check
    const required = form.querySelectorAll("[required]");
    for (const field of required) {
      const ok = field.type === "checkbox" ? field.checked : field.value.trim();
      if (!ok) {
        msg.textContent = "Please complete all required fields.";
        msg.classList.add("err");
        field.focus();
        return;
      }
    }
    const email = form.querySelector('[name="email"]').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      msg.textContent = "Please enter a valid email address.";
      msg.classList.add("err");
      return;
    }

    const d = Object.fromEntries(new FormData(form).entries());
    const isDJ = document.getElementById("djSwitch")?.classList.contains("on");

    // eBas wants the birth date as YYYYMMDD (no full personnummer required).
    const [by = "", bm = "", bd = ""] = (d.dob || "").split("-");
    const memberPayload = {
      api_key: SS_API.ebas.apiKey,
      member: {
        firstname: d.first,
        lastname: d.last,
        gender_id: GENDER_ID[d.gender] || "3",
        socialsecuritynumber: `${by}${bm}${bd}`,
        email: d.email,
        phone1: d.phone,
        street: d.street,
        zip_code: d.zip,
        city: d.city,
        renewed: new Date().toISOString().split("T")[0],
        subscribe_nyhetsbrev: null,
      },
    };

    const submitBtn = form.querySelector('button[type="submit"]');
    const label = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";

    try {
      // 1) register membership in eBas
      const res = await fetch(SS_API.ebas.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(memberPayload),
      });
      const json = await res.json().catch(() => ({}));

      if (!(res.ok && json.stored_member === true)) {
        let why = "Registration failed. Please try again later.";
        if (json.member_errors) why = "Error: " + Object.values(json.member_errors).flat().join(", ");
        else if (json.member_warnings && json.member_warnings.length) why = "Warning: " + json.member_warnings.join(", ");
        throw new Error(why);
      }

      // 2) if they're a DJ, also send the application via EmailJS
      if (isDJ && window.emailjs) {
        const params = {
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
        };
        try { await emailjs.send(SS_API.emailjs.service, SS_API.emailjs.template, params); }
        catch (djErr) { console.error("DJ EmailJS error (membership still registered):", djErr); }
      }

      form.style.display = "none";
      success.classList.add("show");
      success.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      console.error("Membership registration error:", err);
      msg.textContent = err.message || "Failed to register. Please try again later.";
      msg.classList.add("err");
      submitBtn.disabled = false;
      submitBtn.textContent = label;
    }
  });

  /* ---- scroll reveal ---- */
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          en.target.classList.add("in");
          io.unobserve(en.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
  );
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

  /* ---- scroll-driven hero blur (Pacha-style depth) ----
     As the page scrolls up over the fixed hero video, ramp --hb 0 -> 1
     across roughly the first viewport, blurring/dimming the video while
     the foreground content stays crisp. rAF-throttled for smoothness. */
  const heroBg = document.getElementById("heroBg");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (heroBg) {
    let ticking = false;
    let frozen = false;
    const update = () => {
      ticking = false;
      const span = Math.max(window.innerHeight * 0.85, 1);
      const hb = Math.min(Math.max(window.scrollY / span, 0), 1);
      heroBg.style.setProperty("--hb", hb.toFixed(3));
      // freeze the (heavily blurred) video into a still frame once past the
      // hero — saves battery and matches the Pacha "frozen frame" backdrop.
      const v = document.getElementById("heroVideo");
      if (v && !reduceMotion) {
        if (hb >= 0.98 && !frozen) { v.pause(); frozen = true; }
        else if (hb < 0.9 && frozen) { frozen = false; const p = v.play(); if (p && p.catch) p.catch(() => {}); }
      }
    };
    const onScrollBlur = () => {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    };
    update();
    window.addEventListener("scroll", onScrollBlur, { passive: true });
    window.addEventListener("resize", update, { passive: true });
  }

  /* ---- hero video: poster on reduced-motion, else ensure it plays ----
     muted + playsinline lets autoplay through; some browsers (iOS Safari)
     still need an explicit play() nudge once enough data has buffered. */
  const heroVideo = document.getElementById("heroVideo");
  if (heroVideo) {
    if (reduceMotion) {
      heroVideo.removeAttribute("autoplay");
      heroVideo.pause();
    } else {
      const tryPlay = () => {
        const p = heroVideo.play();
        if (p && p.catch) p.catch(() => {});
      };
      if (heroVideo.readyState >= 2) tryPlay();
      heroVideo.addEventListener("loadeddata", tryPlay, { once: true });
      heroVideo.addEventListener("canplay", tryPlay, { once: true });
    }
  }

  /* ============================================================
     UPCOMING EVENTS are now rendered by the official
     <billetto-organiser-widget> embedded in the Upcoming tab
     (see index.html) — it lists events and sells tickets on-site,
     auto-updating from Billetto. The previous custom API-driven card
     loader below is kept DORMANT (returns immediately) so the widget
     owns #upcomingGrid; billettoFetch/SS_API remain for the eBas form.
     ============================================================ */
  (function initUpcomingEvents() {
    return; // disabled: superseded by <billetto-organiser-widget>
    /* eslint-disable no-unreachable */
    const wrap = document.getElementById("upcomingGrid");
    if (!wrap || typeof billettoFetch !== "function") return;

    // optional curated image/venue/blurb per Billetto event id (else fallbacks)
    const EVENT_META = {
      "1900933": { title: "Sunset Sessions", venue: "Kägelbanan", img: "assets/images/DSC01259_small-DrPG6zZq.jpg", desc: "Our best lineup to date — strictly real Tech-House. 18+." },
      "1775961": { title: "Tomi & Kesh", venue: "Mister French · Tullhus 2", img: "assets/images/night-01.jpg", desc: "Tech House. Tomi & Kesh bring raw, hypnotic energy made for big sound systems." },
      "1602331": { title: "Last Path", venue: "Hellasgården", img: "assets/dj-night-red.jpg", desc: "An open-air session in the forest — the last open air of the season." },
      "1257967": { title: "Slutstation Outdoors", venue: "Kärsön", img: "assets/outdoors-rig.jpg", desc: "An open-air all-nighter on Kärsön — outdoors, under the trees, till sunrise." },
    };
    const FALLBACK_IMG = "assets/images/DSC01259_small-DrPG6zZq.jpg";
    const TZ = "Europe/Stockholm";
    const partsOf = (d) => {
      const o = {};
      new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })
        .formatToParts(d).forEach((p) => (o[p.type] = p.value));
      return o;
    };
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

    function buildCard(ev) {
      const meta = EVENT_META[ev.id] || {};
      const start = new Date(ev.starts_at || ev.startdate || ev.start_date);
      const end = ev.ends_at || ev.enddate ? new Date(ev.ends_at || ev.enddate) : null;
      const s = !isNaN(start.getTime()) ? partsOf(start) : null;
      const e = end && !isNaN(end.getTime()) ? partsOf(end) : null;
      const title = esc(meta.title || (ev.name || "").trim() || "Slutstation");
      // image comes straight from the Billetto API (event's own artwork);
      // meta.img / fallback only used if the API ever omits image_url
      const img = ev.image_url || ev.image_link || meta.img || FALLBACK_IMG;
      const venue = esc(meta.venue || "");
      const desc = meta.desc ? esc(meta.desc) : "";
      let badge = "", when = "";
      if (s) {
        badge = `<div class="date"><div class="d">${s.day}</div><div class="m">${s.month} ’${s.year.slice(2)}</div></div>`;
        const sameDay = e && e.day === s.day && e.month === s.month;
        const dayPart = e && !sameDay
          ? (e.month !== s.month ? `${s.day} ${s.month}–${e.day} ${e.month}` : `${s.day}–${e.day} ${s.month}`)
          : `${s.day} ${s.month}`;
        const timePart = s.hour ? ` · ${s.hour}:${s.minute}${e ? `–${e.hour}:${e.minute}` : ""}` : "";
        when = `${dayPart} ${s.year}${timePart}`;
      }
      const loc = `◷ ${venue}${venue && when ? " · " : ""}${when}`;
      const url = ev.public_url || ev.url || `https://billetto.se/e/slutstation-biljetter-${ev.id}`;
      return `<article class="event-card">
        <div class="thumb"><img src="${esc(img)}" alt="Slutstation — ${title}" loading="lazy" decoding="async" />${badge}</div>
        <div class="info"><h4>${title}</h4><div class="loc">${loc}</div>${desc ? `<p class="ev-desc">${desc}</p>` : ""}
          <a class="btn btn-primary btn-sm billetto-trigger" href="${esc(url)}" target="_blank" rel="noopener" data-billetto-id="${esc(ev.id)}">Buy Tickets</a>
        </div>
      </article>`;
    }

    (async () => {
      let list = [];
      try {
        const res = await billettoFetch("/organiser/events?state=published", { method: "GET" });
        list = res?.data || (res?.object === "event" ? [res] : res) || [];
      } catch (err) {
        console.warn("Billetto upcoming-events fetch failed; keeping the announced-soon state.", err);
        return;
      }
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const upcoming = (Array.isArray(list) ? list : [])
        .filter((ev) => { const d = new Date(ev.starts_at || ev.startdate || ev.start_date); return !isNaN(d.getTime()) && d >= today; })
        .sort((a, b) => new Date(a.starts_at || a.startdate) - new Date(b.starts_at || b.startdate));
      if (!upcoming.length) return; // nothing upcoming -> keep the empty state
      wrap.innerHTML = `<div class="event-grid">${upcoming.map(buildCard).join("")}</div>`;
      // let the Billetto widget bind to the freshly-injected ticket buttons
      try { if (window.Billetto && typeof window.Billetto.refresh === "function") window.Billetto.refresh(); } catch (e) {}
    })();
  })();
})();
