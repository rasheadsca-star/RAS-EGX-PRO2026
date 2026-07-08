# V9.1 Data Evidence Core

## ارفع هذه الملفات فقط

- `index.html`
- `service-worker.js`
- `scripts/collect-mubasher-analysis-tools.js`
- `scripts/build-multi-source-intelligence.js`
- `scripts/apply-multisource-intelligence-to-ranking.js`

## لا ترفع

- أي ملف داخل `data`
- `data/scan-state.json`
- `data/full-market-cache.json`

## بعد الرفع

Commit message:

```text
Install V9.1 data evidence core
```

ثم شغّل:

```text
Actions → Update EGX Market Data → Run workflow
history_maintenance = false
```

## ماذا يضيف؟

- مركز واضح باسم `ذكاء المصادر` في القائمة.
- Collector أكثر مرونة لأدوات مباشر، ويحافظ على آخر قراءة جيدة إذا فشل مصدر مؤقتًا.
- Source Evidence Matrix مستقلة لكل سهم.
- بوابة أدلة تخفض أو تحجب التوصية عند ضعف المصدر.
- لا تعيد حساب السعر أو الدخول أو الهدف أو وقف الخسارة.
