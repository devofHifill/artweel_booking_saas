/**
 * The landing page's behaviour, for the 2026-11-20 "premium light" redesign.
 *
 * Kept as a TypeScript string rather than a file on disk for one reason: the
 * production image copies `dist`, and a stray .js under src/ would only reach it
 * by way of a COPY line that exists for an unrelated reason (seeding). A
 * string compiles like everything else and cannot go missing.
 *
 * Behaviour only. Every word is server-rendered, and the page reads fine with
 * this script blocked: `.rv` elements are only hidden once the script has put
 * `js` on <html>, the FAQ is native <details>, and the trade switcher's data is
 * in <template> elements rather than in here.
 *
 * Because this is a template literal on the TypeScript side, it must not
 * contain backticks, "${" or backslash escapes. Keep it to plain ES5.
 */
export const LANDING_JS = `
(function(){
  var doc=document.documentElement;
  doc.classList.add('js');
  var reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  function $(id){return document.getElementById(id)}
  function each(sel,fn){Array.prototype.forEach.call(document.querySelectorAll(sel),fn)}

  /* headline: word-by-word reveal, last word in the serif accent */
  var h1=document.querySelector('.hero h1');
  if(h1){
    var words=h1.textContent.trim().split(' ');
    h1.setAttribute('aria-label',h1.textContent.trim());
    h1.textContent='';
    words.forEach(function(w,i){
      var m=document.createElement('span');m.className='wm';m.setAttribute('aria-hidden','true');
      var s=document.createElement('span');
      s.className='w'+(i===words.length-1?' serif':'');
      s.textContent=w;
      s.style.transitionDelay=(i*65)+'ms';
      m.appendChild(s);h1.appendChild(m);
      if(i<words.length-1)h1.appendChild(document.createTextNode(' '));
    });
    /* open the masks once the last word has actually landed. Keyed to the
       transition, not a timer: a throttled tab can run timers ahead of the
       animation, and an early open lets rising words spill over the text. */
    var lastW=h1.querySelectorAll('.w');lastW=lastW[lastW.length-1];
    var settle=function(){h1.classList.add('settled')};
    if(reduce||!lastW){settle()}else{lastW.addEventListener('transitionend',function(e){if(e.propertyName==='transform')settle()});setTimeout(settle,6000)}
    /* hand-drawn underline under the accent word */
    var acc=h1.querySelector('.serif');
    if(acc){
      var ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),path=document.createElementNS(ns,'path');
      svg.setAttribute('class','uline');svg.setAttribute('viewBox','0 0 200 20');svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('aria-hidden','true');
      path.setAttribute('d','M3 14 C 40 6, 90 4, 130 8 S 185 13, 197 7');
      svg.appendChild(path);acc.appendChild(svg);
    }
    setTimeout(function(){h1.classList.add('go')},reduce?0:120);
  }

  /* announcement badge: the feature names take turns sliding up */
  var bt=document.querySelector('.badge-txt[data-rotate]');
  if(bt&&!reduce){
    var names=bt.getAttribute('data-rotate').split('|'),full=bt.textContent;
    var sr=document.createElement('span');sr.className='sr-only';sr.textContent=full;
    var rot=document.createElement('span');rot.className='rot';rot.setAttribute('aria-hidden','true');
    var spans=names.map(function(n,i){var s=document.createElement('span');s.textContent=n;if(i===0)s.className='on';rot.appendChild(s);return s});
    bt.textContent='';bt.appendChild(sr);bt.appendChild(rot);
    var ri=0;
    var fit=function(){rot.style.width=Math.ceil(spans[ri].getBoundingClientRect().width)+'px'};
    fit();
    if(document.fonts&&document.fonts.ready)document.fonts.ready.then(fit);
    setInterval(function(){
      if(document.hidden)return;
      var prev=spans[ri];ri=(ri+1)%spans.length;
      prev.className='out';spans[ri].className='on';fit();
      setTimeout(function(){if(prev.className==='out')prev.className=''},520);
    },2600);
  }

  /* reveals. The hero is revealed on load, never on scroll: on a short
     laptop screen its buttons sit below the fold and must not wait. */
  each('.hero .rv',function(el){setTimeout(function(){el.classList.add('in')},30)});
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{rootMargin:'0px 0px -10% 0px'});
    each('.rv',function(el){io.observe(el)});
  }else{each('.rv',function(el){el.classList.add('in')})}

  /* header, stage flatten, nav indicator, scrollspy */
  var hdr=$('siteHeader'),stage=$('stage'),ind=$('navInd'),nav=document.querySelector('.nav-desktop');
  var links=nav?Array.prototype.slice.call(nav.querySelectorAll('a[data-spy]')):[];
  var secs=links.map(function(a){return document.querySelector(a.getAttribute('href'))});
  function spy(){
    var y=window.scrollY+140,c=-1;
    secs.forEach(function(s,i){if(!s)return;var r=s.getBoundingClientRect();if(r.top+window.scrollY<=y&&r.bottom+window.scrollY>y)c=i});
    links.forEach(function(a,i){a.classList.toggle('on',i===c)});
    if(ind){var a=links[c];if(a){ind.style.opacity=1;ind.style.left=a.offsetLeft+'px';ind.style.width=a.offsetWidth+'px'}else{ind.style.opacity=0}}
  }
  var tog=$('navToggle'),menu=$('mobileMenu');
  var fine=window.matchMedia&&matchMedia('(hover: hover) and (pointer: fine)').matches;
  var readBar=$('readBar'),lastY=window.scrollY,ticking=false;
  function anyMenuOpen(){return !!document.querySelector('.nav-item.open')||(menu&&!menu.hidden)}
  function onScroll(){
    var y=window.scrollY;
    if(hdr){
      hdr.classList.toggle('stuck',y>10);
      /* slide away while reading down, back on the first scroll up */
      if(!anyMenuOpen()){
        if(y>480&&y-lastY>6)hdr.classList.add('hide');
        else if(lastY-y>6||y<200)hdr.classList.remove('hide');
      }
      /* dark glass over the dark panels */
      var bar=hdr.querySelector('.header-bar'),r=bar.getBoundingClientRect(),under=false;
      var pts=document.elementsFromPoint?document.elementsFromPoint(r.left+r.width/2,r.bottom+2):[];
      for(var i=0;i<pts.length;i++){if(!hdr.contains(pts[i])){under=!!(pts[i].closest&&pts[i].closest('.dark,.cta'));break}}
      hdr.classList.toggle('dark-under',under);
    }
    if(readBar){var max=document.documentElement.scrollHeight-window.innerHeight;readBar.style.setProperty('--p',max>0?Math.min(1,y/max).toFixed(4):'0')}
    if(stage&&y>120)stage.classList.add('flat');
    spy();
    lastY=y;ticking=false;
  }
  window.addEventListener('scroll',function(){if(!ticking){ticking=true;requestAnimationFrame(onScroll)}},{passive:true});
  window.addEventListener('resize',spy);

  /* mega-menus: hover intent on a mouse, click and keyboard everywhere */
  var items=Array.prototype.slice.call(document.querySelectorAll('[data-menu]'));
  function closeAll(except){items.forEach(function(it){if(it!==except){it.classList.remove('open');it.querySelector('.nav-trig').setAttribute('aria-expanded','false')}})}
  function openMenu(it){closeAll(it);it.classList.add('open');it.querySelector('.nav-trig').setAttribute('aria-expanded','true');if(hdr)hdr.classList.remove('hide')}
  items.forEach(function(it){
    var trig=it.querySelector('.nav-trig'),t=null;
    trig.addEventListener('click',function(){if(it.classList.contains('open')){closeAll()}else{openMenu(it)}});
    if(fine){
      it.addEventListener('pointerenter',function(){clearTimeout(t);t=setTimeout(function(){openMenu(it)},70)});
      it.addEventListener('pointerleave',function(){clearTimeout(t);t=setTimeout(function(){it.classList.remove('open');trig.setAttribute('aria-expanded','false')},200)});
    }
    it.addEventListener('keydown',function(e){
      if(e.key==='Escape'&&it.classList.contains('open')){closeAll();trig.focus()}
      if(e.key==='ArrowDown'&&document.activeElement===trig){e.preventDefault();openMenu(it);var f=it.querySelector('.mega a');if(f)f.focus()}
    });
    it.addEventListener('focusout',function(e){if(!it.contains(e.relatedTarget)){it.classList.remove('open');trig.setAttribute('aria-expanded','false')}});
    Array.prototype.forEach.call(it.querySelectorAll('.mega a'),function(a){a.addEventListener('click',function(){closeAll()})});
  });
  document.addEventListener('click',function(e){if(!e.target.closest||!e.target.closest('[data-menu]'))closeAll()});

  /* mobile sheet */
  function setMobile(open){
    if(!menu)return;
    tog.setAttribute('aria-expanded',String(open));tog.setAttribute('aria-label',open?'Close menu':'Open menu');
    if(hdr)hdr.classList.toggle('menu-open',open);
    document.body.style.overflow=open?'hidden':'';
    if(open){
      menu.hidden=false;
      Array.prototype.forEach.call(menu.querySelectorAll('.mm-links a,.mm-trades a'),function(a,i){a.style.transitionDelay=(reduce?0:40+i*30)+'ms'});
      void menu.offsetWidth;
      menu.classList.add('shown');
    }else{menu.classList.remove('shown');menu.hidden=true}
  }
  if(tog&&menu){
    tog.addEventListener('click',function(){setMobile(menu.hidden)});
    each('#mobileMenu a',function(a){a.addEventListener('click',function(){setMobile(false)})});
    document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!menu.hidden){setMobile(false);tog.focus()}});
    window.addEventListener('resize',function(){if(window.innerWidth>900&&!menu.hidden)setMobile(false)});
  }
  onScroll();

  /* hero spotlight */
  var hero=$('hero'),spot=$('spot');
  if(hero&&spot&&!reduce){hero.addEventListener('pointermove',function(e){var r=hero.getBoundingClientRect();spot.style.left=(e.clientX-r.left)+'px';spot.style.top=(e.clientY-r.top)+'px'})}

  /* card spotlight */
  each('.tile,.tr,.plan,.calc-in,.chipx',function(el){
    el.classList.add('sp');
    el.addEventListener('pointermove',function(e){var r=el.getBoundingClientRect();el.style.setProperty('--mx',(e.clientX-r.left)+'px');el.style.setProperty('--my',(e.clientY-r.top)+'px')});
  });

  /* magnetic primary buttons: a few pixels of pull toward a mouse pointer */
  if(fine&&!reduce){
    each('[data-magnet]',function(b){
      b.addEventListener('pointermove',function(e){
        var r=b.getBoundingClientRect();
        var x=(e.clientX-r.left-r.width/2)/r.width,y=(e.clientY-r.top-r.height/2)/r.height;
        b.style.setProperty('--mx',(x*8).toFixed(1)+'px');b.style.setProperty('--my',(y*6).toFixed(1)+'px');
      });
      b.addEventListener('pointerleave',function(){b.style.setProperty('--mx','0px');b.style.setProperty('--my','0px')});
    });
  }

  /* segmented controls: one dark pill that slides to the pressed button */
  function segInit(group){
    var ind=document.createElement('span');ind.className='seg-ind';ind.setAttribute('aria-hidden','true');
    group.insertBefore(ind,group.firstChild);group.classList.add('seg-ctl');
    function place(){
      var on=group.querySelector('button[aria-pressed=true]');if(!on)return;
      ind.style.left=on.offsetLeft+'px';ind.style.width=on.offsetWidth+'px';
      group.classList.add('ready');
    }
    place();
    new MutationObserver(place).observe(group,{subtree:true,attributes:true,attributeFilter:['aria-pressed']});
    window.addEventListener('resize',place);
    group.addEventListener('scroll',place,{passive:true});
  }
  each('.switch,.rates',segInit);

  /* toasts */
  each('.toast',function(t,i){setTimeout(function(){t.classList.add('show')},reduce?0:900+i*700)});

  /* trade switcher (home only): swaps the mock-up from <template> data */
  var tpls={};each('template[data-trade]',function(t){tpls[t.getAttribute('data-trade')]=t});
  var order=Object.keys(tpls),cur=order[0],auto=true,timer=null;
  function applyTrade(k){
    var t=tpls[k];if(!t)return;
    var src=t.content||t;
    var map={wk:'.t-wk',gaugeLabel:'.t-label',gaugeNum:'.t-num',cells:'.t-cells',studio:'.t-studio',av:'.t-av',studio2:'.t-studio',av2:'.t-av',toastTitle:'.t-toast'};
    Object.keys(map).forEach(function(id){var el=$(id),from=src.querySelector(map[id]);if(el&&from)el.innerHTML=from.innerHTML});
  }
  /* cross-fade: blur out, swap, blur in */
  function showTrade(k,instant){
    if(!tpls[k])return;
    each('.switch button',function(b){b.setAttribute('aria-pressed',String(b.getAttribute('data-trade')===k))});
    cur=k;
    if(instant||reduce||!stage){applyTrade(k);return}
    stage.classList.add('swapping');
    clearTimeout(stage._swap);
    stage._swap=setTimeout(function(){applyTrade(k);setTimeout(function(){stage.classList.remove('swapping')},30)},280);
  }
  var sw=document.querySelector('.switch'),swRow=document.querySelector('.switch-row');
  function stopAuto(){auto=false;if(timer)clearInterval(timer);if(swRow)swRow.classList.remove('autoplay');each('.switch button',function(b){b.style.removeProperty('--prog')})}
  each('.switch button',function(b){b.addEventListener('click',function(){stopAuto();showTrade(b.getAttribute('data-trade'))})});
  /* arrow keys move between trades, like a tab list */
  if(sw)sw.addEventListener('keydown',function(e){
    if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft')return;
    e.preventDefault();
    var i=order.indexOf(cur)+(e.key==='ArrowRight'?1:-1);i=(i+order.length)%order.length;
    stopAuto();showTrade(order[i]);
    var nb=sw.querySelector('button[data-trade="'+order[i]+'"]');if(nb)nb.focus();
  });
  if(cur)showTrade(cur,true);

  /* the product window tilts gently toward the mouse, with a moving sheen */
  if(stage&&fine&&!reduce){
    stage.addEventListener('pointermove',function(e){
      if(!stage.classList.contains('flat'))return;
      var r=stage.getBoundingClientRect(),x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;
      stage.classList.add('tilting');
      stage.style.setProperty('--ry',(x*5).toFixed(2)+'deg');stage.style.setProperty('--rx',(-y*4).toFixed(2)+'deg');
      stage.style.setProperty('--px',(x*14).toFixed(1)+'px');stage.style.setProperty('--py',(y*10).toFixed(1)+'px');
      stage.style.setProperty('--gx',((x+.5)*100).toFixed(1)+'%');stage.style.setProperty('--gy',((y+.5)*100).toFixed(1)+'%');
    });
    stage.addEventListener('pointerleave',function(){
      stage.classList.remove('tilting');
      ['--rx','--ry','--px','--py'].forEach(function(v){stage.style.setProperty(v,v.indexOf('p')===2?'0px':'0deg')});
    });
  }
  /* autoplay: a thin bar fills inside the active trade, then it moves on.
     Hovering the switcher or the preview pauses it; choosing a trade ends it. */
  if(order.length>1&&!reduce&&sw){
    var prog=0,held=false,STEP=100,DUR=4600;
    if(swRow)swRow.classList.add('autoplay');
    [swRow,stage].forEach(function(el){if(!el)return;el.addEventListener('pointerenter',function(){held=true});el.addEventListener('pointerleave',function(){held=false})});
    timer=setInterval(function(){
      if(!auto||document.hidden||held)return;
      prog+=STEP/DUR;
      var on=sw.querySelector('button[aria-pressed=true]');
      if(prog>=1){prog=0;if(on)on.style.removeProperty('--prog');showTrade(order[(order.indexOf(cur)+1)%order.length]);return}
      if(on)on.style.setProperty('--prog',prog.toFixed(3));
    },STEP);
  }

  /* capacity tile: places filling and freeing */
  var racks=$('racks'),seats=$('seatsLeft');
  if(racks&&seats&&!reduce){
    var cells=Array.prototype.slice.call(racks.children);
    setInterval(function(){
      if(document.hidden)return;
      var free=cells.filter(function(c){return !c.classList.contains('on')});
      if(free.length>1&&Math.random()<.6){free[0].classList.add('on')}
      else{var on=cells.filter(function(c){return c.classList.contains('on')});if(on.length)on[Math.floor(Math.random()*on.length)].classList.remove('on')}
      seats.textContent=String(cells.filter(function(c){return !c.classList.contains('on')}).length);
    },2200);
  }

  /* how it works: rail, nodes, story bars and scenes */
  var tourEl=$('tour'),tvis=document.querySelector('.tvis'),tvN=$('tvN');
  var steps=Array.prototype.slice.call(document.querySelectorAll('.tstep'));
  var scenes=Array.prototype.slice.call(document.querySelectorAll('.tvis .scene'));
  var bars=Array.prototype.slice.call(document.querySelectorAll('.tv-bars b'));
  /* phones: each step carries its own copy of its scene, played when the step scrolls in */
  steps.forEach(function(st,i){
    if(!scenes[i])return;
    var box=document.createElement('div');box.className='inline-scene';box.setAttribute('aria-hidden','true');
    var sc=scenes[i].cloneNode(true);sc.classList.remove('act');box.appendChild(sc);st.appendChild(box);
  });
  function countUp(el){
    if(!el||el._done)return;el._done=true;
    var to=+el.getAttribute('data-to')||0,t0=null;
    if(reduce){el.textContent='$'+to.toFixed(2);return}
    function f(ts){if(!t0)t0=ts;var p=Math.min(1,(ts-t0)/1200),e=1-Math.pow(1-p,3);el.textContent='$'+(to*e).toFixed(2);if(p<1)requestAnimationFrame(f)}
    el.textContent='$0.00';requestAnimationFrame(f);
    setTimeout(function(){el.textContent='$'+to.toFixed(2)},1600);
  }
  function setStep(n){
    steps.forEach(function(x,i){x.classList.toggle('act',i===n);x.classList.toggle('done',i<n)});
    scenes.forEach(function(x,i){x.classList.toggle('act',i===n)});
    bars.forEach(function(b,i){b.style.transform='scaleX('+(i<=n?1:0)+')'});
    if(tvis)tvis.setAttribute('data-at',String(n));
    if(tvN)tvN.textContent=String(n+1);
    if(n===2)countUp(document.querySelector('.tvis .payline b'));
  }
  if('IntersectionObserver' in window&&steps.length){
    var tio=new IntersectionObserver(function(es){es.forEach(function(e){if(!e.isIntersecting)return;setStep(+e.target.getAttribute('data-step'))})},{rootMargin:'-45% 0px -45% 0px'});
    steps.forEach(function(s){tio.observe(s)});
    var iio=new IntersectionObserver(function(es){es.forEach(function(e){if(!e.isIntersecting)return;e.target.classList.add('act');var pb=e.target.querySelector('.payline b');if(pb)countUp(pb);iio.unobserve(e.target)})},{rootMargin:'0px 0px -20% 0px'});
    Array.prototype.forEach.call(document.querySelectorAll('.inline-scene .scene'),function(sc){iio.observe(sc)});
  }else{steps.forEach(function(x){x.classList.add('act')})}
  setStep(0);
  /* the rail fills as you scroll from the first step to the last */
  if(tourEl&&steps.length>1){
    var railTick=false;
    var rail=function(){
      railTick=false;
      var a=steps[0].getBoundingClientRect(),z=steps[steps.length-1].getBoundingClientRect(),mid=window.innerHeight/2;
      var top=a.top+a.height/2,bot=z.top+z.height/2,p=(mid-top)/Math.max(1,bot-top);
      tourEl.style.setProperty('--rail',Math.max(0,Math.min(1,p)).toFixed(3));
    };
    window.addEventListener('scroll',function(){if(!railTick){railTick=true;requestAnimationFrame(rail)}},{passive:true});
    window.addEventListener('resize',rail);rail();
  }

  /* who it's for: hovering or focusing a trade swaps the preview */
  var trItems=Array.prototype.slice.call(document.querySelectorAll('.tr-item'));
  var tps=Array.prototype.slice.call(document.querySelectorAll('.tp'));
  function showTp(k){
    trItems.forEach(function(a){a.classList.toggle('on',a.getAttribute('data-t')===k)});
    tps.forEach(function(p){p.classList.toggle('on',p.getAttribute('data-t')===k)});
  }
  trItems.forEach(function(a){
    var k=a.getAttribute('data-t');
    a.addEventListener('pointerenter',function(){showTp(k)});
    a.addEventListener('focus',function(){showTp(k)});
  });

  /* commission calculator: same maths as calcChart() in landing.ts */
  var revIn=$('revIn');
  if(revIn){
    var pressedPlan=document.querySelector('.plans-pick button[aria-pressed=true]');
    var rate=.05,planMonth=+revIn.getAttribute('data-plan')||0,planName=pressedPlan?pressedPlan.getAttribute('data-name'):'Studio';
    var min=+revIn.min,max=+revIn.max;
    var C={x0:16,x1:324,y0:128,y1:14};
    var fmt=function(n){return '$'+Math.round(n).toLocaleString('en-US')};
    var keepEl=$('keep'),shown=null,anim=null;
    function tweenKeep(to){
      if(reduce||shown===null){shown=to;keepEl.textContent=fmt(to);return}
      var from=shown,t0=null;cancelAnimationFrame(anim);
      (function f(ts){if(!t0)t0=ts;var p=Math.min(1,(ts-t0)/450),e=1-Math.pow(1-p,3);shown=from+(to-from)*e;keepEl.textContent=fmt(shown);if(p<1)anim=requestAnimationFrame(f)})(performance.now());
      setTimeout(function(){shown=to;keepEl.textContent=fmt(to)},600);
    }
    function pts(monthly,top){var a=[];for(var m=0;m<=12;m++){var x=C.x0+(C.x1-C.x0)*m/12,y=C.y0-(C.y0-C.y1)*(monthly*m)/top;a.push(x.toFixed(1)+','+y.toFixed(1))}return a}
    function calc(){
      var rev=+revIn.value,comM=rev*rate,keep=Math.max(0,(comM-planMonth)*12),top=Math.max(comM,planMonth)*12||1;
      revIn.style.setProperty('--p',((rev-min)/(max-min)*100)+'%');
      revIn.setAttribute('aria-valuetext',fmt(rev)+' a month');
      $('revOut').textContent=fmt(rev);
      tweenKeep(keep);
      /* below the break-even point the flat plan costs more: say so */
      var pn=planName,rp=Math.round(rate*100)+'%';
      $('keepSub').innerHTML=comM>planMonth
        ?'more than with a <span>'+rp+'</span> commission tool, on the <span>'+pn+'</span> plan.'
        :'At this revenue a '+rp+' cut costs less than the '+pn+' plan. The flat price wins from <span>'+fmt(rate>0?planMonth/rate:0)+'</span> a month.';
      $('comMonth').textContent=fmt(comM);$('planMonth').textContent=fmt(planMonth);
      $('ratio').textContent=(planMonth>0?comM/planMonth:0).toFixed(1);
      var c=pts(comM,top),f=pts(planMonth,top);
      $('chCom').setAttribute('d','M'+c.join(' L'));
      $('chFlat').setAttribute('d','M'+f.join(' L'));
      $('chGap').setAttribute('d','M'+c.join(' L')+' L'+f.slice().reverse().join(' L')+' Z');
      var ce=c[12].split(','),fe=f[12].split(',');
      $('chComDot').setAttribute('cx',ce[0]);$('chComDot').setAttribute('cy',ce[1]);
      $('chFlatDot').setAttribute('cx',fe[0]);$('chFlatDot').setAttribute('cy',fe[1]);
      each('.presets button',function(b){b.setAttribute('aria-pressed',String(+b.getAttribute('data-rev')===rev))});
    }
    revIn.addEventListener('input',calc);
    each('.presets button',function(b){b.addEventListener('click',function(){revIn.value=b.getAttribute('data-rev');calc()})});
    each('.rates button[data-rate]',function(b){b.addEventListener('click',function(){rate=+b.getAttribute('data-rate');each('.rates button[data-rate]',function(o){o.setAttribute('aria-pressed',String(o===b))});calc()})});
    each('.plans-pick button',function(b){b.addEventListener('click',function(){planMonth=+b.getAttribute('data-plan');planName=b.getAttribute('data-name');each('.plans-pick button',function(o){o.setAttribute('aria-pressed',String(o===b))});calc()})});
    calc();
  }
})();
`;
