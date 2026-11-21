/* Display server inference separately from the ESP32 operating rules. */
(function(){
document.addEventListener('DOMContentLoaded',()=>{
let current={},warning={};
const fresh=x=>x.status==='ready' && x.source==='trained_model' && Number(x.valid_until)>Date.now();
function render(){
document.getElementById('qualityModelLive').textContent=fresh(current)?(current.positive?'المودل: خارج الحدود المقاسة':'المودل: ضمن الحدود المقاسة'):'نتيجة المودل غير متاحة أو قديمة؛ شغّل برنامج التحليل.';
document.getElementById('qualityWarningLive').textContent=fresh(warning)?(warning.positive?'إنذار: احتمال تجاوز خلال الدقيقة القادمة':'لا إنذار في نافذة الدقيقة القادمة'):warning.status==='gathering'?'جاري تجميع 12 قراءة متتالية بتوقيت التدريب.':warning.status==='current_violation'?'يوجد تجاوز قائم؛ الإنذار المستقبلي غير مطبق.':'الإنذار غير متاح.';
}
DB.listen('ai_results/current_quality',v=>{current=v||{};render();},5000);
DB.listen('ai_results/early_warning',v=>{warning=v||{};render();},5000);
setInterval(render,5000);render();
});
})();
