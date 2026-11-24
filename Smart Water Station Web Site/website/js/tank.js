/* ===== الخزان: المنسوب والكمية (أبعاد ثابتة: قطر 6 م × طول 5 م) ===== */
(function () {
  // السعة = π × نق² × الطول  (بالمتر المكعب ثم باللتر)
  const D = CFG.TANK.DIAMETER_M;
  const L = CFG.TANK.LENGTH_M;
  const VOLUME_M3 = Math.PI * Math.pow(D / 2, 2) * L;      // ≈ 141.37 كوب
  const CAPACITY_L = Math.round(VOLUME_M3 * 1000);         // ≈ 141,372 لتر

  function capacity() { return CAPACITY_L; }
  function liters(pct) { return (Number(pct) || 0) / 100 * CAPACITY_L; }
  function m3(pct) { return liters(pct) / 1000; }

  function status(p) {
    if (p >= 85) return { text: 'ممتلئ', cls: 'info', hint: 'مخزون وفير', bar: '' };
    if (p >= 60) return { text: 'جيد', cls: 'good', hint: 'المخزون كافٍ', bar: '' };
    if (p >= 35) return { text: 'متوسط', cls: 'warn', hint: 'يُنصح بمراقبة المنسوب', bar: 'warn' };
    if (p >= 15) return { text: 'منخفض', cls: 'warn', hint: 'المنسوب منخفض — جهّز التعبئة', bar: 'warn' };
    return { text: 'حرج', cls: 'bad', hint: 'مخزون حرج — يلزم التعبئة فوراً', bar: 'bad' };
  }
  window.Tank = { capacity, liters, m3, status, VOLUME_M3 };

  function render() {
    // بيانات ثابتة
    $('#tankCapacity').textContent = U.num(CAPACITY_L) + ' لتر';

    const t = Store.get('telemetry', {});
    const raw = t.main_tank_level;
    const p = (raw === undefined || raw === null || !isFinite(Number(raw))) ? null : U.clamp(Number(raw), 0, 100);
    if (p === null) return;

    // مستوى الماء في الرسم: الخزان من y=20 إلى y=280
    const y = 20 + 260 * (1 - p / 100);
    $('#tankWater').style.transform = `translate(30px, ${y}px)`;

    const pct = $('#tankPct');
    pct.textContent = U.num(p, 1) + '%';
    pct.classList.toggle('dark', p < 18);

    const st = status(p);
    const badge = $('#tankStatus');
    badge.className = 'badge ' + st.cls;
    badge.textContent = st.text;
    $('#tankHint').textContent = st.hint;

    const lit = liters(p);
    $('#tankLiters').textContent = U.num(lit);
    $('#tankPctBig').textContent = U.num(p, 1) + '%';
    $('#tankFree').textContent = U.num(CAPACITY_L - lit) + ' لتر';

    const bar = $('#tankBar');
    bar.style.width = p + '%';
    bar.className = st.bar;
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('tank')) return;
    Store.on('telemetry', render);
    render();
  });
})();
