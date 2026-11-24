/* ===== الفوتر: بيانات التواصل والخريطة (تُقرأ من CFG.CONTACT في config.js) ===== */
document.addEventListener('DOMContentLoaded', () => {
  const C = CFG.CONTACT || {};
  const safeUrl = u => /^https?:\/\//i.test(String(u || '')) ? u : '';

  // أيقونات التواصل الاجتماعي
  const links = (C.social || []).filter(s => safeUrl(s.url));
  $('#fSocial').innerHTML = links.length
    ? links.map(s => `
        <li><a href="${U.esc(s.url)}" target="_blank" rel="noopener noreferrer" data-type="${U.esc(s.type)}"
               aria-label="${U.esc(s.label || s.type)}" title="${U.esc(s.label || s.type)}">
          <svg class="i"><use href="#s-${U.esc(s.type)}"/></svg></a></li>`).join('')
    : '<li style="color:#7fb1c6">أضف روابط الصفحات من ملف js/config.js</li>';

  // أرقام الدعم الفني
  $('#fPhones').innerHTML = (C.phones || []).map(p => `
    <li><svg class="i"><use href="#i-phone"/></svg>
      <div><span>${U.esc(p.label)}</span>
      <a class="num" href="tel:${U.esc(String(p.number).replace(/[^\d+]/g, ''))}">${U.esc(p.number)}</a></div></li>`).join('');

  // الإيميل والساعات والعنوان
  const mail = $('#fEmail');
  mail.textContent = C.email || '—';
  mail.href = C.email ? 'mailto:' + C.email : '#';
  $('#fHours').textContent = C.hours || '—';
  $('#fAddress').textContent = C.address || '—';

  // الخريطة (Google Maps بدون مفتاح API)
  const lat = Number(C.lat), lng = Number(C.lng), z = Number(C.zoom) || 15;
  if (isFinite(lat) && isFinite(lng)) {
    const q = encodeURIComponent(lat + ',' + lng);
    $('#fMap').src = `https://maps.google.com/maps?q=${q}&z=${z}&output=embed&hl=ar`;
    $('#fMapOpen').href = `https://www.google.com/maps/search/?api=1&query=${q}`;
    $('#fMapRoute').href = `https://www.google.com/maps/dir/?api=1&destination=${q}`;
  }

  $('#fYear').textContent = new Date().getFullYear();
});
