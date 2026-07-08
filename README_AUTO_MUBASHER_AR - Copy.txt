# EGX GitHub Pages Auto Mubasher

هذا هو الحل الذي يغيّر لينك GitHub Pages نفسه بدون Render وبدون كارت دفع.

## كيف يعمل؟
- GitHub Actions يدخل على صفحات مباشر العامة كل 30 دقيقة.
- يقرأ الأسعار والدعم والمقاومة وقيمة التداول حسب المتاح.
- يحلل البيانات.
- يكتب النتيجة في:
  data/market.json
- GitHub Pages يعرض النتيجة على نفس لينك الموقع.

## مهم
- البيانات العامة من مباشر ليست لحظية حقيقية وغالبًا متأخرة.
- لا يوجد Login.
- لا توجد بيانات مدفوعة.
- لا يوجد تجاوز حماية أو CAPTCHA.
- لو مباشر غيّر شكل الصفحة، قد يحتاج ملف fetch-mubasher.js تعديل.

## طريقة التركيب
1. ارفع كل ملفات هذا الفولدر في جذر الريبو.
2. اضغط Commit changes.
3. افتح تبويب Actions.
4. لو ظهر زر Enable workflows اضغطه.
5. افتح workflow باسم:
   Update EGX Market Data
6. اضغط Run workflow.
7. انتظر علامة صح خضراء.
8. افتح:
   https://rasheadsca-star.github.io/RAS-EGX0.1/

## تعديل الأسهم
افتح:
config/watchlist.json

واكتب رموز مباشر مثل:
COMI, ETEL, CCAP
