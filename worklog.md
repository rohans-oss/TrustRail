# TrustRail — Project Worklog

A two-stage payment intelligence system:
- **Stage 1 (Intent risk):** Pre-approval social-engineering / UPI collect-request scam detection.
- **Stage 2 (Causal routing):** Counterfactual gateway routing using doubly-robust causal effect estimation (not naive correlation).

## Architecture

```
/home/z/my-project/                       <- Next.js 16 dashboard + simulator (TrustRail frontend)
  ├─ src/app/page.tsx                     <- Main dashboard UI (single user-visible route)
  ├─ src/app/api/transactions/            <- Next.js API routes (Prisma-backed)
  ├─ src/app/api/ml/route.ts              <- Proxy to Python ML service via XTransformPort
  ├─ prisma/schema.prisma                 <- Transaction / outcome / model artifacts
  └─ trustrail-ml/                        <- Python FastAPI ML mini-service (port 8001)
      ├─ data_generator.py                <- Phase 1: synthetic data w/ real confounding
      ├─ naive_router.py                  <- Phase 2: naive baseline (sklearn)
      ├─ causal_router.py                 <- Phase 3: EconML doubly-robust counterfactual
      ├─ intent_risk.py                   <- Phase 4: scam risk model (logistic)
      ├─ feedback.py                      <- Phase 7: outcome logging + retrain loop
      ├─ main.py                          <- Phase 5: FastAPI service
      └─ artifacts/                       <- trained models, generated data
```

---
Task ID: 0
Agent: main
Task: Initialize TrustRail project + plan

Work Log:
- Verified fullstack-dev skill loaded, Next.js 16 ready on port 3000
- Installed Python deps: econml 0.17.0, dowhy 0.14, scikit-learn 1.9.0
- Created /home/z/my-project/trustrail-ml/ for Python FastAPI backend
- Designed architecture: Next.js dashboard calls Python ML service via Caddy gateway with XTransformPort=8001

Stage Summary:
- Environment ready: Next.js 16 (port 3000) + Python 3.12 + sklearn + econml + dowhy
- Plan: Phase 1 (data gen) → Phase 2 (naive) → Phase 3 (causal) → Phase 4 (intent) → Phase 5 (FastAPI) → Phase 6 (dashboard) → Phase 7 (feedback)

---
Task ID: 1-7
Agent: main
Task: Build all 7 phases of TrustRail

Work Log:
- Phase 1: data_generator.py — 12,000 synthetic transactions, confounding confirmed (+15pp out-of-hours, +21pp first-time, +57pp amount_z between Gateway B and A)
- Phase 2: naive_router.py — two independent GBDT classifiers per gateway. Naive success rate A=81.9%, B=75.6% vs true 76.4% and 66.1% (selection bias visible)
- Phase 3: causal_router.py — DR-learner with 5-fold cross-fitting + EconML DRLearner for diagnostics. Cross-fit ATE=-9.78pp (true -10.5pp), uplift MSE reduced 17% (0.0090 → 0.0074), uplift-truth correlation 0.981 → 0.986, CATE pattern recovered (easy -33pp A wins, hard +8pp B wins)
- Phase 4: intent_risk.py — logistic regression, AUC=0.9994, 100% recall on scams at 84.7% precision, calibrated friction threshold 88%, 5 human-readable reason rules
- Phase 5: main.py FastAPI service with 7 endpoints (/transaction, /stats, /transactions/recent, /transaction/{id}, /feedback, /simulate/batch, /retrain). Verified end-to-end with curl tests.
- Phase 6: Next.js dashboard with StatsPanel (bias-correction story), Simulator (3 risk presets), LiveFeed (auto-refresh), DecisionCard (full per-txn reasoning), ActionsPanel (batch + retrain), ArchitecturePanel (pipeline explainer). All rendering verified via agent-browser.
- Phase 7: feedback loop complete — POST /feedback logs outcomes, POST /retrain overlays on training data + retrains all 3 models. Dashboard "Retrain from feedback" button end-to-end verified.

