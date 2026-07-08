# V11.3 Historical Backfill Recovery Engine

هذا الإصدار يضيف طبقة عملية لتسريع جاهزية التطبيق للتوصيات عبر استرجاع التاريخ الحقيقي للأسهم من مصادر عامة/اختيارية مرخصة فقط.

## ما الجديد

- `scripts/build-v113-source-registry.js`
  - يعرف مصادر التاريخ المسموحة.
  - لا يقبل CSV يدوي أو شاشة سمسرة.

- `scripts/build-v113-symbol-resolver.js`
  - يبني `data/symbol-alias-map.json` لمطابقة رموز EGX بين المصادر.

- `scripts/build-v113-historical-backfill-engine.js`
  - يحاول استرجاع OHLCV تاريخي آليًا.
  - لا يضيف أي جلسة إلا إذا تم استخراجها والتحقق منها.
  - لا يصنع أو يقدر جلسات ناقصة.

- `scripts/build-v113-history-source-diagnostics.js`
  - يوضح سبب فشل كل سهم: تاريخ ناقص، المصدر لا يعرض OHLCV، الرمز لم يفحص، أو فشل HTTP.

- `scripts/build-v113-history-integrity-v2.js`
  - يتحقق من سلامة OHLCV: التاريخ، open/high/low/close، التكرار، وحالة الجاهزية 20/50/120 جلسة.

- `scripts/build-v113-readiness-accelerator.js`
  - يعطي تقرير جاهزية موحد: السعر، التاريخ، السيولة، الخطة، القطاع، وPaper Trading.

## ملفات البيانات الجديدة

- `data/historical-source-registry.json`
- `data/symbol-alias-map.json`
- `data/symbol-resolver-report.json`
- `data/history-backfill-report.json`
- `data/history-source-diagnostics.json`
- `data/history-integrity-v2.json`
- `data/readiness-accelerator-report.json`
- `data/v11-3-readiness-report.json`

## طريقة التشغيل على GitHub

1. ارفع محتويات النسخة إلى جذر الريبو.
2. اعمل Commit.
3. افتح:
   `Actions → Update EGX Market Data → Run workflow`
4. اجعل:
   `history_maintenance = true`
5. شغل الـ Workflow.
6. افتح التطبيق بالرابط مع كاش جديد:
   `?v=113-history-recovery`

## ملاحظة مهمة

إذا ظلت جلسات 20/50 تساوي صفرًا، فهذا لا يعني أن المحرك يختلق نتيجة؛ بل يعني أن المصادر العامة المتاحة لم تعرض جدول OHLCV قابلًا للاستخراج. وقتها راجع:

- `data/history-source-diagnostics.json`
- `data/history-backfill-report.json`

الحل الاحترافي اللاحق هو إضافة API تاريخي مرخص عبر GitHub Secrets:

- `EGX_HISTORY_API_URL`
- `EGX_HISTORY_API_KEY`

بدون إدخال يدوي وبدون CSV سمسرة.
