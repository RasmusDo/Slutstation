// ============================================================================
// SLUTSTATION — the front-page membership form
//
// DEAD CODE, kept for reference. The header used to say "ACTIVE. Wired up in
// src/main.js", and it is not: nothing imports initMembershipSignup, and the
// #applyForm it binds to was taken out of index.html when sign-up moved to
// /account.html. The front page now links there instead. Nothing ships it —
// an un-imported module is not in the bundle — but a comment claiming a file
// is live is worse than no comment, because it is the one thing you would
// check before going looking for a bug in it.
//
// If sign-up ever comes back to the one-pager, note that this predates the
// account page's version, which is the one that has been maintained.
//
// The eBas call happens server-side in the `ebas` Supabase Edge Function, so
// the eBas API key is no longer built into the public bundle (it used to be,
// via VITE_API_KEY — Vite inlines every VITE_* variable at build time).
//
// With email confirmation ON there is no session immediately after signup, so
// eBas registration is deferred: the account page registers them on their
// first signed-in visit. That is why the success panel tells people to check
// their inbox.
//
// The DJ toggle, the DJ fields and the success panel behave exactly as before.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase-config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const GENDER_ID = { Female: 1, Male: 2, "Non-binary": 3, "Prefer not to say": 3 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function initMembershipSignup(opts = {}) {
  const form = document.getElementById("applyForm");
  const msg = document.getElementById("formMsg");
  const success = document.getElementById("formSuccess");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.textContent = "";
    msg.className = "form-msg";

    for (const field of form.querySelectorAll("[required]")) {
      const ok = field.type === "checkbox" ? field.checked : field.value.trim();
      if (!ok) {
        msg.textContent = "Please complete all required fields.";
        msg.classList.add("err");
        field.focus();
        return;
      }
    }

    const d = Object.fromEntries(new FormData(form).entries());

    if (!EMAIL_RE.test((d.email || "").trim())) {
      msg.textContent = "Please enter a valid email address.";
      msg.classList.add("err");
      return;
    }
    if ((d.password || "").length < 8) {
      msg.textContent = "Please choose a password of at least 8 characters.";
      msg.classList.add("err");
      return;
    }

    const btn = form.querySelector('button[type="submit"]');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Sending…";

    try {
      // 1. create the account — the DB trigger fills in the profile
      const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
        email: d.email.trim(),
        password: d.password,
        options: {
          emailRedirectTo: `${window.location.origin}/account.html`,
          data: {
            first_name: d.first?.trim(),
            last_name: d.last?.trim(),
            phone: d.phone?.trim(),
            birth_date: d.dob || null,
            gender_id: GENDER_ID[d.gender] ?? 3,
            street: d.street?.trim(),
            zip_code: d.zip?.trim(),
            city: d.city?.trim(),
            terms_accepted: !!d.agree,
          },
        },
      });

      if (signUpErr) {
        const m = (signUpErr.message || "").toLowerCase();
        throw new Error(
          m.includes("already registered")
            ? "An account with this email already exists — sign in at /account.html instead."
            : signUpErr.message
        );
      }

      // 2. register in eBas now if there's a session. With email confirmation
      //    on there isn't one yet, and the account page registers them on
      //    their first sign-in instead.
      if (signUpData.session) {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/ebas`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${signUpData.session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "register" }),
        });
        const result = await res.json().catch(() => ({}));
        if (!result.ok) console.warn("eBas registration deferred:", result);
      }

      // 3. DJ application still goes out by email, unchanged
      const isDJ = document.getElementById("djSwitch")?.classList.contains("on");
      if (isDJ && window.emailjs && opts.emailjs) {
        try {
          await window.emailjs.send(opts.emailjs.service, opts.emailjs.template, {
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
          });
        } catch (djErr) {
          console.error("DJ EmailJS error (membership still registered):", djErr);
        }
      }

      form.style.display = "none";
      success.classList.add("show");
      success.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      console.error("Membership signup error:", err);
      msg.textContent = err.message || "Failed to register. Please try again later.";
      msg.classList.add("err");
      btn.disabled = false;
      btn.textContent = label;
    }
  });
}
