EGX Pro Hub V9.0 Stable Core Patch

ارفع هذه الملفات فقط:
1) index.html في جذر المشروع
2) service-worker.js في جذر المشروع
3) scripts/build-final-opportunity-ranking.js
4) scripts/apply-multisource-intelligence-to-ranking.js

لا ترفع أي ملفات داخل data يدويًا.
لا ترفع data/scan-state.json أو data/full-market-cache.json.

بعد الرفع:
Commit message:
Install V9.0 stable core restore

ثم افتح:
https://rasheadsca-star.github.io/RAS-EGX0.1/?v=900-stable-core

اضغط Ctrl + Shift + R.
بعد التأكد أن التطبيق فتح كاملًا، شغّل Workflow مرة واحدة فقط مع history_maintenance=false.
