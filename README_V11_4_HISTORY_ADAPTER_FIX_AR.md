# V11.4 Historical Source Adapter Fix

هذا الإصدار يعالج المشكلة التي ظهرت بعد V11.3: المحرك كان يعمل ويفحص الأسهم، لكن `parsedSymbols = 0` لأن صفحات المصادر العامة لم تكن تُقرأ أو تُحلل بشكل كافٍ.

## ما تم تنفيذه

- إضافة محرك جديد:
  - `scripts/build-v114-history-adapter-fix.js`
- تحسين قراءة المصادر التاريخية من:
  - جداول HTML ذات رؤوس عربية/إنجليزية.
  - JSON مضمّن داخل الصفحات.
  - JSON APIs العامة عند توفرها.
  - CSV-like public endpoints عند توفرها.
  - Yahoo public chart endpoint لرموز EGX بصيغة `.CA` عند توفرها.
  - Follow-up links داخل الصفحة عندما تكون روابط التاريخ مخفية.
- إنشاء تقرير تفصيلي:
  - `data/v11-4-history-adapter-report.json`
- حفظ عينات Debug آمنة ومختصرة عند فشل الاستخراج:
  - `data/debug/history-fetch-samples/*.json`
- تحديث شاشة استرجاع التاريخ لتعرض:
  - عدد الرموز المفحوصة.
  - عدد الرموز التي تم Parsed لها فعليًا.
  - عدد عينات Debug.
  - أكثر أسباب الفشل تكرارًا.
- تحديث GitHub Actions لتشغيل V11.4 عند اختيار:
  - `history_maintenance = true`

## مبدأ السلامة

لا يتم إضافة أي جلسة تاريخية إلا إذا اجتازت فحص OHLCV:

- تاريخ صالح.
- Open/High/Low/Close موجبة.
- High >= Low.
- Open و Close داخل نطاق High/Low.
- Volume غير سالب.

لا يوجد CSV يدوي، ولا بيانات شاشة سمسرة، ولا بيانات وهمية.

## بعد الرفع

شغّل:

```text
Actions → Update EGX Market Data → Run workflow → history_maintenance = true
```

ثم افتح:

```text
?v=114-history-adapter
```

لو ظل `Parsed = 0`، افتح:

```text
data/v11-4-history-adapter-report.json
data/debug/history-fetch-samples/
```

وهناك ستجد هل المشكلة: مصدر يتطلب JavaScript، أو لا توجد جداول تاريخ، أو JSON لا يحتوي OHLCV، أو Mapping غير صالح.
