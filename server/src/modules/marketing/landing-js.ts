/**
 * The landing page's behaviour, carried over verbatim from the standalone
 * mockup it was designed in.
 *
 * Kept as a TypeScript string rather than a file on disk for one reason: the
 * production image copies `dist`, and a stray .js under src/ would only reach it
 * by way of a COPY line that exists for an unrelated reason (seeding). A
 * string compiles like everything else and cannot go missing.
 *
 * The mockup's copy of this file also CARRIED the page's content — features,
 * roadmap, stats, pricing bullets and FAQs lived in arrays here and were
 * written in with innerHTML on load. That content is server-rendered now and
 * those arrays are gone: a marketing page whose feature list only exists
 * after JavaScript runs is invisible to the crawler it was written for.
 * What remains is behaviour — reveals, the tilt, counters, the nav and the
 * FAQ accordion wiring.
 */
export const LANDING_JS = `/* =========================================================
   Artweel — landing page interactions
   ========================================================= */
(function () {
  "use strict";

  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Render + wire FAQ accordion ---------- */
  const faqList = document.getElementById("faqList");
  if (faqList) {
    const items = Array.prototype.slice.call(faqList.querySelectorAll(".faq-item"));
    items.forEach(function (item) {
      const btn = item.querySelector(".faq-q");
      const panel = item.querySelector(".faq-a");
      btn.addEventListener("click", function () {
        const isOpen = item.classList.contains("open");
        // close all (one open at a time)
        items.forEach(function (other) {
          other.classList.remove("open");
          other.querySelector(".faq-q").setAttribute("aria-expanded", "false");
          other.querySelector(".faq-a").style.height = "0px";
        });
        if (!isOpen) {
          item.classList.add("open");
          btn.setAttribute("aria-expanded", "true");
          panel.style.height = panel.firstElementChild.offsetHeight + "px";
        }
      });
    });

    // keep open panel sized correctly on resize
    window.addEventListener("resize", function () {
      const open = faqList.querySelector(".faq-item.open");
      if (open) {
        const panel = open.querySelector(".faq-a");
        panel.style.height = panel.firstElementChild.offsetHeight + "px";
      }
    });
  }

  /* ---------- Stagger reveal order inside grids ---------- */
  document.querySelectorAll("[data-stagger]").forEach(function (group) {
    Array.prototype.slice.call(group.children).forEach(function (child, i) {
      child.style.setProperty("--i", i);
    });
  });

  /* ---------- Scroll progress bar ---------- */
  const progress = document.getElementById("scrollProgress");
  if (progress) {
    const bar = progress.firstElementChild;
    let frame = 0;
    const drawProgress = function () {
      frame = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      const pct = max > 0 ? Math.min(window.scrollY / max, 1) : 0;
      bar.style.width = (pct * 100).toFixed(2) + "%";
    };
    window.addEventListener("scroll", function () {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(drawProgress);
    }, { passive: true });
    window.addEventListener("resize", drawProgress, { passive: true });
    drawProgress();
  }

  /* ---------- Back to top ---------- */
  const toTop = document.getElementById("toTop");
  if (toTop) {
    const toggleTop = function () {
      const show = window.scrollY > window.innerHeight * 0.9;
      if (show === !toTop.hidden) return;
      if (show) {
        toTop.hidden = false;
        requestAnimationFrame(function () { toTop.classList.add("show"); });
      } else {
        toTop.classList.remove("show");
        window.setTimeout(function () { if (!toTop.classList.contains("show")) toTop.hidden = true; }, 320);
      }
    };
    window.addEventListener("scroll", toggleTop, { passive: true });
    toggleTop();
    toTop.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: prefersReduced ? "auto" : "smooth" });
    });
  }

  /* ---------- Hero window: pointer tilt ---------- */
  const tiltEl = document.querySelector("[data-tilt]");
  if (tiltEl && !prefersReduced && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    const REST = "perspective(1600px) rotateX(2deg)";
    let raf = null;
    tiltEl.style.transition = "transform .5s var(--ease)";
    tiltEl.addEventListener("mousemove", function (e) {
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = null;
        const r = tiltEl.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        tiltEl.style.transition = "transform .12s linear";
        tiltEl.style.transform =
          "perspective(1600px) rotateX(" + (2 - py * 3.2).toFixed(2) + "deg) rotateY(" +
          (px * 4).toFixed(2) + "deg) translateY(-3px)";
      });
    });
    tiltEl.addEventListener("mouseleave", function () {
      tiltEl.style.transition = "transform .5s var(--ease)";
      tiltEl.style.transform = REST;
    });
  }

  /* ---------- Trust logos: seamless marquee ---------- */
  const trustLogos = document.querySelector(".trust-logos");
  if (trustLogos && !prefersReduced && trustLogos.children.length) {
    const track = document.createElement("div");
    track.className = "trust-track";
    trustLogos.parentNode.insertBefore(track, trustLogos);
    track.appendChild(trustLogos);
    // duplicate the run so translateX(-50%) loops seamlessly
    const originals = Array.prototype.slice.call(trustLogos.children);
    originals.forEach(function (li) { trustLogos.appendChild(li.cloneNode(true)); });
  }

  /* ---------- Capacity ring: fill on first view ---------- */
  const ring = document.querySelector(".app-cap-ring");
  if (ring && !prefersReduced && "IntersectionObserver" in window) {
    const target = parseFloat(ring.style.getPropertyValue("--pct")) || 75;
    ring.style.setProperty("--pct", 0);
    let ringFilled = false;
    const rObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        rObs.unobserve(entry.target);
        ringFilled = true;
        const dur = 900, t0 = performance.now();
        const step = function (now) {
          const p = Math.min((now - t0) / dur, 1);
          const eased = 1 - Math.pow(1 - p, 3);
          ring.style.setProperty("--pct", (target * eased).toFixed(2));
          if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    }, { threshold: 0.4 });
    rObs.observe(ring);
    // safety net: if the observer never delivers, show the real figure
    window.setTimeout(function () { if (!ringFilled) ring.style.setProperty("--pct", target); }, 2500);
  }

  /* ---------- Sticky header shadow on scroll ---------- */
  const header = document.getElementById("siteHeader");
  const onScroll = function () {
    if (window.scrollY > 12) header.classList.add("scrolled");
    else header.classList.remove("scrolled");
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---------- Mobile menu ---------- */
  const toggle = document.getElementById("navToggle");
  const menu = document.getElementById("mobileMenu");
  const setMenu = function (open) {
    toggle.setAttribute("aria-expanded", String(open));
    if (open) {
      menu.hidden = false;
      requestAnimationFrame(function () { menu.style.maxHeight = menu.scrollHeight + "px"; });
      toggle.setAttribute("aria-label", "Close menu");
    } else {
      menu.style.maxHeight = "0px";
      toggle.setAttribute("aria-label", "Open menu");
      window.setTimeout(function () { if (toggle.getAttribute("aria-expanded") === "false") menu.hidden = true; }, 320);
    }
  };
  if (toggle && menu) {
    menu.style.maxHeight = "0px";
    menu.style.transition = "max-height .32s cubic-bezier(.22,.61,.36,1)";
    toggle.addEventListener("click", function () {
      setMenu(toggle.getAttribute("aria-expanded") !== "true");
    });
    menu.addEventListener("click", function (e) {
      if (e.target.closest("a")) setMenu(false);
    });
    // close when focus or a click leaves the header
    document.addEventListener("click", function (e) {
      if (toggle.getAttribute("aria-expanded") !== "true") return;
      if (!e.target.closest("#mobileMenu") && !e.target.closest("#navToggle")) setMenu(false);
    });
    document.addEventListener("keydown", function (e) {
      if (toggle.getAttribute("aria-expanded") !== "true") return;
      if (e.key === "Escape") { setMenu(false); toggle.focus(); return; }
      if (e.key !== "Tab") return;
      // keep tabbing inside the open menu
      const stops = [toggle].concat(Array.prototype.slice.call(menu.querySelectorAll("a")));
      const first = stops[0], last = stops[stops.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  /* ---------- Instagram demo slots (interactive) ---------- */
  const slots = document.querySelectorAll(".ig-slots .slot");
  slots.forEach(function (s) {
    s.addEventListener("click", function () {
      if (s.disabled) return;
      slots.forEach(function (o) {
        o.classList.remove("slot-active");
        o.setAttribute("aria-pressed", "false");
      });
      s.classList.add("slot-active");
      s.setAttribute("aria-pressed", "true");
    });
  });

  /* ---------- Feature card cursor spotlight ---------- */
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (finePointer) {
    document.querySelectorAll(".feature-card").forEach(function (card) {
      card.addEventListener("mousemove", function (e) {
        const r = card.getBoundingClientRect();
        card.style.setProperty("--mx", (e.clientX - r.left) + "px");
        card.style.setProperty("--my", (e.clientY - r.top) + "px");
      });
    });
  }

  /* ---------- Scroll-spy nav ---------- */
  const spyLinks = Array.prototype.slice.call(document.querySelectorAll(".nav-desktop a[data-spy]"));
  if (spyLinks.length && "IntersectionObserver" in window) {
    const targets = spyLinks
      .map(function (a) { return document.querySelector(a.getAttribute("href")); })
      .filter(Boolean);
    const spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          spyLinks.forEach(function (a) {
            const on = a.getAttribute("href") === "#" + entry.target.id;
            a.classList.toggle("active", on);
            if (on) a.setAttribute("aria-current", "true");
            else a.removeAttribute("aria-current");
          });
        }
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    targets.forEach(function (t) { spy.observe(t); });
  }

  /* ---------- Count-up stats ---------- */
  const countEls = document.querySelectorAll(".stat-num");
  const runCount = function (el) {
    const to = parseInt(el.getAttribute("data-to"), 10);
    const suffix = el.getAttribute("data-suffix") || "";
    if (to === 0) { el.textContent = "0" + suffix; return; }
    const dur = 1100, start = performance.now();
    const tick = function (now) {
      const p = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(to * eased) + suffix;
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  if (countEls.length && "IntersectionObserver" in window && !prefersReduced) {
    const cObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { runCount(entry.target); cObs.unobserve(entry.target); }
      });
    }, { threshold: 0.6 });
    countEls.forEach(function (el) { cObs.observe(el); });
  }

  /* ---------- Scroll reveal ---------- */
  const revealEls = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
  const revealNow = function (el) { el.classList.add("in"); };

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          revealNow(entry.target);
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });

    // Reveal anything already in the initial viewport immediately (no wait on scroll).
    const vh = window.innerHeight || document.documentElement.clientHeight;
    revealEls.forEach(function (el) {
      if (el.getBoundingClientRect().top < vh * 0.92) revealNow(el);
      else io.observe(el);
    });

    // Safety net: never leave content stuck invisible if the observer never fires.
    window.setTimeout(function () { revealEls.forEach(revealNow); }, 2500);
  } else {
    revealEls.forEach(revealNow);
  }
})();
`;
