/**
 * The landing page's stylesheet, carried over verbatim from the standalone
 * mockup it was designed in.
 *
 * Kept as a TypeScript string rather than a file on disk for one reason: the
 * production image copies `dist`, and a stray .css under src/ would only reach it
 * by way of a COPY line that exists for an unrelated reason (seeding). A
 * string compiles like everything else and cannot go missing.
 *
 * Do not hand-edit for content changes — it is design only.
 */
export const LANDING_CSS = `/* =========================================================
   Artweel — premium dark SaaS landing page
   ========================================================= */

:root {
  /* Surfaces */
  --bg:            #0d0a08;
  --bg-2:          #120e0c;
  --surface:       #181312;
  --surface-2:     #1f1917;
  --surface-hi:    #271e1a;

  /* Warm accents */
  --accent:        #e07f4a;   /* burnt orange */
  --accent-2:      #c8622d;
  --accent-3:      #b45a3c;   /* terracotta */
  --accent-soft:   rgba(224, 127, 74, 0.13);
  --accent-line:   rgba(224, 127, 74, 0.28);
  --accent-glow:   rgba(200, 98, 45, 0.5);

  /* Text */
  --text:          #f4ede3;
  --text-2:        #d0c2b4;
  --text-3:        #9c8d7e;
  --text-4:        #8a7b6d;

  /* Lines */
  --line:          rgba(235, 212, 191, 0.09);
  --line-2:        rgba(235, 212, 191, 0.15);

  --radius:        18px;
  --radius-sm:     12px;
  --radius-lg:     26px;

  --shadow-sm:     0 1px 2px rgba(0,0,0,.4);
  --shadow:        0 24px 60px -30px rgba(0,0,0,.75);
  --shadow-lg:     0 50px 110px -45px rgba(0,0,0,.9);

  --maxw:          1140px;
  --ease:          cubic-bezier(.22,.61,.36,1);
  --font:          'Inter', system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  --serif:         'Instrument Serif', 'Times New Roman', serif;
}

* { box-sizing: border-box; }

html { scroll-behavior: smooth; -webkit-text-size-adjust: 100%; scroll-padding-top: 84px; }

body {
  margin: 0;
  font-family: var(--font);
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
  font-size: 16px;
  letter-spacing: -0.011em;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  overflow-x: hidden;
}

/* subtle full-page warm vignette */
body::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background:
    radial-gradient(1200px 640px at 50% -12%, rgba(170, 78, 40, 0.16), transparent 60%),
    radial-gradient(900px 520px at 100% 108%, rgba(120, 56, 34, 0.09), transparent 55%);
}

img { max-width: 100%; display: block; }
a { color: inherit; text-decoration: none; }

.container { width: 100%; max-width: var(--maxw); margin: 0 auto; padding: 0 24px; position: relative; z-index: 1; }

.skip-link {
  position: absolute; left: -9999px; top: 0; z-index: 200;
  background: var(--accent); color: #201008; padding: 10px 16px; border-radius: 0 0 8px 0; font-weight: 700;
}
.skip-link:focus { left: 0; }

/* editorial serif accent inside headings */
em { font-style: normal; }
.hero-title em, .section-title em, .cta-title em {
  font-family: var(--serif);
  font-style: italic;
  font-weight: 400;
  letter-spacing: 0;
  color: var(--accent);
  padding-right: .04em;
}

/* ---------- Typography helpers ---------- */
.eyebrow {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--accent);
  margin: 0 0 18px;
}
.eyebrow::before {
  content: ""; width: 20px; height: 1px; background: linear-gradient(90deg, var(--accent), transparent);
}
.eyebrow-on-dark { color: #ffd6bd; }
.eyebrow-on-dark::before { background: linear-gradient(90deg, #ffd6bd, transparent); }

.section-title {
  font-size: clamp(1.65rem, 1.05rem + 2.1vw, 2.5rem);
  font-weight: 700;
  line-height: 1.12;
  letter-spacing: -0.028em;
  margin: 0 0 20px;
  color: var(--text);
}

.lede { font-size: 1.07rem; color: var(--text-2); margin: 0 0 18px; max-width: 48ch; line-height: 1.62; }
.body-muted { color: var(--text-3); margin: 0; max-width: 48ch; }
.lede-on-dark { color: rgba(255,240,232,.82); }

.section { padding: clamp(60px, 8vw, 106px) 0; position: relative; z-index: 1; }

.section-head { max-width: 640px; margin: 0 0 clamp(34px, 5vw, 56px); }
.section-head.center { margin-left: auto; margin-right: auto; text-align: center; }
.section-head.center .eyebrow { justify-content: center; }
.center-lede { margin-left: auto; margin-right: auto; }

/* ---------- Buttons ---------- */
.btn {
  position: relative; overflow: hidden;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  font-family: inherit; font-weight: 600; font-size: 15px;
  border-radius: 999px; border: 1px solid transparent; cursor: pointer;
  padding: 12px 22px; transition: transform .18s var(--ease), box-shadow .25s, border-color .2s, background .2s;
  white-space: nowrap;
}
.btn:active { transform: translateY(1px); }
.btn-sm { padding: 9px 18px; font-size: 14px; }
.btn-lg { padding: 15px 28px; font-size: 16px; }

.btn-primary {
  background: linear-gradient(180deg, #ec9560 0%, var(--accent-2) 100%);
  color: #22120a;
  box-shadow: 0 12px 34px -12px var(--accent-glow), inset 0 1px 0 rgba(255,255,255,.32);
}
.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 18px 46px -14px var(--accent-glow), inset 0 1px 0 rgba(255,255,255,.38);
}
.btn-ghost {
  background: rgba(255,255,255,.035);
  color: var(--text);
  border-color: var(--line-2);
  backdrop-filter: blur(6px);
}
.btn-ghost:hover { background: rgba(255,255,255,.07); border-color: rgba(235,212,191,.26); transform: translateY(-2px); }

/* shimmer sweep */
.btn-shine::after {
  content: ""; position: absolute; top: 0; left: -120%; width: 70%; height: 100%;
  background: linear-gradient(100deg, transparent, rgba(255,255,255,.45), transparent);
  transform: skewX(-18deg); transition: left .7s var(--ease);
}
.btn-shine:hover::after { left: 130%; }

:where(a, button):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
  border-radius: 8px;
}

/* =========================================================
   HEADER
   ========================================================= */
.site-header {
  position: sticky; top: 0; z-index: 100;
  transition: background .3s, border-color .3s, backdrop-filter .3s;
  border-bottom: 1px solid transparent;
}
.site-header.scrolled {
  background: rgba(13, 10, 8, 0.74);
  backdrop-filter: blur(16px) saturate(150%);
  border-bottom-color: var(--line);
}
.header-inner { display: flex; align-items: center; justify-content: space-between; height: 68px; }

.brand { display: inline-flex; align-items: center; gap: 10px; font-weight: 700; letter-spacing: -0.02em; }
.brand-mark { color: var(--accent); display: inline-flex; }
.brand-mark svg { display: block; }
.brand-name { font-size: 18px; }

.nav-desktop { display: flex; align-items: center; gap: 30px; }
.nav-desktop a:not(.btn) { position: relative; color: var(--text-2); font-size: 15px; font-weight: 500; transition: color .18s; }
.nav-desktop a:not(.btn)::after {
  content: ""; position: absolute; left: 0; bottom: -6px; width: 100%; height: 1.5px;
  background: var(--accent); transform: scaleX(0); transform-origin: left; transition: transform .28s var(--ease);
}
.nav-desktop a:not(.btn):hover { color: var(--text); }
.nav-desktop a:not(.btn):hover::after,
.nav-desktop a.active::after { transform: scaleX(1); }
.nav-desktop a.active { color: var(--text); }

.nav-toggle {
  display: none; flex-direction: column; gap: 5px; width: 42px; height: 42px;
  align-items: center; justify-content: center; background: transparent; border: 1px solid var(--line-2);
  border-radius: 10px; cursor: pointer;
}
.nav-toggle span { display: block; width: 18px; height: 2px; background: var(--text); border-radius: 2px; transition: transform .28s var(--ease), opacity .2s; }
.nav-toggle[aria-expanded="true"] span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
.nav-toggle[aria-expanded="true"] span:nth-child(2) { opacity: 0; }
.nav-toggle[aria-expanded="true"] span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }

.mobile-menu {
  overflow: hidden;
  background: rgba(13, 10, 8, 0.97);
  backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--line);
}
.mobile-menu-inner { display: flex; flex-direction: column; gap: 6px; padding-top: 10px; padding-bottom: 20px; }
.mobile-menu-inner a:not(.btn) { padding: 12px 4px; color: var(--text-2); font-weight: 500; border-bottom: 1px solid var(--line); }
.mobile-menu-inner .btn { margin-top: 12px; }

/* =========================================================
   HERO
   ========================================================= */
.hero {
  position: relative;
  padding: clamp(60px, 10vw, 118px) 0 clamp(40px, 6vw, 72px);
  overflow: hidden;
  text-align: center;
}
.hero-bg { position: absolute; inset: 0; z-index: 0; pointer-events: none; }
.aurora { position: absolute; border-radius: 50%; filter: blur(60px); opacity: .5; will-change: transform; }
.aurora-1 {
  left: 50%; top: -8%; width: 780px; height: 520px; transform: translateX(-50%);
  background: radial-gradient(closest-side, rgba(224,127,74,.5), rgba(180,80,40,.1) 60%, transparent 75%);
  animation: drift1 16s ease-in-out infinite alternate;
}
.aurora-2 {
  left: 20%; top: 18%; width: 460px; height: 380px;
  background: radial-gradient(closest-side, rgba(150,70,120,.22), transparent 70%);
  animation: drift2 20s ease-in-out infinite alternate;
}
@keyframes drift1 { from { transform: translate(-52%, 0) scale(1); } to { transform: translate(-48%, 4%) scale(1.08); } }
@keyframes drift2 { from { transform: translate(0,0) scale(1); } to { transform: translate(8%, -6%) scale(1.12); } }

.hero-rings {
  position: absolute; left: 50%; top: 40%; width: 1150px; height: 1150px; transform: translate(-50%, -50%);
  border-radius: 50%;
  background:
    repeating-radial-gradient(circle at center,
      transparent 0, transparent 70px,
      rgba(216, 164, 134, 0.055) 71px, rgba(216, 164, 134, 0.055) 72px);
  -webkit-mask-image: radial-gradient(closest-side, #000 28%, transparent 70%);
          mask-image: radial-gradient(closest-side, #000 28%, transparent 70%);
  opacity: .85;
}
.grain {
  position: absolute; inset: 0; opacity: .045; mix-blend-mode: overlay; pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}

.hero-inner { max-width: 860px; margin: 0 auto; }

.badge {
  display: inline-flex; align-items: center; gap: 9px;
  font-size: 12.5px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase;
  color: var(--text-2);
  background: rgba(255,255,255,.04);
  border: 1px solid var(--line-2);
  padding: 7px 15px 7px 12px; border-radius: 999px; margin-bottom: 26px;
  backdrop-filter: blur(6px); transition: border-color .2s, color .2s;
}
.badge:hover { border-color: var(--accent-line); color: var(--text); }
.badge-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }

.hero-title {
  font-size: clamp(2.35rem, 1.05rem + 5.6vw, 4.35rem);
  font-weight: 800;
  line-height: 1.03;
  letter-spacing: -0.038em;
  margin: 0 0 22px;
  background: linear-gradient(180deg, #fcf6ef 28%, #d8c2b1 128%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.hero-title em { -webkit-text-fill-color: var(--accent); }
.hero-sub {
  font-size: clamp(1.03rem, .95rem + .55vw, 1.24rem);
  color: var(--text-2);
  max-width: 640px; margin: 0 auto 34px; line-height: 1.62;
}
.hero-cta { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; }
.hero-note { color: var(--text-4); font-size: 14px; margin: 22px 0 0; }
.br-lg { display: none; }

/* ---- Hero product preview ---- */
.hero-preview { position: relative; margin: clamp(48px, 7vw, 84px) auto 0; max-width: 960px; }
.app-window {
  position: relative;
  border-radius: 16px;
  border: 1px solid var(--line-2);
  background: linear-gradient(180deg, #1b1512, #100c0a);
  box-shadow: var(--shadow-lg), 0 0 0 1px rgba(255,255,255,.02) inset;
  overflow: hidden;
  text-align: left;
  transform: perspective(1600px) rotateX(2deg);
}
.app-chrome {
  display: flex; align-items: center; gap: 14px;
  padding: 12px 16px; border-bottom: 1px solid var(--line);
  background: rgba(255,255,255,.02);
}
.app-dots { display: inline-flex; gap: 7px; }
.app-dots i { width: 11px; height: 11px; border-radius: 50%; background: #3a2f2a; display: inline-block; }
.app-dots i:nth-child(1){ background:#c85a4a; } .app-dots i:nth-child(2){ background:#d8a24a; } .app-dots i:nth-child(3){ background:#6fae76; }
.app-url { flex: 1; text-align: center; font-size: 12.5px; color: var(--text-4); letter-spacing: .01em;
  background: rgba(255,255,255,.03); border: 1px solid var(--line); border-radius: 8px; padding: 5px 12px; max-width: 320px; margin: 0 auto; }
.app-live { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: #7fbf95; font-weight: 600; }
.live-dot { width: 7px; height: 7px; border-radius: 50%; background: #7fbf95; box-shadow: 0 0 0 3px rgba(127,191,149,.18); }

.app-body { display: grid; grid-template-columns: 200px 1fr; min-height: 320px; }
.app-side { border-right: 1px solid var(--line); padding: 18px 16px; display: flex; flex-direction: column; gap: 18px; background: rgba(0,0,0,.15); }
.app-brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14px; }
.app-nav { display: flex; flex-direction: column; gap: 3px; }
.app-nav-item { display: flex; align-items: center; gap: 10px; padding: 9px 11px; border-radius: 9px; font-size: 13px; color: var(--text-3); }
.app-nav-item.active { background: var(--accent-soft); color: var(--text); border: 1px solid var(--accent-line); }
.ico { width: 15px; height: 15px; border-radius: 4px; flex: none; background: currentColor; opacity: .5;
  -webkit-mask-size: contain; mask-size: contain; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; }
.app-nav-item.active .ico { opacity: 1; color: var(--accent); }
.ico-cal { -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2'%3E%3Crect x='3' y='4' width='18' height='18' rx='2'/%3E%3Cpath d='M3 9h18M8 2v4M16 2v4'/%3E%3C/svg%3E"); mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2'%3E%3Crect x='3' y='4' width='18' height='18' rx='2'/%3E%3Cpath d='M3 9h18M8 2v4M16 2v4'/%3E%3C/svg%3E"); }
.ico-book { -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2'%3E%3Cpath d='M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 0-2 2z'/%3E%3C/svg%3E"); mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2'%3E%3Cpath d='M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 0-2 2z'/%3E%3C/svg%3E"); }
.ico-course { -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2'%3E%3Cpath d='M12 3 2 8l10 5 10-5z'/%3E%3Cpath d='M6 10v6l6 3 6-3v-6'/%3E%3C/svg%3E"); mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2'%3E%3Cpath d='M12 3 2 8l10 5 10-5z'/%3E%3Cpath d='M6 10v6l6 3 6-3v-6'/%3E%3C/svg%3E"); }
.ico-pay { -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2'%3E%3Crect x='2' y='5' width='20' height='14' rx='2'/%3E%3Cpath d='M2 10h20'/%3E%3C/svg%3E"); mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2'%3E%3Crect x='2' y='5' width='20' height='14' rx='2'/%3E%3Cpath d='M2 10h20'/%3E%3C/svg%3E"); }

.app-cap { margin-top: auto; }
.app-cap-label { font-size: 11px; color: var(--text-4); text-transform: uppercase; letter-spacing: .1em; }
.app-cap-ring {
  --pct: 75; margin-top: 10px; width: 76px; height: 76px; border-radius: 50%;
  display: grid; place-items: center;
  background: conic-gradient(var(--accent) calc(var(--pct) * 1%), rgba(255,255,255,.07) 0);
  -webkit-mask: none;
}
.app-cap-ring b { width: 58px; height: 58px; border-radius: 50%; background: #14100e; display: grid; place-items: center; font-size: 18px; font-weight: 700; color: var(--text); }
.app-cap-ring b span { font-size: 12px; color: var(--text-4); font-weight: 500; }

.app-main { padding: 18px 20px; min-width: 0; }
.app-main-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.app-main-head strong { font-size: 15px; }
.app-tabs { display: inline-flex; gap: 2px; background: rgba(255,255,255,.04); border: 1px solid var(--line); border-radius: 9px; padding: 3px; }
.app-tabs i { font-style: normal; font-size: 12px; color: var(--text-3); padding: 4px 11px; border-radius: 6px; }
.app-tabs i.active { background: var(--surface-hi); color: var(--text); }
.app-week { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.app-day { display: flex; flex-direction: column; gap: 8px; }
.app-dow { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--text-4); font-weight: 600; }
.app-ev {
  background: var(--surface-hi); border: 1px solid var(--line); border-left: 3px solid var(--accent);
  border-radius: 9px; padding: 9px 10px; font-size: 12px; font-weight: 600; color: var(--text);
  display: flex; flex-direction: column; gap: 3px;
}
.app-ev em { font-style: normal; font-size: 10.5px; font-weight: 500; color: var(--text-3); }
.app-ev.dim { opacity: .6; }
.app-ev.full { border-left-color: #d1584a; }
.app-ev.full em { color: #dc8478; }
.ev-mobile { border-left-color: #7f9c8f; }
.ev-private { border-left-color: #b98cc0; }
.ev-course { border-left-color: #d8a24a; }

.preview-fade { position: absolute; left: -10%; right: -10%; bottom: -1px; height: 42%;
  background: linear-gradient(180deg, transparent, var(--bg) 92%); pointer-events: none; }

/* ---- Trust strip ---- */
.trust { margin-top: clamp(30px, 5vw, 52px); }
.trust-label { display: block; font-size: 12.5px; letter-spacing: .04em; color: var(--text-4); margin-bottom: 16px; }
.trust-logos { list-style: none; display: flex; flex-wrap: wrap; justify-content: center; gap: 14px 34px; margin: 0; padding: 0; }
.trust-logos li { font-family: var(--serif); font-style: italic; font-size: 1.25rem; color: var(--text-3); opacity: .72; transition: opacity .2s, color .2s; }
.trust-logos li:hover { opacity: 1; color: var(--text-2); }

/* =========================================================
   STATS BAND
   ========================================================= */
.stats-band { padding: clamp(28px, 4vw, 46px) 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.stats { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; }
.stat { text-align: center; position: relative; }
.stat + .stat::before { content: ""; position: absolute; left: -12px; top: 12%; height: 76%; width: 1px; background: var(--line); }
.stat-num { font-size: clamp(1.9rem, 1.2rem + 2vw, 2.7rem); font-weight: 800; letter-spacing: -0.03em; line-height: 1;
  background: linear-gradient(180deg, #fbf1e8, var(--accent)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.stat-label { display: block; margin-top: 9px; font-size: 13px; color: var(--text-3); }

/* =========================================================
   FEATURE GRID
   ========================================================= */
.feature-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; }
.feature-card {
  position: relative;
  background: linear-gradient(180deg, var(--surface) 0%, var(--bg-2) 100%);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 26px 22px 28px;
  transition: transform .3s var(--ease), border-color .3s, box-shadow .3s;
  overflow: hidden;
}
/* cursor spotlight */
.feature-card::after {
  content: ""; position: absolute; inset: 0; border-radius: inherit; opacity: 0; transition: opacity .3s; pointer-events: none;
  background: radial-gradient(360px circle at var(--mx, 50%) var(--my, 0%), rgba(224,127,74,.14), transparent 42%);
}
.feature-card::before {
  content: ""; position: absolute; inset: 0; border-radius: inherit; padding: 1px;
  background: linear-gradient(160deg, rgba(224,127,74,.4), transparent 42%);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
  opacity: 0; transition: opacity .3s;
}
.feature-card:hover {
  transform: translateY(-4px);
  border-color: transparent;
  box-shadow: var(--shadow);
}
.feature-card:hover::before, .feature-card:hover::after { opacity: 1; }

.feature-icon {
  position: relative; z-index: 1;
  width: 44px; height: 44px; border-radius: 13px;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--accent-soft);
  border: 1px solid var(--accent-line);
  color: var(--accent);
  margin-bottom: 18px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
}
.feature-icon svg { width: 21px; height: 21px; }
.feature-card h3 { position: relative; z-index: 1; font-size: 1.03rem; font-weight: 600; line-height: 1.3; margin: 0 0 10px; letter-spacing: -0.02em; color: var(--text); }
.feature-card p { position: relative; z-index: 1; font-size: .92rem; color: var(--text-3); margin: 0; line-height: 1.58; }

/* =========================================================
   SPLIT SECTIONS
   ========================================================= */
.split-grid { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(32px, 5vw, 76px); align-items: center; }
.split-reverse .split-copy { order: 2; }
.split-reverse .split-visual { order: 1; }

/* --- Schedule mockup --- */
.schedule-card {
  background: linear-gradient(180deg, var(--surface-2), var(--bg-2));
  border: 1px solid var(--line-2);
  border-radius: var(--radius-lg);
  padding: 20px;
  box-shadow: var(--shadow-lg);
}
.schedule-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; flex-wrap: wrap; gap: 10px; }
.schedule-title { font-weight: 600; font-size: .95rem; }
.schedule-legend { display: flex; align-items: center; gap: 12px; font-size: 11px; color: var(--text-3); }
.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 5px; vertical-align: middle; }
.dot-studio { background: var(--accent); }
.dot-mobile { background: #7f9c8f; }
.dot-private { background: #b98cc0; }

.schedule-body { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.schedule-col { display: flex; flex-direction: column; gap: 10px; }
.schedule-day { font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: var(--text-4); font-weight: 600; }
.event {
  position: relative;
  background: var(--surface-hi);
  border: 1px solid var(--line);
  border-left: 3px solid var(--accent);
  border-radius: 10px;
  padding: 10px 11px;
  font-size: 12px;
}
.event strong { display: block; font-weight: 600; font-size: 12.5px; margin-bottom: 3px; color: var(--text); }
.event span { color: var(--text-3); font-size: 11px; }
.event.faint { opacity: .62; }
.ev-mobile { border-left-color: #7f9c8f; }
.ev-private { border-left-color: #b98cc0; }
.capbar { height: 4px; background: rgba(255,255,255,.07); border-radius: 4px; margin-top: 8px; overflow: hidden; }
.capbar i { display: block; height: 100%; background: var(--accent); border-radius: 4px; }
.capbar.full i { background: #d1584a; }
.pill { position: absolute; top: 9px; right: 9px; font-size: 9.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: #d1584a; background: rgba(209,88,74,.12); padding: 2px 7px; border-radius: 6px; }

/* --- Instagram booking card --- */
.ig-card {
  background: linear-gradient(180deg, var(--surface-2), var(--bg-2));
  border: 1px solid var(--line-2);
  border-radius: var(--radius-lg);
  padding: 22px;
  box-shadow: var(--shadow-lg);
  max-width: 420px;
}
.ig-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.ig-avatar { width: 46px; height: 46px; border-radius: 50%; flex: none; display: inline-flex; align-items: center; justify-content: center; background: var(--accent-soft); color: var(--accent); border: 1px solid var(--accent-line); }
.ig-meta { flex: 1; min-width: 0; }
.ig-meta strong { display: block; font-size: .95rem; }
.ig-meta span { font-size: 12px; color: var(--text-3); }
.ig-badge { font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #7fbf95; background: rgba(127,191,149,.12); padding: 4px 9px; border-radius: 999px; }
.ig-bio { font-size: 13px; color: var(--text-2); margin: 0 0 16px; }
.ig-slots { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.slot { display: flex; align-items: center; justify-content: space-between; background: var(--surface-hi); border: 1px solid var(--line); color: var(--text-2); border-radius: 10px; padding: 11px 14px; font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; transition: border-color .2s, background .2s, transform .15s; }
.slot em { font-style: normal; font-size: 12px; color: var(--text-4); }
.slot:hover { border-color: var(--line-2); transform: translateX(2px); }
.slot:disabled { opacity: .55; cursor: not-allowed; }
.slot:disabled:hover { transform: none; border-color: var(--line); }
.slot-active { border-color: var(--accent-line); background: var(--accent-soft); color: var(--text); }
.slot-active em { color: var(--accent); }
.ig-cta { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 14px; border-top: 1px solid var(--line); flex-wrap: wrap; }
.ig-cta > span:first-child { font-size: 12px; color: var(--text-3); }
.ig-book { background: linear-gradient(180deg, #ec9560, var(--accent-2)); color: #22120a; font-weight: 600; font-size: 13px; padding: 9px 16px; border-radius: 999px; }

/* --- Map / mobile party card --- */
.map-card { background: linear-gradient(180deg, var(--surface-2), var(--bg-2)); border: 1px solid var(--line-2); border-radius: var(--radius-lg); padding: 18px; box-shadow: var(--shadow-lg); }
.map-face { position: relative; height: 230px; border-radius: 16px; overflow: hidden; background: radial-gradient(120% 120% at 30% 20%, #1e1815, #120e0c); border: 1px solid var(--line); }
.map-grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(235,212,191,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(235,212,191,.05) 1px, transparent 1px); background-size: 34px 34px; }
.map-zone { position: absolute; left: 24%; top: 22%; width: 58%; height: 62%; border-radius: 50%; background: radial-gradient(closest-side, var(--accent-soft), rgba(224,127,74,.03)); border: 1px dashed var(--accent-line); }
.map-pin { position: absolute; display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: var(--text-2); }
.map-pin span { width: 11px; height: 11px; border-radius: 50%; box-shadow: 0 0 0 4px rgba(224,127,74,.16); }
.map-pin-studio { left: 34%; top: 40%; } .map-pin-studio span { background: var(--accent); }
.map-pin-cust { left: 58%; top: 62%; } .map-pin-cust span { background: #7fbf95; box-shadow: 0 0 0 4px rgba(127,191,149,.16); }
.map-route { position: absolute; left: 37%; top: 45%; width: 24%; height: 20%; border-bottom: 2px dashed rgba(235,212,191,.3); border-left: 2px dashed rgba(235,212,191,.3); border-bottom-left-radius: 40px; }
.map-flow { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; }
.flow-step { display: flex; align-items: center; gap: 12px; font-size: 13px; color: var(--text-3); background: var(--surface-hi); border: 1px solid var(--line); border-radius: 10px; padding: 10px 13px; }
.flow-i { width: 22px; height: 22px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; background: rgba(255,255,255,.05); color: var(--text-3); flex: none; }
.flow-step.done { color: var(--text); }
.flow-step.done .flow-i { background: var(--accent-soft); color: var(--accent); }

/* =========================================================
   ROADMAP CARD
   ========================================================= */
.roadmap-card { position: relative; border-radius: var(--radius-lg); padding: 1px; background: linear-gradient(140deg, rgba(224,127,74,.55), rgba(140,64,36,.15) 55%, rgba(224,127,74,.32)); overflow: hidden; box-shadow: var(--shadow-lg); }
.roadmap-inner { position: relative; z-index: 1; background: radial-gradient(120% 140% at 100% 0%, rgba(180,80,40,.34), transparent 55%), linear-gradient(165deg, #2b1a12, #150e0b); border-radius: calc(var(--radius-lg) - 1px); padding: clamp(30px, 5vw, 54px); display: grid; grid-template-columns: 1fr 1fr; gap: clamp(28px, 4vw, 56px); align-items: start; }
.roadmap-glow { position: absolute; right: -10%; top: -40%; width: 60%; height: 120%; background: radial-gradient(closest-side, rgba(236,149,96,.36), transparent 70%); filter: blur(22px); z-index: 0; }
.roadmap-head .section-title { color: #fbeee5; }
.roadmap-head .section-title em { -webkit-text-fill-color: #ffcaa6; color: #ffcaa6; }
.roadmap-list { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.roadmap-list li { display: flex; align-items: flex-start; gap: 13px; background: rgba(255,255,255,.045); border: 1px solid rgba(255,225,205,.13); border-radius: 12px; padding: 14px 16px; font-size: .95rem; color: rgba(255,240,232,.9); transition: transform .25s var(--ease), background .25s; }
.roadmap-list li:hover { transform: translateX(4px); background: rgba(255,255,255,.07); }
.roadmap-list .check { flex: none; width: 22px; height: 22px; border-radius: 7px; margin-top: 1px; display: inline-flex; align-items: center; justify-content: center; background: rgba(236,149,96,.22); color: #ffcaa6; border: 1px solid rgba(236,149,96,.3); }
.roadmap-list .check svg { width: 13px; height: 13px; }

/* =========================================================
   PRICING
   ========================================================= */
.price-card {
  position: relative; overflow: hidden;
  display: grid; grid-template-columns: 1fr 1.1fr; gap: clamp(28px, 4vw, 56px); align-items: center;
  max-width: 940px; margin: 0 auto;
  background: linear-gradient(180deg, var(--surface-2), var(--bg-2));
  border: 1px solid var(--line-2);
  border-radius: var(--radius-lg);
  padding: clamp(30px, 4vw, 48px);
  box-shadow: var(--shadow-lg);
}
.price-glow { position: absolute; left: -12%; top: -40%; width: 55%; height: 150%; background: radial-gradient(closest-side, rgba(224,127,74,.22), transparent 70%); filter: blur(24px); pointer-events: none; }
.price-left { position: relative; z-index: 1; }
.price-plan { display: inline-block; font-size: 12px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: var(--accent); border: 1px solid var(--accent-line); border-radius: 999px; padding: 5px 13px; margin-bottom: 20px; }
.price-amount { font-size: clamp(3rem, 2rem + 4vw, 4.4rem); font-weight: 800; letter-spacing: -0.04em; line-height: 1; color: var(--text); }
.price-amount sup { font-size: .42em; font-weight: 700; vertical-align: super; margin-right: 2px; color: var(--text-2); }
.price-amount .price-per { font-size: .26em; font-weight: 600; color: var(--text-3); letter-spacing: 0; }
.price-note { color: var(--text-3); font-size: .92rem; margin: 16px 0 24px; max-width: 34ch; }
.price-list { position: relative; z-index: 1; list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 12px 20px; }
.price-list li { display: flex; align-items: flex-start; gap: 10px; font-size: .93rem; color: var(--text-2); }
.price-list .tick { flex: none; width: 20px; height: 20px; margin-top: 1px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; background: var(--accent-soft); color: var(--accent); border: 1px solid var(--accent-line); }
.price-list .tick svg { width: 12px; height: 12px; }

/* =========================================================
   FAQ
   ========================================================= */
.faq-wrap { display: grid; grid-template-columns: 0.9fr 1.4fr; gap: clamp(28px, 5vw, 64px); align-items: start; }
.faq-aside { margin-top: 14px; max-width: 30ch; }
.faq-list { display: flex; flex-direction: column; gap: 0; border-top: 1px solid var(--line); }
.faq-item { border-bottom: 1px solid var(--line); }
.faq-q { width: 100%; text-align: left; background: none; border: none; cursor: pointer; font: inherit; font-size: 1.05rem; font-weight: 600; color: var(--text); letter-spacing: -0.015em; padding: 22px 44px 22px 0; position: relative; display: flex; align-items: center; gap: 12px; transition: color .2s; }
.faq-q:hover { color: var(--accent); }
.faq-icon { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); width: 22px; height: 22px; flex: none; }
.faq-icon::before, .faq-icon::after { content: ""; position: absolute; background: var(--accent); border-radius: 2px; left: 50%; top: 50%; transition: transform .3s var(--ease), opacity .3s; }
.faq-icon::before { width: 14px; height: 2px; transform: translate(-50%, -50%); }
.faq-icon::after { width: 2px; height: 14px; transform: translate(-50%, -50%); }
.faq-item.open .faq-icon::after { transform: translate(-50%, -50%) rotate(90deg); opacity: 0; }
.faq-a { overflow: hidden; height: 0; transition: height .32s var(--ease); }
.faq-a-inner { padding: 0 44px 24px 0; color: var(--text-3); font-size: .98rem; line-height: 1.62; max-width: 60ch; }

/* =========================================================
   FINAL CTA
   ========================================================= */
.final-cta { position: relative; overflow: hidden; text-align: center; padding: clamp(80px, 12vw, 148px) 0; }
.cta-bg { position: absolute; inset: 0; z-index: 0; pointer-events: none; }
.cta-glow { position: absolute; left: 50%; top: 50%; width: 760px; height: 500px; transform: translate(-50%,-50%); background: radial-gradient(closest-side, rgba(200,98,45,.36), transparent 70%); filter: blur(16px); }
.cta-rings { position: absolute; left: 50%; top: 50%; width: 1000px; height: 1000px; transform: translate(-50%,-50%); border-radius: 50%; background: repeating-radial-gradient(circle at center, transparent 0 60px, rgba(232,182,152,.06) 61px 62px); -webkit-mask-image: radial-gradient(closest-side, #000 22%, transparent 66%); mask-image: radial-gradient(closest-side, #000 22%, transparent 66%); }
.cta-inner { max-width: 660px; margin: 0 auto; }
.cta-inner .eyebrow { justify-content: center; }
.cta-title { font-size: clamp(2rem, 1.2rem + 3.2vw, 3.1rem); font-weight: 800; letter-spacing: -0.035em; line-height: 1.06; margin: 0 0 16px; background: linear-gradient(180deg, #fcf6ef, #e3cab7); -webkit-background-clip: text; background-clip: text; color: transparent; }
.cta-sub { color: var(--text-2); font-size: 1.1rem; margin: 0 0 30px; }
.cta-fine { color: var(--text-4); font-size: 13px; margin: 22px 0 0; }

/* =========================================================
   FOOTER
   ========================================================= */

/* =========================================================
   UTILITIES
   ========================================================= */
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0;
}

/* =========================================================
   HOW IT WORKS
   ========================================================= */
.steps {
  list-style: none; margin: 0; padding: 0;
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;
  position: relative;
}
/* connector rail behind the cards */
.steps::before {
  content: ""; position: absolute; left: 8%; right: 8%; top: 62px; height: 1px;
  background: linear-gradient(90deg, transparent, var(--accent-line) 12%, var(--accent-line) 88%, transparent);
  z-index: 0;
}
.step {
  position: relative; z-index: 1;
  background: linear-gradient(180deg, var(--surface) 0%, var(--bg-2) 100%);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 28px 24px 24px;
  transition: transform .3s var(--ease), border-color .3s, box-shadow .3s;
}
.step:hover { transform: translateY(-4px); border-color: var(--accent-line); box-shadow: var(--shadow); }
.step-n {
  display: inline-flex; align-items: center; justify-content: center;
  width: 46px; height: 46px; border-radius: 14px;
  font-size: 15px; font-weight: 800; letter-spacing: -0.02em;
  color: var(--accent);
  background: var(--accent-soft); border: 1px solid var(--accent-line);
  box-shadow: 0 0 0 6px rgba(224,127,74,.05), inset 0 1px 0 rgba(255,255,255,.07);
  margin-bottom: 18px;
}
.step h3 { font-size: 1.06rem; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 10px; line-height: 1.3; }
.step p { font-size: .93rem; color: var(--text-3); margin: 0 0 16px; line-height: 1.58; }
.step-tag {
  display: inline-block; font-size: 11.5px; font-weight: 600; letter-spacing: .09em; text-transform: uppercase;
  color: var(--text-3); background: rgba(255,255,255,.04);
  border: 1px solid var(--line); border-radius: 999px; padding: 5px 12px;
}

/* =========================================================
   INTEGRATIONS
   ========================================================= */
.int-card {
  display: grid; grid-template-columns: .85fr 1.15fr; gap: clamp(28px, 4vw, 56px); align-items: center;
  background: linear-gradient(180deg, var(--surface) 0%, var(--bg-2) 100%);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  padding: clamp(28px, 4vw, 46px);
}
.int-copy .section-title { margin-bottom: 14px; }
.int-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.int-list li {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  background: rgba(255,255,255,.03); border: 1px solid var(--line);
  border-radius: 14px; padding: 14px 14px 13px;
  transition: transform .25s var(--ease), border-color .25s, background .25s;
}
.int-list li:hover { transform: translateY(-3px); border-color: var(--accent-line); background: rgba(255,255,255,.055); }
.int-ico {
  width: 30px; height: 30px; border-radius: 9px; margin-bottom: 9px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 700; line-height: 1;
  color: var(--accent); background: var(--accent-soft); border: 1px solid var(--accent-line);
}
.int-list b { font-size: .87rem; font-weight: 600; color: var(--text); letter-spacing: -0.01em; }
.int-list em { font-style: normal; font-size: 11.5px; color: var(--text-3); }

/* =========================================================
   COMPARISON TABLE
   ========================================================= */
.cmp-wrap {
  border: 1px solid var(--line-2); border-radius: var(--radius-lg);
  background: linear-gradient(180deg, var(--surface-2), var(--bg-2));
  box-shadow: var(--shadow-lg);
  overflow-x: auto; -webkit-overflow-scrolling: touch;
}
.cmp-table { width: 100%; border-collapse: collapse; min-width: 720px; text-align: left; }
.cmp-table th, .cmp-table td { padding: 17px 22px; vertical-align: top; font-size: .93rem; }
.cmp-table thead th {
  font-size: 12px; font-weight: 600; letter-spacing: .13em; text-transform: uppercase;
  color: var(--text-3); padding-top: 24px; padding-bottom: 16px;
  border-bottom: 1px solid var(--line-2); white-space: nowrap;
}
.cmp-table tbody th {
  font-weight: 600; color: var(--text); letter-spacing: -0.015em; width: 26%;
}
.cmp-table tbody td { color: var(--text-3); line-height: 1.5; }
.cmp-table tbody tr + tr th, .cmp-table tbody tr + tr td { border-top: 1px solid var(--line); }
.cmp-table tbody tr:hover th, .cmp-table tbody tr:hover td { background: rgba(255,255,255,.018); }

/* highlighted Artweel column */
.cmp-table .cmp-us { background: rgba(224,127,74,.055); }
.cmp-table tbody td.cmp-us { color: var(--text-2); }
.cmp-table thead th.cmp-us { background: rgba(224,127,74,.09); border-bottom-color: var(--accent-line); }
.cmp-us-tag {
  display: inline-flex; align-items: center; gap: 7px;
  font-size: 12.5px; font-weight: 700; letter-spacing: .04em; text-transform: none; color: var(--accent);
}
.cmp-us-tag::before {
  content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--accent);
  box-shadow: 0 0 0 4px var(--accent-soft);
}
.cmp-x, .cmp-v {
  position: relative;
  display: inline-flex; align-items: center; justify-content: center; flex: none;
  width: 19px; height: 19px; border-radius: 6px; margin-right: 10px;
  vertical-align: -4px;
}
.cmp-x { background: rgba(209,88,74,.13); border: 1px solid rgba(209,88,74,.28); }
.cmp-x::before, .cmp-x::after { content: ""; position: absolute; width: 9px; height: 1.6px; border-radius: 2px; background: #dd9084; }
.cmp-x::before { transform: rotate(45deg); }
.cmp-x::after { transform: rotate(-45deg); }
.cmp-v { background: var(--accent-soft); border: 1px solid var(--accent-line); }
.cmp-v::before {
  content: ""; width: 9px; height: 5px;
  border-left: 1.8px solid var(--accent); border-bottom: 1.8px solid var(--accent);
  transform: rotate(-45deg) translate(1px, -1px); border-radius: 1px;
}

/* =========================================================
   TESTIMONIALS
   ========================================================= */
.tst-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.tst-card {
  position: relative; overflow: hidden;
  background: linear-gradient(180deg, var(--surface) 0%, var(--bg-2) 100%);
  border: 1px solid var(--line); border-radius: var(--radius);
  padding: 30px 26px 26px;
  display: flex; flex-direction: column; gap: 18px;
  transition: transform .3s var(--ease), border-color .3s, box-shadow .3s;
}
.tst-card:hover { transform: translateY(-4px); border-color: var(--accent-line); box-shadow: var(--shadow); }
.tst-quote {
  position: absolute; right: 14px; top: -16px;
  font-family: var(--serif); font-size: 6.4rem; line-height: 1; color: var(--accent); opacity: .13;
  pointer-events: none;
}
.tst-card blockquote { margin: 0; }
.tst-card blockquote p { margin: 0; font-size: 1rem; line-height: 1.6; color: var(--text-2); letter-spacing: -0.011em; }
.tst-by { display: flex; align-items: center; gap: 12px; margin-top: auto; padding-top: 4px; }
.tst-av {
  width: 40px; height: 40px; border-radius: 50%; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700; letter-spacing: .02em;
  color: var(--accent); background: var(--accent-soft); border: 1px solid var(--accent-line);
}
.tst-meta { display: flex; flex-direction: column; min-width: 0; }
.tst-meta b { font-size: .92rem; font-weight: 600; color: var(--text); }
.tst-meta em { font-style: normal; font-size: 12px; color: var(--text-3); }

/* =========================================================
   SCROLL PROGRESS
   ========================================================= */
.scroll-progress {
  position: fixed; left: 0; top: 0; width: 100%; height: 2px; z-index: 120; pointer-events: none;
  background: transparent;
}
.scroll-progress i {
  display: block; height: 100%; width: 0;
  background: linear-gradient(90deg, var(--accent-3), var(--accent) 60%, #f0a878);
  box-shadow: 0 0 12px -1px var(--accent-glow);
  transform-origin: left center;
}

/* =========================================================
   BILLING TOGGLE
   ========================================================= */
.bill-toggle {
  position: relative;
  display: inline-flex; align-items: center; gap: 4px;
  margin-top: 28px; padding: 5px;
  background: rgba(255,255,255,.04);
  border: 1px solid var(--line-2);
  border-radius: 999px;
  backdrop-filter: blur(6px);
}
.bill-thumb {
  position: absolute; top: 5px; left: 0; height: calc(100% - 10px); width: 0;
  border-radius: 999px;
  background: linear-gradient(180deg, #ec9560 0%, var(--accent-2) 100%);
  box-shadow: 0 8px 22px -10px var(--accent-glow), inset 0 1px 0 rgba(255,255,255,.3);
  transition: transform .34s var(--ease), width .34s var(--ease);
  pointer-events: none;
}
.bill-opt {
  position: relative; z-index: 1;
  display: inline-flex; align-items: center; gap: 8px;
  font: inherit; font-size: 14px; font-weight: 600;
  color: var(--text-2); background: none; border: 0; cursor: pointer;
  padding: 9px 18px; border-radius: 999px;
  transition: color .24s var(--ease);
  white-space: nowrap;
}
.bill-opt:hover { color: var(--text); }
.bill-opt.is-on { color: #22120a; }
.bill-save {
  font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
  color: var(--accent); background: var(--accent-soft);
  border: 1px solid var(--accent-line); border-radius: 999px; padding: 3px 8px;
  transition: color .24s, background .24s, border-color .24s;
}
.bill-opt.is-on .bill-save { color: #22120a; background: rgba(255,255,255,.42); border-color: transparent; }

/* price value swap */
.price-amount { margin: 0; }
#priceValue { display: inline-block; transition: opacity .18s var(--ease), transform .18s var(--ease); }
#priceValue.swap { opacity: 0; transform: translateY(-8px); }
.price-per { font-size: .26em; font-weight: 600; color: var(--text-3); letter-spacing: 0; }
.price-assure {
  list-style: none; margin: 22px 0 0; padding: 0;
  display: flex; flex-wrap: wrap; gap: 8px 10px;
}
.price-assure li {
  position: relative;
  font-size: 12px; color: var(--text-3);
  border: 1px solid var(--line); border-radius: 999px; padding: 5px 12px 5px 26px;
  background: rgba(255,255,255,.025);
}
.price-assure li::before {
  content: ""; position: absolute; left: 11px; top: 50%; width: 7px; height: 4px;
  border-left: 1.6px solid var(--accent); border-bottom: 1.6px solid var(--accent);
  transform: translateY(-70%) rotate(-45deg);
}

/* =========================================================
   FOOTER
   ========================================================= */
.site-footer { border-top: 1px solid var(--line); padding: clamp(46px, 6vw, 72px) 0 30px; position: relative; z-index: 1; }
.footer-top {
  display: grid; grid-template-columns: 1.5fr 1fr 1fr 1.15fr;
  gap: clamp(28px, 4vw, 56px);
  padding-bottom: 40px;
}
.footer-brand .brand { margin-bottom: 16px; }
.footer-blurb { color: var(--text-3); font-size: .9rem; line-height: 1.6; margin: 0 0 16px; max-width: 34ch; }
.footer-flag {
  display: inline-flex; align-items: center; gap: 9px;
  font-size: 12.5px; font-weight: 600; color: var(--text-2);
  background: rgba(255,255,255,.03); border: 1px solid var(--line);
  border-radius: 999px; padding: 7px 14px; margin: 0;
}
.footer-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); flex: none; }

.footer-col { display: flex; flex-direction: column; align-items: flex-start; gap: 11px; }
.footer-h {
  font-size: 11.5px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase;
  color: var(--text-4); margin: 0 0 5px;
}
.footer-col a { color: var(--text-3); font-size: .9rem; transition: color .18s, transform .18s var(--ease); }
.footer-col a:hover { color: var(--text); transform: translateX(2px); }
.footer-cta { color: var(--accent) !important; font-weight: 600; }

.footer-bottom {
  display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
  border-top: 1px solid var(--line); padding-top: 24px;
}
.footer-copy, .footer-built { margin: 0; color: var(--text-4); font-size: 13px; }

/* =========================================================
   BACK TO TOP  (bottom-left — booking nudge owns bottom-right)
   ========================================================= */
.to-top {
  position: fixed; left: 22px; bottom: 22px; z-index: 90;
  width: 44px; height: 44px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--text-2);
  background: rgba(24,19,18,.82);
  border: 1px solid var(--line-2);
  backdrop-filter: blur(10px);
  box-shadow: var(--shadow);
  cursor: pointer;
  opacity: 0; transform: translateY(10px) scale(.94);
  transition: opacity .3s var(--ease), transform .3s var(--ease), border-color .2s, color .2s;
}
.to-top.show { opacity: 1; transform: none; }
.to-top:hover { color: var(--accent); border-color: var(--accent-line); }

/* =========================================================
   TRUST LOGO MARQUEE
   ========================================================= */
.trust-track {
  position: relative; overflow: hidden;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
          mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
}
.trust-track .trust-logos {
  flex-wrap: nowrap; justify-content: flex-start; width: max-content;
  animation: trust-scroll 34s linear infinite;
}
.trust-track:hover .trust-logos { animation-play-state: paused; }
@keyframes trust-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }

/* =========================================================
   REVEAL STAGGER
   ========================================================= */
[data-stagger] > .reveal { transition-delay: calc(var(--i, 0) * 70ms); }

/* =========================================================
   SCROLL REVEAL
   ========================================================= */
.reveal { opacity: 0; transform: translateY(24px); transition: opacity .7s var(--ease), transform .7s var(--ease); }
.reveal.in { opacity: 1; transform: none; }

/* =========================================================
   RESPONSIVE
   ========================================================= */
@media (max-width: 1024px) {
  .feature-grid { grid-template-columns: repeat(2, 1fr); }
  .app-body { grid-template-columns: 168px 1fr; }
  .app-week { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 860px) {
  .nav-desktop { display: none; }
  .nav-toggle { display: inline-flex; }

  .split-grid { grid-template-columns: 1fr; }
  .split-reverse .split-copy { order: 1; }
  .split-reverse .split-visual { order: 2; }
  .split-visual { max-width: 520px; }

  .roadmap-inner { grid-template-columns: 1fr; }
  .price-card { grid-template-columns: 1fr; }
  .faq-wrap { grid-template-columns: 1fr; }
  .lede, .body-muted { max-width: none; }
  .stats { grid-template-columns: repeat(2, 1fr); gap: 30px 24px; }
  .stat:nth-child(3)::before { display: none; }
}

@media (max-width: 560px) {
  .container { padding: 0 18px; }
  .feature-grid { grid-template-columns: 1fr; gap: 14px; }
  .hero-cta { flex-direction: column; }
  .hero-cta .btn, .mobile-menu .btn { width: 100%; }
  .app-side { display: none; }
  .app-body { grid-template-columns: 1fr; }
  .app-week { grid-template-columns: 1fr 1fr; }
  .app-url { max-width: 180px; }
  .schedule-body { grid-template-columns: 1fr; }
  .schedule-col { flex-direction: row; flex-wrap: wrap; align-items: stretch; }
  .schedule-day { width: 100%; }
  .schedule-col .event { flex: 1; min-width: 130px; }
  .price-list { grid-template-columns: 1fr; }
  .stat + .stat::before { display: none; }
  .app-window { transform: none; }
}

@media (max-width: 420px) {
  .app-url { display: none; }
  .app-chrome { justify-content: space-between; }
}

@media (max-width: 380px) {
  .container { padding: 0 15px; }
  .brand-name { font-size: 17px; }
  .schedule-col { flex-direction: column; }
  .app-week { grid-template-columns: 1fr; }
  .stats { grid-template-columns: 1fr; gap: 22px; }
  .trust-logos { gap: 12px 22px; }
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }
  .reveal { opacity: 1; transform: none; }
  .aurora { animation: none; }
}

/* =========================================================
   RESPONSIVE — sections added in the enhancement pass
   ========================================================= */
@media (max-width: 1024px) {
  .int-list { grid-template-columns: repeat(3, 1fr); }
  .footer-top { grid-template-columns: 1.4fr 1fr 1fr; }
  .footer-brand { grid-column: 1 / -1; }
}

@media (max-width: 860px) {
  .steps { grid-template-columns: 1fr; gap: 14px; }
  .steps::before { display: none; }
  .int-card { grid-template-columns: 1fr; }
  .tst-grid { grid-template-columns: 1fr; }
  .footer-top { grid-template-columns: 1fr 1fr; gap: 32px; }
  .footer-brand { grid-column: 1 / -1; }
}

@media (max-width: 720px) {
  /* stack the comparison into cards — roles on the markup keep the table semantics */
  .cmp-wrap { overflow-x: visible; padding: 6px; }
  .cmp-table { min-width: 0; display: block; }
  .cmp-table thead { display: none; }
  .cmp-table tbody, .cmp-table tbody tr, .cmp-table tbody th, .cmp-table tbody td { display: block; }
  .cmp-table tbody tr { padding: 20px 16px; }
  .cmp-table tbody tr + tr { border-top: 1px solid var(--line); }
  .cmp-table tbody tr + tr th, .cmp-table tbody tr + tr td { border-top: 0; }
  .cmp-table tbody tr:hover th, .cmp-table tbody tr:hover td { background: none; }
  .cmp-table tbody th { width: auto; padding: 0 0 14px; font-size: 1rem; }
  .cmp-table tbody td {
    padding: 12px 14px; margin-top: 8px; font-size: .88rem;
    border: 1px solid var(--line); border-radius: 12px; background: rgba(255,255,255,.02);
  }
  .cmp-table tbody td.cmp-us { background: rgba(224,127,74,.07); border-color: var(--accent-line); }
  .cmp-table tbody td::before {
    content: attr(data-label);
    display: block; margin-bottom: 8px;
    font-size: 10.5px; font-weight: 600; letter-spacing: .13em; text-transform: uppercase;
    color: var(--text-4);
  }
  .cmp-table tbody td.cmp-us::before { color: var(--accent); }
}

@media (max-width: 560px) {
  .int-list { grid-template-columns: repeat(2, 1fr); }
  .bill-toggle { width: 100%; justify-content: center; }
  .bill-opt { flex: 1; justify-content: center; padding: 10px 12px; }
  .price-assure { gap: 7px; }
  .footer-top { grid-template-columns: 1fr; gap: 28px; }
  .footer-bottom { flex-direction: column; align-items: flex-start; gap: 8px; }
  .to-top { left: 16px; bottom: 16px; width: 40px; height: 40px; }
  .step { padding: 24px 20px 22px; }
}

@media (max-width: 380px) {
  .int-list { grid-template-columns: 1fr; }
  .bill-save { display: none; }
}

/* Reduced motion — additions */
@media (prefers-reduced-motion: reduce) {
  .trust-track .trust-logos { animation: none; width: auto; flex-wrap: wrap; justify-content: center; }
  .trust-track { -webkit-mask-image: none; mask-image: none; }
  .to-top { transition: opacity .001ms; }
  [data-stagger] > .reveal { transition-delay: 0ms !important; }
}
`;
