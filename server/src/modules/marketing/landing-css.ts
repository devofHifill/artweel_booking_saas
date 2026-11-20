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
.hero::after{content:"";position:absolute;inset:0 0 auto;height:760px;z-index:-1;opacity:0;background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:64px 64px;-webkit-mask-image:radial-gradient(ellipse 70% 60% at 50% 30%,#000 30%,transparent 75%);mask-image:radial-gradient(ellipse 70% 60% at 50% 30%,#000 30%,transparent 75%)}
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
.orbs i{position:absolute;border-radius:50%;filter:blur(80px);opacity:.32;animation:drift 18s ease-in-out infinite alternate}
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

/* hero decoration
   Quiet on purpose: light and line, no objects. A soft beam of light falls
   from the top centre onto the headline; a faint warm aurora turns behind
   it over two minutes; hairline arcs rise from below the fold like a
   horizon, and one small glint travels along an arc every few seconds; a
   fine dot matrix fades out from the centre. */
.deco{position:absolute;left:0;right:0;top:-90px;height:calc(100svh + 90px);min-height:640px;z-index:-1;pointer-events:none;overflow:hidden}
.beam{position:absolute;left:50%;top:0;width:min(1100px,90vw);height:78%;translate:-50% 0;background:radial-gradient(50% 60% at 50% 0%,rgba(255,255,255,.95),rgba(255,255,255,.4) 45%,transparent 75%);mix-blend-mode:soft-light}
.beam::after{content:"";position:absolute;left:50%;top:0;width:1px;height:62%;translate:-50% 0;background:linear-gradient(180deg,rgba(239,90,36,.0),rgba(239,90,36,.28) 40%,transparent);opacity:.7}
.aurora{position:absolute;left:50%;top:6%;width:min(1200px,110vw);aspect-ratio:2.2;translate:-50% 0;border-radius:50%;background:conic-gradient(from var(--a,0deg) at 50% 50%,rgba(255,180,140,.0),rgba(255,170,120,.30),rgba(255,214,190,.0) 30%,rgba(210,222,255,.26) 55%,rgba(255,190,150,.0) 75%,rgba(255,170,120,.30));filter:blur(70px);opacity:.75;animation:spin 120s linear infinite;-webkit-mask-image:radial-gradient(closest-side,#000 40%,transparent);mask-image:radial-gradient(closest-side,#000 40%,transparent)}
.dots{position:absolute;inset:0;background-image:radial-gradient(rgba(14,15,18,.11) 1px,transparent 1.3px);background-size:22px 22px;-webkit-mask-image:radial-gradient(ellipse 55% 50% at 50% 42%,#000 10%,transparent 70%);mask-image:radial-gradient(ellipse 55% 50% at 50% 42%,#000 10%,transparent 70%);opacity:.55}
.horizon{position:absolute;left:0;right:0;bottom:0;width:100%;height:62%;fill:none;stroke:rgba(14,15,18,.07);stroke-width:1;vector-effect:non-scaling-stroke;-webkit-mask-image:linear-gradient(180deg,transparent,#000 35%,#000 70%,transparent);mask-image:linear-gradient(180deg,transparent,#000 35%,#000 70%,transparent)}
.horizon ellipse{vector-effect:non-scaling-stroke}
.horizon .glint{stroke:rgba(239,90,36,.85);stroke-width:1.6;stroke-linecap:round;stroke-dasharray:4 96;stroke-dashoffset:0;filter:drop-shadow(0 0 4px rgba(239,90,36,.8));animation:glint 9s var(--ease) infinite}
@keyframes glint{0%{stroke-dashoffset:62;opacity:0}12%{opacity:1}55%{opacity:1}70%,100%{stroke-dashoffset:38;opacity:0}}
@media (max-width:900px){
  .deco{height:900px}
  .horizon{height:420px}
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

/* bento
   Twelve columns. Every tile: an illustrated panel on top (soft tinted
   ground, a drawn piece of the product inside) and the text below. Panels
   animate once, when their tile scrolls in (.tile.in). Rows line up, so no
   tile stretches into empty space. */
.bento{display:grid;grid-template-columns:repeat(12,1fr);gap:16px}
.tile{position:relative;display:flex;flex-direction:column;background:#fff;border-radius:26px;padding:10px;box-shadow:0 0 0 1px var(--line),0 1px 2px rgba(14,15,18,.03);overflow:hidden;transition:box-shadow .4s var(--ease),translate .4s var(--ease)}
.tile:hover{translate:0 -3px;box-shadow:0 0 0 1px var(--line-2),0 34px 60px -40px rgba(14,15,18,.4)}
.tile-text{padding:20px 18px 18px}
.tile .k{display:block;margin-bottom:10px;font:500 11px var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.tile h3{font-size:21px;letter-spacing:-.03em;line-height:1.18}
.tile h3 em{font-family:var(--serif);font-style:italic;font-weight:400}
.tile p{margin-top:8px;max-width:520px;font-size:14.5px;line-height:1.55;color:var(--body)}
.media{position:relative;height:214px;border-radius:18px;overflow:hidden;display:grid;place-items:center;isolation:isolate;background:linear-gradient(180deg,#fbfaf8,#f4f2ee);box-shadow:inset 0 0 0 1px rgba(14,15,18,.045)}
.media::before{content:"";position:absolute;inset:0;z-index:-1;background-image:radial-gradient(rgba(14,15,18,.07) 1px,transparent 1.2px);background-size:16px 16px;-webkit-mask-image:radial-gradient(ellipse at center,#000 20%,transparent 75%);mask-image:radial-gradient(ellipse at center,#000 20%,transparent 75%)}
.media>*{transition:transform .6s var(--ease)}
.tile:hover .media>*:first-child{transform:translateY(-3px) scale(1.015)}
.t-cap{grid-column:span 7}
.t-pay{grid-column:span 5}
.t-zone,.t-sms,.t-course{grid-column:span 4}
.t-cal,.t-reg{grid-column:span 6}
.t-new{grid-column:span 12}
.t-cap .media,.t-pay .media{height:250px}

/* capacity */
.media-cap{background:linear-gradient(160deg,#fff6f0,#f6f1ec)}
.mc-panel{width:min(92%,520px);padding:16px;border-radius:16px;background:#fff;box-shadow:0 0 0 1px var(--line),0 24px 40px -28px rgba(14,15,18,.35)}
.mc-head{display:flex;align-items:center;gap:10px;font-size:13px;margin-bottom:12px}
.mc-head b{font-weight:600;letter-spacing:-.01em}
.mc-time{margin-left:auto;font:500 11px var(--mono);color:var(--muted)}
.mc-live{display:inline-flex;align-items:center;gap:5px;font:500 10px var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--green);background:var(--green-soft);padding:3px 7px;border-radius:999px}
.mc-live i{width:6px;height:6px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}
.mc-row{display:grid;grid-template-columns:118px 1fr;align-items:center;gap:12px;padding:9px 0;border-top:1px solid var(--line)}
.mc-lbl{font:500 10.5px var(--mono);text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.racks{display:grid;gap:5px}
.rk{aspect-ratio:1;max-height:34px;border-radius:8px;background:#f1efeb;box-shadow:inset 0 0 0 1px rgba(14,15,18,.05);transition:background .5s var(--ease),transform .5s var(--ease),box-shadow .5s}
.rk::after{display:none}
.rk.on{background:linear-gradient(180deg,#ff7a45,var(--accent));box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 4px 10px -6px rgba(239,90,36,.8)}
.mc-block{height:26px;border-radius:8px;display:flex;align-items:center;padding:0 10px;font:500 10.5px var(--mono);text-transform:uppercase;letter-spacing:.04em;color:#fff;background:repeating-linear-gradient(135deg,#1c1e24 0 8px,#26282f 8px 16px)}
.mc-foot{display:flex;align-items:baseline;justify-content:space-between;padding-top:10px;border-top:1px solid var(--line);font-size:12.5px;color:var(--body)}
.mc-foot b{font-size:28px;font-weight:600;letter-spacing:-.04em;color:var(--ink);font-variant-numeric:tabular-nums}
.mc-foot em{font-style:normal;font-size:13px;color:var(--muted);letter-spacing:0;font-weight:500}

/* payments */
.media-pay{background:linear-gradient(160deg,#f3f0ff,#f4f2ee)}
.pc{width:min(86%,330px);padding:16px 18px;border-radius:18px;background:#fff;box-shadow:0 0 0 1px var(--line),0 26px 44px -30px rgba(40,20,90,.45)}
.pc-top{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--body)}
.pc-ic{display:grid;place-items:center;width:26px;height:26px;border-radius:8px;background:var(--violet-soft);color:var(--violet)}
.pc-ic svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.8}
.pc-ok{margin-left:auto;font:500 10px var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--green);background:var(--green-soft);padding:3px 8px;border-radius:999px}
.pc-amt{margin:12px 0 10px;font-size:40px;font-weight:600;letter-spacing:-.05em;line-height:1;font-variant-numeric:tabular-nums}
.pc-amt small{font-size:20px;color:var(--muted);letter-spacing:-.02em}
.pc-line{display:flex;justify-content:space-between;padding:7px 0;border-top:1px solid var(--line);font-size:12.5px;color:var(--body)}
.pc-line b{color:var(--ink);font-weight:600;font-variant-numeric:tabular-nums}
.pc-line b.zero{color:var(--green)}
.pc-to{display:flex;align-items:center;gap:8px;margin-top:8px;font:500 10.5px var(--mono);text-transform:uppercase;letter-spacing:.05em;color:var(--violet)}
.pc-to i{width:7px;height:7px;border-radius:50%;background:var(--violet);box-shadow:0 0 0 4px rgba(109,79,216,.15)}
.fee-pill{position:absolute;right:16px;top:16px;font:600 11px var(--mono);text-transform:uppercase;letter-spacing:.05em;color:#fff;background:var(--btn-bg);padding:6px 10px;border-radius:999px;box-shadow:0 8px 18px -8px rgba(var(--btn-tint),.8);transform:rotate(4deg)}

/* on-site */
.media-zone{padding:0}
.zone{position:absolute;inset:0;background:#edf2ee;background-image:linear-gradient(rgba(14,15,18,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(14,15,18,.045) 1px,transparent 1px);background-size:24px 24px}
.zone .ring{position:absolute;left:50%;top:50%;width:200px;height:200px;margin:-100px 0 0 -100px;border-radius:50%;background:radial-gradient(circle,rgba(239,90,36,.16),rgba(239,90,36,.04) 70%);box-shadow:inset 0 0 0 1.5px rgba(239,90,36,.45)}
.zone .ring::after{content:"";position:absolute;inset:-1px;border-radius:50%;box-shadow:0 0 0 1.5px rgba(239,90,36,.5);animation:ping 3.2s var(--ease) infinite}
@keyframes ping{0%{transform:scale(.4);opacity:1}100%{transform:scale(1.3);opacity:0}}
.zone .route{position:absolute;left:50%;top:50%;width:62px;height:2px;transform-origin:0 50%;transform:rotate(-38deg);background:repeating-linear-gradient(90deg,var(--green) 0 5px,transparent 5px 9px)}
.pin{position:absolute;width:14px;height:14px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(14,15,18,.3)}
.pin.h{left:calc(50% - 7px);top:calc(50% - 7px);background:var(--accent)}
.pin.c{left:calc(50% + 42px);top:calc(50% - 46px);background:var(--green)}
.pin.x{left:86%;top:80%;background:#b6b9c0}
.zone .tag{position:absolute;font:500 10.5px var(--mono);text-transform:uppercase;background:#fff;padding:4px 8px;border-radius:7px;box-shadow:0 0 0 1px var(--line),0 6px 14px -8px rgba(14,15,18,.3)}
.zone .t1{left:calc(50% + 32px);top:calc(50% - 80px);color:var(--green)}
.zone .t2{right:10px;bottom:46px;color:var(--muted)}

/* reminders */
.media-sms{background:linear-gradient(160deg,#eef3ff,#f4f2ee)}
.sms{width:min(88%,300px);display:flex;flex-direction:column;gap:8px}
.bub{max-width:88%;padding:10px 13px;border-radius:18px;font-size:12.5px;line-height:1.4;box-shadow:0 10px 20px -16px rgba(14,15,18,.4)}
.bub.in{background:#fff;border-bottom-left-radius:6px;color:var(--ink-2)}
.bub.out{align-self:flex-end;background:var(--blue);color:#fff;border-bottom-right-radius:6px}
.bub small{display:block;font:400 10px var(--mono);opacity:.6;margin-top:3px}
.typing{align-self:flex-end;display:flex;gap:4px;padding:10px 12px;border-radius:16px;background:#fff;box-shadow:0 0 0 1px var(--line)}
.typing i{width:6px;height:6px;border-radius:50%;background:#c3c6cd;animation:dotty 1.2s infinite}
.typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}
@keyframes dotty{0%,80%,100%{transform:translateY(0);opacity:.5}40%{transform:translateY(-3px);opacity:1}}
.js .t-sms .b1,.js .t-sms .b2{opacity:0;transform:translateY(8px)}
.js .t-sms .typing{opacity:0;height:0;padding:0 12px;overflow:hidden}
.js .t-sms.in .b1{animation:pop .5s var(--ease) .2s forwards}
.js .t-sms.in .typing{animation:typing 1.4s var(--ease) .8s forwards}
.js .t-sms.in .b2{animation:pop .5s var(--ease) 2.2s forwards}
@keyframes pop{to{opacity:1;transform:none}}
@keyframes typing{0%{opacity:0;height:0;padding:0 12px}15%,80%{opacity:1;height:26px;padding:10px 12px}100%{opacity:0;height:0;padding:0 12px;margin-top:-8px}}

/* courses */
.media-course{background:linear-gradient(160deg,#fff4ec,#f4f2ee);padding:22px 22px 18px;display:flex;flex-direction:column;align-items:stretch;justify-content:space-between}
.crs-head{display:flex;justify-content:space-between;align-items:baseline;font-size:13px}
.crs-head b{font-weight:600}
.crs-head span{font:500 10.5px var(--mono);text-transform:uppercase;color:var(--muted)}
.weeks{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;align-items:stretch;height:128px}
.wk-col{display:flex;flex-direction:column;align-items:center;gap:6px;height:100%;justify-content:flex-end}
.wk-col small{font:500 10px var(--mono);color:var(--muted)}
.wtrack{position:relative;flex:1;width:100%;border-radius:9px 9px 4px 4px;background:repeating-linear-gradient(135deg,rgba(14,15,18,.05) 0 4px,transparent 4px 8px);box-shadow:inset 0 0 0 1px rgba(14,15,18,.05)}
.wbar{position:absolute;left:0;right:0;bottom:0;height:var(--h);border-radius:9px 9px 4px 4px;background:linear-gradient(180deg,#ff9a5a,var(--accent));box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 6px 14px -8px rgba(239,90,36,.7)}
.js .t-course .wbar{transform:scaleY(.05);transform-origin:50% 100%;transition:transform .8s cubic-bezier(.2,.9,.2,1.15);transition-delay:calc(var(--i) * 70ms)}
.js .t-course.in .wbar{transform:none}

/* calendar */
.media-cal{background:linear-gradient(160deg,#eef3ff,#f4f2ee);display:grid;grid-template-columns:1fr 64px 1fr;align-items:center;padding:0 24px}
.cal-col{display:flex;flex-direction:column;gap:7px;padding:12px;border-radius:14px;background:#fff;box-shadow:0 0 0 1px var(--line),0 18px 30px -24px rgba(14,15,18,.4)}
.cal-h{font:500 10px var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:2px}
.cal-ev{display:flex;justify-content:space-between;align-items:center;gap:6px;min-height:30px;padding:6px 9px;border-radius:9px;font-size:12px;font-weight:500}
.cal-ev small{font:500 10px var(--mono);opacity:.7}
.cal-ev.ghost{background:repeating-linear-gradient(90deg,#f3f2ef 0 6px,#f8f7f5 6px 12px)}
.cal-ev.busy{background:#eceef3;color:#596070}
.cal-ev.blocked{background:repeating-linear-gradient(135deg,#1c1e24 0 6px,#2a2c33 6px 12px);color:#fff}
.cal-ev.in-sync{background:var(--blue-soft);color:var(--blue)}
.cal-ev.ours{background:var(--accent-soft);color:var(--accent-ink)}
.cal-sync{display:flex;align-items:center;justify-content:center}
.cal-line{flex:1;height:2px;background:repeating-linear-gradient(90deg,var(--blue) 0 4px,transparent 4px 8px);opacity:.5;animation:flowx 1.4s linear infinite}
@keyframes flowx{to{background-position:16px 0}}
.cal-ic{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:#fff;color:var(--blue);box-shadow:0 0 0 1px var(--line),0 8px 16px -10px rgba(46,107,230,.6)}
.cal-ic svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;animation:orbit 6s linear infinite}
@keyframes orbit{to{transform:rotate(360deg)}}

/* attendance */
.media-reg{background:linear-gradient(160deg,#eaf7f0,#f4f2ee)}
.roster{width:min(86%,320px);padding:12px 14px;border-radius:16px;background:#fff;box-shadow:0 0 0 1px var(--line),0 22px 36px -28px rgba(14,15,18,.4)}
.ro-head{display:flex;justify-content:space-between;align-items:baseline;padding-bottom:8px;font-size:12.5px}
.ro-head b{font-weight:600}
.ro-head span{font:500 10px var(--mono);text-transform:uppercase;color:var(--muted)}
.ro{display:flex;align-items:center;gap:10px;padding:6px 0;border-top:1px solid var(--line);font-size:12.5px}
.ro>span:nth-child(2){flex:1}
.ro .av{width:24px;height:24px;border-radius:50%;font-size:10px}
.ro i{width:22px;height:22px;border-radius:7px;display:grid;place-items:center;font-style:normal;font:600 11px var(--mono)}
.ro i.y{background:var(--green);color:#fff}
.ro i.n{background:#f0efeb;color:var(--muted)}
.js .t-reg .ro i{transform:scale(0);transition:transform .4s cubic-bezier(.2,.9,.3,1.4);transition-delay:calc(.3s + var(--i) * 140ms)}
.js .t-reg.in .ro i{transform:none}

/* just shipped */
.t-new{display:flex;flex-direction:column;gap:22px;padding:30px;background:radial-gradient(120% 140% at 0% 0%,#fff1e7,#fffaf6 45%,#fff);box-shadow:0 0 0 1px rgba(239,90,36,.18)}
.t-new .k{color:var(--accent-ink)}
.t-new h3{font-size:28px}
.new-head{display:flex;justify-content:space-between;align-items:flex-end;gap:24px}
.new-head p{margin:0;max-width:300px;text-align:right}
.chips{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.chipx{position:relative;padding:16px;border-radius:16px;background:#fff;box-shadow:0 0 0 1px var(--line),0 14px 28px -22px rgba(14,15,18,.35);transition:translate .3s var(--ease),box-shadow .3s}
.chipx:hover{translate:0 -2px;box-shadow:0 0 0 1px rgba(239,90,36,.3),0 20px 34px -22px rgba(239,90,36,.45)}
.chipx b{display:flex;justify-content:space-between;align-items:center;gap:8px;font-weight:600;letter-spacing:-.02em;font-size:15px}
.chipx b em{font:500 10px var(--mono);font-style:normal;text-transform:uppercase;letter-spacing:.06em;color:var(--green);background:var(--green-soft);padding:3px 7px;border-radius:999px}
.chipx span{display:block;font-size:13px;line-height:1.45;color:var(--body);margin-top:6px}

@media (max-width:1100px){
  .t-cap,.t-pay{grid-column:span 6}
  .t-zone,.t-sms{grid-column:span 6}
  .t-course{grid-column:span 12}
  .chips{grid-template-columns:repeat(2,1fr)}
}
@media (max-width:760px){
  .bento>.tile{grid-column:span 12}
  .t-new{padding:22px}
  .new-head{flex-direction:column;align-items:flex-start;gap:8px}
  .new-head p{text-align:left}
  .media,.t-cap .media,.t-pay .media{height:200px}
  .t-cap .media{height:230px}
  .tile-text{padding:16px 14px 14px}
  .mc-row{grid-template-columns:1fr;gap:6px}
  .chips{grid-template-columns:1fr}
}
@media (prefers-reduced-motion:reduce){
  .js .t-sms .b1,.js .t-sms .b2{opacity:1;transform:none}
  .js .t-course .wbar,.js .t-reg .ro i{transform:none}
}

/* dark comparison */
.dark{background:var(--night);color:#fff;border-radius:40px;margin:0 16px;position:relative;overflow:hidden;isolation:isolate}
.dark::before{content:"";position:absolute;inset:auto -10% -40% -10%;height:80%;z-index:-1;background:radial-gradient(50% 60% at 50% 100%,rgba(239,90,36,.28),transparent 70%)}
.dark .label{color:#8a8e99}
.dark .h2{color:#fff}
.dark .h2 em{color:var(--accent-2)}
.dark .sub{color:var(--night-body)}
/* comparison: a "versus" table. The BookAIHub column is a raised card with
   a glowing orange edge that runs the full height of the table and ends in
   a Start free button. As the table scrolls in, rows arrive one by one, the
   generic tool's line is struck through, and the check pops. Hovering a row
   lights it across all three columns. */
.cmp-wrap{position:relative;margin-top:64px;isolation:isolate}
.cmp-wrap::before{content:"";position:absolute;z-index:-1;top:-18px;bottom:-18px;left:calc(64% - 6px);right:-6px;border-radius:28px;background:linear-gradient(180deg,rgba(239,90,36,.16),rgba(239,90,36,.05) 40%,rgba(255,255,255,.03));box-shadow:inset 0 0 0 1px rgba(255,138,76,.35),0 40px 80px -30px rgba(239,90,36,.45)}
.cmp-wrap::after{content:"";position:absolute;z-index:-1;top:-18px;left:calc(64% + 40px);right:40px;height:1px;background:linear-gradient(90deg,transparent,rgba(255,190,150,.9),transparent)}
.cmp{width:100%;table-layout:fixed;border-collapse:separate;border-spacing:0;text-align:left}
.cmp .c-need{width:30%}.cmp .c-them{width:34%}.cmp .c-us{width:36%}
.cmp th,.cmp td{padding:20px 24px;font-size:15px;font-weight:400;vertical-align:middle;transition:background .3s}
.cmp thead th{padding:6px 24px 18px;font:500 11.5px var(--mono);text-transform:uppercase;letter-spacing:.08em;color:#8a8e99;vertical-align:bottom}
.cmp thead th:first-child{color:#6b6f7a}
.col-h{display:inline-flex;align-items:center;gap:10px}
.cmp thead .us .col-h{color:#fff;font:600 15px var(--sans);letter-spacing:-.02em;text-transform:none}
.cmp thead .us .brand-mark{width:26px;height:26px;border-radius:8px}
.col-ic{display:grid;place-items:center;width:26px;height:26px;border-radius:8px;font:600 12px var(--mono);background:rgba(255,255,255,.06);color:#6b6f7a;box-shadow:inset 0 0 0 1px var(--night-line)}
.col-pill{font:500 10px var(--mono);text-transform:uppercase;letter-spacing:.06em;color:#1a0d06;background:linear-gradient(180deg,#ffc29c,var(--accent-2));padding:3px 8px;border-radius:999px}
.cmp tbody th,.cmp tbody td{border-top:1px solid var(--night-line)}
.cmp tbody tr:first-child th,.cmp tbody tr:first-child td{border-top-color:rgba(255,255,255,.14)}
.cmp tbody .us{border-top-color:rgba(255,138,76,.16)}
.cmp tbody th{font-weight:500;letter-spacing:-.01em;color:#fff}
.need-n{display:inline-block;width:30px;font:500 11px var(--mono);color:#5b5f6a}
.cmp .them{color:#8a8e99}
.cmp .us{color:#fff;font-weight:500}
.cmp .mk{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;margin-right:12px;vertical-align:-5px;font:600 11px var(--mono);transition:transform .45s cubic-bezier(.2,.9,.3,1.4)}
.cmp .them .mk{background:rgba(255,255,255,.06);color:#6b6f7a}
.cmp .us .mk{background:var(--btn-bg);color:#fff;box-shadow:0 0 0 4px rgba(239,90,36,.15),0 6px 14px -6px rgba(239,90,36,.8)}
.cmp .them .tx{background:linear-gradient(rgba(138,142,153,.7),rgba(138,142,153,.7)) no-repeat 0 55%/0% 1px;transition:background-size .7s var(--ease)}
.cmp tbody tr:hover th,.cmp tbody tr:hover td{background:rgba(255,255,255,.035)}
.cmp tbody tr:hover .us{background:rgba(239,90,36,.1)}
.cmp tbody tr:hover .us .mk{transform:scale(1.15) rotate(-8deg)}
.cmp tfoot th,.cmp tfoot td{padding:22px 24px 8px;border-top:1px solid var(--night-line)}
.cmp tfoot .us{border-top-color:rgba(255,138,76,.16)}
.foot-them{font:500 11.5px var(--mono);text-transform:uppercase;letter-spacing:.06em;color:#5b5f6a}
.cmp tfoot .btn{height:48px}
/* scroll-in */
.js .cmp-wrap tbody tr th,.js .cmp-wrap tbody tr td{opacity:0;transform:translateY(10px);transition:opacity .55s var(--ease),transform .55s var(--ease),background .3s;transition-delay:calc(var(--i) * 90ms),calc(var(--i) * 90ms),0s}
.js .cmp-wrap.in tbody tr th,.js .cmp-wrap.in tbody tr td{opacity:1;transform:none}
.js .cmp-wrap .us .mk{transform:scale(0)}
.js .cmp-wrap.in .us .mk{transform:none;transition-delay:calc(.35s + var(--i) * 90ms)}
.js .cmp-wrap.in tbody tr:hover .us .mk{transform:scale(1.15) rotate(-8deg);transition-delay:0s}
.js .cmp-wrap.in .them .tx{background-size:100% 1px;transition-delay:calc(.5s + var(--i) * 90ms)}
html:not(.js) .cmp .them .tx{background-size:100% 1px}

/* tour
   Left: a rail of three numbered nodes joined by a line that fills orange
   as you scroll (--rail, 0..1). Every step stays readable; the active one
   is full strength with its node lit. Passed steps show a tick.
   Right: a sticky stage with story-style progress bars and a tint that
   changes per step; each scene plays its own animation when it becomes
   active. */
.tour{display:grid;grid-template-columns:.95fr 1.05fr;gap:64px;--rail:0}
.t-rail{position:relative;padding:8vh 0}
.t-line{position:absolute;left:21px;top:calc(8vh + 22px);bottom:calc(8vh + 22px);width:2px;border-radius:2px;background:var(--line-2);overflow:hidden}
.t-line i{position:absolute;inset:0;transform-origin:50% 0;transform:scaleY(var(--rail));background:linear-gradient(180deg,var(--accent-2),var(--accent));transition:transform .15s linear}
.tstep{position:relative;display:grid;grid-template-columns:44px 1fr;gap:22px;min-height:44vh;align-items:center;padding:12px 0;opacity:.42;transition:opacity .5s var(--ease)}
.tstep.act{opacity:1}
.tstep.done{opacity:.6}
.t-node{position:relative;z-index:1;display:grid;place-items:center;width:44px;height:44px;border-radius:50%;background:var(--paper);box-shadow:inset 0 0 0 1.5px var(--line-2);font:600 15px var(--sans);color:var(--muted);transition:background .4s,box-shadow .4s,color .4s,transform .4s var(--ease)}
.t-node svg{position:absolute;width:16px;height:16px;fill:none;stroke:#fff;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;opacity:0;transform:scale(.5);transition:opacity .3s,transform .4s var(--ease)}
.tstep.act .t-node{background:var(--btn-bg);color:#fff;box-shadow:0 0 0 6px rgba(239,90,36,.12),0 10px 24px -10px rgba(239,90,36,.8);transform:scale(1.06)}
.tstep.done .t-node{background:var(--ink);box-shadow:none}
.tstep.done .t-node b{opacity:0}
.tstep.done .t-node svg{opacity:1;transform:none}
.tstep .num{font:500 12px var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--accent-ink);margin-bottom:12px}
.tstep h3{font-size:clamp(28px,3vw,40px);letter-spacing:-.04em;line-height:1.05}
.tstep p{color:var(--body);font-size:17px;margin-top:12px;max-width:460px}
.t-body>small{display:inline-block;margin-top:18px;font:500 11.5px var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--ink-2);background:#fff;box-shadow:inset 0 0 0 1px var(--line);padding:6px 10px;border-radius:999px}
.tvis{position:sticky;top:96px;height:min(580px,calc(100vh - 130px));border-radius:32px;overflow:hidden;isolation:isolate;background:linear-gradient(160deg,#fff8f2,#f5f1ec);box-shadow:0 0 0 1px var(--line),0 40px 80px -50px rgba(14,15,18,.45);transition:background .7s var(--ease)}
.tvis[data-at="1"]{background:linear-gradient(160deg,#f1f4ff,#f3f1ee)}
.tvis[data-at="2"]{background:linear-gradient(160deg,#ecf7f1,#f3f1ee)}
.tvis::before{content:"";position:absolute;inset:0;z-index:-1;background-image:radial-gradient(rgba(14,15,18,.07) 1px,transparent 1.2px);background-size:18px 18px;-webkit-mask-image:radial-gradient(ellipse at center,#000 25%,transparent 75%);mask-image:radial-gradient(ellipse at center,#000 25%,transparent 75%)}
.tv-bars{position:absolute;left:22px;right:22px;top:20px;z-index:3;display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.tv-bars i{height:3px;border-radius:3px;background:rgba(14,15,18,.1);overflow:hidden}
.tv-bars b{display:block;height:100%;width:100%;transform-origin:0 50%;transform:scaleX(0);background:var(--ink);transition:transform .4s var(--ease)}
.tv-chip{position:absolute;left:22px;top:36px;z-index:3;font:500 11px var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.tv-chip b{color:var(--ink)}
.scene{position:absolute;inset:0;display:grid;place-items:center;padding:56px 32px 32px;opacity:0;transform:translateY(26px) scale(.96);filter:blur(4px);transition:opacity .6s var(--ease),transform .6s var(--ease),filter .6s var(--ease);pointer-events:none}
.scene.act{opacity:1;transform:none;filter:none}
.card-ui{width:100%;max-width:380px;background:#fff;border-radius:20px;box-shadow:0 0 0 1px var(--line),0 30px 60px -30px rgba(14,15,18,.35);padding:20px;text-align:left}
.card-ui h4{font-size:15px;letter-spacing:-.02em;font-weight:600}
.card-ui .hint{font-size:12.5px;color:var(--muted);margin:4px 0 14px}
.cu-top{display:flex;justify-content:space-between;align-items:center}
.cu-step{font:500 10.5px var(--mono);text-transform:uppercase;color:var(--muted);background:var(--paper);padding:3px 8px;border-radius:999px;box-shadow:inset 0 0 0 1px var(--line)}
.cu-foot{display:flex;justify-content:space-between;align-items:center;margin-top:14px;font-size:12px;color:var(--muted)}
.cu-btn{font:500 12.5px var(--sans);color:#fff;background:var(--btn-bg);padding:7px 14px;border-radius:999px}

/* scene 1: setup fields fill in one by one */
.fld{position:relative;display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px 40px 11px 14px;border-radius:12px;box-shadow:inset 0 0 0 1px var(--line);margin-bottom:8px;font-size:13.5px;transition:box-shadow .3s}
.fld b{font:500 12.5px var(--mono);background:var(--paper);padding:4px 9px;border-radius:7px;box-shadow:inset 0 0 0 1px var(--line);white-space:nowrap}
.fld-ok{position:absolute;right:12px;top:50%;width:18px;height:18px;margin-top:-9px;border-radius:50%;background:var(--green);display:grid;place-items:center}
.fld-ok svg{width:10px;height:10px;fill:none;stroke:#fff;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.prog{height:6px;border-radius:6px;background:#f0efeb;margin-top:12px;overflow:hidden}
.prog span{display:block;height:100%;width:100%;border-radius:6px;background:linear-gradient(90deg,var(--accent),var(--accent-2));transform-origin:0 50%}
.js .sc-setup .fld b{opacity:0;transform:translateX(6px);transition:opacity .35s,transform .35s var(--ease)}
.js .sc-setup .fld-ok{transform:scale(0);transition:transform .35s cubic-bezier(.2,.9,.3,1.4)}
.js .sc-setup .prog span{transform:scaleX(.08);transition:transform 1.6s var(--ease) .3s}
.js .sc-setup.act .fld b{opacity:1;transform:none;transition-delay:calc(.25s + var(--i) * .32s)}
.js .sc-setup.act .fld-ok{transform:none;transition-delay:calc(.4s + var(--i) * .32s)}
.js .sc-setup.act .prog span{transform:scaleX(.82)}
.js .sc-setup.act .fld:nth-of-type(4){box-shadow:inset 0 0 0 1.5px var(--accent),0 0 0 4px rgba(239,90,36,.12);transition-delay:1.3s}

/* scene 2: Instagram profile, tap the link, booking sheet slides up */
.ig-phone{position:relative;width:min(300px,100%);height:100%;max-height:470px;padding:18px 16px;border-radius:30px;background:#fff;box-shadow:0 0 0 1px var(--line),0 0 0 7px #fff,0 0 0 8px rgba(14,15,18,.08),0 40px 70px -36px rgba(14,15,18,.5);overflow:hidden;text-align:left}
.igp-top{display:flex;align-items:center;gap:14px}
.ig-ring{width:58px;height:58px;border-radius:50%;padding:3px;background:conic-gradient(#f9ce34,#ee2a7b,#6228d7,#f9ce34);flex:none}
.ig-ring span{display:grid;place-items:center;width:100%;height:100%;border-radius:50%;background:#fff;font-weight:600;font-size:15px;color:var(--accent-ink);border:2px solid #fff}
.igp-stats{display:flex;gap:12px;font-size:11px;color:var(--body)}
.igp-stats span{display:flex;flex-direction:column;align-items:center}
.igp-stats b{font-size:14px;color:var(--ink)}
.igp-name{display:block;margin-top:10px;font-size:13.5px}
.igp-bio{font-size:12px;line-height:1.4;color:var(--ink-2);margin-top:2px}
.igp-link{position:relative;display:inline-flex;align-items:center;gap:5px;margin-top:6px;font-size:12px;font-weight:600;color:var(--blue)}
.igp-link svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2}
.tap{position:absolute;left:50%;top:50%;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:rgba(46,107,230,.25);transform:scale(0);opacity:0}
.igp-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;margin-top:14px}
.igp-grid i{aspect-ratio:1;border-radius:4px;background:linear-gradient(135deg,#f4e4d8,#e9d8cb)}
.igp-grid i:nth-child(2n){background:linear-gradient(135deg,#dfe7f3,#cfd9ea)}
.igp-grid i:nth-child(3n){background:linear-gradient(135deg,#e3efe6,#d2e4d7)}
.sheet-up{position:absolute;left:0;right:0;bottom:0;padding:10px 16px 16px;border-radius:22px 22px 0 0;background:#fff;box-shadow:0 -1px 0 var(--line),0 -20px 40px -20px rgba(14,15,18,.35);transform:translateY(105%)}
.sh-grab{display:block;width:36px;height:4px;border-radius:4px;background:#dcdde1;margin:0 auto 10px}
.sheet-up>b{display:block;font-size:13.5px;margin-bottom:8px}
.sh-slots{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.sh-slots span{display:flex;flex-direction:column;gap:2px;padding:8px;border-radius:10px;font-size:11.5px;font-weight:500;box-shadow:inset 0 0 0 1px var(--line)}
.sh-slots em{font-style:normal;font:500 10px var(--mono);color:var(--green);text-transform:uppercase}
.sh-slots .sel{box-shadow:inset 0 0 0 1.5px var(--ink)}
.sh-slots .sold{color:var(--muted)}
.sh-slots .sold em{color:var(--red)}
.sh-book{display:block;margin-top:10px;padding:10px;border-radius:999px;text-align:center;font-size:12.5px;font-weight:500;color:#fff;background:var(--btn-bg)}
.sc-share.act .tap{animation:tap 1s var(--ease) .6s}
.sc-share.act .sheet-up{animation:sheet .7s cubic-bezier(.2,.9,.25,1) 1.2s forwards}
@keyframes tap{0%{transform:scale(0);opacity:1}100%{transform:scale(2.4);opacity:0}}
@keyframes sheet{to{transform:none}}

/* scene 3: reminder lands, register ticks, payout counts */
.run-stack{width:100%;max-width:380px;display:grid;gap:12px}
.run-note{display:flex;gap:12px;align-items:center;padding:12px 14px;border-radius:16px;background:#fff;box-shadow:0 0 0 1px var(--line),0 18px 30px -22px rgba(14,15,18,.4);font-size:12.5px}
.run-note b{display:block;font-size:13px}
.run-note span{color:var(--body)}
.rn-ic{display:grid;place-items:center;width:30px;height:30px;border-radius:10px;flex:none;background:var(--blue-soft);color:var(--blue);font-weight:600}
.reg{display:flex;align-items:center;gap:12px;padding:9px 0;border-top:1px solid var(--line);font-size:13.5px}
.run-reg .cu-top{margin-bottom:6px}
.reg .av{border-radius:50%;font-size:11px}
.reg>span:nth-child(2){flex:1}
.reg i{width:22px;height:22px;border-radius:7px;display:grid;place-items:center;font-style:normal;font:600 11px var(--mono)}
.reg i.y{background:var(--green);color:#fff}
.reg i.n{background:#f0efeb;color:var(--muted)}
.payline{padding:14px 16px;border-radius:16px;background:var(--night);color:#fff;display:flex;justify-content:space-between;align-items:center;font-size:13px;box-shadow:0 20px 34px -20px rgba(14,15,18,.6)}
.payline b{font-size:20px;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.js .sc-run .run-note{opacity:0;transform:translateY(-10px)}
.js .sc-run .reg i{transform:scale(0);transition:transform .4s cubic-bezier(.2,.9,.3,1.4)}
.js .sc-run.act .run-note{animation:pop .5s var(--ease) .3s forwards}
.js .sc-run.act .reg i{transform:none;transition-delay:calc(.7s + var(--i) * .22s)}
.inline-scene{display:none}

/* trades: an index beside a preview.
   The list is grouped, every row a link: count in mono, trade name, its
   resource, and an arrow that slides in. The active row carries a soft
   pill and an orange count. The preview on the right swaps (blur and
   slide) to the hovered trade and shows its own headline, gauge, three
   sessions and booking card. */
.trades{display:grid;grid-template-columns:1fr 1.05fr;gap:40px;align-items:start}
.tr-group+.tr-group{margin-top:26px}
.tr-gh{font:500 11px var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 8px 14px}
.tr-item{position:relative;display:grid;grid-template-columns:44px 1fr auto 20px;align-items:center;gap:12px;padding:13px 14px;border-radius:14px;transition:background .3s,box-shadow .3s}
.tr-item+.tr-item,.tr-group li+li .tr-item{border-top:0}
.tr-group li+li{border-top:1px solid var(--line)}
.tr-n{font:500 15px var(--mono);color:var(--muted);font-variant-numeric:tabular-nums;transition:color .3s}
.tr-name{font-size:18px;font-weight:600;letter-spacing:-.025em;color:var(--ink)}
.tr-res{font:500 11px var(--mono);text-transform:uppercase;letter-spacing:.05em;color:var(--muted);white-space:nowrap}
.tr-here{position:absolute;right:46px;top:50%;translate:0 -50%;font:500 10px var(--mono);text-transform:uppercase;color:var(--accent-ink);background:var(--accent-soft);padding:3px 7px;border-radius:999px}
.tr-item[aria-current] .tr-res{visibility:hidden}
.tr-go{color:var(--muted);opacity:0;transform:translateX(-6px);transition:opacity .3s,transform .3s var(--ease),color .3s}
.tr-item:hover,.tr-item.on,.tr-item:focus-visible{background:#fff;box-shadow:0 0 0 1px var(--line),0 14px 30px -22px rgba(14,15,18,.35)}
.tr-group li:has(.tr-item.on),.tr-group li:has(.tr-item.on)+li,.tr-group li:has(.tr-item:hover),.tr-group li:has(.tr-item:hover)+li{border-top-color:transparent}
.tr-item.on .tr-n,.tr-item:hover .tr-n{color:var(--accent)}
.tr-item.on .tr-go,.tr-item:hover .tr-go,.tr-item:focus-visible .tr-go{opacity:1;transform:none;color:var(--accent)}
.tr-preview{position:sticky;top:110px;display:grid}
.tp{grid-area:1/1;display:flex;flex-direction:column;gap:18px;padding:30px;border-radius:30px;background:var(--night);color:#fff;overflow:hidden;isolation:isolate;position:relative;opacity:0;transform:translateY(14px) scale(.98);filter:blur(4px);pointer-events:none;transition:opacity .45s var(--ease),transform .45s var(--ease),filter .45s var(--ease);box-shadow:0 50px 90px -50px rgba(14,15,18,.7)}
.tp.on{opacity:1;transform:none;filter:none;pointer-events:auto}
.tp::before{content:"";position:absolute;right:-25%;top:-35%;width:90%;height:90%;z-index:-1;background:radial-gradient(closest-side,rgba(239,90,36,.45),transparent);transition:transform .8s var(--ease)}
.tp:hover::before{transform:translate(-6%,6%) scale(1.06)}
.tp::after{content:"";position:absolute;inset:0;z-index:-1;opacity:.35;background-image:radial-gradient(rgba(255,255,255,.12) 1px,transparent 1.2px);background-size:18px 18px;-webkit-mask-image:linear-gradient(200deg,#000,transparent 60%);mask-image:linear-gradient(200deg,#000,transparent 60%)}
.tp-badge{align-self:flex-start;font:500 11px var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--accent-2);background:rgba(239,90,36,.14);padding:5px 10px;border-radius:999px}
.tp-h{font-size:clamp(26px,2.4vw,34px);font-weight:600;letter-spacing:-.04em;line-height:1.08;max-width:440px}
.tp-row{display:grid;grid-template-columns:130px 1fr;gap:16px;align-items:center}
.tp-gauge{display:flex;flex-direction:column;align-items:center;gap:8px}
.tp-ring{position:relative;display:grid;place-items:center;width:112px;height:112px;border-radius:50%;background:conic-gradient(var(--accent) calc(var(--pct) * 1%),rgba(255,255,255,.1) 0)}
.tp-ring::before{content:"";position:absolute;inset:10px;border-radius:50%;background:var(--night)}
.tp-ring b,.tp-ring em{position:relative}
.tp-ring b{font-size:32px;font-weight:600;letter-spacing:-.04em;line-height:1}
.tp-ring em{position:absolute;bottom:30px;font-style:normal;font:500 11px var(--mono);color:#8a8e99}
.tp-ring b{margin-top:-12px}
.tp-lbl{font:500 10.5px var(--mono);text-transform:uppercase;letter-spacing:.05em;color:#8a8e99;text-align:center}
.tp-week{display:grid;gap:7px}
.tp-ev{position:relative;display:grid;grid-template-columns:34px 1fr auto;align-items:center;gap:8px;padding:9px 12px 9px 14px;border-radius:12px;color:#fff;background:rgba(255,255,255,.05);box-shadow:inset 0 0 0 1px var(--night-line);font-size:12.5px;overflow:hidden}
.tp-ev::before{content:"";position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:0 3px 3px 0;background:var(--accent)}
.tp-ev.ev-private::before{background:#6f9bff}.tp-ev.ev-mobile::before{background:#4fd393}.tp-ev.ev-course::before{background:#a48cff}
.tp-ev small{font:500 10px var(--mono);text-transform:uppercase;color:#7e828d}
.tp-ev b{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tp-ev em{font-style:normal;font:500 10.5px var(--mono);color:#a7abb5;white-space:nowrap}
.tp-ev.full em{color:#ff8a8a}
.tp-ev.dim,.tp-ev.full{opacity:1;background:rgba(255,255,255,.05)}
.tp-card{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:16px;background:#fff;color:var(--ink)}
.tp-card b{display:block;font-size:13.5px;letter-spacing:-.01em}
.tp-card small{font-size:11.5px;color:var(--muted)}
.tp-dep{margin-left:auto;font:500 11px var(--mono);text-transform:uppercase;color:var(--accent-ink);background:var(--accent-soft);padding:5px 9px;border-radius:999px;white-space:nowrap}
.tp-go{display:inline-flex;align-items:center;gap:8px;font-size:14px;font-weight:500;color:#fff}
.tp-go i{font-style:normal;display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:var(--btn-bg);transition:transform .3s var(--ease)}
.tp:hover .tp-go i{transform:translateX(4px)}
@media (max-width:1000px){
  .trades{grid-template-columns:1fr}
  .tr-preview{display:none}
  .tr-res{display:none}
  .tr-item{grid-template-columns:40px 1fr 20px}
  .tr-go{opacity:1;transform:none}
}

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
.plan.featured.sp::after{background:radial-gradient(380px circle at var(--mx,50%) var(--my,50%),rgba(255,138,76,.18),transparent 60%)}
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
  .plans,.faq-wrap,.tour,.calc{grid-template-columns:1fr}
  .faq-wrap{gap:24px}
  .tour{gap:0}
  .tvis{display:none}
  .t-rail{padding:0}
  .t-line{top:22px;bottom:22px}
  .tstep{min-height:0;opacity:1;padding:20px 0;align-items:start}
  .inline-scene{display:grid;place-items:center;grid-column:1/-1;margin-top:18px;padding:22px 14px;border-radius:24px;background:linear-gradient(160deg,#fff8f2,#f3f1ee);box-shadow:0 0 0 1px var(--line);min-height:340px;position:relative;overflow:hidden}
  .inline-scene .scene{position:relative;inset:auto;opacity:1;transform:none;filter:none;padding:0}
  .inline-scene .ig-phone{height:430px}
  .footer-grid{grid-template-columns:1fr 1fr}
  .footer-brand{grid-column:1/-1}
  .app{grid-template-columns:1fr}
  .app-side{display:none}
  .wk{grid-template-columns:repeat(3,1fr)}
  .wk .dy:nth-child(n+4){display:none}
  .toasts{display:none}
  .phone{position:relative;left:auto;bottom:auto;margin:-60px auto 0;animation:none}
  .cmp-wrap::before{left:-6px;right:-6px;top:auto;bottom:-14px;height:88px;border-radius:24px}
  .cmp-wrap::after{display:none}
  .cmp colgroup{display:none}
  .cmp thead{display:none}
  .cmp,.cmp tbody,.cmp tfoot,.cmp tr,.cmp th,.cmp td{display:block;width:100%}
  .cmp tbody tr{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--night-line)}
  .cmp tbody tr:first-child{border-top:0}
  .cmp tbody th{grid-column:1/-1;padding-bottom:4px}
  .cmp tbody th,.cmp tbody td,.cmp tfoot th,.cmp tfoot td{border-top:0!important}
  .cmp td::before{content:attr(data-label);display:block;font:500 10.5px var(--mono);text-transform:uppercase;letter-spacing:.06em;color:#6b6f7a;margin-bottom:6px}
  .cmp tbody .us{background:rgba(239,90,36,.08);border-radius:14px}
  .cmp tfoot tr{display:block}
  .cmp tfoot th,.cmp tfoot .them{display:none}
  .cmp tfoot td::before{display:none}
  .cmp tfoot .us{padding:18px 4px 4px;background:transparent}
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
