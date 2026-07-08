# EGX Actions Missing Scripts Fix

سبب الخطأ:
GitHub Actions لم يجد الملف:
scripts/fetch-market-data.js

ارفع محتويات هذا الفولدر إلى جذر الريبو وليس داخل فولدر فرعي.

لازم يظهر في GitHub هكذا:
scripts/fetch-market-data.js
scripts/analyze-market.js
scripts/parsers/mubasher-parser.js
config/watchlist.json
data/market.json
package.json

بعد الرفع:
Actions > Update EGX Market Data > Run workflow
