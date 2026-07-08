# EGX Pro Hub Web Auto Mubasher Release

هذه نسخة Web مطورة لتحديث نفس موقع GitHub Pages الحالي:

https://rasheadsca-star.github.io/RAS-EGX0.1/

## ماذا تم تنفيذه؟

- واجهة عربية RTL مستوحاة من EGX Pro Hub.
- Sidebar كامل:
  - لوحة السوق
  - الفرص التفصيلية
  - مراقب السيولة
  - مراقب حجم التداول
  - الدعم والمقاومة
  - القرار الاستثماري
  - مطابقة مباشر
  - صحة المصادر
  - التنبيهات
  - قوائم المراقبة
  - التقرير اليومي
  - الإعدادات
- GitHub Actions Collector:
  - يقرأ صفحات مباشر العامة.
  - يقرأ الدعم والمقاومة.
  - يقرأ حالة السوق حسب المتاح.
  - يحفظ النتائج في data/*.json.
- Real Confidence Fusion:
  - Data Quality
  - Liquidity
  - Price Action
  - Support / Resistance
  - Source Confidence
  - Risk Penalty
- لا توجد أسعار وهمية.
- لا يوجد ادعاء أن البيانات لحظية حقيقية.
- لا يوجد Backend دائم أو Render أو كارت دفع.

## طريقة التركيب

1. فك الضغط.
2. ارفع كل الملفات والفولدرات إلى جذر الريبو:
   - index.html
   - styles.css
   - app.js
   - package.json
   - config
   - data
   - scripts
   - .github
   - README_AR.md
3. اضغط Commit changes.
4. افتح تبويب Actions.
5. لو ظهر Enable workflows اضغطه.
6. شغّل:
   Update EGX Market Data
7. انتظر علامة صح خضراء.
8. افتح الموقع:
   https://rasheadsca-star.github.io/RAS-EGX0.1/
9. اضغط Ctrl + F5.

## تعديل الأسهم

عدّل الملف:

config/watchlist.json

استخدم رموز مباشر مثل:
- COMI للبنك التجاري الدولي
- ETEL للمصرية للاتصالات
- CCAP للقلعة

ثم شغّل Workflow مرة أخرى.

## الملفات الناتجة

- data/market.json
- data/source-health.json
- data/validation-report.json
- data/daily-report.json

## حدود النسخة

- البيانات من صفحات عامة Public / Delayed.
- لا يوجد Login.
- لا توجد بيانات مدفوعة.
- لا يوجد CAPTCHA bypass.
- الإشارات قرارات مراقبة وليست أوامر تداول.
- لو مباشر غير تصميم الصفحة، قد يحتاج parser تعديل.

## التطوير القادم

- ربط API رسمي.
- تنبيهات Telegram.
- استيراد محفظة.
- Backtest من تاريخي.
