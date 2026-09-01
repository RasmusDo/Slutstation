// ============================================================================
// SLUTSTATION, Liquid Glass
//
// A glass surface should not just blur what is behind it. It should BEND it:
// magnify through the body, compress and colour-split at the rim, and catch
// light unevenly across the face. That is the difference between frosted
// plastic and something that looks like it has thickness.
//
// HOW IT WORKS
//
// Every glass element gets an SVG displacement filter chained into its
// backdrop-filter. The filter is driven by a displacement map generated on a
// canvas, where each pixel's red and green channels encode "sample this pixel
// from over there instead". Two things are written into that map:
//
//   BODY    a weak lens across the whole face, pulling samples toward the
//           centre in proportion to distance from it, which magnifies
//           everything seen through the glass. This is the "depth" of the slab.
//
//   BEVEL   near the rim the surface curves away hard, so the sampling offset
//           ramps up, crests just inside the edge, and eases back to nothing.
//
// Then the filter samples three times at slightly different strengths, one per
// colour channel, and recombines them. Longer wavelengths bend less than
// shorter ones in real glass, so the rim picks up a faint rainbow edge.
//
// FOUR THINGS THAT LOOK OBVIOUS IN HINDSIGHT, EACH FOUND BY RENDERING IT
//
//   1. The bevel is a fixed thickness in pixels, never a proportion of the
//      element. A large pane of glass has the same edge as a small one. Scaling
//      it made big panels read as flat grey haze.
//   2. The bevel crests INSIDE the rim and is zero at the outermost pixel.
//      Peaking it at the boundary tears every hard edge in the backdrop into a
//      coloured smear exactly where the eye is drawn.
//   3. The bevel samples inward. A backdrop-filter can only read the backdrop
//      within the element's own box; ask beyond the edge and Chromium returns
//      the edge pixel smeared, which showed up as a hard seam down one side.
//   4. Frost is applied BEFORE the lens. Filters run left to right, so
//      displacing first tears backdrop edges while they are still razor sharp
//      and speckles the rim with coloured dots.
//
// WHERE IT RUNS
//
// SVG filters inside backdrop-filter are a Chromium capability. Safari and
// Firefox keep the plain frost from the stylesheet, which is also Apple's own
// fallback: iOS with Reduce Transparency swaps Liquid Glass for flat frost.
//
// WHAT IT COSTS, AND WHAT WAS DONE ABOUT IT
//
// The first version of this file built one displacement map per element at the
// element's exact pixel size, on load, in one pass, on the main thread. A grid
// of six cards is about a million pixels of trigonometry before anything can
// be interacted with — a visible stall on a fast laptop and a second or more on
// anything else. Four changes, none of which alter a single rendered pixel:
//
//   * the map is generated at reduced resolution and stretched by feImage. The
//     map is smooth everywhere, so this is invisible — but only down to a
//     point, because the bevel is a narrow band and quantising it flattens the
//     smootherstep into a straight ramp, which reads as a drawn-on border.
//     buildMap keeps the band at ten samples minimum and lets resolution rise
//     again on very large panes rather than take that trade.
//   * the surface normal is solved analytically instead of by four extra
//     signed-distance evaluations per pixel, and Math.hypot — which guards
//     against overflow nobody here can reach — is a plain sqrt.
//   * maps are built when the browser is idle, never on the critical path.
//   * a surface is lensed when it first comes near the viewport, not on load,
//     so a page of glass costs one card's work at a time instead of all of it
//     before the first paint.
// ============================================================================

// Tuned against Apple's iOS glass, by rendering and comparing rather than by
// taste. Every value here is in the same units the user sees.
const GLASS = {
  refraction: 28,   // px of sampling shift where the bevel crests
  dispersion: 3,    // px between the red and blue taps: the rainbow fringe
  depth: 0.14,      // whole-body magnification, the thickness of the slab
  edge: 34,         // px width of the bevel, a constant, not a ratio
  crest: 0.42,      // where in the bevel the bend peaks (0 = rim, 1 = inner)
  frost: 2,         // px of blur applied to the light before it is bent
  saturate: 190,    // % colour lift, glass concentrates colour
  brightness: 1.08, // slight gain, glass gathers light
};

// Large glass only. Every filtered element costs a backdrop pass, and small
// chips and pills read glassy enough from the frost and rim light alone.
const SELECTOR =
  ".form-shell, .tier, .empty-state, .event-card, .accordion, .statement, .glass";

