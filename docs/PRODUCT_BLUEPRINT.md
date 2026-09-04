# Product Blueprint v0.1

## Product thesis

The dashboard is a visual research environment, not an AI analyst and not a portfolio manager. Its core loop is:

```text
Market context → Radar discovery → User thesis → Evidence inspection and challenge → Watchlist change review
```

The product succeeds when the user can answer three questions quickly:

1. What changed in the market or in my research universe?
2. What is my reason for researching this company, and which facts support or challenge that thesis?
3. How fresh and complete is the underlying data?

## Primary navigation

### Overview

- Macro and benchmark context
- Current Radar candidates
- Watchlist changes
- Material filings and known dated events
- Data health summary

### Radar

- Four evidence lenses
- Shared safety and data-quality gates
- Distribution map and filterable candidate table
- Current-run rule diagnostics (no user-facing Radar History)
- Evidence and contradiction drawer

### Watchlist

- User-selected companies only
- User-authored investment points, accepted verification questions, and thesis-linked evidence; Radar is discovery context, not the research criterion
- Latest financial, price, filing, and monitoring-variable changes
- Notes and review state
- No portfolio weights or transaction state

### Markets

- Global equities, Korea, FX/rates, commodities
- Multi-horizon change and long-range position
- Sector breadth and relative strength
- Clear freshness and coverage status

### Explore

- Whole-universe search and screening
- Sector distributions
- Multi-company comparison
- Metric definitions and learning notes

### Data health

- Collection-run timeline
- Source-level freshness, partial results, failures, and retry state
- Coverage by instrument and metric family
- Schema and rule version used for every output

## Product slices

### Slice 1 — Radar experience

- Finalize Radar v2 taxonomy and evidence schema
- Replace static candidates with versioned fixtures derived from legacy outputs
- Implement filters, candidate selection, and evidence drawer
- Add rule-definition and data-quality panels

### Slice 2 — Reliable data foundation

- Maintain local SQLite and versioned source documents; hosted storage is out of scope
- Add Python collectors as isolated scheduled/manual jobs
- Persist raw source references, normalized observations, and run metadata
- Connect the UI read path without enabling remote job execution yet

### Slice 3 — Evidence Copilot

Local status: manual thesis writing, Phase 2A AI question/adoption, the DART periodic-report reader, immutable document/financial/manual evidence links, filing change comparison, and an evidence-aware AI review path are implemented. External AI setup and live answer-quality evaluation remain deferred. See DART_SOURCE_READER.md for extraction scope and source limits.

- Move the research center from Radar rule explanations to user-authored investment theses
- Separate user writing, AI-proposed checks, observed evidence, and generated interpretations
- Add cited support/counterevidence and missing-source states after source-document collection
- Validate real answer usefulness and source fidelity before expanding AI tasks

### Slice 4 — Markets and Overview

- Build macro and benchmark visual system
- Add current Radar results and watchlist context
- Add data-health summary

### Slice 5 — Watchlist, compare, and monitoring

- Simplified the local review workbench to a watchlist-first list plus one cross-stock update inbox; stock-specific thesis, evidence, and AI tools stay in stock detail
- User-controlled thesis states: open, strengthened, weakened, and on hold
- Manual source discovery launchers and immutable user-entered evidence snapshots
- Evidence-aware AI review with explicit consent, immutable inputs, and no automatic thesis/status mutation
- Cross-watchlist learning matrix that exposes review gaps without ranking companies

## Agreed next sequence (2026-09-03)

1. Stock Detail v2: financial metric charts/table, actual price/volume periods, scoped filing timeline and collapsible evidence/source panels. Implemented locally.
2. Radar → candidate preview → explicit interest-list registration → per-company data enrichment → continuing review. Implemented locally with persistent interest records, independent background collection and partial-source retry. Dropping out of Radar does not remove interest records; unregistering hides a record without deleting research data.
3. The interest-list collector fetches preceding cumulative cash-flow reports and complete years, records CFS/OFS and filing receipts, and calculates comparable standalone quarters. Existing Radar results and the legacy screening collector are not silently reclassified or rewritten by this workflow.
4. Local operation is the current target; GitHub/Vercel deployment is out of scope. Startup/manual backups preserve research records and review checkpoints outside the project. Verified restores go to a new directory and never overwrite the active store.
5. The legacy historical-Radar explanation API remains, but its execution tab is removed from the default stock workspace. It never receives private thesis text. Real model quality remains unverified; there are no AI reports or debate.
6. Superseding product direction: manual investment points are now the default for registered stocks. Phase 1 implements optional registration reasons, explicit editing, manual checks, archive/restore, version conflicts, independent source-review state and backward-compatible backups. User writing is not sent to AI. See [Investment Thesis Workspace](INVESTMENT_THESIS_WORKSPACE.md). AI check proposals, actual source-document review and change comparison remain future phases.

Radar History is excluded at the user's request. Internal run metadata remains for provenance, not a history feature.

## Local operation boundary

The local Next.js app reads SQLite and published JSON on the user's PC. Radar, DART, and market collectors run locally and retain provenance and independent source failures. No hosted database or Vercel deployment is planned. Do not push or deploy without a new explicit request. Backups exclude credentials, source code, and large rebuildable market caches; a verified data backup is not a full development-environment backup.

## Visual direction

- Calm light working surface with an off-white canvas and cool blue primary color
- Strong typographic hierarchy and compact, legible rows
- Charts used to reveal distribution, change, and relationships—not for decoration
- Sparse elevation, thin borders, and restrained motion
- Positive/negative market colors kept separate from data-quality colors
- Explicit sample, stale, partial, missing, and error badges
