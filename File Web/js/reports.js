/* ===== التقارير: عرض، طباعة، تصدير CSV ===== */
(function () {
  const DAY = 864e5;
  const STATUS = { sent: 'أُرسل للتنفيذ', filling: 'جاري التعبئة', completed: 'مكتمل', cancelled: 'ملغي' };
  let preset = 'today';
  let lastRows = [];

  const orderTime = o => o.completed_at || o.started_at || o.created_at || 0;

  function getRange() {
    const sod = U.startOfDay(Date.now());
    if (preset === 'yesterday') return [sod - DAY, sod - 1];
    if (preset === '7d') return [sod - 6 * DAY, Date.now()];
    if (preset === '30d') return [sod - 29 * DAY, Date.now()];
    if (preset === 'all') return [0, Date.now() + DAY];
    if (preset === 'custom') {
      const f = new Date($('#rpFrom').value).getTime(), t = new Date($('#rpTo').value).getTime();
      return [isFinite(f) ? f : sod, isFinite(t) ? t : Date.now()];
    }
    return [sod, Date.now()];
  }

  function fillPartnerOptions() {
    const sel = $('#rpPartner'), cur = sel.value;
    const list = Store.get('partners', []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));
    sel.innerHTML = '<option value="">كل الشركات والبيع المباشر</option><option value="__direct">البيع المباشر فقط (بدون شراكة)</option>' +
      list.map(p => `<option value="${p.id}">${U.esc(p.name)}</option>`).join('');
    if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
  }

  function selected() {
    const [from, to] = getRange();
    const pid = $('#rpPartner').value;
    const rows = Store.get('orders', [])
      .filter(o => o.status === 'completed' && Number(o.filled_liters) > 0)
      .filter(o => { const t = orderTime(o); return t >= from && t <= to; })
      .filter(o => !pid || (pid === '__direct' ? !o.partner_id : o.partner_id === pid))
      .sort((a, b) => orderTime(a) - orderTime(b));
    return { from, to, rows, pid };
  }

  function render() {
    const { from, to, rows, pid } = selected();
    const cap = Tank.capacity();
    const total = rows.reduce((s, o) => s + (Number(o.filled_liters) || 0), 0);
    const t = Store.get('telemetry', {});
    const lvl = Number(t.main_tank_level);
    const hasLvl = t.main_tank_level !== undefined && t.main_tank_level !== null && isFinite(lvl);
    lastRows = rows;

    const pName = pid === '__direct' ? 'البيع المباشر' : (pid ? (Store.get('partners', []).find(p => p.id === pid) || {}).name : 'كل الشركات');
    $('#rpMeta').textContent = `الفترة: ${preset === 'all' ? 'كل السجلات' : U.fmtDateTime(from) + ' إلى ' + U.fmtDateTime(to)} — ${pName || '—'}`;
    $('#rpPrinted').textContent = U.fmtDateTime(Date.now());
    const contact = CFG.CONTACT || {};
    $('#rpContact').textContent = contact.email && !contact.email.endsWith('@example.com') ? contact.email : '';

    $('#rpKOps').textContent = U.num(rows.length);
    $('#rpKLiters').textContent = U.num(total);
    $('#rpKM3').textContent = U.num(total / 1000, 2);
    $('#rpKPct').textContent = U.num(total / cap * 100, 2) + '%';
    $('#rpKTank').textContent = hasLvl ? U.num(lvl, 1) + '% (' + U.num(Tank.m3(lvl), 1) + ' كوب)' : '—';
    $('#rpKValue').textContent = U.num(total / 1000 * CFG.PRICE_PER_M3, 2);

    $('#rpBody').innerHTML = rows.length ? rows.map((o, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${U.fmtDateTime(orderTime(o))}</td>
        <td dir="ltr" style="text-align:right">${U.esc(o.plate)}</td>
        <td>${U.esc(o.driver)}</td>
        <td class="wrap">${U.esc(o.partner_name || o.sponsor)}</td>
        <td>${U.num(o.filled_liters)}${o.estimated ? ' *' : ''}</td>
        <td>${U.num((Number(o.filled_liters) || 0) / 1000, 2)}</td>
        <td>${STATUS[o.status] || '—'}</td>
      </tr>`).join('') : '<tr><td class="empty" colspan="8">لا توجد عمليات في الفترة المختارة.</td></tr>';

    $('#rpFoot').innerHTML = rows.length
      ? `<tr><td colspan="5">الإجمالي</td><td>${U.num(total)}</td><td>${U.num(total / 1000, 2)}</td><td></td></tr>` : '';

    // أرصدة الحصص (كل الشركات أو الشركة المختارة)
    const orders = Store.get('orders', []);
    const plist = Store.get('partners', []).filter(p => !pid || p.id === pid);
    $('#rpPartnersBody').innerHTML = plist.length ? plist.map(p => {
      const paid = p.status === 'paid';
      return `<tr>
        <td>${U.esc(p.name)}</td>
        <td>${paid ? 'مفعّلة' : 'بانتظار التحويل'}</td>
        <td>${paid ? U.num(Partners.allocated(p)) : '—'}</td>
        <td>${paid ? U.num(Partners.used(p, orders)) : '—'}</td>
        <td>${paid ? '<b>' + U.num(Partners.remaining(p, orders)) + '</b>' : '—'}</td>
        <td>${paid ? U.num(Partners.daysLeftEq(p, orders), 1) + ' من ' + p.days : '—'}</td>
        <td class="wrap" dir="ltr" style="text-align:right">${U.esc(Partners.plates(p).join(' ، ') || '—')}</td>
      </tr>`;
    }).join('') : (pid === '__direct' ? '<tr><td class="empty" colspan="7">لا ينطبق على البيع المباشر.</td></tr>' : '<tr><td class="empty" colspan="7">لا توجد شراكات.</td></tr>');
  }

  function exportCSV() {
    const rows = [['#', 'التاريخ', 'المركبة', 'السائق', 'الشركة / الجهة', 'المعبأ (لتر)', 'المعبأ (كوب)', 'الحالة']];
    lastRows.forEach((o, i) => rows.push([i + 1, U.fmtDateTime(orderTime(o)), o.plate, o.driver, o.partner_name || o.sponsor,
      Number(o.filled_liters) || 0, ((Number(o.filled_liters) || 0) / 1000).toFixed(2), STATUS[o.status] || '']));
    U.downloadCSV('water-report.csv', rows);
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('reports')) return;
    const now = Date.now();
    $('#rpFrom').value = U.toInputDT(U.startOfDay(now));
    $('#rpTo').value = U.toInputDT(now);

    $('#rpPresets').addEventListener('click', e => {
      const b = e.target.closest('[data-preset]');
      if (!b) return;
      preset = b.dataset.preset;
      $$('#rpPresets .chip').forEach(c => c.classList.toggle('active', c === b));
      $('#rpCustom').hidden = preset !== 'custom';
      render();
    });
    $('#rpApply').addEventListener('click', render);
    $('#rpPartner').addEventListener('change', render);
    const preview = $('#rpPreview');
    const hidePreview = () => { preview.hidden = true; $('#rpShow').setAttribute('aria-expanded', 'false'); };
    $('#rpShow').setAttribute('aria-controls', 'rpPreview');
    $('#rpShow').setAttribute('aria-expanded', 'false');
    $('#rpShow').addEventListener('click', () => {
      render();
      preview.hidden = false;
      $('#rpShow').setAttribute('aria-expanded', 'true');
      preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('#rpClose').focus({ preventScroll: true });
    });
    $('#rpClose').addEventListener('click', () => { hidePreview(); $('#rpShow').focus(); });
    $('#rpPresets').addEventListener('click', e => { if (e.target.closest('[data-preset]')) hidePreview(); });
    $('#rpPartner').addEventListener('change', hidePreview);
    $('#rpFrom').addEventListener('change', hidePreview);
    $('#rpTo').addEventListener('change', hidePreview);
    $('#rpApply').addEventListener('click', hidePreview);
    let printing = false;
    window.addEventListener('beforeprint', () => { if (!printing) render(); printing = true; });
    window.addEventListener('afterprint', () => { printing = false; render(); });
    $('#rpPrint').addEventListener('click', () => { render(); window.print(); });
    $('#rpCsv').addEventListener('click', exportCSV);

    fillPartnerOptions();
    render();
    Store.on('partners', () => { if (!printing) { fillPartnerOptions(); render(); } });
    Store.on('orders', () => { if (!printing) render(); });
    Store.on('telemetry', () => { if (!printing) render(); });
  });
})();
