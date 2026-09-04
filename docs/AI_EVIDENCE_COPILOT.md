# AI Evidence Copilot Contract

## Product direction update — thesis-centered review

The following sections document the **existing historical Radar explanation implementation**, not the agreed final AI product. The new direction is [투자포인트 중심 검토 작업면](INVESTMENT_THESIS_WORKSPACE.md). Manual theses and explicitly consented AI question proposals/edited adoption are implemented locally. Document-based support/counter evidence and change comparison remain future work. Radar is discovery context only. Actual provider quality has not been evaluated without a configured key.

The existing rule excluding personal notes remains true for the Radar endpoint. The separate thesis endpoint discloses selected writing and requires explicit transmission confirmation. It does not send collected Radar facts or any other thesis. Do not widen the old endpoint's payload or treat discovery evidence as the user's research criterion.

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

## Implemented first slice (2026-09-03)

The old `AI 해설` tab is no longer a default Stock Detail entry point. Its API is retained. Stock Detail now offers the separate `AI 질문` workflow. An API key is required locally; live answer-quality evaluation is still outstanding.

- Explain one historical Radar lens, not the newer research financials or current eligibility.
- Fixed definitions and original numbers are available without AI. AI produces up to three short interpretations and verification questions, with source IDs.
- Do not summarize filing bodies in this slice: only recorded filing classifications and canonical receipt links exist. Evidence can include contextual metrics below a threshold; inclusion is not proof every individual condition passed.
- Contradictions, missing evidence and source warnings come from the deterministic packet and remain visible independently of generated text.
- GET reads evidence/cache only. POST accepts a lens and content revision, rebuilds evidence server-side, checks same-origin loopback access, and rejects concurrent source changes.
- The input allowlist contains public company identity, selected evidence, metric definitions and caveats. Watchlist membership, review checkpoints, raw documents, API credentials and local file paths are not input fields.

## Current response contract

Every response returns structured claims rather than one free-form essay.

```json
{
  "status": "grounded | insufficient_evidence",
  "claims": [
    {
      "source_ids": ["E1"],
      "explanation": "short interpretation without rewritten numeric characters",
      "question": "one verification question"
    }
  ]
}
```

A claim without at least one available evidence ID is rejected before display. Generated strings may not contain numeric characters, URLs/HTML or prohibited trading language; canonical values are rendered from the stored packet instead. This validates citation availability and output format, not whether every qualitative inference is true. Do not present `grounded` as a factual accuracy score. Source/provider failures are explicit HTTP errors rather than invented explanations.

## Provider and operating limits

The implementation uses the [OpenAI Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs) for Responses `text.format` with a strict schema and separate refusal/incomplete handling. The pinned [GPT-5.4 mini snapshot](https://developers.openai.com/api/docs/models/gpt-5.4-mini) is configured in `research/evidence-ai.json`. No external SDK dependency is required.

`OPENAI_API_KEY` stays server-side in `.env.local`. `store: false` does not promise zero provider-side retention. No tools, browsing, schedules or automatic retries. Radar cache keys include packet, config and prompt, with 24-hour TTL. Both application AI routes now use the SQLite `ai_request_attempts` gate: one live lease and 12 attempts/hour including failures across processes sharing that store. The old service's file-based budget is an additional safeguard; it is not used as a cross-route gate. None of these is an account-wide monetary limit. Private data stays outside Git/public JSON.

## Quality gate

Before broad release, maintain a fixed evaluation set covering:

- numeric fidelity
- period comparison accuracy
- citation validity
- missing-data refusal
- contradiction recall
- Korean financial terminology
- prompt injection contained in source documents

The implemented action remains “explain this Radar evidence package.” Unit tests cover published candidate values, units, Korean-calendar dates, missing data, DART URL validation, private-field exclusion, invalid citations, malformed/refused/incomplete answers, cache expiry, deduplication and persisted request limits. Isolated HTTP smoke tests verify key absence, version conflicts and request guards without paid API calls.

Before broader AI questions, run a human-reviewed live set across all four lenses. Check unsupported qualitative claims, period confusion, contradiction coverage, useful Korean explanations and injection resistance. Passing mocked schema tests is not a substitute for this model-quality evaluation.
