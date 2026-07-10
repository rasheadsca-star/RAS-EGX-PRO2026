# EGX Pro Hub V5.4 Institutional Workspace Patch

## الهدف
هذه ترقية تنظيم وواجهة فوق V4.2/V5.3، وليست Reset ولا تغيير في كاش السوق.

تعالج 3 مشاكل:

1. ظهور 100 سهم فقط أو ظهور جزء من السوق.
2. زحمة وعدم انسجام الواجهة.
3. الشارت ضعيف وغير احترافي.

## الملفات

```text
assets/js/egx-v5-4-institutional-ux.js
scripts/build-v54-universe-index.js
```

## ماذا يفعل ملف الواجهة؟

`assets/js/egx-v5-4-institutional-ux.js`

- ينشئ واجهة مؤسسية منظمة باسم:

```text
EGX Pro Hub V5.4 Institutional Workspace
```

- يقسم التطبيق إلى مساحات عمل واضحة:

```text
الرئيسية الذكية
كل الأسهم
الفرص المختصرة
Chart Lab
صحة البيانات
```

- يعرض كل الأسهم ببحث وفلترة و Pagination بدل حد 100.
- يوضح حالة كل سهم:

```text
داخل الكاش
ينتظر Batch
فشل قراءة
غير معروف
```

- يقرأ `config/egx-symbols.csv` حتى لو كان مضغوطًا/غير منظم كسطر لكل سهم.
- يعرض شارت SVG احترافي من `data/history.json` عند توفر تاريخ كافٍ.
- لا يزيف بيانات الشارت: لو لا يوجد تاريخ كافٍ يعرض رسالة واضحة بدل رسم وهمي.

## ماذا يفعل سكريبت الكون؟

`scripts/build-v54-universe-index.js`

- يولد:

```text
data/universe-index.json
```

- يدمج الرموز من:

```text
config/egx-symbols.csv
data/full-market-cache.json
data/market.json
data/recommendations.json
data/pro-report.json
data/symbol-audit.json
data/source-health.json
```

- لا يلمس أبدًا:

```text
data/scan-state.json
data/full-market-cache.json
```

## طريقة الرفع

ارفع الملفات في نفس المسارات داخل الريبو.

ثم افتح `index.html` وأضف السطر التالي بعد V5.3:

```html
<script src="assets/js/egx-v5-4-institutional-ux.js"></script>
```

الترتيب المقترح:

```html
<script src="assets/js/egx-v5-global-ui.js"></script>
<script src="assets/js/egx-v5-1-global-intelligence.js"></script>
<script src="assets/js/egx-v5-2-command-center.js"></script>
<script src="assets/js/egx-v5-3-smart-market-ui.js"></script>
<script src="assets/js/egx-v5-4-institutional-ux.js"></script>
```

## تشغيل universe-index اختياري لكنه مفضل

من GitHub Actions أو محليًا:

```bash
node scripts/build-v54-universe-index.js
```

لو ستضيفه داخل Workflow، ضعه بعد خطوة جلب بيانات السوق وبعد توليد ملفات V5.2 إن وجدت:

```yaml
- name: Build V5.4 Universe Index
  run: node scripts/build-v54-universe-index.js
```

## بعد الرفع

1. افتح الموقع.
2. اضغط Ctrl + F5.
3. تأكد من ظهور:

```text
EGX Pro Hub V5.4 Institutional Workspace
```

4. افتح تبويب `كل الأسهم` وابحث عن:

```text
ETRS
```

## معيار النجاح

- لا توجد شاشة واحدة مزدحمة.
- السوق يظهر كـ Universe كامل مع Pagination.
- ETRS يظهر إما داخل الكاش أو ينتظر Batch.
- الشارت يظهر بشكل احترافي عند توفر بيانات تاريخية.
- إذا لا توجد بيانات تاريخية، تظهر رسالة واضحة بدل رسم مضلل.
- لا يتم رفع أو تعديل scan-state/full-market-cache يدويًا.

## تذكير مهم

البيانات عامة ومتأخرة من Mubasher Public Pages. الترشيحات تحليل ومراقبة فقط وليست أوامر تداول.
