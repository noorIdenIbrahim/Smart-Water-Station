/* ===== الشراكات: مؤسسات تتعاقد لشراء المياه + ربط المركبات + رصيد الحصة ===== */
(function () {
  const PATH = 'partner_orders';
  const L_PER_M3 = 1000;
  const DAY = 864e5;
  const inflight = {};

  const partners = () => Store.get('partners', []);
  const allOrders = () => Store.get('orders', []);
  const money = v => '$' + U.num(v, 2);

  /* ================= دوال مشتركة (تستخدمها المركبات والتقارير) ================= */
  const normPlate = s => String(s == null ? '' : s).trim().toUpperCase().replace(/\s+/g, ' ');

  function plates(p) {
    const v = p && p.vehicles;
    const arr = Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []);
    return arr.map(x => String(x)).filter(Boolean);
  }
  const isLinked = (p, plate) => plates(p).some(x => normPlate(x) === normPlate(plate));
  const ordersOf = (p, orders) => (orders || allOrders()).filter(o => o.partner_id === p.id);

  /** الكمية المستهلكة من الحصة: المكتمل بالمعبّأ فعلياً، والجاري/المُرسل محجوز بالمطلوب */
  function used(p, orders) {
    return ordersOf(p, orders).reduce((sum, o) => {
      const filled = Number(o.filled_liters) || 0, target = Number(o.target_liters) || 0;
      if (o.status === 'completed') return sum + filled;
      if (o.status === 'sent' || o.status === 'filling') return sum + Math.max(filled, target);
      return sum;
    }, 0);
  }
  const allocated = p => p.status === 'paid' ? (Number(p.allocated_liters) || Math.round(p.qty_m3 * L_PER_M3)) : 0;
  const remaining = (p, orders) => Math.max(0, allocated(p) - used(p, orders));
  const dailyLiters = p => (Number(p.qty_m3) * L_PER_M3) / (Number(p.days) || 1);
  const daysLeftEq = (p, orders) => remaining(p, orders) / (dailyLiters(p) || 1);
  const endMs = p => (p.paid_at || 0) + (Number(p.days) || 0) * DAY;
  const parseVehicles = text => {
    const seen = new Set(), out = [];
    String(text || '').split(/[,،\n;]/).map(normPlate).filter(Boolean).forEach(x => { if (!seen.has(x)) { seen.add(x); out.push(x); } });
    return out;
  };

  window.Partners = { normPlate, plates, isLinked, ordersOf, used, allocated, remaining, dailyLiters, daysLeftEq, endMs, parseVehicles };

  /* ================= معاينة السعر ================= */
  function preview() {
    const q = Number($('#pQty').value) || 0;
    const d = Number($('#pDays').value) || 0;
    $('#parUnit').textContent = U.num(CFG.PRICE_PER_M3, 2);
    $('#parLiters').textContent = q ? U.num(q * L_PER_M3) + ' لتر' : '—';
    $('#parDaily').textContent = q && d ? `${U.num(q / d, 2)} كوب / يوم (${U.num(q / d * L_PER_M3)} لتر)` : '—';
    $('#parPrice').textContent = q ? money(q * CFG.PRICE_PER_M3) : '—';
  }

  /* ================= إضافة شراكة ================= */
  async function submit(e) {
    e.preventDefault();
    const form = e.target;
    const d = Object.fromEntries(new FormData(form).entries());
    const qty = Number(d.qty), days = Number(d.days);
    if (!(qty > 0) || !(days >= 1)) { U.toast('تحقق من الكمية وعدد الأيام', 'error'); return; }

    const p = {
      name: d.name.trim(), qty_m3: qty, days: Math.round(days),
      price_per_m3: CFG.PRICE_PER_M3, total_price: +(qty * CFG.PRICE_PER_M3).toFixed(2),
      status: 'pending', created_at: Date.now()
    };
    const veh = parseVehicles(d.vehicles);
    if (veh.length) p.vehicles = veh;
    try {
      const id = await DB.push(PATH, p);
      Store.set('partners', [...partners(), { ...p, id }]);
      U.toast('تمت إضافة الشراكة — بانتظار تأكيد التحويل', 'success');
      form.reset();
      preview();
    } catch (err) {
      U.toast('تعذّر الحفظ في Firebase (تحقق من الاتصال وقواعد الكتابة)', 'error');
    }
  }

  function updatePartner(id, fields) {
    Store.set('partners', partners().map(p => p.id === id ? { ...p, ...fields } : p));
    inflight[id] = (inflight[id] || Promise.resolve())
      .then(() => DB.update(`${PATH}/${id}`, fields))
      .catch(() => U.toast('تعذّر حفظ التعديل في Firebase', 'error'));
    return inflight[id];
  }

  /* ================= تأكيد التحويل ================= */
  async function confirmPayment(id) {
    const p = partners().find(x => x.id === id);
    if (!p) return;
    const ok = await U.confirm({
      title: 'تأكيد عملية التحويل',
      text: `هل تم استلام مبلغ <b>${money(p.total_price)}</b> من <b>${U.esc(p.name)}</b>؟<br>سيتم تفعيل حصتها: ${U.num(p.qty_m3 * L_PER_M3)} لتر على ${p.days} يوم.`,
      okText: 'نعم، تم التحويل'
    });
    if (!ok) return;
    await updatePartner(id, {
      status: 'paid', paid_at: Date.now(), allocated_liters: Math.round(p.qty_m3 * L_PER_M3)
    });
    U.toast('تم تأكيد التحويل وتفعيل الحصة', 'success');
  }

  /* ================= ربط / فك ربط المركبات ================= */
  async function addVehicle(id) {
    const p = partners().find(x => x.id === id);
    if (!p) return;
    const r = await U.dialog({
      title: 'ربط مركبة بالشركة',
      body: `
        <p style="margin-bottom:12px">المركبة ستتمكن من التعبئة من حصة <b>${U.esc(p.name)}</b>.</p>
        <div class="field"><label>رقم / اسم المركبة (يمكن إدخال عدة أرقام مفصولة بفاصلة)</label>
        <input name="plate" required maxlength="120" placeholder="123-456-78"></div>`,
      buttons: [
        { text: 'إلغاء', value: false, cls: 'btn-ghost' },
        { text: 'ربط', value: true, cls: 'btn-primary', submit: true }
      ]
    });
    if (r.value !== true) return;
    const merged = parseVehicles([...plates(p), ...parseVehicles(r.data.plate)].join(','));
    await updatePartner(id, { vehicles: merged });
    U.toast('تم ربط المركبة بالشركة', 'success');
  }

  /** تُستدعى من قسم المركبات لربط رقم مركبة بشركة مباشرة */
  async function linkVehicle(partnerId, plate) {
    const p = partners().find(x => x.id === partnerId);
    if (!p) return false;
    const merged = parseVehicles([...plates(p), plate].join(','));
    await updatePartner(partnerId, { vehicles: merged });
    return true;
  }
  window.Partners.linkVehicle = linkVehicle;

  async function removeVehicle(id, plate) {
    const p = partners().find(x => x.id === id);
    if (!p) return;
    const ok = await U.confirm({ title: 'فك ارتباط المركبة', text: `فك ارتباط المركبة <b dir="ltr">${U.esc(plate)}</b> عن <b>${U.esc(p.name)}</b>؟`, okText: 'فك الارتباط', danger: true });
    if (!ok) return;
    await updatePartner(id, { vehicles: plates(p).filter(x => normPlate(x) !== normPlate(plate)) });
    U.toast('تم فك الارتباط', 'success');
  }

  /* ================= تعديل / حذف ================= */
  async function editPartner(id) {
    const p = partners().find(x => x.id === id);
    if (!p) return;
    const r = await U.dialog({
      title: 'تعديل الشراكة', wide: true,
      body: `
        <div class="field"><label>اسم المؤسسة</label><input name="name" required value="${U.esc(p.name)}"></div>
        <div class="two">
          <div class="field"><label>الكمية (كوب)</label><input name="qty" type="number" min="0.5" step="0.5" required value="${Number(p.qty_m3) || ''}"></div>
          <div class="field"><label>عدد أيام التوزيع</label><input name="days" type="number" min="1" step="1" required value="${Number(p.days) || ''}"></div>
        </div>
        <div class="field"><label>المركبات المرتبطة (مفصولة بفاصلة)</label><input name="vehicles" value="${U.esc(plates(p).join('، '))}"></div>
        <div class="field"><label>الحالة</label>
          <select name="status">
            <option value="pending" ${p.status !== 'paid' ? 'selected' : ''}>بانتظار التحويل</option>
            <option value="paid" ${p.status === 'paid' ? 'selected' : ''}>تم التحويل</option>
          </select>
        </div>`,
      buttons: [
        { text: 'إلغاء', value: false, cls: 'btn-ghost' },
        { text: 'حفظ التعديل', value: true, cls: 'btn-primary', submit: true }
      ]
    });
    if (r.value !== true) return;
    const d = r.data, qty = Number(d.qty);
    const price = p.price_per_m3 || CFG.PRICE_PER_M3;
    const fields = {
      name: d.name.trim(), qty_m3: qty, days: Math.round(Number(d.days)),
      total_price: +(qty * price).toFixed(2), status: d.status,
      allocated_liters: d.status === 'paid' ? Math.round(qty * L_PER_M3) : 0,
      vehicles: parseVehicles(d.vehicles)
    };
    if (d.status === 'paid' && !p.paid_at) fields.paid_at = Date.now();
    await updatePartner(id, fields);
    U.toast('تم حفظ التعديل', 'success');
  }

  async function deletePartner(id) {
    const ok = await U.confirm({ title: 'حذف الشراكة', text: 'سيتم حذف هذه الشراكة نهائياً. هل أنت متأكد؟', okText: 'حذف', danger: true });
    if (!ok) return;
    try {
      await DB.remove(`${PATH}/${id}`);
      Store.set('partners', partners().filter(p => p.id !== id));
      U.toast('تم الحذف', 'success');
    } catch (e) { U.toast('تعذّر الحذف من Firebase', 'error'); }
  }

  /* ================= العرض ================= */
  function balanceBlock(p, orders) {
    const alloc = allocated(p), usedL = used(p, orders), rem = remaining(p, orders);
    const pctUsed = alloc ? U.clamp(usedL / alloc * 100, 0, 100) : 0;
    const daily = dailyLiters(p);
    const low = rem < daily; // أقل من حصة يوم واحد
    const expired = Date.now() > endMs(p);
    return `
      <div class="par-balance">
        <div class="par-balance-nums">
          <div><span>الحصة الكلية</span><b>${U.num(alloc)} لتر</b></div>
          <div><span>تم تفريغه</span><b>${U.num(usedL)} لتر</b></div>
          <div class="rem ${low ? 'low' : ''}"><span>المتبقي من الحصة</span><b>${U.num(rem)} لتر</b></div>
          <div><span>الأيام المتبقية (بالحصة اليومية)</span><b>${U.num(daysLeftEq(p, orders), 1)} من ${p.days}</b></div>
        </div>
        <div class="progress"><span style="width:${pctUsed}%"></span></div>
        <small>الحصة اليومية ${U.num(daily)} لتر — مدة التوزيع حتى ${U.fmtDate(endMs(p))}${expired ? ' <b style="color:var(--bad)">(انتهت المدة)</b>' : ''}</small>
      </div>`;
  }

  function vehiclesBlock(p) {
    const list = plates(p);
    return `
      <div class="par-vehicles">
        <h5>المركبات المرتبطة (${list.length})</h5>
        <div class="chips">
          ${list.length ? list.map(v => `<span class="vchip">${U.esc(v)}<button type="button" data-rmveh="${p.id}" data-plate="${U.esc(v)}" title="فك الارتباط">×</button></span>`).join('') : '<span class="none">لا توجد مركبات مرتبطة بعد</span>'}
          <button class="btn btn-ghost btn-sm" type="button" data-addveh="${p.id}"><svg class="i"><use href="#i-truck"/></svg> ربط مركبة</button>
        </div>
      </div>`;
  }

  function historyBlock(p, orders) {
    const rows = ordersOf(p, orders)
      .filter(o => o.status !== 'cancelled')
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0)).slice(0, 5);
    if (!rows.length) return '';
    return `
      <div class="par-history">
        <h5>آخر عمليات التفريغ</h5>
        <ul>${rows.map(o => `
          <li><b>${U.esc(o.plate)}</b>
          <span>${o.status === 'completed' ? U.num(o.filled_liters) + ' لتر' : 'جارٍ: ' + U.num(o.target_liters) + ' لتر'}</span>
          <span>${U.fmtDateTime(o.started_at || o.created_at)}</span></li>`).join('')}
        </ul>
      </div>`;
  }

  function card(p, orders) {
    const paid = p.status === 'paid';
    return `
      <article class="card par-item ${paid ? 'paid' : ''}">
        <div class="par-top">
          <div><h4>${U.esc(p.name)}</h4><small>أُضيفت في ${U.fmtDateTime(p.created_at)}</small></div>
          <span class="badge ${paid ? 'good' : 'warn'}">${paid ? 'تم التحويل — الحصة مفعّلة' : 'بانتظار التحويل'}</span>
        </div>
        <div class="par-nums">
          <div><span>الكمية</span><b>${U.num(p.qty_m3, 1)} كوب</b></div>
          <div><span>باللتر</span><b>${U.num(p.qty_m3 * L_PER_M3)}</b></div>
          <div><span>مدة التوزيع</span><b>${p.days} يوم</b></div>
          <div><span>الحصة اليومية</span><b>${U.num(p.qty_m3 / p.days, 2)} كوب</b></div>
          <div class="price"><span>السعر</span><b>${money(p.total_price)}</b></div>
        </div>
        ${paid ? balanceBlock(p, orders) : ''}
        ${vehiclesBlock(p)}
        ${paid ? historyBlock(p, orders) : ''}
        <div class="par-actions">
          ${paid ? '' : `<button class="btn btn-good btn-sm" data-pay="${p.id}"><svg class="i"><use href="#i-check"/></svg> تم التحويل</button>`}
          <button class="btn btn-ghost btn-sm" data-edit="${p.id}"><svg class="i"><use href="#i-edit"/></svg> تعديل</button>
          <button class="btn btn-ghost btn-sm" data-del="${p.id}" style="color:var(--bad)"><svg class="i"><use href="#i-trash"/></svg> حذف</button>
        </div>
      </article>`;
  }

  function render() {
    const orders = allOrders();
    const list = partners().slice().sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    const paid = list.filter(p => p.status === 'paid');
    const pending = list.filter(p => p.status !== 'paid');
    const sum = a => a.reduce((s, p) => s + (Number(p.total_price) || 0), 0);

    $('#parKpiCount').textContent = U.num(list.length);
    $('#parKpiQty').textContent = U.num(list.reduce((s, p) => s + (Number(p.qty_m3) || 0), 0), 1);
    $('#parKpiPaid').textContent = U.num(sum(paid), 2);
    $('#parKpiPending').textContent = U.num(sum(pending), 2);

    $('#parList').innerHTML = list.length
      ? list.map(p => card(p, orders)).join('')
      : '<div class="card empty">لا توجد شراكات بعد. أضف أول مؤسسة من النموذج.</div>';
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('partners')) return;
    $('#parForm').addEventListener('submit', submit);
    $('#pQty').addEventListener('input', preview);
    $('#pDays').addEventListener('input', preview);
    $('#parList').addEventListener('click', e => {
      const pay = e.target.closest('[data-pay]'), ed = e.target.closest('[data-edit]'), dl = e.target.closest('[data-del]');
      const av = e.target.closest('[data-addveh]'), rv = e.target.closest('[data-rmveh]');
      if (pay) confirmPayment(pay.dataset.pay);
      if (ed) editPartner(ed.dataset.edit);
      if (dl) deletePartner(dl.dataset.del);
      if (av) addVehicle(av.dataset.addveh);
      if (rv) removeVehicle(rv.dataset.rmveh, rv.dataset.plate);
    });
    preview();
    render();
    Store.on('partners', render);
    Store.on('orders', render);
  });
})();
