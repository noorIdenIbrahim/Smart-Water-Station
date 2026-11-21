/* ===== الطوارئ والأمان ===== */
(function () {
  function render() {
    const sys = Store.get('system', {});
    const card = $('#emCard');
    const badge = $('#emStatus');
    const reason = $('#emReason');
    const stop = $('#emBtn');
    const release = $('#emReleaseBtn');

    card.classList.remove('active', 'safe');
    if (sys.emergency_stop === true) {
      card.classList.add('active');
      badge.className = 'badge bad pulse';
      badge.textContent = 'وضع الطوارئ مفعّل';
      reason.textContent = 'السبب: ' + (sys.reason || 'غير محدد');
      stop.disabled = true;
      release.disabled = false;
    } else if (sys.emergency_stop === false) {
      card.classList.add('safe');
      badge.className = 'badge good';
      badge.textContent = 'النظام يعمل بشكل طبيعي';
      reason.textContent = 'لا يوجد إيقاف طارئ نشط.';
      stop.disabled = false;
      release.disabled = true;
    } else {
      badge.className = 'badge muted';
      badge.textContent = 'لا توجد قراءة';
      reason.textContent = 'بانتظار حالة النظام من Firebase…';
      stop.disabled = false;
      release.disabled = false;
    }
  }

  function renderLog(list) {
    const rows = list.slice().sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, 6);
    $('#emLog').innerHTML = rows.length ? rows.map(l => `
      <li class="${l.type === 'release' ? 'release' : ''}">
        <span class="dot"></span>
        <div><b>${l.type === 'release' ? 'إلغاء الطوارئ وإعادة التشغيل' : 'إيقاف طارئ'}</b>
        <small>${U.esc(l.reason || '—')} — ${U.fmtDateTime(l.time)}</small></div>
      </li>`).join('') : '<li class="empty">لا توجد أحداث مسجّلة.</li>';
  }

  async function trigger() {
    const reason = $('#emReasonInput').value.trim() || 'إيقاف طارئ يدوي من لوحة التحكم';
    const ok = await U.confirm({
      title: 'تأكيد الإيقاف الطارئ',
      text: 'سيتم <b>إيقاف جميع المضخات والمحركات وإغلاق كل الصمامات</b> فوراً. هل تريد المتابعة؟',
      okText: 'إيقاف الآن', danger: true
    });
    if (!ok) return;
    try {
      await DB.update('system_status', {
        emergency_stop: true, reason, source: 'dashboard',
        pumps_stopped: true, valves_closed: true, timestamp: U.nowSec()
      });
      await DB.set('commands', { action: CFG.CMD.EMERGENCY_STOP, timestamp: U.nowSec() });
      DB.push('emergency_log', { type: 'stop', reason, time: Date.now() }).catch(() => {});
      Store.set('system', { ...Store.get('system', {}), emergency_stop: true, reason });
      Store.set('emergency_log', [...Store.get('emergency_log', []), { type: 'stop', reason, time: Date.now() }]);
      $('#emReasonInput').value = '';
      U.toast('تم إرسال أمر الإيقاف الطارئ', 'success');
    } catch (e) {
      U.toast('فشل إرسال أمر الطوارئ! تحقق من الاتصال بـ Firebase', 'error');
    }
  }

  async function releaseEmergency() {
    const ok = await U.confirm({
      title: 'إلغاء وضع الطوارئ',
      text: 'تأكد من زوال الخطر قبل إعادة تشغيل النظام. هل تريد إلغاء الطوارئ؟',
      okText: 'إلغاء الطوارئ'
    });
    if (!ok) return;
    const reason = 'تم إلغاء الطوارئ من لوحة التحكم';
    try {
      await DB.update('system_status', {
        emergency_stop: false, reason, source: 'dashboard',
        pumps_stopped: false, valves_closed: false, timestamp: U.nowSec()
      });
      await DB.set('commands', { action: CFG.CMD.EMERGENCY_RESET, timestamp: U.nowSec() });
      DB.push('emergency_log', { type: 'release', reason, time: Date.now() }).catch(() => {});
      Store.set('system', { ...Store.get('system', {}), emergency_stop: false, reason });
      Store.set('emergency_log', [...Store.get('emergency_log', []), { type: 'release', reason, time: Date.now() }]);
      U.toast('تم إلغاء وضع الطوارئ', 'success');
    } catch (e) {
      U.toast('تعذّر إلغاء الطوارئ، تحقق من الاتصال بـ Firebase', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('emergency')) return;
    $('#emBtn').addEventListener('click', trigger);
    $('#emReleaseBtn').addEventListener('click', releaseEmergency);
    Store.on('system', render);
    Store.on('emergency_log', renderLog);
    render();
  });
})();
