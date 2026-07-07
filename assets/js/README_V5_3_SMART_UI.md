# EGX Pro Hub — V5.3 Smart Market UI Patch

الغرض:
- حل ملاحظة ظهور 100 سهم فقط في الشاشة.
- تنظيم الشاشة المزدحمة إلى Tabs واضحة وسهلة.
- عرض كل الكون المتاح من:
  - config/egx-symbols.csv
  - data/full-market-cache.json
  - data/market.json
  - data/recommendations.json
  - data/pro-report.json
  - data/symbol-audit.json
- بدون رفع أو لمس:
  - data/scan-state.json
  - data/full-market-cache.json

## الملفات

ارفع الملف التالي:

```text
assets/js/egx-v5-3-smart-market-ui.js
```

ثم أضف هذا السطر في `index.html` بعد V5.2:

```html
<script src="assets/js/egx-v5-3-smart-market-ui.js"></script>
```

يفضل ترتيب السكريبتات في نهاية `index.html` بهذا الشكل:

```html
<script src="assets/js/egx-v5-global-ui.js"></script>
<script src="assets/js/egx-v5-1-global-intelligence.js"></script>
<script src="assets/js/egx-v5-2-command-center.js"></script>
<script src="assets/js/egx-v5-3-smart-market-ui.js"></script>
```

## ماذا يفعل V5.3؟

- يخفي لوحة V5.2 القديمة بصريًا حتى لا تزيد الزحمة.
- يعرض لوحة منظمة باسم:

```text
🧠 EGX Pro Hub V5.3 Smart Market UI
```

- يضيف Tabs:
  - الرئيسية الذكية
  - كل الأسهم
  - الفرص
  - التنبيهات والمخاطر
  - صحة البيانات

- في تبويب كل الأسهم:
  - بحث بالرمز/الاسم/القطاع
  - فلترة: كل الأسهم، داخل الكاش، ينتظر Batch، فرص، Failed
  - ترتيب: الرمز، الثقة، التغير، الحجم، السعر
  - Pagination 25/50/100/250

## مهم

لا ترفع يدويًا:

```text
data/scan-state.json
data/full-market-cache.json
```

هذه الحزمة واجهة فقط ولا تعمل Reset.

## اختبار النجاح

1. ارفع الملف.
2. أضف script في index.html بعد V5.2.
3. افتح الموقع واضغط Ctrl + F5.
4. تأكد من ظهور:

```text
🧠 EGX Pro Hub V5.3 Smart Market UI
```

5. افتح تبويب "كل الأسهم" وابحث عن:

```text
ETRS
```

إذا ظهر `Next Batch` فهذا طبيعي: السهم موجود في الكون ولم يدخل الكاش بعد.
إذا ظهر `Cached` فهذا يعني أن Workflow قرأه ودخل الكاش.
