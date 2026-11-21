/* ===== تشغيل الموقع: بدء مراقبة مسارات Firebase ===== */
document.addEventListener('DOMContentLoaded', () => {
  // قراءات الحساسات الحية
  DB.listen('live_telemetry', v => Store.set('telemetry', v || {}), CFG.POLL_FAST);
  DB.listen('system_status', v => Store.set('system', v || {}), CFG.POLL_FAST);
  DB.listen('controls', v => Store.set('controls', v || {}), CFG.POLL_NORMAL);

  // السجلات
  DB.listen('vehicle_orders', v => Store.set('orders', U.toList(v)), CFG.POLL_NORMAL);
  DB.listen('partner_orders', v => Store.set('partners', U.toList(v)), CFG.POLL_NORMAL);
  DB.listen('ai_forecasts', v => Store.set('forecast', v || {}), CFG.POLL_SLOW);

  // آخر 60 قراءة تاريخية (للرسم البياني)
  DB.listen('history_logs', v => {
    const entries = Object.entries(v || {}).filter(([, x]) => x && typeof x === 'object');
    const numeric = entries.length && entries.every(([k]) => /^\d+$/.test(k));
    entries.sort((a, b) => numeric ? Number(a[0]) - Number(b[0]) : (a[0] < b[0] ? -1 : 1));
    Store.set('history', entries.map(([, x]) => x));
  }, CFG.POLL_SLOW, DB.lastN(60));

  // آخر أحداث الطوارئ
  DB.listen('emergency_log', v => Store.set('emergency_log', U.toList(v)), CFG.POLL_NORMAL * 2, DB.lastN(6));
});
