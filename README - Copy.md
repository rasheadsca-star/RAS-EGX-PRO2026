# EGX Full CI/CD Production System

Live-ready Egyptian market trading-intelligence dashboard.

## What this is
- Node.js + Express backend
- Socket.IO real-time stream
- Browser dashboard
- AI-style signals: BUY / HOLD / REDUCE
- Portfolio allocation simulation
- Render deployment ready
- GitHub Actions CI ready

## What this is not
This is not a licensed broker, not a trading execution system, and not financial advice.
It uses simulated/live-ready data until you connect a licensed market data or broker API.

## Run locally

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

## Deploy on Render

Use:

```text
Build Command: npm install
Start Command: npm start
Health Check Path: /health
```

Or deploy using `render.yaml`.

## GitHub CI/CD

The package includes:

```text
.github/workflows/ci.yml
.github/workflows/release-source.yml
```

Push to `main` to validate the project.
Create a tag like `v1.0.0` to generate a GitHub Release source zip.

## Recommended next live-data upgrade

Replace `produceSnapshot()` in `server/index.js` with:
- licensed EGX data provider
- broker API
- Mubasher-compatible lawful API/feed
