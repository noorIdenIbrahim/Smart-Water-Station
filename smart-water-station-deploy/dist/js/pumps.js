/* ===== المضخات الثلاث: قراءات مباشرة من Firebase ===== */
(function () {
  const PUMPS = {
    submersible: 'is_run_Submersible_Pump',
    filter: 'is_run_Falte_Pump',
    vehicle: 'is_run_Track_Water_Pump'
  };

  function render(t) {
    t = t || {};
    const sys = Store.get('system', {});
    let running = 0, known = 0;

    Object.entries(PUMPS).forEach(([name, key]) => {
      const card = $(`[data-pump="${name}"]`);
      if (!card) return;
      const badge = $('.pump-state', card);
      const v = t[key];

      card.classList.remove('is-on', 'is-off');
      if (typeof v !== 'boolean') {
        badge.className = 'pump-state badge muted';
        badge.textContent = 'لا توجد قراءة';
        return;
      }
      known++;
      if (v) {
        running++;
        card.classList.add('is-on');
        badge.className = 'pump-state badge good pulse';
        badge.textContent = 'تعمل';
      } else {
        card.classList.add('is-off');
        badge.className = 'pump-state badge bad';
        badge.textContent = 'متوقفة';
      }
    });

    const total = Object.keys(PUMPS).length;
    $('#pumpsSummary').innerHTML =
      `<span>المضخات العاملة: <b dir="ltr">${known ? running : '—'} / ${total}</b></span>` +
      (sys.emergency_stop ? '<span class="warn-note">⚠ النظام في وضع الإيقاف الطارئ — جميع المضخات يجب أن تكون متوقفة</span>' : '');
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('pumps')) return;
    Store.on('telemetry', render);
    Store.on('system', () => render(Store.get('telemetry', {})));
    render({});
  });
})();
