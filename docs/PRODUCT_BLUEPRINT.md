# Product Blueprint v0.1

## Product thesis

The dashboard is a visual research environment, not an AI analyst and not a portfolio manager. Its core loop is:

```text
Market context → Radar discovery → Evidence inspection → Watchlist monitoring → Change review
```

The product succeeds when the user can answer three questions quickly:

1. What changed in the market or in my research universe?
2. Why did Radar surface this company, and what evidence contradicts it?
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

- Design hosted relational schema
- Add Python collectors as isolated scheduled/manual jobs
- Persist raw source references, normalized observations, and run metadata
- Connect the UI read path without enabling remote job execution yet

### Slice 3 — Evidence Copilot

- Add source-grounded explanation for one Radar candidate
- Return claim-level citations and explicit insufficiency states
- Build an evaluation set before enabling broader AI questions

### Slice 4 — Markets and Overview

- Build macro and benchmark visual system
- Add current Radar results and watchlist context
- Add data-health summary

### Slice 5 — Watchlist, compare, and monitoring

- Saved watchlist state
- Common company detail and comparison views
- Known dated events plus non-dated monitoring variables

## Agreed next sequence (2026-09-03)

1. Stock Detail v2: financial metric charts/table, actual price/volume periods, scoped filing timeline and collapsible evidence/source panels. Implemented locally.
2. Radar → candidate preview → explicit interest-list registration → per-company data enrichment → continuing review. Implemented locally with persistent interest records, independent background collection and partial-source retry. Dropping out of Radar does not remove interest records; unregistering hides a record without deleting research data.
3. The interest-list collector fetches preceding cumulative cash-flow reports and complete years, records CFS/OFS and filing receipts, and calculates comparable standalone quarters. Existing Radar results and the legacy screening collector are not silently reclassified or rewritten by this workflow.
4. Evidence Copilot remains next: grounded explanations with citations, unavailable-data refusals and evaluation cases. No AI reports or debate.

Radar History is excluded at the user's request. Internal run metadata remains for provenance, not a history feature.

## Deployment boundary

The Vercel app renders and queries durable data. It must not execute full-market Radar scans, long DART collection, or multi-step AI jobs inside a page request. Those jobs run separately and write versioned results. This keeps the site responsive even when one source is slow or unavailable.

## Visual direction

- Calm light working surface with an off-white canvas and cool blue primary color
- Strong typographic hierarchy and compact, legible rows
- Charts used to reveal distribution, change, and relationships—not for decoration
- Sparse elevation, thin borders, and restrained motion
- Positive/negative market colors kept separate from data-quality colors
- Explicit sample, stale, partial, missing, and error badges
