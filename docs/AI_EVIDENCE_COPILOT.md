# AI Evidence Copilot Contract

## Role

The copilot explains collected evidence. It does not replace Radar rules, source collection, or the user's judgment.

## Allowed tasks

- Explain why a Radar rule fired using cited metrics
- Compare periods and point out material changes
- Summarize a filing section with links to the original document
- Suggest questions or missing evidence to verify
- Explain a chart or metric definition in learning mode
- Propose monitoring variables for user approval

## Disallowed tasks

- Buy, sell, hold, allocation, or order instructions
- Target prices or expected-return promises
- Uncited company facts
- Treating missing data as a negative or positive fact
- Generating a conclusion from a news title alone
- Presenting generated prose as source data

## Response contract

Every response returns structured claims rather than one free-form essay.

```json
{
  "status": "grounded | insufficient_evidence | source_error",
  "answer": "short explanation",
  "claims": [
    {
      "text": "claim text",
      "source_ids": ["source-id"],
      "metric_ids": ["metric-id"],
      "confidence": "high | medium | low"
    }
  ],
  "contradictions": [],
  "missing_evidence": [],
  "warnings": []
}
```

A factual claim without at least one available source is rejected before display.

## Quality gate

Before broad release, maintain a fixed evaluation set covering:

- numeric fidelity
- period comparison accuracy
- citation validity
- missing-data refusal
- contradiction recall
- Korean financial terminology
- prompt injection contained in source documents

The first implementation should support one narrow action—“explain this Radar evidence package”—and expand only after it passes the evaluation set.

