# TrustRail
TrustRail is a two-stage payment intelligence system that prevents social-engineering fraud and intelligently routes UPI transactions using causal inference. Built with Next.js, FastAPI, EconML, scikit-learn, Prisma, and SQLite.

TrustRail

TrustRail is a two-stage payment intelligence system designed for UPI transactions. It combines behavioral scam detection with causal payment-gateway routing.

What It Solves
Stage 1 – Scam Detection: Detects social-engineering and UPI collect-request scams before approval using behavioral signals such as first-time payee, high amount, unusual hours, collect direction, and fast approval.
Stage 2 – Causal Routing: Estimates the counterfactual success probability of each payment gateway and routes the transaction to the better option using Doubly-Robust causal estimation instead of biased historical correlation.
How It Works

Transaction → Intent Risk → Pass / Friction / Block → Causal Gateway Routing → Outcome → Feedback → Retraining

The system includes:

Synthetic data generation with realistic routing confounding
Naive baseline router for comparison
DR-Learner with 5-fold cross-fitting
Logistic regression intent-risk model with explainable reasons
FastAPI ML service
Next.js interactive dashboard
Feedback-based retraining and drift monitoring
Key Results
Cross-fit ATE: −9.78 pp
True ATE: −10.50 pp
Cross-fit error: 0.72 pp
17% lower uplift MSE than the naive router
Intent-risk model AUC: 0.9994
100% scam recall at 84.7% precision
12,000 synthetic transactions with known counterfactual ground truth
Tech Stack

Frontend: Next.js 16
Backend: Python, FastAPI
ML: scikit-learn, EconML
Database: Prisma + SQLite
Models: Logistic Regression, Gradient Boosting, DR-Learner

Running the Project
ML Service
cd trustrail-ml

python3 data_generator.py
python3 naive_router.py
python3 causal_router.py
python3 intent_risk.py
Start the Services
# Start ML service
./scripts/start-trustrail-ml.sh

# Start Next.js
npm run dev

The dashboard runs on port 3000 and the ML service runs on port 8001.

Why TrustRail?

Traditional gateway routing learns from historical success rates, which can contain selection bias because transactions are not randomly assigned to gateways. TrustRail uses causal inference to estimate what would have happened if the same transaction had been routed through another gateway.

TrustRail: Detect the intent. Estimate the counterfactual. Route smarter.