const MAP_MAX = 288;  // px, longest side of a generated map before it is scaled
const MIN_BAND = 10;  // map samples the bevel must keep, or the crease shows
const MAX_FILTERS = 24;

const idle = (fn) =>
  "requestIdleCallback" in window
    ? requestIdleCallback(fn, { timeout: 1000 })
    : setTimeout(fn, 32);

// ---------------------------------------------------------------------------
// the displacement map
// ---------------------------------------------------------------------------

// Signed distance to a rounded rectangle: negative inside, zero on the edge.
function sdRoundRect(px, py, hx, hy, r) {
  const qx = Math.abs(px) - (hx - r);
  const qy = Math.abs(py) - (hy - r);
  const mx = qx > 0 ? qx : 0;
  const my = qy > 0 ? qy : 0;
  const outer = Math.sqrt(mx * mx + my * my);
  const inner = Math.min(Math.max(qx, qy), 0);
  return outer + inner - r;
}

// Outward unit normal of that same shape, solved rather than sampled. The
// finite-difference version this replaces cost four more sdRoundRect calls for
// every pixel in the bevel and produced the same direction.
function sdNormal(px, py, hx, hy, r, out) {
  const qx = Math.abs(px) - (hx - r);
  const qy = Math.abs(py) - (hy - r);
  const sx = px < 0 ? -1 : 1;
  const sy = py < 0 ? -1 : 1;
  if (qx > 0 && qy > 0) {
    // Rounded corner: the normal radiates from the corner's centre of curvature.
    const len = Math.sqrt(qx * qx + qy * qy) || 1;
    out[0] = (qx / len) * sx;
    out[1] = (qy / len) * sy;
  } else if (qx > qy) {
    out[0] = sx;
    out[1] = 0;
  } else {
    out[0] = 0;
    out[1] = sy;
  }
}

// Smootherstep: zero first and second derivative at both ends, so the bevel
// blends into the flat interior with no detectable seam. A plain pow() curve
// leaves a visible crease, which is what made an earlier attempt look like a
// drawn-on border rather than glass.
const ease = (x) => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * t * (t * (t * 6 - 15) + 10);
};

// Bevel strength against depth into the edge band (0 = outermost pixel).
const bevel = (u) =>
  u < GLASS.crest ? ease(u / GLASS.crest) : ease((1 - u) / (1 - GLASS.crest));

