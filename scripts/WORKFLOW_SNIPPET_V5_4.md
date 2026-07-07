# Workflow snippet for V5.4

Add this step after the current market-data and V5.2 intelligence build steps:

```yaml
- name: Build V5.4 Universe Index
  run: node scripts/build-v54-universe-index.js
```

Do not add or upload these files manually unless you intentionally want a reset/restore:

```text
data/scan-state.json
data/full-market-cache.json
```
