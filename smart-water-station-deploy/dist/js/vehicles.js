/* ===== تعبئة المركبات: الفحص + الإرسال + التقارير ===== */
(function () {
  const PATH = 'vehicle_orders';
  const STATUS = {
    sent: ['أُرسل للتنفيذ', 'info'],
    filling: ['جاري التعبئة', 'info pulse'],
    completed: ['مكتمل', 'good'],
    cancelled: ['ملغي', 'muted']
  };
  let donut = null;
  let search = '';
  const maxSeen = {};
  const inflight = {};

  const tele = () => Store.get('telemetry', {});
  const orders = () => Store.get('orders', []);
  const orderTime = o => o.started_at || o.created_at || 0;
  const isToday = ms => ms >= U.startOfDay(Date.now());

  /* ---------- ربط المركبة بالشركة ---------- */
  const partnersList = () => Store.get('partners', []);
  const selPartner = () => partnersList().find(p => p.id === $('#vPartner').value) || null;

  function renderPartnerOptions() {
    const sel = $('#vPartner');
    const cur = sel.value;
    const list = partnersList().slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));
    sel.innerHTML = '<option value="">بدون شراكة (بيع مباشر)</option>' + list.map(p => {
      const paid = p.status === 'paid';
      const rem = paid ? ' — المتبقي ' + U.num(Partners.remaining(p, orders())) + ' لتر' : ' — بانتظار التحويل';
      return `<option value="${p.id}" ${paid ? '' : 'disabled'}>${U.esc(p.name)}${rem}</option>`;
    }).join('');
    if (cur && list.some(p => p.id === cur && p.status === 'paid')) sel.value = cur;
    syncPartnerUI();
  }

  /** يحدّث حقل الجهة، قائمة أرقام المركبات المرتبطة، وبطاقة رصيد الحصة */
  function syncPartnerUI() {
    const p = selPartner();
    const sp = $('#vSponsor'), info = $('#vPartnerInfo'), dl = $('#vPlateList');
    if (p) {
      sp.value = p.name; sp.readOnly = true;
      dl.innerHTML = Partners.plates(p).map(v => `<option value="${U.esc(v)}">`).join('');
      const rem = Partners.remaining(p, orders());
      const left = Partners.daysLeftEq(p, orders());
      info.hidden = false;
      info.classList.toggle('low', rem < Partners.dailyLiters(p));
      info.innerHTML = `رصيد الحصة المتبقي: <b>${U.num(rem)} لتر</b> (≈ ${U.num(left, 1)} يوم من ${p.days}) — المركبات المرتبطة: ${Partners.plates(p).length}`;
    } else {
      if (sp.readOnly) sp.value = '';
      sp.readOnly = false;
      info.hidden = true;
      dl.innerHTML = '';
    }
    syncLinkBtn();
  }

  function syncLinkBtn() {
    const p = selPartner(), plate = $('#vPlate').value;
    $('#vLinkBtn').hidden = !(p && plate.trim() && !Partners.isLinked(p, plate));
  }

  /** عند كتابة رقم مركبة مرتبط بشركة مفعّلة يُختار اسم الشركة تلقائياً */
  function autoPickPartner() {
    const plate = $('#vPlate').value;
    if (!plate.trim()) { syncLinkBtn(); return; }
    if (!$('#vPartner').value) {
      const hit = partnersList().find(p => p.status === 'paid' && Partners.isLinked(p, plate));
      if (hit) { $('#vPartner').value = hit.id; syncPartnerUI(); return; }
    }
    syncLinkBtn();
  }

  async function linkPlate() {
    const p = selPartner(), plate = Partners.normPlate($('#vPlate').value);
    if (!p || !plate) return;
    await Partners.linkVehicle(p.id, plate);
    U.toast(`تم ربط المركبة ${plate} بالشركة ${p.name}`, 'success');
    syncPartnerUI(); renderChecks();
  }

  /* ---------- فحص الشروط ---------- */
  function checks(required) {
    const t = tele(), sys = Store.get('system', {}), ctl = Store.get('controls', {});
    const cap = Tank.capacity();
    const lvl = Number(t.main_tank_level);
    const avail = isFinite(lvl) ? lvl / 100 * cap : 0;
    const reserve = cap * CFG.TANK_RESERVE_PCT / 100;
    const usable = Math.max(0, avail - reserve);
    const q = Quality.evaluate(t);
    const rf = ctl.rfid_access || {};
    const p = selPartner();
    const plate = $('#vPlate').value;

    const extra = [];
    if (p) {
      const rem = Partners.remaining(p, orders());
      extra.push({
        ok: p.status === 'paid' && Date.now() <= Partners.endMs(p) + 864e5,
        title: 'عقد الشركة مفعّل وضمن مدة التوزيع',
        detail: p.status !== 'paid' ? 'لم يتم تأكيد التحويل بعد' : `ينتهي التوزيع في ${U.fmtDate(Partners.endMs(p))}`
      });
      extra.push({
        ok: !!plate.trim() && Partners.isLinked(p, plate),
        title: 'المركبة مرتبطة بهذه الشركة',
        detail: !plate.trim() ? 'أدخل رقم المركبة' : (Partners.isLinked(p, plate) ? 'المركبة مرتبطة' : 'الرقم غير مرتبط بالشركة — استخدم زر «ربط هذه المركبة بالشركة»')
      });
      extra.push({
        ok: required > 0 ? required <= rem : rem > 0,
        title: 'رصيد حصة الشركة كافٍ',
        detail: (required > 0 ? `المطلوب ${U.num(required)} لتر — ` : '') + `المتبقي من الحصة ${U.num(rem)} لتر`
      });
    }

    return [
      ...extra,
      {
        ok: sys.emergency_stop === false,
        title: 'النظام ليس في وضع الطوارئ',
        detail: sys.emergency_stop ? 'إيقاف طارئ مفعّل: ' + (sys.reason || '—') : (sys.emergency_stop === false ? 'النظام يعمل بشكل طبيعي' : 'لا توجد قراءة لحالة النظام')
      },
      {
        ok: rf.is_authorized === true,
        title: 'وجود مركبة مصرّح لها (RFID)',
        detail: rf.is_authorized === true ? 'البطاقة: ' + (rf.last_card_uid || '—') : 'لم يتم التعرف على مركبة مصرّح لها عند نقطة التعبئة'
      },
      {
        ok: t.is_filling === false,
        title: 'لا توجد عملية تعبئة جارية',
        detail: t.is_filling ? 'هناك عملية تعبئة قيد التنفيذ الآن' : (t.is_filling === false ? 'نقطة التعبئة جاهزة' : 'لا توجد قراءة')
      },
      {
        ok: required > 0 ? required <= usable : usable > 0,
        title: 'المياه متوفرة بالكمية المطلوبة',
        detail: (required > 0 ? `المطلوب ${U.num(required)} لتر — ` : 'أدخل الكمية لفحص التوفر — ') +
          `المتاح للسحب ${U.num(usable)} لتر (بعد احتياطي ${CFG.TANK_RESERVE_PCT}% من السعة)`
      },
      {
        ok: q.potable,
        title: 'جودة المياه مطابقة للمعايير',
        detail: q.ready ? `نسبة الصلاحية ${q.score}%` + (q.potable ? '' : ' — غير صالحة') : 'لا توجد قراءات للحساسات'
      }
    ];
  }

  function renderChecks() {
    const required = Number($('#vLiters').value) || 0;
    $('#vehChecks').innerHTML = checks(required).map(c => `
      <li class="${c.ok ? 'ok' : 'fail'}">
        <span class="mark"><svg class="i"><use href="#i-${c.ok ? 'check' : 'x'}"/></svg></span>
        <div><b>${c.title}</b><small>${U.esc(c.detail)}</small></div>
      </li>`).join('');
  }

  /* ---------- الإرسال ---------- */
  async function submit(e) {
    e.preventDefault();
    const form = e.target;
    const d = Object.fromEntries(new FormData(form).entries());
    const required = Number(d.liters);
    if (!(required > 0)) { U.toast('أدخل كمية صحيحة', 'error'); return; }

    renderChecks();
    const res = checks(required);
    const failed = res.filter(c => !c.ok);
    if (failed.length) {
      U.toast('لم يتم الإرسال: ' + failed[0].title, 'error');
      return;
    }

    const btn = $('#vehSubmit');
    btn.disabled = true;
    if (window.Loader) Loader.show('جاري إرسال طلب التعبئة إلى Firebase…');
    try {
      const p = selPartner();
      const order = {
        plate: Partners.normPlate(d.plate), driver: d.driver.trim(), sponsor: (p ? p.name : d.sponsor).trim(),
        target_liters: required, filled_liters: 0, status: 'sent', created_at: Date.now()
      };
      if (p) { order.partner_id = p.id; order.partner_name = p.name; }
      const id = await DB.push(PATH, order);
      await DB.set('commands', {
        action: CFG.CMD.START_REFILL, timestamp: U.nowSec(),
        target_liters: required, vehicle_plate: order.plate, order_id: id
      });
      Store.set('orders', [...orders(), { ...order, id }]);
      U.toast(p ? `تم إرسال أمر التعبئة وحجز ${U.num(required)} لتر من حصة ${p.name}` : 'تم الفحص بنجاح وإرسال أمر التعبئة إلى Firebase', 'success');
      form.reset();
      renderPartnerOptions();
      renderChecks();
    } catch (err) {
      U.toast('تعذّر الإرسال إلى Firebase (تحقق من الاتصال وقواعد الكتابة)', 'error');
    } finally {
      btn.disabled = false;
      if (window.Loader) Loader.hide();
    }
  }

  /* ---------- تحديث الطلب محلياً وفي Firebase ---------- */
  function updateOrder(id, fields) {
    Store.set('orders', orders().map(o => o.id === id ? { ...o, ...fields } : o));
    // تسلسل الكتابات لكل طلب حتى لا يضيع أي تحديث
    inflight[id] = (inflight[id] || Promise.resolve())
      .then(() => DB.update(`${PATH}/${id}`, fields))
      .catch(() => U.toast('تعذّر حفظ التعديل في Firebase', 'error'));
    return inflight[id];
  }


  /* ---------- خصم المياه المعبأة من الخزان الرئيسي ----------
     التنفيذ Idempotent: كل طلب يُخصم مرة واحدة فقط.
     نقرأ آخر منسوب من Firebase قبل الخصم، ثم نحدّث live_telemetry
     ونحفظ المنسوب قبل/بعد الخصم داخل سجل الطلب للتقارير. */
  async function deductFromMainTank(order, filledLiters) {
    const litersOut = Math.max(0, Number(filledLiters) || 0);
    if (!order || !order.id || !litersOut) return;
    if ((Number(order.tank_deducted_liters) || 0) > 0) return;

    try {
      const fresh = await DB.get('live_telemetry') || {};
      const beforePct = Number(fresh.main_tank_level);
      if (!isFinite(beforePct)) {
        U.toast('اكتملت التعبئة لكن تعذّر قراءة منسوب الخزان لاحتساب الخصم', 'error');
        return;
      }

      const cap = Tank.capacity();
      const beforeLiters = Tank.liters(beforePct);
      const actualOut = Math.min(litersOut, beforeLiters);
      const afterLiters = Math.max(0, beforeLiters - actualOut);
      const afterPct = U.clamp(afterLiters / cap * 100, 0, 100);

      await DB.update('live_telemetry', {
        main_tank_level: +afterPct.toFixed(3),
        main_tank_liters: Math.round(afterLiters),
        last_vehicle_dispensed_liters: Math.round(actualOut),
        last_tank_adjustment_at: Date.now()
      });

      const audit = {
        tank_before_percent: +beforePct.toFixed(3),
        tank_after_percent: +afterPct.toFixed(3),
        tank_deducted_liters: Math.round(actualOut),
        tank_adjusted_at: Date.now()
      };
      await updateOrder(order.id, audit);

      // تحديث الواجهة فوراً قبل دورة القراءة التالية من Firebase
      Store.set('telemetry', {
        ...tele(),
        main_tank_level: +afterPct.toFixed(3),
        main_tank_liters: Math.round(afterLiters)
      });
      U.toast(`تم خصم ${U.num(actualOut)} لتر من الخزان الرئيسي`, 'success');
    } catch (e) {
      U.toast('اكتملت التعبئة، لكن تعذّر تحديث رصيد الخزان في Firebase', 'error');
    }
  }

  /* ---------- متابعة التعبئة الجارية وتسجيل اكتمالها ---------- */
  function track(t) {
    const active = orders()
      .filter(o => o.status === 'sent' || o.status === 'filling')
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0];
    if (!active) return;

    const session = Number(t.session_filled_liters) || 0;
    if (t.is_filling === true) {
      maxSeen[active.id] = Math.max(maxSeen[active.id] || 0, session);
      if (active.status === 'sent') {
        updateOrder(active.id, { status: 'filling', started_at: Date.now(), filled_liters: maxSeen[active.id] });
      } else if (maxSeen[active.id] !== Number(active.filled_liters || 0)) {
        updateOrder(active.id, { filled_liters: maxSeen[active.id] });
      }
    } else if (t.is_filling === false && active.status === 'filling') {
      let filled = Math.max(maxSeen[active.id] || 0, Number(active.filled_liters) || 0);
      let estimated = false;
      if (!filled) { filled = Number(active.target_liters) || 0; estimated = true; }
      const completedAt = Date.now();
      updateOrder(active.id, { status: 'completed', completed_at: completedAt, filled_liters: filled, estimated })
        .then(() => deductFromMainTank({ ...active, status: 'completed', filled_liters: filled }, filled));
    }
  }

  /* ---------- حالة التعبئة الحالية ---------- */
  function renderLive() {
    const t = tele();
    const setBadge = (el, on, onText, offText) => {
      if (typeof on !== 'boolean') { el.className = 'badge muted'; el.textContent = '—'; return; }
      el.className = 'badge ' + (on ? 'good pulse' : 'muted');
      el.textContent = on ? onText : offText;
    };
    setBadge($('#vehTruckPump'), t.is_run_Track_Water_Pump, 'تعمل', 'متوقفة');
    setBadge($('#vehIsFilling'), t.is_filling, 'جارية', 'لا توجد عملية');

    const session = Number(t.session_filled_liters) || 0;
    const target = Number(t.target_liters) || 0;
    $('#vehProgressText').textContent = target > 0 ? `${U.num(session)} / ${U.num(target)} لتر` : `${U.num(session)} لتر`;
    $('#vehProgress').style.width = (target > 0 ? U.clamp(session / target * 100, 0, 100) : 0) + '%';

    const vt = Number(t.vehicle_tank_level);
    const has = t.vehicle_tank_level !== undefined && t.vehicle_tank_level !== null && isFinite(vt);
    $('#vehTankText').textContent = has ? U.num(vt, 1) + '%' : '—';
    $('#vehTankBar').style.width = (has ? U.clamp(vt, 0, 100) : 0) + '%';
  }

  /* ---------- التقارير ---------- */
  function renderReports() {
    const t = tele();
    const list = orders();
    const todayDone = list.filter(o => (o.status === 'completed' || o.status === 'filling') && isToday(orderTime(o)));
    const dispensed = todayDone.reduce((a, o) => a + (Number(o.filled_liters) || 0), 0);
    const cap = Tank.capacity();
    const lvl = Number(t.main_tank_level);
    const hasLvl = t.main_tank_level !== undefined && t.main_tank_level !== null && isFinite(lvl);

    $('#vehKpiCount').textContent = U.num(todayDone.length);
    $('#vehKpiLiters').textContent = U.num(dispensed);
    $('#vehKpiPct').textContent = U.num(dispensed / cap * 100, 1) + '%';
    $('#vehKpiTank').textContent = hasLvl ? U.num(lvl, 1) + '%' : '—';

    // الرسم الدائري: المتبقي في الخزان مقابل المسحوب اليوم
    const remaining = hasLvl ? Tank.liters(lvl) : 0;
    const sum = remaining + dispensed;
    const pr = sum > 0 ? remaining / sum * 100 : 0;
    const pd = sum > 0 ? dispensed / sum * 100 : 0;
    $('#vehDonutLegend').innerHTML = `
      <li><span><i style="background:#12877f"></i>المتبقي في الخزان</span><b>${U.num(remaining)} لتر (${U.num(pr, 1)}%)</b></li>
      <li><span><i style="background:#f59e0b"></i>الخارج اليوم للمركبات</span><b>${U.num(dispensed)} لتر (${U.num(pd, 1)}%)</b></li>`;

    if (typeof Chart !== 'undefined') {
      const data = [Math.round(remaining), Math.round(dispensed)];
      if (!donut) {
        donut = new Chart($('#vehDonut'), {
          type: 'doughnut',
          data: { labels: ['المتبقي في الخزان', 'الخارج اليوم'], datasets: [{ data, backgroundColor: ['#12877f', '#f59e0b'], borderWidth: 0 }] },
          options: { cutout: '68%', plugins: { legend: { display: false } }, animation: { duration: 600 } }
        });
      } else {
        donut.data.datasets[0].data = data;
        donut.update();
      }
    }

    renderTable(list);
  }

  function renderTable(list) {
    const q = search.trim().toLowerCase();
    const rows = list
      .filter(o => !q || [o.plate, o.driver, o.sponsor].some(x => String(x || '').toLowerCase().includes(q)))
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    $('#vehTableBody').innerHTML = rows.length ? rows.map(o => {
      const st = STATUS[o.status] || [o.status || '—', 'muted'];
      return `<tr>
        <td>${U.fmtDateTime(orderTime(o))}</td>
        <td>${U.esc(o.plate)}</td>
        <td>${U.esc(o.driver)}</td>
        <td class="wrap">${U.esc(o.sponsor)}${o.partner_id ? '<span class="tag-partner">من الحصة</span>' : ''}</td>
        <td>${U.num(o.target_liters)}</td>
        <td>${U.num(o.filled_liters)}${o.estimated ? ' <small title="قيمة تقديرية: لم يرسل الجهاز كمية الجلسة">*</small>' : ''}</td>
        <td><span class="badge ${st[1]}">${st[0]}</span></td>
        <td><div class="row-actions">
          <button class="icon-btn" data-edit="${o.id}" title="تعديل"><svg class="i"><use href="#i-edit"/></svg></button>
          <button class="icon-btn del" data-del="${o.id}" title="حذف"><svg class="i"><use href="#i-trash"/></svg></button>
        </div></td>
      </tr>`;
    }).join('') : '<tr><td class="empty" colspan="8">لا توجد عمليات تعبئة مسجّلة بعد.</td></tr>';
  }

  /* ---------- تعديل / حذف ---------- */
  async function editOrder(id) {
    const o = orders().find(x => x.id === id);
    if (!o) return;
    const opts = Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${v[0]}</option>`).join('');
    const r = await U.dialog({
      title: 'تعديل عملية تعبئة', wide: true,
      body: `
        <div class="field"><label>رقم / اسم المركبة</label><input name="plate" required value="${U.esc(o.plate)}"></div>
        <div class="two">
          <div class="field"><label>اسم السائق</label><input name="driver" required value="${U.esc(o.driver)}"></div>
          <div class="field"><label>الجهة الداعمة</label><input name="sponsor" required value="${U.esc(o.sponsor)}"></div>
        </div>
        <div class="two">
          <div class="field"><label>الكمية المطلوبة (لتر)</label><input name="target" type="number" min="1" required value="${Number(o.target_liters) || ''}"></div>
          <div class="field"><label>الكمية المعبّأة (لتر)</label><input name="filled" type="number" min="0" required value="${Number(o.filled_liters) || 0}"></div>
        </div>
        <div class="field"><label>الحالة</label><select name="status">${opts}</select></div>`,
      buttons: [
        { text: 'إلغاء', value: false, cls: 'btn-ghost' },
        { text: 'حفظ التعديل', value: true, cls: 'btn-primary', submit: true }
      ]
    });
    if (r.value !== true) return;
    const d = r.data;
    await updateOrder(id, {
      plate: d.plate.trim(), driver: d.driver.trim(), sponsor: d.sponsor.trim(),
      target_liters: Number(d.target), filled_liters: Number(d.filled), status: d.status, estimated: false
    });
    U.toast('تم حفظ التعديل', 'success');
  }

  async function deleteOrder(id) {
    const ok = await U.confirm({ title: 'حذف العملية', text: 'سيتم حذف هذه العملية من السجل نهائياً. هل أنت متأكد؟', okText: 'حذف', danger: true });
    if (!ok) return;
    try {
      await DB.remove(`${PATH}/${id}`);
      Store.set('orders', orders().filter(o => o.id !== id));
      U.toast('تم الحذف', 'success');
    } catch (e) { U.toast('تعذّر الحذف من Firebase', 'error'); }
  }

  function exportCSV() {
    const rows = [['التاريخ', 'المركبة', 'السائق', 'الجهة الداعمة', 'المطلوب (لتر)', 'المعبأ (لتر)', 'الحالة']];
    orders().sort((a, b) => (b.created_at || 0) - (a.created_at || 0)).forEach(o => {
      rows.push([U.fmtDateTime(orderTime(o)), o.plate, o.driver, o.sponsor, o.target_liters, o.filled_liters, (STATUS[o.status] || [o.status])[0]]);
    });
    U.downloadCSV('vehicle-fills.csv', rows);
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('vehicles')) return;
    $('#vehForm').addEventListener('submit', submit);
    $('#vLiters').addEventListener('input', renderChecks);
    $('#vPartner').addEventListener('change', () => { syncPartnerUI(); renderChecks(); });
    $('#vPlate').addEventListener('input', () => { autoPickPartner(); renderChecks(); });
    $('#vLinkBtn').addEventListener('click', linkPlate);
    $('#vehSearch').addEventListener('input', e => { search = e.target.value; renderTable(orders()); });
    $('#vehExport').addEventListener('click', exportCSV);
    $('#vehTableBody').addEventListener('click', e => {
      const ed = e.target.closest('[data-edit]'), dl = e.target.closest('[data-del]');
      if (ed) editOrder(ed.dataset.edit);
      if (dl) deleteOrder(dl.dataset.del);
    });

    renderChecks();
    renderLive();
    renderReports();

    Store.on('telemetry', t => { renderChecks(); renderLive(); renderReports(); track(t); });
    Store.on('system', renderChecks);
    Store.on('controls', renderChecks);
    Store.on('partners', () => { renderPartnerOptions(); renderChecks(); });
    Store.on('orders', () => { renderPartnerOptions(); renderChecks(); renderReports(); track(tele()); });
  });
})();
