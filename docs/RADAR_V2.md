# Radar v2 Specification

## Why the legacy Radar needs a redesign

The six legacy scripts contain useful hypotheses but mix four different concerns inside each strategy: universe eligibility, signal construction, risk exclusion, and ranking. That makes scores hard to compare and changes hard to validate.

| Legacy Radar | Useful hypothesis | v2 treatment |
|---|---|---|
| A | financially viable large caps after a large drawdown | Dislocation lens + shared quality gate |
| B | overlooked profitable small/mid caps | Quality and Improvement lenses |
| C | structural growers with operating strength | Quality and Improvement lenses |
| D | unusual flow, trading, or filing activity | Event/Attention overlay, not a standalone investment score |
| E | distressed turnaround optionality | Improvement + Event, with a strict high-risk gate |
| F | early growth and market expansion | Improvement + Event, exploration-only when evidence is thin |

## Pipeline

```text
Universe snapshot
  → data and liquidity eligibility
  → survival-risk exclusions
  → four independent evidence lenses
  → contradiction checks
  → candidate evidence packages
  → forward observation history
```

## Shared gates

Gates are evaluated before lens scoring and remain visible in diagnostics.

### Data eligibility

- Stable stock identifier and listing metadata
- Required observation periods available
- Non-finite values normalized to null
- Coverage and freshness calculated per metric family
- Missing data does not receive a neutral or zero value silently

### Liquidity eligibility

- Minimum listing age
- Minimum median traded value over a configured period
- Suspensions and insufficient trading history excluded or labeled separately

### Survival and integrity gate

- Capital impairment
- Going-concern or adverse audit language
- Trading suspension or delisting process
- Repeated dilution or financing stress
- Incomplete financial statements

High-risk findings cannot be offset by positive points from another signal.

## Evidence lenses

The initial thresholds live in `radar/rules.v1.json`. They are deliberately permissive and versioned so distribution changes can be attributed to one rule change at a time.

### v0 common eligibility

- Market cap at least KRW 50 billion
- 20-day median traded value at least KRW 500 million
- At least 120 price observations (60 for Event)
- Financial snapshot no older than 180 days
- Preferred shares, SPACs, and REITs are separate universes
- Stale price data may not generate a current Dislocation match

### 1. Quality

Question: Is the business demonstrating durable economic quality?

- Return on invested capital and its persistence
- Operating margin stability
- Operating cash flow and earnings conversion
- Balance-sheet resilience
- Dilution and capital-allocation history

v0 requires at least three available evidence signals and one cash/profit-persistence core signal. Initial numeric checks include ROE >= 5%, interest coverage >= 2x, cash conversion >= 0.7, and debt ratio <= 200%.

### 2. Improvement

Question: Are the fundamentals changing in a measurable and sustained way?

- Revenue and operating-profit acceleration
- Margin inflection
- Cash-conversion improvement
- Working-capital normalization
- Balance-sheet repair

v0 requires at least two evidence signals, including one business-direction signal. The initial anchors are revenue YoY >= 5%, operating profit YoY >= 10%, loss narrowing >= 20%, or margin improvement >= 1 percentage point.

### 3. Dislocation

Question: Is price behavior unusually weak relative to observable business evidence?

- Drawdown and long-range price position
- Valuation versus own history and sector distribution
- Fundamental trend versus price trend
- Event-adjusted dislocation

Dislocation never means “cheap.” It means the relationship deserves inspection.

v0 requires at least two price/valuation signals and one business-support signal. Initial anchors are a 52-week drawdown of at least 20%, six-month relative underperformance of 15 percentage points, a 120-day price position in the bottom 35%, or a valid valuation multiple in the bottom 30% of the comparison set.

### 4. Event

Question: Has a primary-source event changed the research case?

- Earnings or guidance change
- Material contract, capacity, product, or regulatory milestone
- Capital allocation change
- Financing, dilution, governance, audit, or legal risk

News titles may help locate a source but cannot be the sole evidence for a strong event signal.

v0 only surfaces verified DART items within 120 days whose importance has been structured as a material contract, buyback, or dilution risk. Unknown filing titles remain visible in source diagnostics but do not create candidates.

## First seed diagnostic — 2026-09-02

The legacy database was used only as a migration seed, not as a complete market run.

- KOSPI/KOSDAQ common-share listing universe: 2,504
- Stocks with financial records in the legacy database: 87
- Stocks passing the shared data/liquidity gate: 16
- Unique surfaced candidates: 7
- Lens matches: Quality 7, Improvement 6, Dislocation 0, Event 2
- Dislocation was withheld because the available price history ended on 2026-04-28

This run is intentionally marked `partial`. The next production milestone is a fresh full-market price and minimum-financial snapshot, not tighter thresholds.

## No opaque master score

Each lens may calculate an internal normalized strength value for filtering and diagnostics, but the default UI presents:

- lens
- evidence strength band
- evidence count
- contradiction count
- data coverage
- freshness
- source links

The system does not add all lenses into a single investment score.

## Evidence package contract

Every surfaced candidate must contain:

```json
{
  "instrument_id": "KRX:000000",
  "run_id": "radar_2026-09-02_close_v1",
  "lens": "quality",
  "evidence_band": "strong",
  "coverage": 0.92,
  "as_of": "2026-09-02",
  "evidence": [
    {
      "metric": "operating_cash_flow_ttm",
      "value": 0,
      "comparison": "improved_yoy",
      "period": "2026Q2_TTM",
      "source_id": "dart:document-id",
      "source_url": "https://...",
      "confidence": "high"
    }
  ],
  "contradictions": [],
  "warnings": []
}
```

## Validation before production use

- Freeze rule and schema versions for every run
- Store the whole eligible universe, not only winners
- Track entries, exits, persistence, and missing-data causes
- Run out-of-sample forward observations without rewriting history
- Check survivorship, look-ahead, liquidity, and restatement bias
- Evaluate signal stability and sector concentration
- Treat observed returns as research diagnostics, not proof of investability