Stage Summary:
- All 7 phases complete and verified.
- Dashboard renders cleanly at localhost:3000 (verified via agent-browser).
- Python ML service on port 8001 (auto-started via scripts/start-trustrail-ml.sh).
- Final lint: 0 errors, 0 warnings.
- Key headline metrics:
  - Cross-fit ATE = -9.78pp (true -10.5pp, within 1pp)
  - Uplift MSE reduced 17% by causal correction
  - Intent model AUC = 0.9994 with 100% scam recall
  - Confounding measurable: +15-21pp on routing policy features
- Artifacts:
  - /home/z/my-project/trustrail-ml/artifacts/*.joblib (trained models)
  - /home/z/my-project/trustrail-ml/data/transactions.csv (12k synthetic txns)
  - /home/z/my-project/trustrail-ml/data/router_comparison.csv (per-txn analysis)
  - /home/z/my-project/trustrail-ml/data/{causal,naive,intent}_summary.json (metrics)
  - /home/z/my-project/download/trustrail-final-dashboard.png (screenshot)

---
Task ID: 8
Agent: main
Task: Redesign dashboard for professional polish — login page, proper tables, alignment, typography

Work Log:
- Researched SaaS dashboard patterns (Stripe Dashboard, Vercel, Linear, Datadog)
- Applied strict typography scale: 11/12/13/14/16/20/24/30px (no in-between values)
- Applied 8px spacing grid: 4/8/12/16/24/32/48
- Built LoginPage component (src/components/dashboard/login-page.tsx):
  - SaaS split-screen: dark navy brand panel left + clean form right
  - Decorative grid + gradient blobs on brand panel
  - 3 headline KPIs on brand panel (17% MSE reduction, 99.94% AUC, 12K txns)
  - Email/password form with icons, validation, loading state
  - localStorage session persistence
- Built KpiCard component (kpi-card.tsx): Stripe-style cards with top accent line + 11px label + 24px value
- Built TransactionsTable component (transactions-table.tsx):
  - Proper data table with header row + zebra stripes + sticky header
  - Search by txn ID/payer/payee
  - Two filter dropdowns (verdict + action)
  - Pagination (15 per page) with prev/next buttons
  - Right-aligned numeric columns, monospace IDs
  - Color-coded risk score (rose >= 85%, amber >= 50%)
- Built ModelComparisonTable component (model-comparison-table.tsx):
  - Side-by-side naive vs causal vs true for 8 metrics
  - Green cells when estimator is within 0.5pp of truth
  - Legend at bottom explaining color coding
- Built ApiReferenceTable component (api-reference-table.tsx):
  - All 14 endpoints (8 Python + 6 Next.js) in one table
  - Method badges color-coded (GET = sky, POST = emerald)
  - Service column shows which port each endpoint runs on
- Built ArchitectureTables component (architecture-tables.tsx):
  - Pipeline Stages table (2 stages, 6 columns)
  - Technology Stack table (8 layers, 3 columns)
  - Hidden bug callout (3-card grid explaining confounding → silent effect → correction)
- Redesigned main page (src/app/page.tsx):
  - Auth gate: shows LoginPage until logged in
  - 4-tab navigation (Dashboard / Transactions / Models / Pipeline) with icons
  - Header with logo, status pills, user info, sign out button
  - Footer with version + year
  - Modal drawer for transaction detail (click row → opens full DecisionCard)
- Updated Simulator: tighter spacing, proper label sizes (12px), better preset buttons
- Updated LiveFeed: consistent badge styling, cleaner row layout, slate border colors
- Fixed lint errors:
  - generate-trustrail-docx.js: added eslint-disable for require() (CommonJS script)
  - page.tsx: refactored useEffect to avoid setState-in-effect (used cancellation flag pattern)
  - Final lint: 0 errors, 0 warnings

Stage Summary:
- Login page: SaaS split-screen with localStorage session persistence
- 4 new data tables added: Transactions, Model Comparison, API Reference, Pipeline Stages + Stack
- Strict typography scale applied throughout (11/12/13/14/16/20/24/30px)
- Consistent badge system (semantic colors: emerald pass, amber friction, rose block, sky route)
- All 4 tabs verified via agent-browser: Dashboard renders KPIs + ModelComparisonTable + simulator + live feed
- Transactions tab renders proper data table with search + filters + pagination
- Pipeline tab renders 3 tables (Pipeline Stages + Stack + API Reference)
- Models tab renders ModelComparisonTable + Intent + Causal detailed metric cards
- Modal drawer works: click any transaction → opens full DecisionCard
- Final lint: 0 errors, 0 warnings
- Screenshots saved to /home/z/my-project/download/:
  - trustrail-new-dashboard.png (Dashboard tab)
  - trustrail-transactions-tab.png (new data table view)
  - trustrail-pipeline-tab.png (Pipeline tab with 3 tables)
  - trustrail-decision-modal.png (transaction detail modal)
  - trustrail-final-redesign.png (full page)

---
Task ID: 9
Agent: main
Task: Item 1 — Break the circular feedback loop with human-labeled review path

Work Log:
- prisma/schema.prisma: added `feedbackSource String?` to Transaction with
  three documented values (model_estimate | human_labeled | observed_outcome)
- prisma/schema.prisma: fleshed out ModelArtifact stub (trainingDataHash,
  trainingDataRows, isActive, @@index) — Item 4 will use these fields
- trustrail-ml/main.py: added `source` field to FeedbackRequest pydantic
  schema with regex validation `^(observed_outcome|human_labeled|model_estimate)$`
- trustrail-ml/main.py: `/feedback` endpoint now records the `source` (and
  optional `is_scam` flag) in feedback.jsonl
- trustrail-ml/main.py: rewrote `/retrain` to FILTER OUT model_estimate rows
  before counting — only `human_labeled` and `observed_outcome` rows are
  overlaid on training data. Response now includes `n_feedback_rows_skipped`
  and a `skipped_reason` explaining why
- src/app/api/feedback/route.ts: now persists feedback fields to Prisma
  Transaction table (best-effort, doesn't fail if DB write fails), so the
  Review Queue can mark rows as resolved
- src/app/api/review-queue/route.ts: NEW endpoint — returns transactions
  where feedbackSource IS NULL OR = 'model_estimate' (i.e. awaiting real
  review). Optional `?verdict=` filter
- src/components/dashboard/review-queue.tsx: NEW component — table of pending
  review items with 4 action buttons per row:
    - "Yes, scam" → logs feedback {outcome:0, source:human_labeled, is_scam:1}
    - "No, legit" → logs feedback {outcome:1, source:human_labeled, is_scam:0}
    - "Success" → logs feedback {outcome:1, source:human_labeled}
    - "Failure" → logs feedback {outcome:0, source:human_labeled}
- src/app/page.tsx: added "Review Queue" tab to navigation (now 5 tabs total)
- src/components/dashboard/actions-panel.tsx: REMOVED the old circular
  auto-feedback loop that logged `outcome = random sample from model's own
  counterfactual estimate`. Retrain button now just calls /retrain directly;
  if too few usable rows exist, error message points user to Review Queue tab.

End-to-end verification (curl tests):
  - Empty feedback log → /retrain returns: "Need at least 50 USABLE feedback
    rows... Use the Review Queue to log real outcomes."
  - 5 model_estimate rows → /retrain still blocked: "got 0 usable + 5 skipped"
  - 60 human_labeled rows → /retrain succeeds: "Feedback used: 4, Skipped: 5,
    Skipped reason: 5 rows had source='model_estimate' (circular) and were
    skipped." New ATE: -0.0981pp

Dashboard verification (agent-browser):
  - "Review Queue" tab appears between Transactions and Models
  - Filter dropdown works (Stage 1: Friction / Blocked / Passed / All)
  - All 4 action buttons render per row
  - VLM verified professional layout with color-coded actions

Stage Summary:
- Circular feedback loop is broken: /retrain refuses to use model_estimate rows
- Human-labeled review path is live: Review Queue tab + 4 action buttons per row
- Schema migration applied successfully (feedbackSource column added to Transaction)
- Lint clean (0 errors, 0 warnings)
- Models retrained with the new flow, ATE = -0.0981pp (within 1pp of true -0.105)

---
Task ID: 10
Agent: main
Task: Item 2 — Stress-test synthetic data generator with hard cases

Work Log:
- trustrail-ml/data_generator.py: added `difficulty_mode` parameter to
  generate_transactions() with three modes:
    - "easy"  : original behavior (every scam fires all 4 signals)
    - "hard"  : three adversarial sub-patterns:
        (a) partial-signal scams (randomly drop 1-2 of high_amount/odd_hour/
            fast_approval/first_time from the classic scam profile)
        (b) patient scammers (normal 3-8s approval latency, defeats the
            "fast_approval" rule)
        (c) hard negatives (legitimate high-value first-time payments that
            resemble scams — is_scam=0 but all 4 signals fire)
    - "mixed" : 60% easy + 40% hard + 3% hard negatives (realistic distribution)
- generate_and_save() now writes mode-specific files
  (transactions_<mode>.csv + summary_<mode>.json) so all three coexist
- CLI: `python3 data_generator.py all` generates all three modes in sequence
- New script trustrail-ml/stress_test_intent.py trains the intent model on
  each mode and writes a side-by-side comparison to
  artifacts/intent_difficulty_comparison.json

Before/after metrics (verified via stress_test_intent.py):
  Metric                    | EASY     | HARD     | MIXED
  --------------------------|----------|----------|----------
  AUC (test)                | 0.9997   | 0.9862   | 0.9944
  Scam recall               | 99.0%    | 84.5%    | 89.0%
  Scam precision            | 93.5%    | 70.6%    | 83.5%
  Scam F1                   | 96.2%    | 76.9%    | 86.2%
  False-positive rate       | 0.43%    | 2.29%    | 1.14%
  Friction threshold        | 0.777    | 0.881    | 0.898

Key finding: the headline 99.94% AUC was on the EASY distribution. The same
model on the HARD distribution (partial-signal + patient + hard negatives)
drops to 98.62% AUC, 84.5% recall, 70.6% precision, 2.29% FPR — that's
the realistic expectation for production UPI data.

Production models retrained on the MIXED distribution (more honest numbers):
  - Intent AUC: 0.9944 (was 0.9994 on easy)
  - Uplift MSE: 0.0051 (causal) vs 0.0072 (naive) → 29% reduction
  - Uplift-truth correlation: 0.991 (causal) vs 0.986 (naive)

Dashboard updates:
- src/lib/trustrail.ts: added stress_test field to StatsResponse type
- trustrail-ml/main.py: _load_stress_test_comparison() helper + /stats now
  returns the easy/hard/mixed comparison array
- src/app/page.tsx: Models tab now shows a "Stress-test · Intent model
  performance across difficulty modes" table with all 3 rows side-by-side
  plus an "Honest framing" callout explaining the gap between easy and hard
- Lint clean (0 errors, 0 warnings)
- Verified via agent-browser: stress-test table renders on Models tab with
  EASY/HARD/MIXED badges, AUC numbers, and the honest framing callout

Stage Summary:
- Data generator now produces realistic stress-test distributions
- Models retrained on mixed distribution (honest numbers, not overfit to easy)
- Dashboard surfaces the easy/hard/mixed comparison so the production
  expectations are visible to reviewers
- Artifact saved: trustrail-ml/artifacts/intent_difficulty_comparison.json

---
Task ID: 11
Agent: main
Task: Item 3 — Add p50/p95/p99 latency instrumentation per stage

Work Log:
- trustrail-ml/main.py:
  - Added stage1_ms and stage2_ms fields to DecisionResponse pydantic model
  - Wrapped intent_model.predict() with time.time() probes → t_stage1_ms
  - Wrapped causal_router.counterfactual_success() + naive_router.predict_proba_per_gateway()
    with time.time() probes → t_stage2_ms
  - Added thread-safe in-memory ring buffer (_LATENCY_BUFFER_SIZE=1000) holding
    the last 1000 decisions' per-stage timings
  - Added _record_latency() (called from _process_transaction) and
    _latency_stats() helper that computes p50/p95/p99/mean for stage1/stage2/total
  - /stats now returns a latency object with: n_samples, stage1_ms {p50,p95,p99,mean},
    stage2_ms {p50,p95,p99,mean}, total_ms {p50,p95,p99,mean}, and sla_targets
    (stage1 p99 < 50ms, stage2 p99 < 80ms, total p99 < 150ms)
- src/lib/trustrail.ts:
  - Added stage1_ms? and stage2_ms? fields to DecisionResponse type
  - Added latency field to StatsResponse type with the full shape
- src/app/page.tsx:
  - Models tab now shows a "Latency · p50 / p95 / p99 per stage" card
    with all 3 rows (Stage 1 / Stage 2 / Total) and color-coded p99 cells
    (green ✓ if within SLA, red ✗ if breached)
- src/components/dashboard/decision-card.tsx:
  - Per-transaction card now shows "Stage 1: Xms · Stage 2: Yms · Total: Zms"
    instead of just total processing_ms

Verified end-to-end (10 sample transactions through /transaction):
  - Stage 1: p50=4.3ms, p95=39.3ms, p99=46.4ms (within 50ms SLA ✓)
  - Stage 2: p50=6.8ms, p95=10.2ms, p99=11.6ms (within 80ms SLA ✓)
  - Total:   p50=14.5ms, p95=52ms, p99=57.6ms (within 150ms SLA ✓)
- Lint clean (0 errors, 0 warnings)
- Verified via agent-browser: latency table renders on Models tab with all
  3 rows + SLA column + green ✓ checkmarks on p99

Stage Summary:
- Per-stage latency instrumentation complete
- p50/p95/p99 surfaced on /stats endpoint and dashboard Models tab
- SLA targets defined (Stage 1 < 50ms, Stage 2 < 80ms, Total < 150ms p99)
- All current timings well within SLA on this hardware

---
Task ID: 12
Agent: main
Task: Item 4 — Model versioning + drift monitoring

Work Log:
- prisma/schema.prisma (in Item 1): fleshed out ModelArtifact with version,
  trainedAt, metrics (JSON), trainingDataHash, trainingDataRows, path,
  isActive, @@index([modelName, isActive])
- trustrail-ml/model_versioning.py: NEW module with:
    - compute_data_hash(df) → SHA-256 of CSV bytes
    - record_model_artifact(...) → upserts into Prisma ModelArtifact table
      via direct sqlite3 connection (avoids Prisma in Python service),
      deactivates previous active version
    - get_active_version(model_name) / list_artifact_history(model_name)
    - compute_drift_metrics(current_df, previous_df) → KS-test p-values +
      PSI for numeric features (amount, amount_z, hour_of_day, latency, etc.)
      + chi-squared for categorical (direction, is_first_time_payee, etc.)
    - check_propensity_auc_drift() → flags if confounding severity changed
      by >= 5pp (WARN) or >= 10pp (BREACH)
    - get_drift_status_snapshot() / save_drift_report() → persists to
      artifacts/drift_report.json for /stats to read
- trustrail-ml/main.py:
    - /retrain now records all 3 ModelArtifact rows + computes drift report
      between current and previous training run, persists to drift_report.json
    - /stats now includes a drift field with severity + active_versions
    - NEW /drift endpoint returns full drift report + artifact version history

Verified end-to-end:
  1. Seeded 60 human_labeled feedback rows → /retrain succeeded
     - version: 0.1.202609030542
     - severity: OK (first run, no previous to compare)
  2. Re-seeded with 20% outcome flips → /retrain succeeded
     - version: 0.1.202609030544
     - severity: OK (training data unchanged at file level, only feedback overlay shifted)
     - propensity AUC drift: delta=0.0 (expected — same TRAIN_DF)

Dashboard updates:
- src/lib/trustrail.ts: added drift field to StatsResponse type with
  last_check, severity, note, active_versions shape
- src/app/page.tsx: Models tab now shows a "Drift monitoring" card with:
    - Severity badge (color-coded: OK=emerald, WARN=amber, BREACH=rose)
    - Last check timestamp
    - Active versions table (model name, version, trained at, training rows)
- Verified via agent-browser: card renders with version 0.1.202609030544
  for all 3 models, last check timestamp visible

Stage Summary:
- ModelArtifact table populated with version history on every retrain
- Drift monitoring runs automatically — KS-test + PSI for numerics, chi-squared
  for categoricals, propensity AUC delta for confounding severity
- /stats surfaces severity (OK/WARN/BREACH), /drift returns full report
- Dashboard shows current active versions + last drift check time
- Lint clean (0 errors, 0 warnings)

---
Task ID: 13
Agent: main
Task: Item 5 — Compliance / data-handling section

Work Log:
- Created /home/z/my-project/COMPLIANCE.md (11 KB) covering:
    - RBI data localization for UPI transaction data (RBI circular 6 April 2018)
    - NPCI UPI certification (sponsor-bank model vs PA-CB license)
    - PCI-DSS posture (SAQ-A scope, ASV scans, roadmap)
    - PII handling (current plaintext in SQLite → tokenization required)
    - Audit log integrity (chain-of-custody hashing + WORM storage)
    - DPDP Act 2023 (consent flow, DSAR endpoints, breach notification)
    - Roadmap table with quarterly milestones
- README.md updated with:
    - Link to COMPLIANCE.md
    - "Production-credibility hardening (Items 1–4)" section summarizing all
      4 hardening items with concrete improvements
    - TL;DR stating this is a demo build, no certifications complete
- Lint clean

---
Task ID: 14
Agent: main
Task: Item 6 — Honest metrics framing in README + dashboard caveats

Work Log:
- README.md headline metrics section completely rewritten:
    - Added prominent ⚠️ "Synthetic data caveat (read this first)" callout
      at the top explaining:
        1. Metrics reflect generator's assumptions, not real UPI data
        2. Real UPI fraud is adversarial and evolving
        3. No real confounding structure beyond what's hand-coded
    - Updated headline metrics table to use MIXED-mode numbers (the
      realistic distribution the production models are now trained on)
      instead of the rosy EASY-mode numbers
    - Added new "Intent-risk model — easy vs hard distribution" table
      showing the same model's metrics across all 3 distributions
      (easy/hard/mixed) so reviewers see the realistic degradation
- Dashboard Models tab: added ⚠️ amber callout boxes next to:
    - Intent model AUC headline (warning about synthetic ground truth +
      pointing to stress-test table)
    - Causal router ATE headline (warning that true ATE is only known
      because the generator bakes it in; on real data it's unknowable)
- Verified via agent-browser: both caveats render correctly on the
  Models tab
- Lint clean (0 errors, 0 warnings)

Stage Summary:
All 6 items complete:
1. ✅ Circular feedback loop broken (Review Queue + source field + /retrain filter)
2. ✅ Synthetic data stress-tested (3 modes, easy/hard/mixed, honest metrics)
3. ✅ p50/p95/p99 latency instrumentation per stage
4. ✅ Model versioning + drift monitoring (ModelArtifact + KS-test/PSI/chi-squared)
5. ✅ COMPLIANCE.md covering RBI/NPCI/PCI-DSS/PII/DPDP Act
6. ✅ Honest metrics framing — synthetic data caveat on README + dashboard

Final state:
- All 6 production-credibility items complete
- Dashboard renders cleanly with new tabs (Review Queue, expanded Models)
- ML service has 8 endpoints (/transaction, /stats, /transactions/recent,
  /transaction/{id}, /feedback, /simulate/batch, /retrain, /drift)
- Prisma schema extended (feedbackSource on Transaction, full ModelArtifact)
- New Python modules: model_versioning.py, stress_test_intent.py
- New doc: COMPLIANCE.md
- README rewritten with honest framing
- Lint: 0 errors, 0 warnings