// Everything below works in MAP space, which is the element scaled by `s`.
// The displacement values are normalised to -1..1, so feDisplacementMap's own
// `scale` (in element pixels) is unaffected by the resolution chosen here —
// only the geometry has to be scaled, which is why `band` and `radius` are.
function buildMap(w, h, radius) {
  let s = Math.min(1, MAP_MAX / Math.max(w, h));
  // Let the resolution back up if the bevel would be too few samples wide to
  // hold its curve. On a very large pane that costs more pixels; a flat-looking
  // rim costs the whole effect.
  if (GLASS.edge * s < MIN_BAND) s = MIN_BAND / GLASS.edge;

  const mw = Math.max(8, Math.round(w * s));
  const mh = Math.max(8, Math.round(h * s));

  const c = document.createElement("canvas");
  c.width = mw;
  c.height = mh;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const img = ctx.createImageData(mw, mh);
  const d = img.data;

  const hx = mw / 2;
  const hy = mh / 2;
  const r = Math.min(radius * s, hx, hy);
  const band = Math.min(GLASS.edge * s, Math.min(hx, hy) * 0.95);
  const n = [0, 0];

  for (let y = 0; y < mh; y++) {
    const py = y - hy + 0.5;
    const pyn = py / hy;
    let i = y * mw * 4;
    for (let x = 0; x < mw; x++, i += 4) {
      const px = x - hx + 0.5;
      const inside = -sdRoundRect(px, py, hx, hy, r);
      let nx = 0;
      let ny = 0;

      if (inside > 0) {
        // Body: a weak lens over the whole face.
        const pxn = px / hx;
        const rad = Math.sqrt(pxn * pxn + pyn * pyn);
        if (rad > 0.001) {
          const m = (rad < 1 ? rad : 1) * GLASS.depth;
          nx -= (pxn / rad) * m;
          ny -= (pyn / rad) * m;
        }

        // Bevel: the rim curvature, pointing inward.
        if (inside < band) {
          sdNormal(px, py, hx, hy, r, n);
          const k = bevel(inside / band);
          nx -= n[0] * k;
          ny -= n[1] * k;
        }
      }

      d[i] = ((nx < -1 ? -1 : nx > 1 ? 1 : nx) * 0.5 + 0.5) * 255;
      d[i + 1] = ((ny < -1 ? -1 : ny > 1 ? 1 : ny) * 0.5 + 0.5) * 255;
      d[i + 2] = 128;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}

// ---------------------------------------------------------------------------
// the filter
// ---------------------------------------------------------------------------
let defs = null;
let seq = 0;
const cache = new Map(); // "wxhxr" -> filter id, shared by same-shaped elements

function ensureDefs() {
  if (defs) return defs;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "position:absolute;pointer-events:none";
  svg.innerHTML = "<defs></defs>";
  document.body.appendChild(svg);
  defs = svg.firstChild;
  return defs;
}

function filterFor(w, h, radius) {
  const key = `${w}x${h}x${radius}`;
  const hit = cache.get(key);
  if (hit) return hit;
  // Every distinct shape is a map to generate and an SVG filter to keep alive.
  // Past two dozen the page has stopped being a design and started being a
  // leak; whatever is left keeps the stylesheet's plain frost, which is the
  // same thing Safari has been showing all along.
  if (cache.size >= MAX_FILTERS) return null;

  const id = "lq" + seq++;
  const S = GLASS.refraction;
  const D = GLASS.dispersion;
  const tap = (scale, res) =>
    `<feDisplacementMap in="SourceGraphic" in2="m" scale="${scale}" xChannelSelector="R" yChannelSelector="G" result="${res}"/>`;
  const pick = (src, m, res) =>
    `<feColorMatrix in="${src}" type="matrix" values="${m}" result="${res}"/>`;

  // The map is stretched to the filter region by feImage, so it is written at
  // 100%/100% rather than the pixel size it was generated at.
  ensureDefs().insertAdjacentHTML(
    "beforeend",
    `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feImage href="${buildMap(w, h, radius)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="m"/>
      ${tap(S - D, "dr")}${tap(S, "dg")}${tap(S + D, "db")}
      ${pick("dr", "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0", "r")}
      ${pick("dg", "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0", "g")}
      ${pick("db", "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0", "b")}
      <feBlend in="r" in2="g" mode="screen" result="rg"/>
      <feBlend in="rg" in2="b" mode="screen"/>
    </filter>`
  );
  cache.set(key, id);
  return id;
}

// ---------------------------------------------------------------------------
// applying it
// ---------------------------------------------------------------------------
const FROST = `blur(${GLASS.frost}px) saturate(${GLASS.saturate}%) brightness(${GLASS.brightness})`;
const tracked = new Set(); // what has a lens, so a resize can rebuild it

// Bucket to 16px so a grid of near-identical cards shares one filter and one
// generated map, instead of building dozens.
function bucket(v) {
  return Math.round(v / 16) * 16;
}

// The bucket a lens was actually built for, so the observer below can tell a
// real change from a pixel of reflow noise.
const lensedAt = new WeakMap();

// A surface can change size without the window doing anything. A status line
// appears under a form, a disclosure opens, a list finishes loading — and the
// map inside its backdrop-filter is still the one drawn for the old box. The
// map is stretched over a shape it was never drawn for, and the surface goes
// soft.
//
// That is what "the sign-in panel goes blurry when I press Forgot password"
// was: the reply line makes the card 39px taller, 647 to 686, which crosses
// from the 640 bucket to the 688 one. Every other button on that panel does
// the same thing, and so does opening the new change-password fields.
//
// Rebuilt only when the BUCKET changes, so a one-pixel reflow costs nothing
// and a grid of cards still shares one map. Safe against the feedback loop
// that usually bites ResizeObserver: lens() writes backdrop-filter and nothing
// else, and backdrop-filter cannot change layout.
const sizeWatch =
  typeof ResizeObserver === "undefined"
    ? null
    : new ResizeObserver((entries) => {
        const stale = [];
        for (const e of entries) {
          const r = e.target.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 &&
              `${bucket(r.width)}x${bucket(r.height)}` !== lensedAt.get(e.target)) {
            stale.push([e.target, r]);
          }
        }
        if (stale.length) idle(() => stale.forEach(([el, rect]) => lens(el, rect)));
      });

function lens(el, rect) {
  // Hands off while someone is typing in this panel — see the focus block
  // below lens() for why. Without this line a background rescan (a mutation,
  // a resize) would quietly re-apply the lens mid-keystroke.
  if (typingIn.has(el)) return;
  const w = bucket(rect.width);
  const h = bucket(rect.height);
  if (w < 48 || h < 32) return;
  // Very large surfaces are not worth a map; the effect reads as haze at that
  // size anyway, and the backdrop pass is the most expensive one on the page.
  if (w > 1600 || h > 1200) return;

  const radius = Math.round(parseFloat(getComputedStyle(el).borderRadius) || 0);
  const id = filterFor(w, h, radius);
  if (!id) return;

  const want = `${FROST} url(#${id})`;
  if (el.style.backdropFilter !== want) {
    el.style.backdropFilter = want;
    el.style.webkitBackdropFilter = ""; // the prefixed property rejects url()
  }
  tracked.add(el);
  // Recorded before observing, so the observer's first callback — which fires
  // once on observe() with the size we just built for — is a no-op instead of
  // an immediate rebuild.
  lensedAt.set(el, `${w}x${h}`);
  sizeWatch?.observe(el);
}

// ---------------------------------------------------------------------------
// The lens steps aside while you type.
//
// Chromium composites its native popups — the saved-login dropdown above all —
// straight over the page, and a backdrop-filter that runs through an SVG
// displacement map is exactly the kind of layer it then degrades or
// re-rasterises soft. That is the "sign-in goes blurry when I pick a saved
// email" bug: same family as the resize softness ResizeObserver already
// fixes, but triggered by the browser's own UI, which no observer can see.
//
// So: the moment a field inside a lensed panel takes focus, that panel falls
// back to the stylesheet's plain frost (dropping the inline filter is all it
// takes), and the lens is rebuilt fresh once focus has left the panel. Nobody
// reads refraction while filling in a form, and a rebuilt map is also the
// correct answer if the panel changed size mid-typing (Turnstile expanding,
// a validation row appearing).
// ---------------------------------------------------------------------------
const typingIn = new Set();

document.addEventListener("focusin", (e) => {
  const t = e.target;
  if (!(t instanceof Element) || !t.matches("input, textarea, select")) return;
  for (const host of tracked) {
    if (host.contains(t)) {
      typingIn.add(host);
      host.style.backdropFilter = "";   // the stylesheet's frost takes over
      break;
    }
  }
});

document.addEventListener("focusout", () => {
  // After focus settles: tabbing between two fields of the same panel must
  // not thrash the lens off and on between them.
  setTimeout(() => {
    for (const host of [...typingIn]) {
      if (host.contains(document.activeElement)) continue;
      typingIn.delete(host);
      const r = host.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) lens(host, r);
    }
  }, 0);
});

