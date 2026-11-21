/* ===== تحليل سحب المياه ===== */
(function () {
  const DAY = 864e5;
  const WEEKDAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const PERIODS = [
    { name: 'ليلاً (12 ص – 6 ص)', from: 0, to: 5 },
    { name: 'صباحاً (6 ص – 12 ظ)', from: 6, to: 11 },
    { name: 'ظهراً وعصراً (12 ظ – 5 م)', from: 12, to: 16 },
    { name: 'مساءً (5 م – 12 ص)', from: 17, to: 23 }
  ];
  const charts = {};
  let preset = 'today';

  const orderTime = o => MLData.timestamp(o.completed_at || o.started_at || o.created_at) || 0;

  function getRange() {
    const sod = U.startOfDay(Date.now());
    if (preset === 'yesterday') return [sod - DAY, sod - 1];
    if (preset === '7d') return [sod - 6 * DAY, sod + DAY - 1];
    if (preset === 'custom') {
      const f = new Date($('#anFrom').value).getTime();
      const t = new Date($('#anTo').value).getTime();
      return [isFinite(f) ? f : sod, isFinite(t) ? t : Date.now()];
    }
    return [sod, sod + DAY - 1];
  }

  function upsert(key, canvasId, config) {
    if (typeof Chart === 'undefined') return;
    if (!charts[key]) {
      charts[key] = new Chart($(canvasId), config);
    } else {
      charts[key].data.labels = config.data.labels;
      charts[key].data.datasets.forEach((ds, i) => { ds.data = config.data.datasets[i].data; });
      charts[key].update();
    }
  }

  const baseOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: { y: { beginAtZero: true, grid: { color: '#e4ece9' } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 12, maxRotation: 0, autoSkip: true } } }
  };

  function render() {
    const [from, to] = getRange();
    $('#anRangeLabel').innerHTML = `الفترة المعروضة: <b>${U.fmtDateTime(from)}</b> إلى <b>${U.fmtDateTime(to)}</b>`;

    const t = Store.get('telemetry', {});
    const cap = Tank.capacity();
    const rows = Store.get('orders', []).filter(o => {
      const tm = orderTime(o);
      return (o.status === 'completed' || o.status === 'filling') && Number(o.filled_liters) > 0 && tm >= from && tm <= to;
    });

    // التوزيع على الساعات
    const hours = new Array(24).fill(0);
    let total = 0;
    rows.forEach(o => {
      const l = Number(o.filled_liters) || 0;
      hours[new Date(orderTime(o)).getHours()] += l;
      total += l;
    });

    // التوزيع على الأيام
    const dayMap = new Map();
    const startDay = U.startOfDay(from);
    const nDays = Math.min(31, Math.max(1, Math.floor((U.startOfDay(to) - startDay) / DAY) + 1));
    for (let i = 0; i < nDays; i++) dayMap.set(startDay + i * DAY, 0);
    rows.forEach(o => {
      const k = U.startOfDay(orderTime(o));
      if (dayMap.has(k)) dayMap.set(k, dayMap.get(k) + (Number(o.filled_liters) || 0));
    });

    // مؤشرات
    const peakVal = Math.max(...hours);
    const peakHour = hours.indexOf(peakVal);
    const periodSums = PERIODS.map(p => hours.slice(p.from, p.to + 1).reduce((a, b) => a + b, 0));
    const bestPeriod = Math.max(...periodSums);
    const avgDaily = total / nDays;

    $('#anTotal').textContent = U.num(total);
    $('#anPct').textContent = U.num(avgDaily / cap * 100, 1) + '%' + (nDays > 1 ? ' / يوم' : '');
    $('#anPeak').textContent = total > 0 ? `${U.pad(peakHour)}:00 – ${U.pad((peakHour + 1) % 24)}:00` : '—';
    $('#anPeriod').textContent = total > 0 ? PERIODS[periodSums.indexOf(bestPeriod)].name.split(' (')[0] : '—';
    $('#anOps').textContent = U.num(rows.length);
    $('#anCum').textContent = t.total_consumed_liters !== undefined ? U.num(t.total_consumed_liters) + ' لتر' : '—';
    $('#anEmpty').hidden = rows.length > 0;

    upsert('hour', '#chHour', {
      type: 'bar',
      data: {
        labels: hours.map((_, h) => U.pad(h) + ':00'),
        datasets: [{ data: hours.map(Math.round), backgroundColor: hours.map((v, h) => v === peakVal && v > 0 ? '#f59e0b' : '#12877f'), borderRadius: 6 }]
      },
      options: baseOpts
    });

    upsert('day', '#chDay', {
      type: 'bar',
      data: {
        labels: [...dayMap.keys()].map(k => U.fmtDate(k).slice(0, 5)),
        datasets: [{ data: [...dayMap.values()].map(Math.round), backgroundColor: '#14b8a6', borderRadius: 6 }]
      },
      options: baseOpts
    });
  }

  function renderHistory(list) {
    list = list || [];
    const pts = MLData.history(list).points.slice(-60);
    const opts = JSON.parse(JSON.stringify(baseOpts));
    opts.plugins.legend = { display: true };
    opts.scales.y.max = 100;
    upsert('history', '#chHistory', {
      type: 'line',
      data: {
        labels: pts.map(p => U.fmtTime(p._time)),
        datasets: [
          { label: 'الخزان الرئيسي', data: pts.map(p => p.main_tank_level), borderColor: '#12877f', tension: .3, pointRadius: 0, borderWidth: 2.5 },
          { label: 'خزان المركبة', data: pts.map(p => p.vehicle_tank_level), borderColor: '#16a34a', tension: .3, pointRadius: 0, borderWidth: 2.5 }
        ]
      },
      options: opts
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('analytics')) return;
    if (typeof Chart !== 'undefined') {
      Chart.defaults.font.family = "'Cairo','Segoe UI',sans-serif";
      Chart.defaults.color = '#607078';
    }

    const now = Date.now();
    $('#anFrom').value = U.toInputDT(U.startOfDay(now));
    $('#anTo').value = U.toInputDT(now);

    $('#anPresets').addEventListener('click', e => {
      const b = e.target.closest('[data-preset]');
      if (!b) return;
      preset = b.dataset.preset;
      $$('#anPresets .chip').forEach(c => c.classList.toggle('active', c === b));
      $('#anCustom').hidden = preset !== 'custom';
      render();
    });
    $('#anApply').addEventListener('click', render);

    render();
    Store.on('orders', render);
    Store.on('telemetry', () => { $('#anCum').textContent = Store.get('telemetry', {}).total_consumed_liters !== undefined ? U.num(Store.get('telemetry', {}).total_consumed_liters) + ' لتر' : '—'; });

    Store.on('history', renderHistory);
  });
})();
