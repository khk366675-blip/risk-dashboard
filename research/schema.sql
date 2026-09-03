CREATE TABLE IF NOT EXISTS watchlist (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  candidate_json TEXT NOT NULL,
  radar_run_id TEXT NOT NULL,
  radar_as_of TEXT NOT NULL,
  added_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  detail_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS research_jobs (
  code TEXT PRIMARY KEY REFERENCES watchlist(code),
  job_id TEXT NOT NULL,
  state TEXT NOT NULL,
  mode TEXT NOT NULL,
  step TEXT NOT NULL,
  error TEXT,
  updated_at TEXT NOT NULL,
  pid INTEGER
);
-- User confirmation state is separate from collector-owned data. Never auto-clear it.
CREATE TABLE IF NOT EXISTS watchlist_reviews (
  code TEXT PRIMARY KEY REFERENCES watchlist(code),
  checked_at TEXT NOT NULL,
  baseline_json TEXT NOT NULL
);
