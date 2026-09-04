# Value Investment Dashboard — Working Rules

## Product mission

Build a personal, visual-first investment learning dashboard. The product helps the user discover ideas, understand data, inspect primary evidence, and monitor change. It does not recommend, buy, sell, order, or manage a portfolio.

## Non-negotiable rules

- Radar outputs are discovery signals, never investability grades or recommendations.
- Do not display one opaque total score as the product's main conclusion.
- Every material metric and AI claim must be traceable to a source, period, and collection run.
- Stale, missing, partial, and failed data must stay visible in the UI.
- Never substitute AI text for missing source data.
- AI may explain, compare, annotate, and propose checks. It may not issue investment opinions, target prices, or trading actions.
- Portfolio allocation, position sizing, orders, and trading CTAs are out of scope.
- UI labels must be user-facing language, not raw internal keys.
- Generated artifacts are never the sole source of truth.
- A user-created evidence link is a review classification, not a verified fact or a proven thesis. Preserve the exact thesis revision and either the document version/section/block/source path/excerpt or the financial period/metric/value/basis/source state.
- Thesis review states are user-authored assessments. Evidence counts and AI output must never change them automatically.
- External source launchers are manual search aids, not collected or verified news. User-entered links remain `user_supplied` until independently checked.
- A stock added directly to the watchlist must retain `discovery: manual`; never present it as a Radar detection or fabricate Radar evidence. It may use the same follow-up collectors after registration, with missing and pending source states kept visible.
- Automatic news/report crawling and AI web collection are out of scope. Keep the user-reviewed link and note workflow as the external-evidence path.
- Evidence-aware AI may identify tensions, gaps, and questions only from the explicitly previewed snapshot. It must not follow links, browse, mutate thesis/status, or turn relationship labels into facts.
- Removing a thesis or evidence link must be recoverable archival state. Collection refreshes must not overwrite user links.

## Architecture

- Web: Next.js App Router, TypeScript, Tailwind CSS, shadcn/ui, Recharts.
- Operating target: local PC only. Do not push to GitHub or deploy to Vercel unless the user explicitly asks again.
- Radar, DART, and market collectors run locally. Preserve their existing local execution limits.
- Local SQLite and source files are persistent user data. Never reset them to repair a development server.
- Backups belong outside the project by default; restore into a new directory, never over the active database. API keys are excluded.
- Each collection run must have a stable `run_id`, `as_of`, `collected_at`, status, warnings, and source metadata.
- Update-inbox review state and thesis status are user data, separate from collector-owned detail JSON and source-review baselines.

## Development

- Keep the main workflow recognizable in the first viewport.
- Prefer tables, plots, and linked evidence over nested card grids.
- Use design tokens in `app/globals.css` before local one-off colors.
- Reuse `components/ui` primitives for interactive controls.
- Use representative fixtures only when clearly labeled as sample data.
- Before completing a change, run `npm run build` and the relevant tests.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