export function initLiquidGlass() {
  // url() inside backdrop-filter is Chromium-only. In Safari it parses but
  // renders nothing and takes the blur down with it, so this has to be opt-in
  // rather than try-and-see.
  const chromium = !!navigator.userAgentData?.brands?.some((b) => /Chromium/i.test(b.brand));
  if (!chromium) return;
  if (window.matchMedia("(prefers-reduced-transparency: reduce)").matches) return;
  // A displacement filter on a backdrop is the single most expensive thing on
  // this site. It is for machines that can afford it; everything else keeps
  // the frost, which is what the stylesheet draws on its own.
  if ((document.documentElement.dataset.tier || "high") !== "high") return;

  // Every surface is lensed once, up front.
  //
  // This used to wait for each card to come within 400px of the viewport. It
  // is the cheaper thing to do and it was the wrong call: on a fast scroll the
  // card arrives before its filter does, so panels visibly change as you go
  // past them, and a card that is scrolled to before the idle callback runs
  // simply looks like a different card for a moment. Glass that flickers on
  // is worse than glass that costs a little more.
  //
  // The bill is small and bounded. Maps are bucketed to 16px and cached by
  // size, so a page of near-identical cards builds one map, not one per card;
  // a whole page is a handful of distinct buckets. Reading geometry for all of
  // them in a single pass is also one layout, where the observer version paid
  // for one per batch, mid-scroll, which is the expensive place to pay.
  //
  // Still off the critical path: the pass is scheduled at idle so it never
  // competes with first paint.
  const seen = new WeakSet();

  const scan = () => {
    const todo = [];
    document.querySelectorAll(SELECTOR).forEach((el) => {
      if (seen.has(el)) return;
      // Never lens glass inside other glass. Chromium's nested backdrop for a
      // url() filter picks up sibling content it should not see, which filled
      // an inner pill with a white smear.
      if (el.parentElement?.closest(SELECTOR)) return;
      todo.push(el);
    });
    if (!todo.length) return;

    // One read pass, then one write pass. Interleaving them would force a
    // layout per element.
    const rects = todo.map((el) => el.getBoundingClientRect());

    // Marked as done only if it was actually MEASURABLE. A card inside a
    // [hidden] panel measures 0x0, and marking it here would retire it for
    // good: the MutationObserver below would see the panel open, run this
    // again, find it already in `seen` and skip it forever. That is what left
    // the panels on the work page unfrosted once you picked what you are —
    // every card on that page is behind a [hidden] section at load. The
    // observer version never had this problem because a hidden element simply
    // never intersects, so it kept its turn.
    todo.forEach((el, i) => {
      const r = rects[i];
      if (r.width > 0 && r.height > 0) seen.add(el);
    });

    const ready = todo.filter((el, i) => rects[i].width > 0 && rects[i].height > 0);
    if (!ready.length) return;
    const readyRects = ready.map((el) => rects[todo.indexOf(el)]);
    idle(() => ready.forEach((el, i) => lens(el, readyRects[i])));
  };

  // Cards arrive asynchronously (events, tickets, admin tables) and appear by
  // having [hidden] flipped. Debounced so a burst of mutations costs a single
  // pass. 'style' is deliberately not observed: lens() writes style, and
  // watching it would loop.
  // Nothing is scanned while the tab is hidden, and that is not an
  // optimisation — requestIdleCallback DOES NOT RUN AT ALL in a hidden tab,
  // timeout included, so idle() inside scan() would silently never fire and
  // every surface would be marked seen and then never lensed. A page opened in
  // a background tab came up with no glass at all, permanently, which is
  // exactly what Axel was looking at. run() is called again the moment the tab
  // is looked at.
  const run = () => {
    if (document.hidden) return;
    scan();
  };
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) run();
  });

  let t = 0;
  const queue = () => {
    clearTimeout(t);
    t = setTimeout(run, 250);
  };
  new MutationObserver(queue).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["hidden", "class"],
  });

  // A resize changes every element's shape, so the maps built for the old one
  // are wrong. Rebuilt only for surfaces that actually have a lens, and only
  // once the resize has stopped — a maximised window fires this fifty times.
  let rt = 0;
  window.addEventListener(
    "resize",
    () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        const rects = [...tracked].map((el) => [el, el.getBoundingClientRect()]);
        idle(() => rects.forEach(([el, rect]) => lens(el, rect)));
      }, 300);
    },
    { passive: true }
  );

  run();
}

// ---------------------------------------------------------------------------
// pointer-tracked light
//
// A static specular reads as a printed texture. One that answers your hand
// reads as a surface. The CSS paints a soft highlight at --gx/--gy; this moves
// it. One passive listener, batched into a frame, off on touch and under
// reduced motion.
//
// Moving the highlight repaints the card it is on, which is why this is kept
// to the top tier along with the lens: on a machine that is already struggling,
// a repaint chasing the cursor is the last thing it needs.
// ---------------------------------------------------------------------------
const SHEEN = ".form-shell, .tier, .empty-state, .event-card, .genre, .artist, .accordion";

export function initGlassLight() {
  initLiquidGlass();

  if ((document.documentElement.dataset.tier || "high") !== "high") return;
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  let raf = 0;
  let last = null;
  document.addEventListener(
    "pointermove",
    (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const card = e.target instanceof Element ? e.target.closest(SHEEN) : null;
        if (last && last !== card) {
          last.style.removeProperty("--gx");
          last.style.removeProperty("--gy");
        }
        last = card;
        if (!card) return;
        const r = card.getBoundingClientRect();
        card.style.setProperty("--gx", `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
        card.style.setProperty("--gy", `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
      });
    },
    { passive: true }
  );
}
