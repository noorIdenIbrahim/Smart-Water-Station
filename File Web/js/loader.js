/* ===== شاشة تحميل موحّدة ===== */
(function(){
  function ensure(){
    let el = document.getElementById('siteLoader');
    if(el) return el;
    el = document.createElement('div');
    el.id = 'siteLoader';
    el.className = 'site-loader';
    el.setAttribute('role','status');
    el.setAttribute('aria-live','polite');
    el.innerHTML = `
      <div class="loader-box">
        <div class="loader-logo-wrap">
          <span class="loader-ring"></span><span class="loader-pulse"></span>
          <img class="loader-logo" src="assets/water-station-logo.png" alt="Smart Water Station">
        </div>
        <div class="loader-title">SMART WATER STATION</div>
        <div class="loader-message" id="loaderMessage">جاري تحميل بيانات المحطة…</div>
      </div>`;
    document.body.appendChild(el);
    return el;
  }
  window.Loader = {
    show(msg){
      const el=ensure(), m=document.getElementById('loaderMessage');
      if(m) m.textContent=msg || 'جاري التحميل…';
      el.classList.remove('is-hidden');
    },
    hide(){ const el=ensure(); el.classList.add('is-hidden'); }
  };
  document.addEventListener('DOMContentLoaded',()=>{
    ensure();
    setTimeout(()=>Loader.hide(), 450);
    document.addEventListener('click',e=>{
      const a=e.target.closest('a[href]');
      if(!a || a.target==='_blank' || a.hasAttribute('download')) return;
      const href=a.getAttribute('href')||'';
      if(!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || /^https?:/i.test(href)) return;
      Loader.show('جاري الانتقال إلى الصفحة…');
    });
  });
  window.addEventListener('pageshow',()=>{ if(window.Loader) Loader.hide(); });
})();