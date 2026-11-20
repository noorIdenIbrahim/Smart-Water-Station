/* Read-only analysis. No training, generated samples or database writes. */
(function () {
  'use strict';
  const TZ = 'Asia/Hebron';
  const number = v => (v === null || v === undefined || v === '' || typeof v === 'boolean') ? null : (Number.isFinite(Number(v)) ? Number(v) : null);
  function timestamp(v) {
    const n = number(v);
    if (n === null || n < 946684800) return null; // Reject uptime/1970 values.
    const ms = n < 1e11 ? n * 1000 : n;
    return ms >= Date.UTC(2000, 0, 1) && ms <= Date.now() + 300000 ? ms : null;
  }
  const dateKey = ms => {
    const parts = new Intl.DateTimeFormat('en-CA', {timeZone: TZ, year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ms));
    const p = Object.fromEntries(parts.map(x=>[x.type,x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  };
  const tomorrow = () => {
    const [y,m,d] = dateKey(Date.now()).split('-').map(Number);
    return new Date(Date.UTC(y,m-1,d+1)).toISOString().slice(0,10);
  };
  const timeLabel = ms => new Intl.DateTimeFormat('ar-PS',{timeZone:TZ,hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(ms);
  function history(rows) {
    const all = Array.isArray(rows) ? rows : [];
    const points = all.filter(x=>x && typeof x==='object').map(x=>({...x,_time:timestamp(x.timestamp)})).filter(x=>x._time !== null).sort((a,b)=>a._time-b._time);
    return {points, rejected:all.length-points.length};
  }
  function ready(x) {
    const t = x && timestamp(x.generated_at);
    const expiry = x && number(x.valid_until);
    const until = expiry !== null && expiry < 1e11 ? expiry*1000 : expiry;
    return !!(x && x.status==='ready' && typeof x.model_version==='string' && x.model_version.trim() && x.source==='trained_model' && t!==null && until!==null && until>Date.now() && until>t);
  }
  function forecast(x) {
    if (!ready(x) || x.target_date!==tomorrow()) return null;
    const c=number(x.confirmed_m3), e=number(x.predicted_extra_m3);
    if(c===null || e===null || c<0 || e<0)return null;
    return {...x, confirmed_m3:c, predicted_extra_m3:e,total_m3:c+e};
  }
  window.MLData={number,timestamp,history,ready,forecast,dateKey};
  const definitions={
    ph:{label:'الحموضة pH',unit:'pH',bounds:[6.5,8.5],range:[0,14]},
    tds:{label:'الأملاح TDS',unit:'ppm',bounds:[300],range:[0,null]},
    turbidity:{label:'العكارة',unit:'NTU',bounds:[1.5],range:[0,null]},
    dissolved_oxygen:{label:'الأكسجين الذائب',unit:'mg/L',bounds:[5],range:[0,null]}
  };
  const plots={};
  function plot(id,type,labels,datasets,unit) {
    if(typeof Chart==='undefined') {
      document.getElementById('mlHistoryNote').textContent='تعذّر تحميل مكتبة الرسوم. تحقق من الاتصال ثم أعد تحميل الصفحة.';
      return;
    }
    if(plots[id])plots[id].destroy();
    plots[id]=new Chart(document.getElementById(id),{type,data:{labels,datasets},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{position:'bottom'}},scales:{y:{beginAtZero:true,title:{display:true,text:unit}},x:{grid:{display:false},ticks:{maxTicksLimit:10,maxRotation:0,autoSkip:true}}}}});
  }
  const text=(id,v)=>{document.getElementById(id).textContent=v;};
  function renderHistory(rows) {
    const {points,rejected}=history(rows);const pts=points.slice(-60);
    const key=document.getElementById('mlSensor').value, def=definitions[key];
    const values=pts.map(p=>number(p[key]));
    text('mlHistoryNote',`${pts.length} سجلًا مؤرّخًا معروضًا؛ ${rejected} سجلًا مستبعدًا لغياب تاريخ صالح. الوقت حسب فلسطين. لا يتم تعويض القراءات الناقصة بصفر.`);
    plot('mlSensorChart','line',pts.map(p=>timeLabel(p._time)),[
      {label:def.label,data:values,borderColor:'#0b726b',backgroundColor:'#12877f1a',fill:false,tension:.2,pointRadius:2,spanGaps:false},
      ...def.bounds.map(b=>({label:`حد التشغيل ${b}`,data:pts.map(()=>b),borderColor:'#e9a23b',borderDash:[6,5],pointRadius:0,borderWidth:1.5}))
    ],def.unit);
  }
  function renderLive(t) {
    const level=number(t.main_tank_level), tm=timestamp(t.timestamp);
    const fresh=tm!==null && Date.now()-tm<=90000;
    const cap=Tank.capacity()/1000;
    text('mlStock',fresh && t.main_level_valid!==false && level!==null && level>=0 && level<=100 ? U.num(cap*level/100,2)+' م³':'—');
    text('mlLiveNote',tm===null?'وقت القراءة غير صالح؛ تحقق من تسجيل timestamp.':`آخر قراءة: ${U.fmtDateTime(tm)} — ${fresh?'حديثة':'قديمة؛ حالة التشغيل الحالية غير مؤكدة'}. حكم الجهاز ${typeof t.water_healthy==='boolean'?(t.water_healthy?'ضمن شروطه':'خارج شروطه'):'غير متوفر'}، وهو منطق قواعد وليس نتيجة موديل.`);
    const equipment=[['مضخة الفلترة','is_run_Falte_Pump'],['المضخة الغاطسة','is_run_Submersible_Pump'],['مضخة المركبة','is_run_Track_Water_Pump']];
    const health=Store.get('equipmentAI',{});const verified=ready(health);
    const known={normal:'أداء طبيعي حسب الموديل',anomaly:'أداء غير طبيعي حسب الموديل',fault_risk:'خطر عطل حسب الموديل'};
    document.getElementById('mlEquipment').replaceChildren();
    equipment.forEach(([label,key])=>{
      const row=document.createElement('div'),left=document.createElement('div'),title=document.createElement('b'),note=document.createElement('small'),state=document.createElement('span');
      title.textContent=label;note.textContent=verified && health.equipment && known[health.equipment[key]] ? known[health.equipment[key]]:'تحليل المعدّة: الموديل لم يُجهّز بعد';
      state.textContent=!fresh || typeof t[key]!=='boolean'?'غير مؤكد':t[key]?'أمر تشغيل':'أمر إيقاف';state.className=t[key] && fresh?'ai-on':'ai-off';
      left.append(title,note);row.append(left,state);document.getElementById('mlEquipment').append(row);
    });
    text('mlEquipmentMeta',verified?'آخر تحليل موثّق: '+U.fmtDateTime(timestamp(health.generated_at)):'تحليل الأعطال: الموديل لم يُجهّز بعد أو النتيجة غير صالحة.');
  }
  function renderForecast() {
    const f=Store.get('tomorrowPlan',{});
    const valid=['ready','quality_blocked'].includes(f.status) && f.target_date===tomorrow() && Number(f.valid_until)>Date.now();
    document.getElementById('mlForecastEmpty').hidden=valid;
    document.getElementById('mlForecastBox').hidden=!valid;
    text('mlForecastBadge',valid?'حساب احتياج الغد':'بانتظار بيانات الخطة');
    text('mlForecastEmpty',f.reason || 'شغّل برنامج التحليل وراجع جدول الحجوزات وإعدادات الخزان.');
    text('mlDemand',valid?U.num(f.total_m3,2)+' م³':'—');
    text('mlDemandNote',valid?'ليوم '+f.target_date+'؛ تقدير أولي يشمل 5 أفراد':'لا توجد خطة حديثة مكتملة');
    text('mlProduction',valid?U.num(f.required_production_m3,2)+' م³':'—');
    text('mlProductionNote',valid?(f.status==='quality_blocked'?'التنفيذ محظور حتى معالجة حالة الجودة':'الحجوزات + الأفراد + الاحتياطي − المخزون الصالح'):'بانتظار بيانات صالحة');
    text('mlForecastMeta',valid?`الاحتياطي: ${U.num(f.reserve_m3,2)} م³ | المخزون الصالح: ${U.num(f.usable_stock_m3,2)} م³ | متوسط طلب الفرد: ${U.num(f.average_individual_m3,2)} م³ من ${f.historical_orders_used} طلبات فعلية. حساب تخطيطي وليس مودل طلب مدرّب.`:'');
    if(valid)plot('mlForecastChart','bar',['الغد'],[{label:'حجوزات مؤكدة',data:[f.confirmed_m3],backgroundColor:'#14b8a6'},{label:'5 أفراد × متوسط الطلب',data:[f.predicted_extra_m3],backgroundColor:'#12877f'}],'م³');
  }
  function renderWarning() {
    const x=Store.get('warningAI',{}),valid=ready(x);
    text('mlWarning',valid?(x.positive?'إنذار مبكر':'لا إنذار في هذه النافذة'):x.status==='current_violation'?'تجاوز قائم حاليًا':'الإنذار غير متاح');
    text('mlWarningNote',valid?'احتمال تجاوز الحدود المقاسة خلال 60 ثانية. نتيجة تجريبية؛ درجة المودل غير معايرة.':x.status==='gathering'?'جاري التجميع: يلزم 12 قراءة متتالية بفاصل 5 ثوانٍ مطابق للتدريب.':x.reason || 'بانتظار برنامج التحليل وقراءات حديثة');
  }
  function renderQuality(x) {
    const valid=ready(x) && ['acceptable','unacceptable'].includes(x.verdict);
    text('mlQuality',valid?(x.verdict==='acceptable'?'ضمن الحدود المقاسة':'خارج الحدود المقاسة'):'—');
    text('mlQualityNote',valid?'نتيجة الموديل '+x.model_version+'؛ لا تغطي الملوثات غير المقاسة':'الموديل لم يُجهّز بعد أو النتيجة منتهية الصلاحية');
  }
  function renderComparison(raw) {
    const rows=Object.values(raw||{}).filter(x=>x && /^\d{4}-\d{2}-\d{2}$/.test(x.target_date) && x.target_date<dateKey(Date.now()) && x.source==='trained_model' && typeof x.model_version==='string' && x.model_version.trim() && timestamp(x.generated_at)!==null && dateKey(timestamp(x.generated_at))<x.target_date && number(x.predicted_total_m3)!==null && number(x.predicted_total_m3)>=0 && number(x.actual_total_m3)!==null && number(x.actual_total_m3)>=0).sort((a,b)=>a.target_date.localeCompare(b.target_date)).slice(-14);
    document.getElementById('mlCompareEmpty').hidden=rows.length>0;document.getElementById('mlCompareBox').hidden=rows.length===0;
    if(!rows.length){if(plots.mlCompareChart){plots.mlCompareChart.destroy();delete plots.mlCompareChart;}return;}
    plot('mlCompareChart','line',rows.map(x=>x.target_date),[{label:'الطلب الفعلي',data:rows.map(x=>Number(x.actual_total_m3)),borderColor:'#14b8a6',tension:.2},{label:'التوقع السابق',data:rows.map(x=>Number(x.predicted_total_m3)),borderColor:'#12877f',borderDash:[6,4],tension:.2}],'م³');
  }
  document.addEventListener('DOMContentLoaded',()=>{
    if(!document.getElementById('analytics'))return;
    renderLive({});renderForecast({});renderQuality({});renderWarning();renderComparison({});renderHistory([]);
    document.getElementById('mlSensor').addEventListener('change',()=>renderHistory(Store.get('history',[])));
    Store.on('history',renderHistory);Store.on('telemetry',renderLive);Store.on('forecast',renderForecast);Store.on('qualityAI',renderQuality);Store.on('equipmentAI',()=>renderLive(Store.get('telemetry',{})));Store.on('comparisonAI',renderComparison);
    DB.listen('ai_results/current_quality',v=>Store.set('qualityAI',v||{}),CFG.POLL_SLOW);
    DB.listen('ai_results/early_warning',v=>{Store.set('warningAI',v||{});renderWarning();},5000);
    DB.listen('ai_results/tomorrow_plan',v=>{Store.set('tomorrowPlan',v||{});renderForecast();},5000);
    DB.listen('ai_results/service_status',v=>{Store.set('aiService',v||{});},5000);
    DB.listen('ai_results/equipment_health',v=>Store.set('equipmentAI',v||{}),CFG.POLL_SLOW);
    DB.listen('ai_forecasts/evaluation',v=>Store.set('comparisonAI',v||{}),CFG.POLL_SLOW,DB.lastN(30));
    window.addEventListener('db-status',e=>text('mlConnection',e.detail?'متصل بقاعدة البيانات':'تعذّر الاتصال؛ قد تكون البيانات قديمة'));
    setInterval(()=>{renderLive(Store.get('telemetry',{}));renderForecast(Store.get('forecast',{}));renderQuality(Store.get('qualityAI',{}));renderWarning();const service=Store.get('aiService',{});text('mlService',Number(service.valid_until)>Date.now()?'برنامج التحليل متصل':'برنامج التحليل متوقف أو غير متصل');},5000);
  });
})();
