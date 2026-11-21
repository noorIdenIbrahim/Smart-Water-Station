/* Present only fresh telemetry; database connectivity alone is not sensor freshness. */
(function(){
function render(){
 const t=Store.get('telemetry',{}),sys=Store.get('system',{}),stamp=Number(t.timestamp);
 const fresh=Number.isFinite(stamp)&&stamp>946684800000&&Date.now()-stamp<=60000&&stamp<=Date.now()+5000;
 const q=Quality.evaluate(t);
 $('#heroQuality').textContent=q.ready?(q.potable?'ضمن الحدود':'خارج الحدود'):'غير متاح';
 $('#heroQualitySub').textContent=q.ready?'تقييم قواعد الحساسات؛ نتيجة المودل في صفحة الجودة':'بانتظار قراءات حديثة وصالحة';
 const raw=t.main_tank_level,p=Number(raw),valid=fresh&&raw!==null&&raw!==undefined&&raw!==''&&Number.isFinite(p)&&p>=0&&p<=100&&t.main_level_valid!==false;
 $('#heroTank').textContent=valid?U.num(p,1)+'%':'غير متاح';
 $('#heroTankSub').textContent=valid?Tank.status(p).text:'لا توجد قراءة منسوب حديثة';
 const keys=['is_run_Submersible_Pump','is_run_Falte_Pump','is_run_Track_Water_Pump'];
 const known=keys.every(k=>typeof t[k]==='boolean');
 const on=keys.filter(k=>t[k]===true).length;
 $('#heroPumps').textContent=fresh&&known?on+' / 3':'غير مؤكد';
 $('#heroPumpsSub').textContent=fresh&&known?'أوامر تشغيل المضخات الثلاث':'بانتظار حالات تشغيل حديثة';
 const emergency=typeof sys.emergency_stop==='boolean'?sys.emergency_stop:null;
 $('#heroSystemCard').classList.toggle('alert',emergency===true);
 $('#heroSystem').textContent=emergency===true?'إيقاف طارئ':emergency===false?'غير مفعّل':'غير مؤكد';
 $('#heroSystemSub').textContent=emergency===true?(sys.reason||'إيقاف طارئ مفعّل'):emergency===false?'آخر حالة مسجلة للطوارئ؛ لا تؤكد سلامة المياه':'لم تصل حالة الطوارئ';
}
document.addEventListener('DOMContentLoaded',()=>{
 if(!document.getElementById('home'))return;
 Store.on('telemetry',render);Store.on('system',render);render();setInterval(render,5000);
 window.addEventListener('db-sync',e=>{$('#heroSync').textContent=U.fmtTime(e.detail)+':'+U.pad(new Date(e.detail).getSeconds());});
});
})();
