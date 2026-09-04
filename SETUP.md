# Setup Instructions

## Prerequisites
- Node.js 18+ (or Bun)
- Python 3.12+
- SQLite (bundled with the OS)

## 1. Install JavaScript dependencies
```bash
cd /path/to/TrustRail
bun install   # or: npm install
```

## 2. Set up the database
```bash
cp .env.example .env
bun run db:push
```

## 3. Install Python dependencies
```bash
pip install fastapi uvicorn pandas numpy scikit-learn econml scipy joblib pydantic
```

## 4. Generate the synthetic training data (first time only)
```bash
cd trustrail-ml
python3 data_generator.py all
```
This generates 3 datasets (easy/hard/mixed) in `trustrail-ml/data/`.

## 5. Train the models (first time only)
```bash
cd trustrail-ml
python3 naive_router.py      # Phase 2
python3 causal_router.py      # Phase 3 (~30s)
python3 intent_risk.py        # Phase 4
python3 stress_test_intent.py # Generates easy/hard/mixed comparison
```

## 6. Start the Python ML service (port 8001)
```bash
cd trustrail-ml
python3 main.py
```
Or use the included script:
```bash
bash scripts/start-trustrail-ml.sh
```

## 7. Start the Next.js dashboard (port 3000)
```bash
bun run dev   # or: npm run dev
```

## 8. Open the dashboard
Go to http://localhost:3000

## Login
The login is in demo mode — any email and password will sign you in.
Session is stored in localStorage; clear it to log out.

## Regenerating everything from scratch
```bash
# Wipe generated data + models
rm -f trustrail-ml/data/transactions*.csv trustrail-ml/data/router_comparison.csv
rm -f trustrail-ml/artifacts/*.joblib
rm -f db/custom.db

# Regenerate
cd trustrail-ml
python3 data_generator.py all
python3 naive_router.py
python3 causal_router.py
python3 intent_risk.py
python3 stress_test_intent.py

# Reset database
cd ..
bun run db:push
```

## Architecture
- Next.js dashboard: port 3000 (frontend + API routes)
- Python FastAPI ML service: port 8001 (model inference)
- SQLite database: db/custom.db (managed by Prisma)
- Caddy gateway: port 81 (reverse proxy, for sandbox preview only)
