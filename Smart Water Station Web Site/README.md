# Smart Water Station — نظام إدارة محطة المياه الذكية

موقع ثابت (HTML/CSS/JS) بدون أي خطوة بناء، موجود كله في مجلد `website/` (لا توجد نسخة مكررة). افتح `website/index.html` مباشرة، أو شغّل خادماً محلياً:

    cd website && python3 -m http.server 8000

## هيكل المشروع

    website/    الموقع (يُرفع كاملاً على الاستضافة)
    backend/    خدمة Python لتشغيل الموديلات + الموديلات المدرّبة + نتائج التقييم
    training/   كود التدريب والداتا (لإعادة التدريب فقط)
    docs/       ملاحظات التصميم
    START_HERE_AR.md   شرح التشغيل الكامل

## هيكل ملفات الموقع (داخل website/)

كل قسم له ملف تصميم وملف برمجة مستقل:

| القسم | التصميم | البرمجة |
|---|---|---|
| الأساس / شريط التنقل | `css/base.css`, `css/navbar.css` | `js/utils.js`, `js/navbar.js` |
| الرئيسية | `css/hero.css` | `js/hero.js` |
| جودة المياه | `css/quality.css` | `js/quality.js` |
| المضخات | `css/pumps.css` | `js/pumps.js` |
| الخزان | `css/tank.css` | `js/tank.js` |
| تعبئة المركبات | `css/vehicles.css` | `js/vehicles.js` |
| الشراكات | `css/partners.css` | `js/partners.js` |
| الطوارئ | `css/emergency.css` | `js/emergency.js` |
| تحليل السحب | `css/analytics.css` | `js/analytics.js` |
| التقارير والطباعة | `css/reports.css` | `js/reports.js` |
| الفوتر (تواصل، دعم، خريطة) | `css/footer.css` | `js/footer.js` |

الإعدادات (رابط Firebase، سعر الكوب، أوامر الأجهزة): `js/config.js`

## عقد Firebase

**يقرأ الموقع:** `live_telemetry`, `system_status`, `controls/rfid_access`, `ai_forecasts`, `history_logs`

**يكتب الموقع:**
- `commands` ← `{action, timestamp, ...}` (START_REFILL / EMERGENCY_STOP / EMERGENCY_RESET)
- `system_status` ← عند الطوارئ وإلغائها
- `vehicle_orders` (يحتوي partner_id للمركبات المرتبطة بشركة), `partner_orders` (يحتوي قائمة vehicles), `emergency_log`

يجب أن تسمح قواعد Firebase (Rules) بالقراءة والكتابة على هذه المسارات.

## الخزان
أبعاد الخزان ثابتة في `js/config.js` (القطر 6 م، الطول 5 م) والسعة = π × 3² × 5 ≈ 141.37 كوب (141,372 لتر).

## بيانات التواصل
روابط التواصل الاجتماعي وأرقام الدعم والإيميل والعنوان وإحداثيات الخريطة كلها في `CFG.CONTACT` داخل `js/config.js`.

## صفحات مستقلة
ابدأ من index.html. ينقل شريط التنقل إلى صفحة HTML مستقلة لكل قسم:
quality.html، pumps.html، tank.html، vehicles.html، partners.html، emergency.html، analytics.html، reports.html.
الترويسة والفوتر مشتركان في التصميم، ويُميز شريط التنقل الصفحة الحالية.
تظل دوال البيانات المشتركة متاحة، وتعمل واجهة كل قسم فقط عند فتح صفحته.


## تحديثات النسخة الحالية
- إضافة شعار Smart Water Station إلى شريط التنقل والتقارير.
- إضافة شاشة Loading موحدة باللوجو عند الانتقال بين الصفحات والعمليات.
- صفحة المضخات تعرض 3 مضخات من Firebase:
  - `is_run_Submersible_Pump`
  - `is_run_Falte_Pump`
  - `is_run_Track_Water_Pump`
- عند اكتمال تعبئة مركبة، تُخصم `filled_liters` من الخزان الرئيسي ويُحدّث `live_telemetry/main_tank_level`.
- كل عملية مكتملة تحفظ `tank_before_percent` و`tank_after_percent` و`tank_deducted_liters` للتدقيق.
- الخصم محمي من التكرار بواسطة `tank_deducted_liters`.
- التقرير الرسمي يعرض عمليات التعبئة المكتملة فقط لتجنب احتساب عملية جارية كعملية نهائية.

### ملاحظة مهمة عن الخزان
إذا كان ESP32 يرسل `main_tank_level` باستمرار من حساس حقيقي، فقراءة الحساس هي المرجع الفيزيائي النهائي.
في المحاكاة، الموقع يحدّث المنسوب حسابياً بعد التعبئة. يجب أن يتوافق كود Wokwi/ESP32 مع هذا السلوك حتى لا يعيد كتابة قيمة قديمة فوق القيمة المعدلة.
