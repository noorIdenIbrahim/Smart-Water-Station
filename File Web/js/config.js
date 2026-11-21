/* ===== الإعدادات العامة (عدّل هنا فقط) ===== */
window.CFG = {
  // رابط قاعدة بيانات Firebase Realtime Database
  FIREBASE_URL: 'https://ai-iot-smartwatersystem-default-rtdb.firebaseio.com',

  // سعر الكوب (المتر المكعب) بالدولار
  PRICE_PER_M3: 32.64,

  // أبعاد الخزان (أسطواني): تُحسب السعة منها تلقائياً = π × (القطر/2)² × الطول
  TANK: { DIAMETER_M: 6, LENGTH_M: 5 },

  // احتياطي لا يُسحب منه عند التعبئة (% من سعة الخزان)
  TANK_RESERVE_PCT: 10,

  // أوامر تُكتب في العقدة commands — يجب أن تطابق ما يقرؤه كود ESP32
  CMD: {
    START_REFILL: 'START_REFILL',
    EMERGENCY_STOP: 'EMERGENCY_STOP',
    EMERGENCY_RESET: 'EMERGENCY_RESET'
  },

  // ===== بيانات التواصل (الفوتر) — القيم الحالية أمثلة مؤقتة، استبدلها ببياناتك =====
  CONTACT: {
    // روابط صفحات التواصل الاجتماعي. اترك الرابط فارغاً '' لإخفاء الأيقونة.
    // الأنواع المتاحة: facebook, instagram, whatsapp, telegram, x, youtube, linkedin, tiktok
    social: [
      { type: 'facebook',  label: 'فيسبوك',   url: 'https://www.facebook.com/' },
      { type: 'instagram', label: 'إنستغرام', url: 'https://www.instagram.com/' },
      { type: 'whatsapp',  label: 'واتساب',   url: 'https://wa.me/970000000000' },
      { type: 'telegram',  label: 'تيليغرام', url: 'https://t.me/' },
      { type: 'youtube',   label: 'يوتيوب',   url: 'https://www.youtube.com/' },
      { type: 'linkedin',  label: 'لينكدإن',  url: 'https://www.linkedin.com/' }
    ],

    // أرقام الدعم الفني (الرقم بصيغة دولية بدون مسافات ليعمل زر الاتصال)
    phones: [
      { label: 'الدعم الفني', number: '+970000000000' },
      { label: 'الطوارئ والصيانة', number: '+970000000001' }
    ],

    email: 'support@example.com',
    hours: 'يومياً من 8:00 صباحاً إلى 4:00 مساءً',

    // عنوان المحطة ونقطتها على الخريطة (خط العرض والطول من Google Maps: كليك يمين على الموقع ← انسخ الإحداثيات)
    address: 'اكتب عنوان المحطة هنا — المدينة، المنطقة، الشارع',
    lat: 31.5017,
    lng: 34.4668,
    zoom: 15
  },

  // سرعة التحديث (ملّي ثانية)
  POLL_FAST: 2000,
  POLL_NORMAL: 3000,
  POLL_SLOW: 15000
};
