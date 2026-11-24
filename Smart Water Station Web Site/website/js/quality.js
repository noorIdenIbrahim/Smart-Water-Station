/* ===== جودة المياه: حساب نسبة الصلاحية من 4 حساسات ===== */
(function () {
  // Match the operating limits used by ESP32 and the training labels.
  const SENSORS = [
    {
      key: 'ph', label: 'درجة الحموضة', en: 'pH', unit: '', dec: 2,
      desc: 'مدى حموضة أو قلوية المياه', std: '6.5 – 8.5',
      min: 0, max: 14,
      zones: [[0, 6, 'bad'], [6, 6.5, 'warn'], [6.5, 8.5, 'good'], [8.5, 9, 'warn'], [9, 14, 'bad']],
      score: v => U.piece(v, [[4.5, 0], [6, 60], [6.5, 100], [8.5, 100], [9, 60], [10.5, 0]]),
      status: v => (v >= 6.5 && v <= 8.5) ? 'good' : (v >= 6 && v <= 9) ? 'warn' : 'bad'
    },
    {
      key: 'tds', label: 'المواد الصلبة الذائبة', en: 'TDS', unit: 'ppm', dec: 0,
      desc: 'إجمالي الأملاح والمعادن الذائبة', std: '≤ 300 ppm',
      min: 0, max: 1000,
      zones: [[0, 300, 'good'], [300, 1000, 'bad']],
      score: v => U.piece(v, [[300, 100], [500, 85], [1000, 30], [1500, 0]]),
      status: v => v <= 300 ? 'good' : 'bad'
    },
    {
      key: 'turbidity', label: 'Turbidity', en: 'NTU', unit: 'NTU', dec: 2,
      desc: 'مدى صفاء المياه من الشوائب العالقة', std: '≤ 1.5 NTU',
      min: 0, max: 5,
      zones: [[0, 1.5, 'good'], [1.5, 5, 'bad']],
      score: v => U.piece(v, [[1, 100], [5, 60], [10, 20], [20, 0]]),
      status: v => v <= 1.5 ? 'good' : 'bad'
    },
    {
      key: 'dissolved_oxygen', label: 'Dissolved Oxygen (DO)', en: 'mg/L', unit: 'mg/L', dec: 2,
      desc: 'مستوى الأكسجين الذائب في المياه', std: '≥ 5 mg/L',
      min: 0, max: 10,
      zones: [[0, 3, 'bad'], [3, 5, 'warn'], [5, 10, 'good']],
      score: v => U.piece(v, [[2, 0], [4, 40], [5, 85], [6.5, 100]]),
      status: v => v >= 5 ? 'good' : v >= 3 ? 'warn' : 'bad'
    }
  ];

  const STATUS_TEXT = { good: 'ضمن المعيار', warn: 'قريب من الحد', bad: 'خارج المعيار', none: 'لا توجد قراءة' };
  const STATUS_BADGE = { good: 'good', warn: 'warn', bad: 'bad', none: 'muted' };

  /** يقيّم القراءات ويُرجع النتيجة */
  function evaluate(t) {
    t = t || {};
    const sensors = SENSORS.map(s => {
      const raw = t[s.key];
      const v = (raw === null || raw === undefined || raw === '') ? NaN : Number(raw);
      if (!isFinite(v)) return { ...s, value: null, score: null, state: 'none' };
      return { ...s, value: v, score: U.clamp(s.score(v), 0, 100), state: s.status(v) };
    });
    const stamp=Number(t.timestamp);
    const fresh=Number.isFinite(stamp) && stamp>946684800000 && Date.now()-stamp<=60000 && stamp<=Date.now()+5000;
    const ready = fresh && sensors.every(s => s.value !== null && s.value>=s.min && s.value<=s.max);
    const score = ready ? Math.round(sensors.filter(s=>s.state==='good').length/4*100) : null;
    const bad = sensors.filter(s => s.state === 'bad');
    const warn = sensors.filter(s => s.state === 'warn');
    const potable = ready && sensors.every(s=>s.state==='good');
    return { ready, score, potable, sensors, bad, warn };
  }
  window.Quality = { evaluate };

  function sensorCard(s) {
    const pos = s.value === null ? 0 : U.clamp((s.value - s.min) / (s.max - s.min), 0, 1) * 100;
    const zones = s.zones.map(z => `<i class="${z[2]}" style="flex:${z[1] - z[0]}"></i>`).join('');
    return `
      <article class="card sensor">
        <div class="sensor-top">
          <div><span class="sensor-name">${s.label}</span><span class="sensor-en">${s.en}</span></div>
          <span class="badge ${STATUS_BADGE[s.state]}">${STATUS_TEXT[s.state]}</span>
        </div>
        <div class="sensor-val"><small>${s.unit}</small><strong>${s.value === null ? '—' : U.num(s.value, s.dec)}</strong></div>
        <div class="sensor-desc">${s.desc}</div>
        <div class="scale">
          <div class="scale-zones">${zones}</div>
          ${s.value === null ? '' : `<span class="scale-mark" style="left:${pos}%"></span>`}
        </div>
        <div class="scale-info"><span>المعيار: <b>${s.std}</b></span><span>الدرجة: <b>${s.score === null ? '—' : Math.round(s.score) + '%'}</b></span></div>
      </article>`;
  }

  function render(t) {
    const r = evaluate(t);
    const grid = $('#sensorGrid');
    if (!grid) return;
    grid.innerHTML = r.sensors.map(sensorCard).join('');

    const arc = $('#gaugeArc'), val = $('#gaugeValue'), verdict = $('#gaugeVerdict'), note = $('#gaugeNote');
    const C = 502.65;

    if (!r.ready) {
      arc.style.strokeDashoffset = C;
      arc.setAttribute('class', 'gauge-arc');
      val.textContent = '—';
      verdict.className = 'verdict wait';
      verdict.textContent = 'بانتظار قراءات حساسات حديثة وصالحة…';
      note.textContent = '';
    } else {
      arc.style.strokeDashoffset = C * (1 - r.score / 100);
      arc.setAttribute('class', 'gauge-arc ' + (r.potable ? 'good' : r.score >= 60 ? 'warn' : 'bad'));
      val.textContent = r.score + '%';
      verdict.className = 'verdict ' + (r.potable ? 'good' : 'bad');
      verdict.textContent = r.potable ? '✓ ضمن حدود تشغيل المشروع' : '✕ خارج حدود تشغيل المشروع';

      if (r.bad.length) note.textContent = 'خارج المعيار: ' + r.bad.map(s => s.label).join('، ');
      else if (!r.potable) note.textContent = 'يوجد حساس خارج حدود تشغيل المشروع.';
      else if (r.warn.length) note.textContent = 'تُراجع القراءات: ' + r.warn.map(s => s.label).join('، ');
      else note.textContent = 'جميع القراءات ضمن حدود المشروع؛ النسبة نسبة الحساسات المطابقة وليست ثقة مودل أو شهادة شرب.';
    }

    // مقارنة مع حكم الجهاز
    const dv = $('#deviceVerdict');
    if (typeof t.water_healthy === 'boolean') {
      const same = r.ready && r.potable === t.water_healthy;
      dv.innerHTML = `تقييم الجهاز (ESP32): <b>${t.water_healthy ? 'صالحة' : 'غير صالحة'}</b>` +
        (r.ready && !same ? ' — <span style="color:var(--warn);font-weight:700">يختلف عن حساب الموقع، راجع معايرة الحساسات</span>' : '');
    } else dv.innerHTML = '';
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('quality')) return;
    render({});
    Store.on('telemetry', render);
  });
})();
