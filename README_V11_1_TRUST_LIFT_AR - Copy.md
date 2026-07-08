# V11.1 Trust Lift & Data Recovery

هذا الإصدار يرفع الثقة عمليًا دون تخفيف شروط V11 ودون استخدام مدخلات غير عامة أو بيانات وهمية.

## ما أضيف

1. **Price Truth Layer**
   - يميّز بين تعارض سعر حقيقي وبين اختلاف ناتج عن Cache قديم.
   - يقارن فقط المصادر العامة الحديثة عند تقرير صلاحية السعر للتنفيذ.
   - الملف: `data/price-truth-layer.json`

2. **History Trust Recovery**
   - يراكم الجلسات من snapshots عامة حقيقية فقط.
   - لا يصطنع جلسات تاريخية مفقودة.
   - الملف: `data/history-trust-recovery.json`

3. **Liquidity Gate**
   - يمنع تحويل الأسهم ضعيفة السيولة إلى BUY حتى لو كان شكلها الفني جيدًا.
   - الملف: `data/liquidity-gate-report.json`

4. **Trade Plan Validator**
   - يمنع عرض الدخول/الهدف/الوقف إذا كانت الخطة غير منطقية.
   - الملف: `data/trade-plan-validation-report.json`

5. **Paper Trading + Recommendation Ledger**
   - يسجل التوصيات ويقيس المغلق فقط.
   - لا يحسب الإشارات المفتوحة نجاحًا أو فشلًا.
   - الملفات: `data/recommendation-ledger.json`, `data/paper-trading-dashboard.json`

6. **Practical Readiness Report**
   - يحدد هل التطبيق في Monitoring أو Paper Trading أو Live Advisory.
   - الملف: `data/v11-1-readiness-report.json`

## نتيجة البناء الحالي

- تغطية السعر الموثوق ارتفعت إلى حوالي 92% بعد عدم اعتبار Cache القديم تعارضًا حقيقيًا.
- تعارضات السعر التنفيذية أصبحت 0 في Price Truth Layer.
- ما زال التطبيق في مرحلة Monitoring لأن التاريخ التاريخي غير كافٍ: لا توجد أسهم لديها 20 أو 50 جلسة كافية.
- لا توجد توصيات BUY تنفيذية حتى الآن، وهذا مقصود لحماية القرار.

## تشغيل Workflow

بعد الرفع على GitHub:

1. افتح Actions.
2. شغّل `Update EGX Market Data`.
3. انتظر اكتمال Workflow.
4. افتح GitHub Pages واعمل تحديث قاسٍ للصفحة.

