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

The active thresholds live in `radar/rules.v1.json`. They are versioned so distribution changes can be attributed to a specific rule change. Rule v7 widens the common evaluation universe while making each evidence lens more selective.

### v0 common eligibility

- Market cap at least KRW 30 billion
- 20-day median traded value at least KRW 200 million
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

Rule v7 requires all three cash/profit-persistence core signals and at least six of seven evidence signals with at least 85% coverage. Numeric checks include ROE >= 20%, interest coverage >= 10x, cash conversion >= 1.5, debt ratio <= 50%, and operating margin >= 15%.

### 2. Improvement

Question: Are the fundamentals changing in a measurable and sustained way?

- Revenue and operating-profit acceleration
- Margin inflection
- Cash-conversion improvement
- Working-capital normalization
- Balance-sheet repair

Rule v7 requires three business-direction signals, one financial-support signal, at least four total evidence signals, and 67% coverage. Numeric anchors are revenue YoY >= 30%, operating profit YoY >= 75%, loss narrowing >= 70%, margin improvement >= 6 percentage points, current operating margin >= 7%, and debt-ratio improvement >= 35 percentage points.

### 3. Dislocation

Question: Is price behavior unusually weak relative to observable business evidence?

- Drawdown and long-range price position
- Valuation versus own history and sector distribution
- Fundamental trend versus price trend
- Event-adjusted dislocation

Dislocation never means “cheap.” It means the relationship deserves inspection.

Rule v7 requires the full five-item package plus business support and at least 90% coverage: a 52-week drawdown of at least 40%, an extreme drawdown of at least 55%, six-month relative underperformance of 35 percentage points, a 120-day price position in the bottom 10%, and a positive valuation multiple in the bottom 7% of the comparison set. Stale price data cannot match.

### 4. Event

Question: Has a primary-source event changed the research case?

- Earnings or guidance change
- Material contract, capacity, product, or regulatory milestone
- Capital allocation change
- Financing, dilution, governance, audit, or legal risk

News titles may help locate a source but cannot be the sole evidence for a strong event signal.

Rule v7 only surfaces verified DART items within 120 days whose importance has been structured as a material contract, buyback, or dilution risk. A dilution-risk item must be no older than two days. Other items must be no older than seven days and have at least KRW 75 billion of event-day traded value at eight times the prior baseline. A traded-value observation below the threshold is never counted as supporting evidence. Unknown filing titles remain visible in source diagnostics but do not create candidates.

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
