/* ===== شريط التنقل ===== */
document.addEventListener('DOMContentLoaded', () => {
  const nav = $('#navbar');
  const toggle = $('#navToggle');
  const links = $('#navLinks');
  const dot = $('#connDot');
  const text = $('#connText');

  // ظل عند التمرير
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 30);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // قائمة الجوال
  toggle.addEventListener('click', () => {
    const open = links.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  $$('a', links).forEach(a => a.addEventListener('click', () => {
    links.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  }));

  // تمييز الصفحة الحالية في قائمة التنقل
  const page = document.body.dataset.page;
  $$('a[data-link]', links).forEach(a => {
    const active = a.dataset.link === page;
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  // حالة الاتصال
  window.addEventListener('db-status', e => {
    dot.className = 'conn-dot ' + (e.detail ? 'on' : 'off');
    text.textContent = e.detail ? 'متصل بـ Firebase' : 'انقطع الاتصال';
  });
});
