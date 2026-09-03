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

## Architecture

- Web: Next.js App Router, TypeScript, Tailwind CSS, shadcn/ui, Recharts.
- Hosting: GitHub-connected Vercel deployment.
- Long-running Radar, DART, and market collection jobs must run outside Vercel request handlers.
- Persistent production data belongs in a hosted database. Do not depend on local JSON or SQLite at runtime.
- Each collection run must have a stable `run_id`, `as_of`, `collected_at`, status, warnings, and source metadata.

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
