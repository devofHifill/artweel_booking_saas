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
      var s=document.createElement('span');
      s.className='w'+(i===words.length-1?' serif':'');
      s.setAttribute('aria-hidden','true');
      s.textContent=w;
      s.style.transitionDelay=(i*70)+'ms';
      h1.appendChild(s);
      if(i<words.length-1)h1.appendChild(document.createTextNode(' '));
    });
    setTimeout(function(){h1.classList.add('go')},reduce?0:120);
  }

  /* reveals. The hero is revealed on load, never on scroll: on a short
     laptop screen its buttons sit below the fold and must not wait. */
  each('.hero .rv',function(el){requestAnimationFrame(function(){el.classList.add('in')})});
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
  function showTrade(k){
    var t=tpls[k];if(!t)return;
    var src=t.content||t;
    var map={wk:'.t-wk',gaugeLabel:'.t-label',gaugeNum:'.t-num',cells:'.t-cells',studio:'.t-studio',av:'.t-av',studio2:'.t-studio',av2:'.t-av',toastTitle:'.t-toast'};
    Object.keys(map).forEach(function(id){var el=$(id),from=src.querySelector(map[id]);if(el&&from)el.innerHTML=from.innerHTML});
    each('.switch button',function(b){b.setAttribute('aria-pressed',String(b.getAttribute('data-trade')===k))});
    cur=k;
  }
  each('.switch button',function(b){b.addEventListener('click',function(){auto=false;if(timer)clearInterval(timer);showTrade(b.getAttribute('data-trade'))})});
  if(cur)showTrade(cur);
  if(order.length>1&&!reduce){timer=setInterval(function(){if(!auto||document.hidden)return;showTrade(order[(order.indexOf(cur)+1)%order.length])},4200)}

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

  /* sticky tour */
  var steps=Array.prototype.slice.call(document.querySelectorAll('.tstep'));
  var scenes=Array.prototype.slice.call(document.querySelectorAll('.tvis .scene'));
  steps.forEach(function(st,i){
    if(!scenes[i])return;
    var box=document.createElement('div');box.className='inline-scene';box.setAttribute('aria-hidden','true');
    var sc=scenes[i].cloneNode(true);sc.classList.add('act');box.appendChild(sc);st.appendChild(box);
  });
  if('IntersectionObserver' in window&&steps.length){
    var tio=new IntersectionObserver(function(es){es.forEach(function(e){if(!e.isIntersecting)return;var s=+e.target.getAttribute('data-step');steps.forEach(function(x,i){x.classList.toggle('act',i===s)});scenes.forEach(function(x,i){x.classList.toggle('act',i===s)})})},{rootMargin:'-45% 0px -45% 0px'});
    steps.forEach(function(s){tio.observe(s)});
  }

  /* commission calculator */
  var revIn=$('revIn');
  if(revIn){
    var plan=+revIn.getAttribute('data-plan')||0,rate=.05;
    var min=+revIn.min,max=+revIn.max;
    var fmt=function(n){return '$'+Math.round(n).toLocaleString('en-US')};
    var calc=function(){
      var rev=+revIn.value,com=rev*rate*12,keep=Math.max(0,com-plan),top=Math.max(com,plan)||1;
      revIn.style.setProperty('--p',((rev-min)/(max-min)*100)+'%');
      revIn.setAttribute('aria-valuetext',fmt(rev)+' a month');
      $('revOut').textContent=fmt(rev);
      $('comYear').textContent=fmt(com);
      $('comBar').style.width=(com/top*100)+'%';
      $('planBar').style.width=(plan/top*100)+'%';
      $('keep').textContent=fmt(keep);
      $('rateTxt').textContent=Math.round(rate*100)+'%';
    };
    revIn.addEventListener('input',calc);
    each('.rates button',function(b){b.addEventListener('click',function(){rate=+b.getAttribute('data-rate');each('.rates button',function(o){o.setAttribute('aria-pressed',String(o===b))});calc()})});
    calc();
  }
})();
`;
