/**
 * The landing page's stylesheet: "premium light", the 2026-11-20 redesign.
 *
 * Ported from scratch/landing-prototype (v2). Light warm paper, near-black ink,
 * one orange accent, Geist with Instrument Serif italic for a single accent
 * word, and two dark panels (the comparison and the closing call to action)
 * for rhythm. See LANDING-REDESIGN-PLAN.md §5.
 *
 * Kept as a TypeScript string rather than a file on disk for one reason: the
 * production image copies `dist`, and a stray .css under src/ would only reach it
 * by way of a COPY line that exists for an unrelated reason (seeding). A
 * string compiles like everything else and cannot go missing.
 *
 * Design only. Every word on the page comes from content.ts / verticals.ts.
 */
export const LANDING_CSS = `
:root{
  --paper:#faf9f6;--ink:#0e0f12;--ink-2:#2a2c33;--body:#5d6170;--muted:#7d818c;
  --line:rgba(14,15,18,.08);--line-2:rgba(14,15,18,.14);
  --accent:#ef5a24;--accent-2:#ff8a4c;--accent-soft:#fff1ea;--accent-ink:#b23d0d;
  --green:#12804f;--green-soft:#e6f6ee;--blue:#2e6be6;--blue-soft:#ebf1fe;--violet:#6d4fd8;--violet-soft:#f1edfd;--red:#c93535;
  --night:#0d0e11;--night-2:#16181d;--night-line:rgba(255,255,255,.09);--night-body:#a7abb5;
  --sans:Geist,Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--mono:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace;--serif:"Instrument Serif",Georgia,serif;
  --ease:cubic-bezier(.2,.7,.2,1);--wrap:1200px;
  /* Primary button colour (option A, brand orange, chosen 2026-11-20). To try
     another, change only these: background gradient, its shadow tint, the
     arrow disc and the arrow. */
  --btn-bg:linear-gradient(180deg,#ff7a45,#ef5a24 58%,#e04c16);
  --btn-tint:239,90,36;--btn-edge:120,30,0;
  --btn-disc:#fff;--btn-arrow:#ef5a24;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:96px}
body{margin:0;background:var(--paper);color:var(--ink);font:400 16px/1.6 var(--sans);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;overflow-x:hidden}
a{color:inherit;text-decoration:none}
p{margin:0}
h1,h2,h3,h4{margin:0;font-weight:600;letter-spacing:-.035em;line-height:1.04}
ul,ol{margin:0;padding:0;list-style:none}
button{font:inherit}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:6px}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.skip-link{position:absolute;left:16px;top:-60px;z-index:200;background:var(--ink);color:#fff;padding:10px 16px;border-radius:10px;transition:top .2s}
.skip-link:focus{top:12px}
.container{max-width:var(--wrap);margin:0 auto;padding:0 28px}
.serif{font-family:var(--serif);font-style:italic;font-weight:400;letter-spacing:-.01em}
.label{font:500 12px/1 var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--muted);display:inline-flex;align-items:center;gap:10px}
.label::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--accent)}
.h2{font-size:clamp(34px,4.6vw,60px)}
.h2 em{font-family:var(--serif);font-style:italic;font-weight:400;letter-spacing:-.01em}
.h2 .dim{color:var(--muted)}
.sub{font-size:clamp(17px,1.5vw,19px);color:var(--body);line-height:1.55}

/* buttons
   One system for every button on the page:
     .btn-ink    primary. Brand-orange pill (--btn-*), lit top edge, a sheen that sweeps across on
                 hover, and an orange arrow disc that slides out and swaps for
                 a fresh arrow coming in.
     .btn-accent the one orange button (featured plan). Same behaviour.
     .btn-line   secondary. Frosted glass with a hairline that turns into a
                 gradient ring on hover; its arrow fades in from the left.
     .glow       a slow conic ring around a primary, for the two main CTAs.
   Press sinks 1px and tightens the shadow. Hover lift and magnetism are
   disabled for reduced motion and on touch (no hover there anyway). */
@property --a{syntax:"<angle>";initial-value:0deg;inherits:false}
@keyframes spin{to{--a:360deg}}
@keyframes sheen{from{transform:translateX(-120%) skewX(-20deg)}to{transform:translateX(220%) skewX(-20deg)}}
.btn{--mx:0px;--my:0px;position:relative;display:inline-flex;align-items:center;justify-content:center;gap:10px;height:50px;padding:0 24px;border-radius:999px;font:500 15px var(--sans);letter-spacing:-.01em;border:0;cursor:pointer;white-space:nowrap;isolation:isolate;overflow:hidden;-webkit-tap-highlight-color:transparent;transform:translate(var(--mx),var(--my));transition:transform .35s var(--ease),box-shadow .3s var(--ease),background .25s,color .25s}
.btn>.lbl{position:relative;z-index:2;display:inline-flex;align-items:center;gap:10px}
.btn:focus-visible{outline:none;box-shadow:0 0 0 3px var(--paper),0 0 0 5px var(--accent)}
.btn-ink,.btn-accent{color:#fff}
.btn-ink{background:var(--btn-bg);box-shadow:inset 0 1px 0 rgba(255,255,255,.3),inset 0 -1px 0 rgba(var(--btn-edge),.35),0 1px 2px rgba(var(--btn-tint),.35),0 12px 28px -12px rgba(var(--btn-tint),.75)}
.btn-accent{background:linear-gradient(180deg,#ff7a45,var(--accent) 60%,#e04c16);box-shadow:inset 0 1px 0 rgba(255,255,255,.3),inset 0 -1px 0 rgba(120,30,0,.35),0 1px 2px rgba(178,61,13,.35),0 12px 28px -12px rgba(239,90,36,.75)}
.btn-ink::after,.btn-accent::after{content:"";position:absolute;z-index:1;top:0;bottom:0;left:0;width:45%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.22),transparent);transform:translateX(-120%) skewX(-20deg);pointer-events:none}
.btn-ink:hover,.btn-accent:hover{transform:translate(var(--mx),calc(var(--my) - 2px))}
.btn-ink:hover{box-shadow:inset 0 1px 0 rgba(255,255,255,.32),inset 0 -1px 0 rgba(var(--btn-edge),.35),0 2px 4px rgba(var(--btn-tint),.3),0 20px 38px -14px rgba(var(--btn-tint),.8)}
.btn-accent:hover{box-shadow:inset 0 1px 0 rgba(255,255,255,.32),inset 0 -1px 0 rgba(120,30,0,.35),0 2px 4px rgba(178,61,13,.3),0 20px 38px -14px rgba(239,90,36,.8)}
.btn-ink:hover::after,.btn-accent:hover::after{animation:sheen .9s var(--ease)}
.btn-ink:active,.btn-accent:active{transform:translate(var(--mx),calc(var(--my) + 1px)) scale(.985);box-shadow:inset 0 1px 0 rgba(255,255,255,.12),inset 0 2px 6px rgba(var(--btn-edge),.35),0 4px 12px -6px rgba(var(--btn-tint),.6);transition-duration:.08s}

/* the arrow disc: current arrow slides out right, a new one slides in from the left */
.arr{position:relative;z-index:2;display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--accent);margin-right:-14px;overflow:hidden;flex:none;box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 2px 6px -2px rgba(239,90,36,.7);transition:transform .35s var(--ease),background .25s}
.arr svg{grid-area:1/1;width:12px;height:12px;stroke:#fff;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;transition:transform .4s var(--ease)}
.arr svg+svg{transform:translateX(-22px)}
.btn:hover .arr{transform:scale(1.08)}
.btn:hover .arr svg:first-child{transform:translateX(22px)}
.btn:hover .arr svg+svg{transform:none}
.btn-ink .arr,.btn-accent .arr{background:var(--btn-disc);box-shadow:0 2px 6px -2px rgba(var(--btn-edge),.4)}
.btn-ink .arr svg,.btn-accent .arr svg{stroke:var(--btn-arrow)}

/* secondary */
.btn-line{color:var(--ink);background:rgba(255,255,255,.72);-webkit-backdrop-filter:blur(10px) saturate(160%);backdrop-filter:blur(10px) saturate(160%);box-shadow:inset 0 0 0 1px var(--line-2),0 1px 2px rgba(14,15,18,.05)}
.btn-line::before{content:"";position:absolute;inset:0;border-radius:inherit;padding:1px;background:conic-gradient(from 200deg,var(--accent),#ffb27f,var(--ink-2),var(--accent));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0);opacity:0;transition:opacity .3s;pointer-events:none}
.btn-line:hover{background:#fff;transform:translate(var(--mx),calc(var(--my) - 1px));box-shadow:inset 0 0 0 1px transparent,0 10px 24px -14px rgba(14,15,18,.35)}
.btn-line:hover::before{opacity:1}
.btn-line:active{transform:translate(var(--mx),var(--my)) scale(.985);transition-duration:.08s}
.btn-line .go{position:relative;z-index:2;width:0;opacity:0;margin-left:-10px;transform:translateX(-6px);transition:width .3s var(--ease),opacity .25s,transform .3s var(--ease),margin .3s var(--ease);display:inline-flex}
.btn-line .go svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.btn-line:hover .go{width:14px;opacity:1;margin-left:0;transform:none}

.btn-sm{height:40px;padding:0 18px;font-size:14px}
.btn-sm .arr{width:24px;height:24px;margin-right:-11px}
.btn-lg{height:56px;padding:0 28px;font-size:16px}
.btn-lg .arr{width:32px;height:32px;margin-right:-16px}
.btn-block{display:flex;width:100%}

/* the conic ring for the two headline CTAs */
.glow{overflow:visible}
.glow::before{content:"";position:absolute;inset:-2px;border-radius:inherit;z-index:-2;background:conic-gradient(from var(--a,0deg),#ffd2b8,#fff,var(--accent-2),rgba(var(--btn-edge),.5),#ffd2b8);animation:spin 4s linear infinite}
.glow>.bg{position:absolute;inset:0;border-radius:inherit;z-index:-1;background:inherit;box-shadow:inherit;overflow:hidden}
.glow>.bg::after{content:"";position:absolute;top:0;bottom:0;left:0;width:45%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.22),transparent);transform:translateX(-120%) skewX(-20deg)}
.glow:hover>.bg::after{animation:sheen .9s var(--ease)}
.glow::after{display:none}
.glow-halo{position:absolute;inset:-14px;border-radius:inherit;z-index:-3;background:radial-gradient(closest-side,rgba(239,90,36,.35),transparent);opacity:0;filter:blur(8px);transition:opacity .35s;pointer-events:none}
.glow:hover .glow-halo{opacity:1}

/* segmented controls (trade switcher, calculator rates) */
.seg-ctl{position:relative;isolation:isolate}
.seg-ctl .seg-ind{position:absolute;z-index:-1;top:4px;bottom:4px;left:0;width:0;border-radius:999px;background:var(--btn-bg);box-shadow:inset 0 1px 0 rgba(255,255,255,.28),0 6px 14px -8px rgba(var(--btn-tint),.7);transition:left .4s var(--ease),width .4s var(--ease),opacity .2s;opacity:0}
.seg-ctl.ready .seg-ind{opacity:1}
.seg-ctl.ready button[aria-pressed=true]{background:transparent!important;box-shadow:none!important}
.rates.seg-ctl .seg-ind{top:0;bottom:0;border-radius:12px}
.seg-ctl button{position:relative;z-index:1}
.seg-ctl button:active{transform:scale(.97)}
.rates button:hover:not([aria-pressed=true]),.switch button:hover:not([aria-pressed=true]){color:var(--ink);background:rgba(14,15,18,.05)}

@media (hover:none){
  .btn-line .go{display:none}
}

/* header
   A floating glass pill. It tightens once you scroll, slides away while you
   read down and comes back the moment you scroll up, and turns to dark glass
   over the two dark panels. Product and Who it is for open mega-menus (hover
   with intent on a mouse, click or keyboard anywhere). A hairline along the
   bottom of the bar shows reading progress. */
.site-header{position:sticky;top:0;z-index:50;padding:14px 0;transition:transform .45s var(--ease),padding .35s var(--ease)}
.site-header.hide{transform:translateY(-120%)}
.site-header.menu-open{transform:none}
.header-bar{position:relative;display:flex;align-items:center;gap:20px;height:60px;max-width:var(--wrap);margin:0 auto;padding:0 10px 0 18px;border-radius:999px;transition:background .35s,box-shadow .35s,height .35s var(--ease),max-width .45s var(--ease),color .35s}
.site-header.stuck{padding:10px 0}
.site-header.stuck .header-bar{height:54px;max-width:1080px;background:rgba(255,255,255,.78);-webkit-backdrop-filter:saturate(180%) blur(18px);backdrop-filter:saturate(180%) blur(18px);box-shadow:0 0 0 1px var(--line),0 1px 0 rgba(255,255,255,.8) inset,0 14px 36px -18px rgba(14,15,18,.28)}
.site-header.stuck.dark-under .header-bar{background:rgba(22,24,29,.72);box-shadow:0 0 0 1px rgba(255,255,255,.1),0 1px 0 rgba(255,255,255,.06) inset,0 14px 36px -18px rgba(0,0,0,.6);color:#fff}
.dark-under .brand{color:#fff}
.dark-under .nav-desktop>a,.dark-under .nav-trig,.dark-under .nav-signin{color:rgba(255,255,255,.72)}
.dark-under .nav-ind{background:rgba(255,255,255,.1)}
.progress{position:absolute;left:24px;right:24px;bottom:0;height:2px;border-radius:2px;overflow:hidden;opacity:0;transition:opacity .3s;pointer-events:none}
.stuck .progress{opacity:1}
.progress i{display:block;height:100%;width:100%;transform-origin:0 50%;transform:scaleX(var(--p,0));background:linear-gradient(90deg,var(--accent),var(--accent-2))}
.brand{display:flex;align-items:center;gap:10px;font-weight:600;font-size:17px;letter-spacing:-.03em;color:var(--ink);flex:none;transition:color .3s}
.brand-mark{width:30px;height:30px;border-radius:10px;background:conic-gradient(from 210deg,var(--accent),var(--accent-2),var(--accent));display:grid;place-items:center;color:#fff;box-shadow:inset 0 0 0 1px rgba(255,255,255,.25),0 4px 10px -4px rgba(239,90,36,.6);flex:none;transition:transform .6s var(--ease)}
.brand:hover .brand-mark{transform:rotate(-90deg) scale(1.05)}
.nav-desktop{position:relative;display:flex;align-items:center;gap:2px;margin:0 auto;isolation:isolate}
.nav-desktop>a,.nav-trig{position:relative;display:inline-flex;align-items:center;gap:6px;height:38px;padding:0 14px;font:500 14.5px var(--sans);color:var(--body);border:0;background:transparent;border-radius:999px;cursor:pointer;transition:color .2s}
.nav-desktop>a:hover,.nav-desktop>a.on,.nav-trig:hover,.nav-trig[aria-expanded=true]{color:var(--ink)}
.dark-under .nav-desktop>a:hover,.dark-under .nav-desktop>a.on,.dark-under .nav-trig:hover,.dark-under .nav-trig[aria-expanded=true]{color:#fff}
.nav-trig svg{width:10px;height:10px;stroke:currentColor;fill:none;stroke-width:2;transition:transform .3s var(--ease)}
.nav-trig[aria-expanded=true] svg{transform:rotate(180deg)}
.nav-ind{position:absolute;top:50%;height:38px;margin-top:-19px;border-radius:999px;background:rgba(14,15,18,.06);transition:left .35s var(--ease),width .35s var(--ease),opacity .25s;opacity:0;z-index:-1}
.header-actions{display:flex;align-items:center;gap:4px;flex:none}
.nav-signin{font-size:14.5px;font-weight:500;color:var(--body);padding:8px 14px;border-radius:999px;transition:color .2s,background .2s}
.nav-signin:hover{color:var(--ink);background:rgba(14,15,18,.05)}
.dark-under .nav-signin:hover{color:#fff;background:rgba(255,255,255,.08)}

/* mega-menus */
.nav-item{position:static}
.nav-desktop{position:static}
.mega{position:absolute;left:50%;top:calc(100% + 12px);z-index:60;width:min(700px,calc(100vw - 48px));padding:10px;border-radius:24px;background:rgba(255,255,255,.97);-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);box-shadow:0 0 0 1px var(--line),0 30px 70px -24px rgba(14,15,18,.35),0 8px 20px -12px rgba(14,15,18,.15);color:var(--ink);text-align:left;opacity:0;visibility:hidden;transform:translate(-50%,8px) scale(.98);transform-origin:50% 0;transition:opacity .22s var(--ease),transform .3s var(--ease),visibility 0s .3s}
.mega::before{content:"";position:absolute;left:0;right:0;top:-30px;height:30px}
.nav-item.open .mega{opacity:1;visibility:visible;transform:translate(-50%,0) scale(1);transition:opacity .22s var(--ease),transform .3s var(--ease),visibility 0s}
.mega-grid{display:grid;grid-template-columns:1fr 1fr 210px;gap:2px}
.mega a.mi{display:flex;gap:12px;align-items:flex-start;padding:12px;border-radius:14px;transition:background .2s}
.mega a.mi:hover,.mega a.mi:focus-visible{background:var(--paper)}
.mi-ic{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;flex:none;background:var(--accent-soft);color:var(--accent-ink);transition:transform .3s var(--ease)}
.mi-ic svg{width:17px;height:17px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.mega a.mi:hover .mi-ic{transform:scale(1.08) rotate(-4deg)}
.mi b{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;letter-spacing:-.015em}
.mi small{display:block;font-size:12.5px;color:var(--body);line-height:1.4;margin-top:2px}
.mi .n{font:600 12px var(--mono);width:34px;height:34px;border-radius:10px;display:grid;place-items:center;flex:none;background:var(--paper);box-shadow:inset 0 0 0 1px var(--line);transition:background .2s,color .2s}
.mega a.mi:hover .n{background:var(--ink);color:#fff;box-shadow:none}
.mi.cur .n{background:var(--accent);color:#fff;box-shadow:none}
.mi .tag-new{font:500 9.5px var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--green);background:var(--green-soft);padding:2px 6px;border-radius:999px}
.mega-feature{grid-column:3;grid-row:1/span 3;display:flex;flex-direction:column;justify-content:flex-end;gap:6px;padding:18px;border-radius:18px;background:var(--night);color:#fff;position:relative;overflow:hidden;isolation:isolate;min-height:220px;transition:transform .3s var(--ease)}
.mega-trades .mega-feature{grid-row:1/span 5}
.mega-feature::before{content:"";position:absolute;right:-40%;top:-40%;width:120%;height:120%;z-index:-1;background:radial-gradient(closest-side,rgba(239,90,36,.5),transparent)}
.mega-feature:hover{transform:translateY(-2px)}
.mega-feature .k{font:500 10.5px var(--mono);text-transform:uppercase;letter-spacing:.08em;color:#8a8e99}
.mega-feature b{font-size:17px;letter-spacing:-.02em;line-height:1.2}
.mega-feature .fs{font-size:12.5px;color:var(--night-body)}
.mega-foot{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:6px;padding:12px 14px 6px;border-top:1px solid var(--line);font-size:13px;color:var(--body)}
.mega-foot a{font-weight:500;color:var(--ink)}
.mega-foot a:hover{color:var(--accent-ink)}

/* burger */
.nav-toggle{display:none;margin-left:auto;width:44px;height:44px;border-radius:50%;border:0;background:var(--ink);align-items:center;justify-content:center;cursor:pointer;transition:background .3s}
.nav-toggle i,.nav-toggle i::before,.nav-toggle i::after{display:block;width:16px;height:1.6px;border-radius:2px;background:#fff;transition:transform .35s var(--ease),background .2s}
.nav-toggle i{position:relative}
.nav-toggle i::before,.nav-toggle i::after{content:"";position:absolute;left:0}
.nav-toggle i::before{transform:translateY(-5px)}
.nav-toggle i::after{transform:translateY(5px)}
.nav-toggle[aria-expanded=true] i{background:transparent}
.nav-toggle[aria-expanded=true] i::before{transform:rotate(45deg)}
.nav-toggle[aria-expanded=true] i::after{transform:rotate(-45deg)}

/* mobile sheet */
.mobile-menu{position:fixed;left:10px;right:10px;top:80px;bottom:10px;z-index:49;overflow:auto;overscroll-behavior:contain;padding:8px 22px 22px;border-radius:28px;background:rgba(255,255,255,.98);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);box-shadow:0 0 0 1px var(--line),0 30px 70px -20px rgba(14,15,18,.4);display:flex;flex-direction:column}
.mobile-menu[hidden]{display:none}
.mm-links a{display:flex;justify-content:space-between;align-items:center;padding:16px 0;font-size:22px;font-weight:600;letter-spacing:-.03em;border-bottom:1px solid var(--line)}
.mm-links a::after{content:"\\2192";font-size:16px;color:var(--muted)}
.mm-h{margin:24px 0 10px;font:500 11px var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.mm-trades{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.mm-trades a{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:14px;background:var(--paper);box-shadow:inset 0 0 0 1px var(--line);font-size:14px;font-weight:500}
.mm-trades a span{font:600 12px var(--mono);color:var(--accent-ink)}
.mm-actions{margin-top:auto;padding-top:22px;display:grid;gap:10px}
.mm-actions .btn{display:flex;width:100%}
.js .mm-links a,.js .mm-trades a{opacity:0;transform:translateY(10px);transition:opacity .4s var(--ease),transform .4s var(--ease)}
.js .mobile-menu.shown .mm-links a,.js .mobile-menu.shown .mm-trades a{opacity:1;transform:none}

/* hero */
.hero{position:relative;padding:56px 0 0;text-align:center;isolation:isolate}
.hero::before{content:"";position:absolute;inset:-140px 0 auto;height:900px;z-index:-1;background:radial-gradient(600px 340px at 50% 70%,rgba(239,90,36,.16),transparent 70%),radial-gradient(420px 260px at 20% 30%,rgba(255,138,76,.10),transparent 70%),radial-gradient(420px 260px at 82% 26%,rgba(46,107,230,.07),transparent 70%)}
.hero::after{content:"";position:absolute;inset:0 0 auto;height:760px;z-index:-1;opacity:.5;background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:64px 64px;-webkit-mask-image:radial-gradient(ellipse 70% 60% at 50% 30%,#000 30%,transparent 75%);mask-image:radial-gradient(ellipse 70% 60% at 50% 30%,#000 30%,transparent 75%)}
.spot{position:absolute;z-index:-1;width:520px;height:520px;border-radius:50%;left:0;top:0;pointer-events:none;background:radial-gradient(closest-side,rgba(239,90,36,.14),transparent);transform:translate(-50%,-50%);opacity:0;transition:opacity .6s}
.hero:hover .spot{opacity:1}
/* headline
   Each word sits in its own mask and rises out of it with a slight tilt,
   one after another. The words are filled with a soft ink gradient rather
   than flat black. The last word is the serif accent: an orange gradient
   with a slow shimmer, a warm glow and the drawn underline. The masks open
   up once the words have landed, so italics and the underline are never
   clipped. Without JavaScript it is plain ink text. */
.hero h1{font-size:clamp(44px,7vw,96px);letter-spacing:-.055em;line-height:.98;max-width:1040px;margin:0 auto;text-wrap:balance}
.hero h1 .wm{display:inline-block;overflow:hidden;padding:0 .07em .16em;margin:0 -.07em -.16em;vertical-align:bottom}
.hero h1.settled .wm{overflow:visible}
.hero h1 .w{display:inline-block;transform:translateY(108%) rotate(5deg);transform-origin:0 100%;transition:transform 1.05s cubic-bezier(.16,1,.3,1);background:linear-gradient(180deg,#0e0f12 30%,#4a4e5a 125%);-webkit-background-clip:text;background-clip:text;color:transparent}
.hero h1.go .w{transform:none}
.hero h1 .w.serif{font-size:1.08em;letter-spacing:-.02em;background:linear-gradient(100deg,#b23d0d 0%,#ef5a24 28%,#ffa064 46%,#ef5a24 64%,#b23d0d 100%);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:shimmer 7s linear infinite;filter:drop-shadow(0 10px 26px rgba(239,90,36,.28))}
.hero h1:hover .w.serif{animation-duration:2.6s}
@keyframes shimmer{from{background-position:0% 50%}to{background-position:200% 50%}}
.hero-sub{max-width:660px;margin:26px auto 34px;font-size:clamp(17px,1.55vw,20px);line-height:1.6;color:var(--body);text-wrap:pretty}
/* subtitle: the owned nouns in ink with a highlighter stroke that sweeps in,
   one after another; the closing promise on its own line with an orange
   underline drawn last. Fully drawn when JavaScript is off. */
.hero-sub .own{font-style:normal;font-weight:500;color:var(--ink);padding:0 .1em;margin:0 -.04em;border-radius:3px;background:linear-gradient(transparent 58%,rgba(255,160,100,.42) 58%,rgba(255,160,100,.42) 94%,transparent 94%) no-repeat 0 0/0% 100%;transition:background-size .75s var(--ease)}
.hero-sub.in .own{background-size:100% 100%}
.hero-sub .own:nth-of-type(1){transition-delay:.7s}.hero-sub .own:nth-of-type(2){transition-delay:.85s}.hero-sub .own:nth-of-type(3){transition-delay:1s}.hero-sub .own:nth-of-type(4){transition-delay:1.15s}.hero-sub .own:nth-of-type(5){transition-delay:1.3s}
.kicker{display:block;margin-top:12px}
.kicker-mark{position:relative;display:inline-flex;align-items:center;gap:8px;font-weight:600;color:var(--ink);letter-spacing:-.01em;padding-bottom:3px;background:linear-gradient(90deg,var(--accent),var(--accent-2)) no-repeat 0 100%/0% 2px;transition:background-size .9s var(--ease) 1.5s}
.kicker-mark::before{content:"";width:18px;height:18px;border-radius:50%;flex:none;background:var(--green-soft) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2312804f' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12l5 5L19 7'/%3E%3C/svg%3E") center/11px no-repeat}
.hero-sub.in .kicker-mark{background-size:100% 2px}
html:not(.js) .hero-sub .own{background-size:100% 100%}
html:not(.js) .kicker-mark{background-size:100% 2px}
.ctas{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.hero-note{margin-top:18px;font:500 12px var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.switch{display:inline-flex;gap:4px;padding:4px;margin-top:30px;border-radius:999px;background:rgba(255,255,255,.75);box-shadow:inset 0 0 0 1px var(--line);max-width:100%;overflow-x:auto;scrollbar-width:none}
.switch button{flex:none;border:0;background:transparent;font:500 13.5px var(--sans);color:var(--body);padding:8px 14px;border-radius:999px;cursor:pointer;transition:background .2s,color .2s}
.switch button[aria-pressed=true]{background:var(--accent);color:#fff}

/* hero, enhanced
   Drifting warm orbs behind everything; a badge that reads as a link; a
   hand-drawn underline under the accent word, drawn in after the headline
   lands; a proof row in place of the mono note; a labelled trade switcher;
   a window bar with a padlock and a pulsing Live pill; a gentle 3D tilt that
   follows the mouse; and a soft cross-fade whenever the schedule swaps. */
.orbs{position:absolute;inset:-120px 0 auto;height:1000px;z-index:-1;overflow:hidden;pointer-events:none}
.orbs i{position:absolute;border-radius:50%;filter:blur(60px);opacity:.55;animation:drift 18s ease-in-out infinite alternate}
.orbs i:nth-child(1){width:420px;height:420px;left:8%;top:120px;background:#ffd2b8}
.orbs i:nth-child(2){width:360px;height:360px;right:6%;top:60px;background:#dfe8ff;animation-duration:22s;animation-delay:-6s}
.orbs i:nth-child(3){width:520px;height:340px;left:32%;top:520px;background:#ffc3a0;opacity:.45;animation-duration:26s;animation-delay:-12s}
@keyframes drift{0%{transform:translate(0,0) scale(1)}50%{transform:translate(40px,-30px) scale(1.08)}100%{transform:translate(-30px,24px) scale(.96)}}


.hero h1 .serif{position:relative;padding:0 .04em}
.uline{position:absolute;left:-.04em;bottom:-.12em;width:calc(100% + .1em);height:.32em;overflow:visible;pointer-events:none}
.uline path{fill:none;stroke:var(--accent);stroke-width:5;stroke-linecap:round;stroke-dasharray:240;stroke-dashoffset:240;opacity:.85;transition:stroke-dashoffset 1.1s var(--ease) .75s}
.hero h1.go .uline path{stroke-dashoffset:0}

/* proof capsule: four facts in one frosted strip, split by hairlines. Each
   has its own tinted icon tile; they pop in one after another once the
   buttons land, and each lifts on hover with its icon giving a small turn. */
.proof{display:inline-flex;align-items:stretch;margin:26px auto 0;padding:6px;border-radius:20px;background:rgba(255,255,255,.66);-webkit-backdrop-filter:blur(12px) saturate(160%);backdrop-filter:blur(12px) saturate(160%);box-shadow:0 0 0 1px var(--line),0 1px 0 rgba(255,255,255,.9) inset,0 18px 40px -26px rgba(14,15,18,.35);text-align:left}
.hero-inner>.proof{display:inline-flex}
.pf{position:relative;display:flex;align-items:center;gap:10px;padding:8px 16px 8px 8px;border-radius:14px;transition:background .25s,translate .3s var(--ease)}
.pf+.pf::before{content:"";position:absolute;left:-1px;top:22%;bottom:22%;width:1px;background:var(--line-2)}
.pf:hover{background:#fff;translate:0 -1px}
.pf:hover+.pf::before,.pf:hover::before{opacity:0}
.pt{display:flex;flex-direction:column;line-height:1.2}
.pt small{font:500 10px var(--mono);text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:3px}
.pt b{font-size:13.5px;font-weight:600;letter-spacing:-.015em;color:var(--ink);white-space:nowrap}
.js .proof .pf{opacity:0;transform:translateY(8px) scale(.97);transition:opacity .5s var(--ease),transform .5s var(--ease),background .25s,translate .3s var(--ease)}
.js .proof.in .pf{opacity:1;transform:none}
.js .proof.in .pf:nth-child(2){transition-delay:.08s,.08s,0s,0s}.js .proof.in .pf:nth-child(3){transition-delay:.16s,.16s,0s,0s}.js .proof.in .pf:nth-child(4){transition-delay:.24s,.24s,0s,0s}
.pi{display:grid;place-items:center;width:34px;height:34px;border-radius:11px;flex:none;transition:transform .4s var(--ease)}
.pf:hover .pi{transform:rotate(-8deg) scale(1.06)}
.pf-who .pi{background:var(--accent-soft);color:var(--accent-ink)}
.pf-trial .pi{background:var(--green-soft);color:var(--green)}
.pf-stripe .pi{background:var(--violet-soft);color:var(--violet)}
.pf-time .pi{background:var(--blue-soft);color:var(--blue)}
.pi svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}

.switch-row{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:34px;max-width:100%}
.switch-row .switch{margin-top:0}
.switch-lbl{font:500 11.5px var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--muted);flex:none}

.win-url{display:inline-flex;align-items:center;gap:6px}
.win-url .lock{width:8px;height:7px;border-radius:2px;background:var(--muted);position:relative;margin-top:3px}
.win-url .lock::before{content:"";position:absolute;left:1px;top:-4px;width:6px;height:6px;border:1.5px solid var(--muted);border-bottom:0;border-radius:4px 4px 0 0;box-sizing:border-box}
.win-bar{position:relative}
.live{position:absolute;right:16px;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;gap:6px;font:500 11px var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--green)}
.live i{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 0 0 rgba(18,128,79,.5);animation:pulse 2s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(18,128,79,.45)}70%{box-shadow:0 0 0 7px rgba(18,128,79,0)}100%{box-shadow:0 0 0 0 rgba(18,128,79,0)}}

.stage{--rx:0deg;--ry:0deg}
.stage.flat .win{transform:rotateX(var(--rx)) rotateY(var(--ry))}
.stage.flat .win{transition:transform .6s var(--ease)}
.stage .float{transition:translate .6s var(--ease)}
.stage.tilting .float.phone{translate:calc(var(--px,0px) * -1) calc(var(--py,0px) * -1)}
.stage.tilting .float.toasts{translate:var(--px,0px) var(--py,0px)}
.win::after{content:"";position:absolute;inset:0;pointer-events:none;border-radius:inherit;background:radial-gradient(600px circle at var(--gx,50%) var(--gy,0%),rgba(255,255,255,.35),transparent 50%);opacity:0;transition:opacity .4s}
.stage.tilting .win::after{opacity:1}
.wk,.gauge-n,.cells,.app-who b{transition:opacity .28s var(--ease),transform .28s var(--ease),filter .28s}
.swapping .wk,.swapping .gauge-n,.swapping .cells,.swapping .app-who b{opacity:0;transform:translateY(6px);filter:blur(3px)}
.ev{transition:box-shadow .3s,transform .3s var(--ease)}
.ev:hover{transform:translateY(-1px)}
.mq:hover .mq-track{animation-play-state:paused}

/* announcement badge
   A white pill inside a slowly turning orange ring. An orange "New" chip
   with a sparkle and a light sweep, a hairline divider, then the feature
   name, which the script turns into a rotator (Waitlists, Class packs,
   Make-up credits, Piece tracking) sliding up one at a time, with the width
   easing between names. "are live" and the arrow stay put. Hover lifts it
   and glows the ring. Without JS it shows the full sentence. */
.badge{position:relative;isolation:isolate;display:inline-flex;align-items:center;gap:10px;height:38px;padding:0 6px 0 5px;margin-bottom:28px;border-radius:999px;font-size:13.5px;color:var(--ink-2);background:#fff;box-shadow:0 1px 2px rgba(14,15,18,.06),0 10px 26px -14px rgba(239,90,36,.45);transition:translate .35s var(--ease),box-shadow .35s var(--ease),opacity .9s var(--ease),transform .9s var(--ease)}
.badge::before{content:"";position:absolute;inset:-1px;z-index:-2;border-radius:inherit;background:conic-gradient(from var(--a,0deg),rgba(239,90,36,.75),rgba(255,178,127,.35),rgba(14,15,18,.08),rgba(14,15,18,.08),rgba(239,90,36,.75));animation:spin 6s linear infinite}
.badge::after{content:"";position:absolute;inset:0;z-index:-1;border-radius:inherit;background:linear-gradient(180deg,#fff,#fffaf6)}
.badge:hover{translate:0 -2px;box-shadow:0 2px 4px rgba(14,15,18,.06),0 16px 34px -14px rgba(239,90,36,.6)}
.badge-new{position:relative;overflow:hidden;display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 10px 0 8px;border-radius:999px;font:500 11px var(--mono);letter-spacing:.06em;text-transform:uppercase;color:#fff;background:var(--btn-bg);box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 4px 10px -4px rgba(var(--btn-tint),.7)}
.badge-new svg{width:12px;height:12px;fill:#fff;animation:twinkle 2.4s var(--ease) infinite}
.badge-new::after{content:"";position:absolute;top:0;bottom:0;left:0;width:60%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent);transform:translateX(-140%) skewX(-20deg);animation:chipsheen 4s var(--ease) infinite 1.2s}
@keyframes twinkle{0%,100%{transform:scale(1) rotate(0)}40%{transform:scale(1.25) rotate(20deg)}60%{transform:scale(.9) rotate(-10deg)}}
@keyframes chipsheen{0%{transform:translateX(-140%) skewX(-20deg)}30%,100%{transform:translateX(260%) skewX(-20deg)}}
.badge-sep{width:1px;height:16px;background:var(--line-2)}
.badge-txt{font-weight:500;color:var(--ink)}
.badge-tail{color:var(--body)}
.rot{position:relative;display:inline-block;height:1.5em;vertical-align:bottom;overflow:hidden;transition:width .45s var(--ease)}
.rot span{position:absolute;left:0;top:0;white-space:nowrap;line-height:1.5em;font-weight:600;background:linear-gradient(90deg,var(--accent-ink),var(--accent));-webkit-background-clip:text;background-clip:text;color:transparent;transform:translateY(100%);opacity:0;transition:transform .5s var(--ease),opacity .4s}
.rot span.on{transform:none;opacity:1}
.rot span.out{transform:translateY(-100%);opacity:0}
.badge-go{display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:var(--paper);box-shadow:inset 0 0 0 1px var(--line);transition:transform .35s var(--ease),background .3s,box-shadow .3s}
.badge-go svg{width:10px;height:10px;stroke:var(--ink);fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;transition:stroke .3s}
.badge:hover .badge-go{transform:translateX(2px);background:var(--accent);box-shadow:none}
.badge:hover .badge-go svg{stroke:#fff}
@media (max-width:560px){
  .badge{font-size:13px;gap:8px}
  .badge-sep,.badge-tail{display:none}
}

/* trade switcher, enhanced
   "Live preview" with a pulsing dot; each trade has a line icon and its
   resource count; during autoplay a thin bar fills along the bottom of the
   active trade (paused on hover, gone once a trade is picked). */
.switch-row{gap:14px}
.switch-lbl{display:inline-flex;align-items:center;gap:8px}
.live-dot{width:7px;height:7px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}
.switch{padding:5px;gap:2px;background:rgba(255,255,255,.8);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);box-shadow:inset 0 0 0 1px var(--line),0 10px 28px -20px rgba(14,15,18,.35)}
.switch button{position:relative;display:inline-flex;align-items:center;gap:8px;padding:8px 10px 8px 9px;overflow:hidden}
.sw-ic{display:grid;place-items:center;width:24px;height:24px;border-radius:8px;background:var(--paper);box-shadow:inset 0 0 0 1px var(--line);color:var(--body);transition:background .3s,color .3s,box-shadow .3s,transform .4s var(--ease)}
.sw-ic svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.switch button:hover .sw-ic{transform:rotate(-8deg)}
.switch button[aria-pressed=true] .sw-ic{background:rgba(255,255,255,.22);box-shadow:none;color:#fff}
.sw-n{font:500 10.5px var(--mono);padding:2px 6px;border-radius:999px;background:rgba(14,15,18,.06);color:var(--muted);transition:background .3s,color .3s}
.switch button[aria-pressed=true] .sw-n{background:rgba(255,255,255,.22);color:#fff}
.sw-bar{position:absolute;left:12px;right:12px;bottom:3px;height:2px;border-radius:2px;background:rgba(255,255,255,.28);opacity:0;transition:opacity .3s}
.sw-bar::after{content:"";position:absolute;inset:0;border-radius:inherit;background:#fff;transform-origin:0 50%;transform:scaleX(var(--prog,0));transition:transform .1s linear}
.autoplay .switch button[aria-pressed=true] .sw-bar{opacity:1}

/* hero buttons, enhanced
   The primary breathes a soft glow every few seconds until someone hovers
   it. The demo button leads with a play disc that sends out a ripple, and
   fills orange on hover. */
.ctas{gap:14px}
.hero .glow:not(:hover) .glow-halo{animation:breathe 5s var(--ease) infinite 2.5s}
@keyframes breathe{0%,60%,100%{opacity:0}78%{opacity:.85}}
.btn-line.has-play{padding-left:8px}
.play{position:relative;z-index:2;display:grid;place-items:center;width:34px;height:34px;border-radius:50%;flex:none;background:var(--ink);transition:background .3s,transform .35s var(--ease)}
.btn-lg .play{width:40px;height:40px}
.play svg{width:12px;height:12px;fill:#fff;margin-left:2px}
.play::after{content:"";position:absolute;inset:0;border-radius:50%;box-shadow:0 0 0 0 rgba(14,15,18,.35);animation:ripple 2.6s var(--ease) infinite}
@keyframes ripple{0%{box-shadow:0 0 0 0 rgba(14,15,18,.3)}70%,100%{box-shadow:0 0 0 12px rgba(14,15,18,0)}}
.btn-line.has-play:hover .play{background:var(--accent);transform:scale(1.06)}
.btn-line.has-play:hover .play::after{animation-name:ripple-o}
@keyframes ripple-o{0%{box-shadow:0 0 0 0 rgba(239,90,36,.45)}70%,100%{box-shadow:0 0 0 12px rgba(239,90,36,0)}}
.cta .play{background:#fff}
.cta .play svg{fill:var(--ink)}
.cta .play::after{animation-name:ripple-w}
@keyframes ripple-w{0%{box-shadow:0 0 0 0 rgba(255,255,255,.35)}70%,100%{box-shadow:0 0 0 12px rgba(255,255,255,0)}}
@media (max-width:560px){
  .sw-n{display:none}
  .switch button{padding:7px 10px 7px 7px}
}

/* product stage */
.stage{position:relative;max-width:1080px;margin:56px auto 0;perspective:2000px}
.win{position:relative;background:#fff;border-radius:18px;box-shadow:0 0 0 1px var(--line),0 2px 4px rgba(14,15,18,.04),0 40px 80px -30px rgba(14,15,18,.35);overflow:hidden;transform:rotateX(8deg);transform-origin:50% 0;transition:transform 1s var(--ease)}
.stage.flat .win{transform:none}
.win-bar{display:flex;align-items:center;gap:7px;height:40px;padding:0 16px;border-bottom:1px solid var(--line);background:#fcfcfb}
.win-bar i{width:10px;height:10px;border-radius:50%;background:#e7e7ea}
.win-url{margin:0 auto;font:400 12px var(--mono);color:var(--muted);background:#f4f4f2;padding:3px 14px;border-radius:7px}
.app{display:grid;grid-template-columns:200px 1fr;min-height:420px;text-align:left}
.app-side{border-right:1px solid var(--line);padding:18px 12px;font-size:13.5px;color:var(--body);background:#fcfcfb}
.app-who{display:flex;gap:10px;align-items:center;margin:0 6px 18px}
.app-who b{display:block;color:var(--ink);font-weight:600;font-size:14px;letter-spacing:-.02em}
.app-who small{font-size:11.5px;color:var(--muted)}
.av{width:30px;height:30px;border-radius:9px;background:var(--accent-soft);color:var(--accent-ink);display:grid;place-items:center;font-weight:600;font-size:12px;flex:none}
.app-it{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:9px;margin-bottom:2px}
.app-it i{width:14px;height:14px;border-radius:4px;border:1.5px solid currentColor;opacity:.6}
.app-it.on{background:#fff;color:var(--ink);font-weight:500;box-shadow:0 0 0 1px var(--line),0 2px 6px -2px rgba(14,15,18,.08)}
.gauge{margin:22px 4px 0;padding:14px;border-radius:12px;background:#fff;box-shadow:0 0 0 1px var(--line)}
.gauge small{font:500 10.5px var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.gauge-n{font-size:26px;font-weight:600;letter-spacing:-.03em;margin:6px 0 10px}
.gauge-n em{font-style:normal;font-size:14px;color:var(--muted);font-weight:500}
.cells{display:grid;grid-template-columns:repeat(8,1fr);gap:4px}
.cells i{aspect-ratio:1;border-radius:4px;background:#eeeeec}
.cells i.on{background:var(--accent)}
.app-main{padding:18px 20px;min-width:0}
.app-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.app-top b{font-size:16px;font-weight:600;letter-spacing:-.02em}
.seg{display:flex;padding:3px;border-radius:9px;background:#f3f3f1;font-size:12px}
.seg span{padding:4px 11px;border-radius:7px;color:var(--body)}
.seg span.on{background:#fff;color:var(--ink);box-shadow:0 1px 2px rgba(14,15,18,.08)}
.wk{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.dy small{display:block;font:500 11px var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px}
.ev{position:relative;border-radius:10px;padding:9px 10px 9px 12px;margin-bottom:8px;font-size:12px;line-height:1.35;overflow:hidden}
.ev::before{content:"";position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:0 3px 3px 0;background:currentColor}
.ev b{display:block;font-weight:600;color:var(--ink);font-size:12.5px;letter-spacing:-.01em}
.ev span{color:var(--body)}
.ev-studio{background:var(--accent-soft);color:var(--accent)}
.ev-private{background:var(--blue-soft);color:var(--blue)}
.ev-mobile{background:var(--green-soft);color:var(--green)}
.ev-course{background:var(--violet-soft);color:var(--violet)}
.ev.dim{opacity:.6}
.ev.full{background:#f4f4f2;color:#a9acb4}
.ev.full span{color:var(--red);font-weight:500}
.ev.hl{box-shadow:inset 0 0 0 2px var(--accent)}
.float{position:absolute;z-index:3;text-align:left}
.phone{left:-56px;bottom:-96px;width:252px;padding:16px;border-radius:26px;background:rgba(255,255,255,.94);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);box-shadow:0 0 0 1px var(--line),0 24px 50px -20px rgba(14,15,18,.35);animation:bob 7s ease-in-out infinite}
.phone-head{display:flex;gap:10px;align-items:center;margin-bottom:12px}
.phone-head b{display:block;font-size:13.5px;font-weight:600;letter-spacing:-.02em}
.phone-head small{font-size:11.5px;color:var(--muted)}
.slot{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-radius:11px;margin-bottom:6px;font-size:12.5px;box-shadow:inset 0 0 0 1px var(--line)}
.slot em{font-style:normal;font:500 11px var(--mono);color:var(--green);text-transform:uppercase}
.slot.sel{box-shadow:inset 0 0 0 1.5px var(--ink);background:#fff}
.slot.sold{color:var(--muted)}
.slot.sold em{color:var(--red)}
.phone-pay{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;padding-top:10px;border-top:1px dashed var(--line-2);font-size:12px;color:var(--body)}
.phone-pay .btn{height:32px;padding:0 14px;font-size:12.5px;flex:none}
.toasts{right:-48px;bottom:-70px;width:280px}
.toast{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;margin-bottom:10px;border-radius:14px;background:rgba(255,255,255,.95);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);box-shadow:0 0 0 1px var(--line),0 18px 40px -18px rgba(14,15,18,.35);font-size:12.5px;line-height:1.4;opacity:0;transform:translateY(10px) scale(.98);transition:opacity .5s var(--ease),transform .5s var(--ease)}
.toast.show{opacity:1;transform:none}
.toast .ic{width:28px;height:28px;border-radius:9px;display:grid;place-items:center;flex:none;font:600 12px var(--mono)}
.toast b{display:block;font-weight:600;color:var(--ink)}
.toast span{color:var(--body)}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}

/* marquee */
.mq{margin-top:150px;padding:22px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);overflow:hidden;-webkit-mask-image:linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent);mask-image:linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent)}
.mq-track{display:flex;gap:56px;width:max-content;animation:mq 50s linear infinite}
.mq-track span{display:flex;align-items:center;gap:14px;font-size:20px;font-weight:500;letter-spacing:-.03em;color:var(--ink-2);white-space:nowrap}
.mq-track span::after{content:"";width:6px;height:6px;border-radius:50%;background:var(--accent);margin-left:42px}
.mq-track em{font:400 13px var(--mono);font-style:normal;color:var(--muted)}
@keyframes mq{to{transform:translateX(-50%)}}

/* sections */
.section{padding:140px 0}
.section.tight{padding-top:0}
.head{display:flex;justify-content:space-between;align-items:flex-end;gap:40px;margin-bottom:56px}
.head .h2{max-width:720px;margin-top:18px}
.head .sub{max-width:380px}

/* bento */
.bento{display:grid;grid-template-columns:repeat(6,1fr);gap:16px}
.tile{position:relative;background:#fff;border-radius:24px;padding:28px;box-shadow:0 0 0 1px var(--line);overflow:hidden;transition:box-shadow .3s var(--ease),transform .3s var(--ease)}
.tile:hover{box-shadow:0 0 0 1px var(--line-2),0 30px 60px -36px rgba(14,15,18,.35);transform:translateY(-2px)}
.tile h3{font-size:22px;letter-spacing:-.03em;line-height:1.15}
.tile h3 em{font-family:var(--serif);font-style:italic;font-weight:400}
.tile p{color:var(--body);font-size:15px;margin-top:8px;max-width:440px}
.tile .k{font:500 11px var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:14px;display:block}
.t-cap{grid-column:span 4;grid-row:span 2;display:flex;flex-direction:column;background:linear-gradient(180deg,#fff,#fffaf6)}
.t-pay,.t-zone{grid-column:span 2}
.t-sms,.t-course,.t-cal,.t-reg{grid-column:span 3}
.t-new{grid-column:span 6;background:linear-gradient(120deg,#fff4ec,#fffaf6 60%,#fff);box-shadow:0 0 0 1px rgba(239,90,36,.18);display:grid;grid-template-columns:1fr 1.4fr;gap:32px;align-items:center}
.t-new .k{color:var(--accent-ink)}
.cap-vis{margin-top:auto;padding-top:28px}
.racks{display:grid;grid-template-columns:repeat(8,1fr);gap:10px}
.rk{aspect-ratio:1;border-radius:16px;background:#f3f2ef;display:grid;place-items:center;transition:background .5s var(--ease)}
.rk::after{content:"";width:46%;height:46%;border-radius:50%;border:2px solid #d9d8d3;transition:border-color .5s}
.rk.on{background:var(--accent)}
.rk.on::after{border-color:rgba(255,255,255,.7)}
.cap-meta{display:flex;justify-content:space-between;align-items:flex-end;margin-top:18px;gap:16px;flex-wrap:wrap}
.cap-big{font-size:56px;font-weight:600;letter-spacing:-.05em;line-height:1}
.cap-big em{font-style:normal;color:var(--muted);font-size:22px;letter-spacing:-.02em}
.legend{display:flex;gap:16px;font-size:13px;color:var(--body)}
.legend span{display:flex;gap:7px;align-items:center}
.legend i{width:10px;height:10px;border-radius:3px}
.money{margin-top:22px;padding:16px;border-radius:16px;background:var(--paper);box-shadow:inset 0 0 0 1px var(--line)}
.money div{display:flex;justify-content:space-between;font-size:13.5px;padding:6px 0;color:var(--body)}
.money b{color:var(--ink);font-weight:600;font-variant-numeric:tabular-nums}
.money .tot{border-top:1px dashed var(--line-2);margin-top:6px;padding-top:12px}
.money .tot b{font-size:20px;letter-spacing:-.03em}
.zone{position:relative;height:150px;margin-top:22px;border-radius:16px;background:#eef2ee;overflow:hidden;background-image:linear-gradient(rgba(14,15,18,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(14,15,18,.04) 1px,transparent 1px);background-size:22px 22px}
.zone .ring{position:absolute;left:50%;top:50%;width:190px;height:190px;margin:-95px 0 0 -95px;border-radius:50%;background:radial-gradient(circle,rgba(239,90,36,.16),rgba(239,90,36,.05) 70%);box-shadow:inset 0 0 0 1.5px rgba(239,90,36,.45)}
.zone .ring::after{content:"";position:absolute;inset:-1px;border-radius:50%;box-shadow:0 0 0 1.5px rgba(239,90,36,.5);animation:ping 3s var(--ease) infinite}
@keyframes ping{0%{transform:scale(.4);opacity:1}100%{transform:scale(1.25);opacity:0}}
.pin{position:absolute;width:14px;height:14px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(14,15,18,.3)}
.pin.h{left:calc(50% - 7px);top:calc(50% - 7px);background:var(--accent)}
.pin.c{left:68%;top:28%;background:var(--green)}
.pin.x{left:90%;top:80%;background:#b6b9c0}
.tag{position:absolute;font:500 10.5px var(--mono);text-transform:uppercase;background:#fff;padding:3px 7px;border-radius:6px;box-shadow:0 0 0 1px var(--line)}
.flow{margin-top:14px;display:grid;gap:6px;font-size:13px;color:var(--body)}
.flow li{display:flex;gap:8px;align-items:center}
.flow li::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--green)}
.flow li:last-child::before{background:var(--line-2)}
.sms{margin-top:22px;display:flex;flex-direction:column;gap:8px}
.bub{max-width:85%;padding:10px 14px;border-radius:18px;font-size:13.5px;line-height:1.4}
.bub.in{background:#f1f1ef;border-bottom-left-radius:6px;color:var(--ink-2)}
.bub.out{align-self:flex-end;background:var(--blue);color:#fff;border-bottom-right-radius:6px}
.bub small{display:block;font:400 10.5px var(--mono);opacity:.65;margin-top:3px}
.weeks{margin-top:22px;display:grid;grid-template-columns:repeat(6,1fr);gap:8px;align-items:end;height:110px;padding-bottom:22px}
.wbar{border-radius:10px 10px 4px 4px;background:linear-gradient(180deg,var(--accent-2),var(--accent));position:relative}
.wbar span{position:absolute;bottom:-22px;left:0;right:0;text-align:center;font:500 10.5px var(--mono);color:var(--muted)}
.cal{margin-top:20px;display:grid;gap:8px}
.cal div{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-radius:12px;box-shadow:inset 0 0 0 1px var(--line);font-size:13px}
.cal em{font-style:normal;font:500 10.5px var(--mono);text-transform:uppercase;padding:3px 8px;border-radius:999px}
.cal .g em{background:var(--blue-soft);color:var(--blue)}
.cal .b em{background:#f1f1ef;color:var(--muted)}
.ticks{margin-top:20px;display:flex;gap:6px;flex-wrap:wrap}
.ticks span{display:flex;align-items:center;gap:8px;padding:8px 12px 8px 8px;border-radius:999px;box-shadow:inset 0 0 0 1px var(--line);font-size:13px}
.ticks i{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;font-style:normal;font:600 10px var(--mono);background:var(--green);color:#fff}
.ticks .no i{background:#f0efeb;color:var(--muted)}
.chips{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.chipx{position:relative;padding:16px 18px;border-radius:16px;background:#fff;box-shadow:0 0 0 1px var(--line),0 10px 24px -18px rgba(14,15,18,.3)}
.chipx b{display:flex;justify-content:space-between;align-items:center;font-weight:600;letter-spacing:-.02em;font-size:16px}
.chipx b em{font:500 10.5px var(--mono);font-style:normal;text-transform:uppercase;letter-spacing:.06em;color:var(--green);background:var(--green-soft);padding:3px 8px;border-radius:999px}
.chipx span{display:block;font-size:13.5px;color:var(--body);margin-top:4px}

/* dark comparison */
.dark{background:var(--night);color:#fff;border-radius:40px;margin:0 16px;position:relative;overflow:hidden;isolation:isolate}
.dark::before{content:"";position:absolute;inset:auto -10% -40% -10%;height:80%;z-index:-1;background:radial-gradient(50% 60% at 50% 100%,rgba(239,90,36,.28),transparent 70%)}
.dark .label{color:#8a8e99}
.dark .h2{color:#fff}
.dark .h2 em{color:var(--accent-2)}
.dark .sub{color:var(--night-body)}
.cmp{width:100%;margin-top:64px;border-collapse:separate;border-spacing:0;border-radius:24px;box-shadow:inset 0 0 0 1px var(--night-line);overflow:hidden;text-align:left}
.cmp th,.cmp td{padding:22px 26px;font-size:15px;font-weight:400;vertical-align:middle}
.cmp tbody tr+tr th,.cmp tbody tr+tr td,.cmp tbody tr:first-child th,.cmp tbody tr:first-child td{border-top:1px solid var(--night-line)}
.cmp thead th{padding:16px 26px;font:500 11.5px var(--mono);text-transform:uppercase;letter-spacing:.08em;color:#8a8e99}
.cmp thead .us{color:var(--accent-2)}
.cmp tbody th{font-weight:500;letter-spacing:-.01em;color:#fff}
.cmp .them{color:#8a8e99}
.cmp .us{background:rgba(239,90,36,.07)}
.cmp .mk{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;margin-right:10px;vertical-align:-4px;font:600 11px var(--mono)}
.cmp .them .mk{background:rgba(255,255,255,.07);color:#6b6f7a}
.cmp .us .mk{background:var(--accent);color:#fff}

/* tour */
.tour{display:grid;grid-template-columns:1fr 1.1fr;gap:72px}
.tstep{min-height:62vh;display:flex;flex-direction:column;justify-content:center;padding:24px 0;opacity:.28;transition:opacity .5s var(--ease)}
.tstep.act{opacity:1}
.tstep .num{font:500 13px var(--mono);color:var(--accent);margin-bottom:18px}
.tstep h3{font-size:clamp(28px,3vw,40px);letter-spacing:-.04em;line-height:1.05}
.tstep p{color:var(--body);font-size:17px;margin-top:14px;max-width:440px}
.tstep>small{display:inline-block;margin-top:22px;font:500 11.5px var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--ink-2);background:#fff;box-shadow:inset 0 0 0 1px var(--line);padding:6px 10px;border-radius:999px;align-self:flex-start}
.tvis{position:sticky;top:110px;height:min(560px,calc(100vh - 140px));border-radius:32px;background:linear-gradient(160deg,#fff,#f6f3ee);box-shadow:0 0 0 1px var(--line);overflow:hidden}
.tvis::before{content:"";position:absolute;inset:0;background-image:radial-gradient(rgba(14,15,18,.07) 1px,transparent 1px);background-size:18px 18px;-webkit-mask-image:radial-gradient(ellipse at center,#000 30%,transparent 75%);mask-image:radial-gradient(ellipse at center,#000 30%,transparent 75%)}
.scene{position:absolute;inset:0;display:grid;place-items:center;padding:32px;opacity:0;transform:translateY(24px) scale(.97);transition:opacity .6s var(--ease),transform .6s var(--ease);pointer-events:none}
.scene.act{opacity:1;transform:none}
.card-ui{width:100%;max-width:380px;background:#fff;border-radius:20px;box-shadow:0 0 0 1px var(--line),0 30px 60px -30px rgba(14,15,18,.35);padding:22px;text-align:left}
.card-ui h4{font-size:15px;letter-spacing:-.02em;font-weight:600}
.card-ui .hint{font-size:12.5px;color:var(--muted);margin:4px 0 16px}
.fld{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 14px;border-radius:12px;box-shadow:inset 0 0 0 1px var(--line);margin-bottom:8px;font-size:13.5px}
.fld b{font:500 12.5px var(--mono);background:var(--paper);padding:4px 9px;border-radius:7px;box-shadow:inset 0 0 0 1px var(--line);white-space:nowrap}
.fld.focus{box-shadow:inset 0 0 0 1.5px var(--accent),0 0 0 4px rgba(239,90,36,.12)}
.prog{height:6px;border-radius:6px;background:#f0efeb;margin-top:14px;overflow:hidden}
.prog span{display:block;height:100%;width:80%;border-radius:6px;background:linear-gradient(90deg,var(--accent),var(--accent-2))}
.linkbox{display:flex;align-items:center;gap:10px;padding:10px 10px 10px 14px;border-radius:12px;background:var(--paper);box-shadow:inset 0 0 0 1px var(--line);font:500 13px var(--mono)}
.linkbox span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.linkbox em{font-style:normal;font:500 12px var(--sans);background:var(--ink);color:#fff;padding:6px 12px;border-radius:8px}
.copied{margin-top:12px;font:500 12px var(--mono);text-transform:uppercase;color:var(--green)}
.ig{margin-top:16px;padding:16px;border-radius:16px;box-shadow:inset 0 0 0 1px var(--line);display:flex;gap:14px;align-items:center}
.ig-ring{width:54px;height:54px;border-radius:50%;padding:3px;background:conic-gradient(#f9ce34,#ee2a7b,#6228d7,#f9ce34);flex:none}
.ig-ring span{display:grid;place-items:center;width:100%;height:100%;border-radius:50%;background:#fff;font-weight:600;font-size:15px;color:var(--accent-ink);border:2px solid #fff}
.ig b{display:block;font-size:14px}
.ig p{font-size:12.5px;color:var(--body);line-height:1.4}
.ig p span{color:var(--blue);font-weight:500}
.reg{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--line);font-size:13.5px}
.reg:first-of-type{border-top:0}
.reg .av{border-radius:50%;font-size:11px}
.reg>span:nth-child(2){flex:1}
.reg i{width:22px;height:22px;border-radius:7px;display:grid;place-items:center;font-style:normal;font:600 11px var(--mono)}
.reg i.y{background:var(--green);color:#fff}
.reg i.n{background:#f0efeb;color:var(--muted)}
.payline{margin-top:14px;padding:14px;border-radius:14px;background:var(--night);color:#fff;display:flex;justify-content:space-between;align-items:center;font-size:13px}
.payline b{font-size:18px;letter-spacing:-.03em}
.inline-scene{display:none}

/* trades */
.tgrid{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}
.tr{position:relative;padding:22px;border-radius:22px;background:#fff;box-shadow:0 0 0 1px var(--line);min-height:210px;height:100%;display:flex;flex-direction:column;overflow:hidden;transition:transform .35s var(--ease),box-shadow .35s var(--ease),background .35s}
.tr .cnt{font-size:64px;font-weight:600;letter-spacing:-.06em;line-height:.9;color:var(--ink);transition:color .35s;font-variant-numeric:tabular-nums}
.tr .res{font:500 11.5px var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-top:10px}
.tr b{margin-top:auto;padding-top:18px;font-size:16px;font-weight:600;letter-spacing:-.02em;display:flex;justify-content:space-between;align-items:center;gap:8px}
.tr b::after{content:"\\2192";color:var(--muted);transition:transform .3s var(--ease),color .3s}
a.tr:hover{transform:translateY(-4px);background:var(--ink);box-shadow:0 30px 50px -30px rgba(14,15,18,.6)}
a.tr:hover .cnt{color:var(--accent-2)}
a.tr:hover b{color:#fff}
a.tr:hover b::after{color:var(--accent-2);transform:translateX(4px)}
a.tr:hover .res{color:#8a8e99}
.tr.current{box-shadow:inset 0 0 0 1.5px var(--accent)}
.tr.current b::after{content:"You are here";font:500 10.5px var(--mono);text-transform:uppercase;color:var(--accent-ink)}

/* commission calculator */
.calc{display:grid;grid-template-columns:1.05fr .95fr;gap:20px;align-items:stretch}
.calc-in,.calc-out{border-radius:28px;padding:36px}
.calc-in{position:relative;background:#fff;box-shadow:0 0 0 1px var(--line)}
.calc-out{background:var(--night);color:#fff;position:relative;overflow:hidden;isolation:isolate;display:flex;flex-direction:column}
.calc-out::before{content:"";position:absolute;right:-30%;bottom:-50%;width:120%;height:120%;z-index:-1;background:radial-gradient(closest-side,rgba(239,90,36,.35),transparent)}
.calc label,.calc .lbl{display:block;font:500 11.5px var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:12px}
.rev{font-size:clamp(44px,5vw,64px);font-weight:600;letter-spacing:-.05em;line-height:1;margin-bottom:22px;font-variant-numeric:tabular-nums}
.rev small{font-size:16px;color:var(--muted);letter-spacing:-.01em;font-weight:500}
.calc input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:6px;border-radius:6px;background:linear-gradient(90deg,var(--accent) var(--p,17%),#ecebe7 var(--p,17%));margin:0}
.calc input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:26px;height:26px;border-radius:50%;background:#fff;box-shadow:0 0 0 1px var(--line-2),0 4px 12px rgba(14,15,18,.2);cursor:grab}
.calc input[type=range]::-moz-range-thumb{width:26px;height:26px;border:0;border-radius:50%;background:#fff;box-shadow:0 0 0 1px var(--line-2),0 4px 12px rgba(14,15,18,.2);cursor:grab}
.scale{display:flex;justify-content:space-between;font:500 11px var(--mono);color:var(--muted);margin-top:10px}
.rates{display:flex;gap:6px}
.rates button{flex:1;height:44px;border:0;border-radius:12px;background:var(--paper);box-shadow:inset 0 0 0 1px var(--line);font:500 14px var(--sans);color:var(--body);cursor:pointer;transition:background .2s,color .2s}
.rates button[aria-pressed=true]{background:var(--accent);color:#fff;box-shadow:none}
.calc-out .lbl{color:#8a8e99}
.keep{font-size:clamp(52px,6vw,80px);font-weight:600;letter-spacing:-.06em;line-height:1;margin:14px 0 6px;color:var(--accent-2);font-variant-numeric:tabular-nums}
.keep-sub{color:var(--night-body);font-size:15px}
.vs{margin-top:auto;padding-top:28px;display:grid;gap:12px}
.vsr{display:grid;grid-template-columns:120px 1fr auto;gap:14px;align-items:center;font-size:13.5px;color:var(--night-body)}
.bar{height:10px;border-radius:10px;background:rgba(255,255,255,.08);overflow:hidden}
.bar span{display:block;height:100%;border-radius:10px;transition:width .5s var(--ease)}
.vsr b{color:#fff;font-weight:600;font-variant-numeric:tabular-nums;min-width:84px;text-align:right}
.calc-note{margin-top:16px;font-size:12.5px;color:#8a8e99}

/* pricing */
.plans{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;align-items:stretch}
.plan{position:relative;padding:32px;border-radius:28px;background:#fff;box-shadow:0 0 0 1px var(--line);display:flex;flex-direction:column}
.plan-name{display:flex;justify-content:space-between;align-items:center;font-weight:600;font-size:17px;letter-spacing:-.02em}
.plan-flag{font:500 10.5px var(--mono);text-transform:uppercase;letter-spacing:.06em;padding:4px 9px;border-radius:999px;background:var(--accent);color:#fff}
.price{font-size:64px;font-weight:600;letter-spacing:-.06em;line-height:1;margin:26px 0 6px}
.price sup{font-size:24px;letter-spacing:0;vertical-align:28px;margin-right:2px;font-weight:500}
.price small{font-size:15px;letter-spacing:-.01em;color:var(--muted);font-weight:500}
.plan-note{color:var(--body);font-size:14.5px;min-height:46px}
.plan .btn{width:100%;margin:24px 0 26px}
.plan ul{padding:22px 0 0;border-top:1px solid var(--line);display:grid;gap:12px;font-size:14.5px;color:var(--ink-2)}
.plan li{display:flex;gap:12px;align-items:center}
.plan li::before{content:"";width:18px;height:18px;border-radius:50%;flex:none;background:var(--green-soft) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2312804f' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12l5 5L19 7'/%3E%3C/svg%3E") center/11px no-repeat}
.plan.featured{background:var(--night);color:#fff;box-shadow:0 40px 80px -40px rgba(14,15,18,.7);overflow:hidden}
.plan.featured::before{content:"";position:absolute;inset:-40% -20% auto;height:70%;background:radial-gradient(closest-side,rgba(239,90,36,.35),transparent);pointer-events:none}
.plan.featured .plan-note,.plan.featured .price small{color:var(--night-body)}
.plan.featured ul{border-color:var(--night-line);color:#e4e6ea}
.plan.featured li::before{background-color:rgba(18,128,79,.28);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%237fe0ad' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12l5 5L19 7'/%3E%3C/svg%3E")}
.plan.featured .btn-line{background:#fff;box-shadow:none}
.assure{display:flex;justify-content:center;gap:28px;flex-wrap:wrap;margin-top:32px;font:500 12px var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}

/* faq */
.faq-wrap{display:grid;grid-template-columns:.8fr 1.2fr;gap:64px}
.faq-aside{margin-top:20px;color:var(--body);max-width:340px}
.faq details{border-top:1px solid var(--line-2);padding:24px 0}
.faq details:last-child{border-bottom:1px solid var(--line-2)}
.faq summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;gap:20px;font-size:19px;font-weight:500;letter-spacing:-.02em}
.faq summary::-webkit-details-marker{display:none}
.faq summary i{width:28px;height:28px;border-radius:50%;flex:none;box-shadow:inset 0 0 0 1px var(--line-2);position:relative;transition:background .3s}
.faq summary i::before,.faq summary i::after{content:"";position:absolute;left:50%;top:50%;width:10px;height:1.5px;background:var(--ink);transform:translate(-50%,-50%)}
.faq summary i::after{transform:translate(-50%,-50%) rotate(90deg);transition:transform .3s var(--ease)}
.faq details[open] summary i{background:var(--ink)}
.faq details[open] summary i::before,.faq details[open] summary i::after{background:#fff}
.faq details[open] summary i::after{transform:translate(-50%,-50%) rotate(0)}
.faq details p{color:var(--body);margin-top:12px;max-width:620px}

/* closing cta */
.cta{position:relative;margin:0 16px;padding:150px 28px;text-align:center;border-radius:40px;background:var(--night);color:#fff;overflow:hidden;isolation:isolate}
.cta::before{content:"";position:absolute;left:50%;top:100%;width:1100px;height:1100px;margin-left:-550px;margin-top:-420px;border-radius:50%;z-index:-1;background:radial-gradient(closest-side,rgba(239,90,36,.55),rgba(239,90,36,.12) 55%,transparent 72%)}
.cta::after{content:"";position:absolute;inset:0;z-index:-1;opacity:.35;background-image:linear-gradient(var(--night-line) 1px,transparent 1px),linear-gradient(90deg,var(--night-line) 1px,transparent 1px);background-size:64px 64px;-webkit-mask-image:radial-gradient(ellipse 60% 70% at 50% 40%,#000,transparent 75%);mask-image:radial-gradient(ellipse 60% 70% at 50% 40%,#000,transparent 75%)}
.cta h2{font-size:clamp(44px,7vw,92px);letter-spacing:-.05em;line-height:.98}
.cta h2 em{font-family:var(--serif);font-style:italic;font-weight:400;color:var(--accent-2)}
.cta p{color:var(--night-body);font-size:18px;margin:24px auto 36px;max-width:520px}
.cta .btn-line{background:transparent;color:#fff;box-shadow:inset 0 0 0 1px rgba(255,255,255,.22)}

/* footer */
.site-footer{padding:80px 0 40px}
.footer-grid{display:grid;grid-template-columns:1.6fr repeat(3,1fr);gap:40px;font-size:14.5px;color:var(--body)}
.footer-h{margin:0 0 16px;font:500 11.5px var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.footer-col a{display:block;padding:5px 0;transition:color .2s}
.footer-col a:hover{color:var(--ink)}
.footer-blurb{margin-top:16px;max-width:300px}
.wordmark{margin-top:72px;font-size:clamp(64px,15vw,210px);font-weight:600;letter-spacing:-.07em;line-height:.8;color:transparent;-webkit-text-stroke:1px var(--line-2);-webkit-user-select:none;user-select:none;white-space:nowrap;overflow:hidden}
.footer-bottom{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-top:28px;font:500 12px var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}

/* spotlight + grain */
.sp::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:0;transition:opacity .3s;background:radial-gradient(380px circle at var(--mx,50%) var(--my,50%),rgba(239,90,36,.10),transparent 60%)}
.sp:hover::after{opacity:1}
.plan.featured.sp::after,a.tr.sp::after{background:radial-gradient(380px circle at var(--mx,50%) var(--my,50%),rgba(255,138,76,.18),transparent 60%)}
body::after{content:"";position:fixed;inset:0;z-index:100;pointer-events:none;opacity:.035;mix-blend-mode:multiply;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}

/* reveal: only hidden once the script has said it will reveal them */
.js .rv{opacity:0;transform:translateY(24px);transition:opacity .9s var(--ease),transform .9s var(--ease)}
.js .rv.in{opacity:1;transform:none}
.js .rv.d1{transition-delay:.08s}.js .rv.d2{transition-delay:.16s}.js .rv.d3{transition-delay:.24s}

@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation:none!important;transition:none!important}
  html{scroll-behavior:auto}
  .js .rv,.hero h1 .w{opacity:1;transform:none;filter:none}
  .hero h1 .wm{overflow:visible}
  .win{transform:none}
  .toast{opacity:1;transform:none}
}

@media (max-width:1100px){
  .nav-desktop>a.nav-demo{display:none}
  .nav-desktop>a,.nav-trig{padding:0 11px}
  .phone{left:-16px}
  .toasts{right:-12px}
  .tgrid{grid-template-columns:repeat(3,1fr)}
}
@media (max-width:1000px){
  .hero-inner>.proof{display:grid;grid-template-columns:1fr 1fr;gap:2px}
  .pf:nth-child(3)::before{display:none}
}
@media (max-width:900px){
  .nav-desktop,.header-actions{display:none}
  .nav-toggle{display:flex}
  .section{padding:96px 0}
  .head{flex-direction:column;align-items:flex-start;gap:16px}
  .bento>.tile{grid-column:span 6}
  .t-new{grid-template-columns:1fr}
  .plans,.faq-wrap,.tour,.calc{grid-template-columns:1fr}
  .faq-wrap{gap:24px}
  .tour{gap:0}
  .tvis{display:none}
  .tstep{min-height:0;opacity:1;padding:28px 0}
  .inline-scene{display:grid;place-items:center;margin-top:24px;padding:24px 16px;border-radius:24px;background:linear-gradient(160deg,#fff,#f6f3ee);box-shadow:0 0 0 1px var(--line)}
  .inline-scene .scene{position:static;opacity:1;transform:none;padding:0}
  .footer-grid{grid-template-columns:1fr 1fr}
  .footer-brand{grid-column:1/-1}
  .app{grid-template-columns:1fr}
  .app-side{display:none}
  .wk{grid-template-columns:repeat(3,1fr)}
  .wk .dy:nth-child(n+4){display:none}
  .toasts{display:none}
  .phone{position:relative;left:auto;bottom:auto;margin:-60px auto 0;animation:none}
  .cmp thead{display:none}
  .cmp,.cmp tbody,.cmp tr,.cmp th,.cmp td{display:block;width:100%}
  .cmp tbody tr{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--night-line)}
  .cmp tbody tr:first-child{border-top:0}
  .cmp tbody th{grid-column:1/-1;padding-bottom:4px}
  .cmp tbody th,.cmp tbody td{border-top:0!important}
  .cmp td::before{content:attr(data-label);display:block;font:500 10.5px var(--mono);text-transform:uppercase;letter-spacing:.06em;color:#6b6f7a;margin-bottom:6px}
  .cmp .us{background:transparent}
  .dark,.cta{margin:0 8px;border-radius:28px}
  .calc-in,.calc-out{padding:26px}
  .vsr{grid-template-columns:90px 1fr auto}
  .spot{display:none}
}
@media (max-width:560px){
  .container{padding:0 18px}
  .site-header{padding:10px 0}
  .hero{padding-top:28px}
  .hero h1{font-size:44px}
  .switch-row{flex-direction:column;gap:10px}
  .orbs i{filter:blur(40px);opacity:.4}
  .proof{display:grid;grid-template-columns:1fr 1fr;gap:2px;width:100%;max-width:420px;border-radius:18px}
  .pf{padding:8px}
  .pf::before{display:none}
  .pt b{white-space:normal;font-size:13px}
  .ctas{flex-direction:column;align-items:stretch;max-width:420px;margin-left:auto;margin-right:auto}
  .ctas .btn{width:100%}
  .stage{margin-top:40px}
  .win{transform:none}
  .wk{grid-template-columns:repeat(2,1fr)}
  .wk .dy:nth-child(n+3){display:none}
  .mq{margin-top:72px}
  .tgrid{grid-template-columns:1fr 1fr}
  .tr{min-height:170px;padding:18px}
  .tr .cnt{font-size:48px}
  .racks{gap:6px}
  .rk{border-radius:10px}
  .cap-big{font-size:44px}
  .tile{padding:22px;border-radius:20px}
  .chips{grid-template-columns:1fr}
  .cmp th,.cmp td{padding:16px 18px;font-size:14px}
  .cta{padding:96px 20px}
  .price{font-size:54px}
}

/* first screen: on tablets and up, the header and everything from the badge
   to the trade switcher fit in one viewport. The block fills exactly the
   screen below the header and centres its content; spacing (--vg) and the
   headline size scale with the screen's height, so a 650px laptop and a
   1080px monitor both get one composed first screen. The product window
   starts just below the fold. */
@media (min-width:901px){
  .site-header{--hp:clamp(6px,1.2vh,14px);padding:var(--hp) 0}
  .hero{padding-top:0}
  .hero-top{--vg:clamp(10px,2.3vh,30px);min-height:calc(100svh - 60px - 2 * clamp(6px,1.2vh,14px));display:flex;flex-direction:column;align-items:center;justify-content:center;padding:var(--vg) 0 calc(var(--vg) * 1.3)}
  .hero-top .badge{margin-bottom:var(--vg)}
  .hero h1{font-size:clamp(40px,min(6.6vw,9.4vh),92px)}
  .hero-sub{margin:var(--vg) auto calc(var(--vg) * 1.1);font-size:clamp(16px,min(1.5vw,2.5vh),20px);line-height:1.5}
  .kicker{margin-top:calc(var(--vg) * .45)}
  .hero-top .proof{margin-top:var(--vg)}
  .hero-top .switch-row{margin-top:var(--vg)}
  .stage{margin-top:clamp(20px,4vh,56px)}
}
@media (min-width:901px) and (max-height:720px){
  .hero-top .btn-lg{height:50px;padding:0 24px;font-size:15px}
  .hero-top .btn-lg .arr{width:28px;height:28px;margin-right:-14px}
  .hero-top .btn-lg .play{width:34px;height:34px}
  .hero-top .pf{padding:6px 14px 6px 6px}
  .hero-top .pi{width:30px;height:30px}
  .hero-top .switch button{padding:6px 9px 6px 7px}
  .hero-top .badge{height:34px}
  .hero-top .badge-new{height:24px}
}
`;
