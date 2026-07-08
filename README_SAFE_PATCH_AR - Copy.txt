# Safe Collector Patch

هذا التصحيح يعالج فشل GitHub Actions.

ارفع محتويات الفولدر إلى جذر الريبو:
- scripts
- config
- data
- package.json
- .github/workflows/update-market-data.yml

بعدها:
Actions > Update EGX Market Data > Run workflow

مهم:
لو GitHub رفض git push في آخر خطوة، افتح:
Settings > Actions > General > Workflow permissions
واختر Read and write permissions ثم Save.
