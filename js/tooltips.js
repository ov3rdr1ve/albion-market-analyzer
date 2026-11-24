// Instant hover tooltips.
//
// The whole app annotates controls, table headers and in-row badges with the
// native `title` attribute — but browsers show those only after a ~1s delay and
// style them with the bare OS chrome. This module replaces that with a single
// styled tooltip box that appears the moment you hover (or keyboard-focus) ANY
// element carrying tooltip text, anywhere on the page — including table cells
// rendered long after load, via event delegation on `document`.
//
// How it avoids a double tooltip: the first time an element with a `title` is
// hovered, its text is migrated to `data-tip` and the `title` is removed, so the
// native delayed tooltip never fires again. Freshly re-rendered cells keep their
// `title` until first hover, then migrate too — no per-render bookkeeping.
//
// computeTooltipPosition is a pure function (no DOM) so it can be unit-tested:
// given the anchor rect, the tooltip size and the viewport, it returns where to
// place the box (above the anchor, flipping below when there's no room, clamped
// inside the viewport). See tests/tooltip-position.test.cjs.

(function () {
  "use strict";

  // Pure placement math. All inputs are plain {…} rects/sizes; returns the
  // viewport-relative {left, top, placement} for a position:fixed tooltip.
  function computeTooltipPosition(anchorRect, tipSize, viewport, margin) {
    const gap = typeof margin === "number" ? margin : 8;

    // Horizontally centre on the anchor, then clamp fully inside the viewport.
    const centeredLeft = anchorRect.left + anchorRect.width / 2 - tipSize.width / 2;
    const maxLeft = Math.max(gap, viewport.width - tipSize.width - gap);
    const left = Math.min(Math.max(gap, centeredLeft), maxLeft);

    // Prefer above the anchor; flip below when it would clip the top edge.
    const aboveTop = anchorRect.top - tipSize.height - gap;
    let top, placement;
    if (aboveTop >= gap) {
      top = aboveTop;
      placement = "top";
    } else {
      placement = "bottom";
      const belowTop = anchorRect.bottom + gap;
      const maxTop = Math.max(gap, viewport.height - tipSize.height - gap);
      top = Math.min(belowTop, maxTop);
    }
    return { left: Math.round(left), top: Math.round(top), placement };
  }

  // ── Browser wiring (skipped under Node so the pure fn stays unit-testable) ──
  if (typeof document !== "undefined" && typeof window !== "undefined") {
    const SELECTOR = "[title],[data-tip]";
    let tipEl = null;
    let activeAnchor = null;

    function ensureEl() {
      if (!tipEl) {
        tipEl = document.createElement("div");
        tipEl.id = "app-tooltip";
        tipEl.setAttribute("role", "tooltip");
        document.body.appendChild(tipEl);
      }
      return tipEl;
    }

    // Read an element's tooltip text, migrating a native `title` to `data-tip`
    // once so the slow native tooltip never fires for it again.
    function tooltipText(el) {
      if (el.hasAttribute("title")) {
        const t = el.getAttribute("title");
        if (t && t.trim()) el.setAttribute("data-tip", t);
        el.removeAttribute("title");
      }
      const tip = el.getAttribute("data-tip");
      return tip && tip.trim() ? tip : "";
    }

    function show(anchor) {
      const text = tooltipText(anchor);
      if (!text) return;
      activeAnchor = anchor;
      const el = ensureEl();
      el.textContent = text; // textContent → tooltip text can never inject HTML
      // Measure off-screen-ish (hidden but laid out), then place.
      el.style.visibility = "hidden";
      el.classList.add("visible");
      const tr = el.getBoundingClientRect();
      const pos = computeTooltipPosition(
        anchor.getBoundingClientRect(),
        { width: tr.width, height: tr.height },
        { width: window.innerWidth, height: window.innerHeight },
      );
      el.style.left = pos.left + "px";
      el.style.top = pos.top + "px";
      el.dataset.placement = pos.placement;
      el.style.visibility = "";
    }

    function hide() {
      activeAnchor = null;
      if (tipEl) tipEl.classList.remove("visible");
    }

    function anchorFrom(target) {
      return target && target.closest ? target.closest(SELECTOR) : null;
    }

    document.addEventListener("mouseover", function (e) {
      const anchor = anchorFrom(e.target);
      if (!anchor || anchor === activeAnchor) return;
      show(anchor);
    });
    document.addEventListener("mouseout", function (e) {
      if (!activeAnchor) return;
      const to = e.relatedTarget;
      if (to && (activeAnchor === to || activeAnchor.contains(to))) return; // still inside
      hide();
    });

    // Keyboard accessibility: show on focus, hide on blur.
    document.addEventListener("focusin", function (e) {
      const anchor = anchorFrom(e.target);
      if (anchor) show(anchor);
    });
    document.addEventListener("focusout", hide);

    // Never strand the box: any scroll, resize, escape, or click dismisses it.
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") hide(); });
    document.addEventListener("click", function () { if (activeAnchor) hide(); }, true);
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { computeTooltipPosition };
  } else if (typeof window !== "undefined") {
    window.computeTooltipPosition = computeTooltipPosition;
  }
})();
