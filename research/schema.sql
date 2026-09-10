CREATE TABLE IF NOT EXISTS dashboard_jobs (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('markets','radar')),
 state TEXT NOT NULL CHECK(state IN ('queued','running','completed','partial','error')),
 step TEXT NOT NULL, started_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 finished_at TEXT, error TEXT, pid INTEGER
);
CREATE TABLE IF NOT EXISTS comparison_sets (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, reason TEXT NOT NULL, codes_json TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT
);
CREATE TABLE IF NOT EXISTS pdf_documents (
 id TEXT PRIMARY KEY,code TEXT NOT NULL REFERENCES watchlist(code),title TEXT NOT NULL,
 sha256 TEXT NOT NULL,path TEXT NOT NULL,page_count INTEGER NOT NULL,created_at TEXT NOT NULL,
 archived_at TEXT, UNIQUE(code,sha256)
);
CREATE TABLE IF NOT EXISTS pdf_annotations (
 id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES pdf_documents(id),
 manual_id TEXT NOT NULL REFERENCES research_manual_evidence(id), page INTEGER NOT NULL,
 rectangles_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS dashboard_jobs_active ON dashboard_jobs(kind) WHERE state IN ('queued','running');
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
-- User-authored content is never part of collector-owned detail_json.
CREATE TABLE IF NOT EXISTS investment_theses (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL REFERENCES watchlist(code),
  revision INTEGER NOT NULL CHECK(revision >= 1),
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  content_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS investment_theses_code ON investment_theses(code,archived,created_at);
CREATE TABLE IF NOT EXISTS investment_thesis_revisions (
  thesis_id TEXT NOT NULL REFERENCES investment_theses(id),
  revision INTEGER NOT NULL CHECK(revision >= 1),
  archived INTEGER NOT NULL CHECK(archived IN (0,1)),
  saved_at TEXT NOT NULL,
  content_json TEXT NOT NULL,
  PRIMARY KEY(thesis_id,revision)
);
-- One durable paid-request gate shared by both local AI routes. No private text.
CREATE TABLE IF NOT EXISTS ai_request_attempts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  lease_until INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE TABLE IF NOT EXISTS thesis_ai_runs (
  id TEXT PRIMARY KEY REFERENCES ai_request_attempts(id),
  thesis_id TEXT NOT NULL,
  thesis_revision INTEGER NOT NULL,
  signature TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  state TEXT NOT NULL CHECK(state IN ('pending','completed','error')),
  error_message TEXT,
  answer_json TEXT,
  usage_json TEXT,
  adoption_json TEXT,
  FOREIGN KEY(thesis_id,thesis_revision) REFERENCES investment_thesis_revisions(thesis_id,revision)
);
CREATE INDEX IF NOT EXISTS thesis_ai_runs_point ON thesis_ai_runs(thesis_id,created_at);
-- DART originals are independent of user writing and source-review checkpoints.
CREATE TABLE IF NOT EXISTS filing_documents (
  code TEXT NOT NULL REFERENCES watchlist(code),
  receipt TEXT NOT NULL,
  title TEXT NOT NULL,
  filing_date TEXT,
  job_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('queued','running','ready','partial','error','unsupported')),
  requested_at TEXT NOT NULL,
  checked_at TEXT,
  error TEXT,
  current_version TEXT,
  PRIMARY KEY(code,receipt)
);
CREATE TABLE IF NOT EXISTS filing_document_versions (
  code TEXT NOT NULL,
  receipt TEXT NOT NULL,
  version TEXT NOT NULL,
  archive_sha256 TEXT NOT NULL,
  extracted_sha256 TEXT,
  archive_path TEXT NOT NULL,
  extracted_path TEXT,
  parser_version TEXT NOT NULL,
  collected_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  PRIMARY KEY(code,receipt,version),
  FOREIGN KEY(code,receipt) REFERENCES filing_documents(code,receipt)
);
-- User-selected source links are separate from thesis text and collector state.
CREATE TABLE IF NOT EXISTS research_evidence (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL REFERENCES watchlist(code),
  thesis_id TEXT NOT NULL REFERENCES investment_theses(id),
  thesis_revision INTEGER NOT NULL CHECK(thesis_revision >= 1),
  relation TEXT NOT NULL CHECK(relation IN ('supports','challenges','context')),
  note TEXT NOT NULL,
  receipt TEXT NOT NULL,
  document_title TEXT NOT NULL,
  document_version TEXT NOT NULL,
  document_collected_at TEXT NOT NULL,
  section_id TEXT NOT NULL,
  section_title TEXT NOT NULL,
  block_id TEXT NOT NULL,
  block_kind TEXT NOT NULL CHECK(block_kind IN ('text','table')),
  source_path TEXT NOT NULL,
  excerpt_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY(thesis_id,thesis_revision) REFERENCES investment_thesis_revisions(thesis_id,revision),
  FOREIGN KEY(code,receipt,document_version) REFERENCES filing_document_versions(code,receipt,version)
);
CREATE INDEX IF NOT EXISTS research_evidence_thesis ON research_evidence(thesis_id,archived_at,created_at);
-- v1 omitted receipt. Recreate the index so identical version hashes under separate
-- filings remain independently linkable without weakening active-link deduplication.
DROP INDEX IF EXISTS research_evidence_active_source;
CREATE UNIQUE INDEX research_evidence_active_source ON research_evidence(thesis_id,receipt,document_version,block_id) WHERE archived_at IS NULL;

-- User-selected, server-resolved financial observations. Values are immutable
-- snapshots and remain separate from source refresh state and thesis text.
CREATE TABLE IF NOT EXISTS research_financial_evidence (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL REFERENCES watchlist(code),
  thesis_id TEXT NOT NULL REFERENCES investment_theses(id),
  thesis_revision INTEGER NOT NULL CHECK(thesis_revision >= 1),
  relation TEXT NOT NULL CHECK(relation IN ('supports','challenges','context')),
  note TEXT NOT NULL,
  metric TEXT NOT NULL CHECK(metric IN ('rev','op','ni','ocf','op_margin_pct','equity','debt','debt_ratio_pct')),
  metric_label TEXT NOT NULL,
  unit TEXT NOT NULL,
  year INTEGER NOT NULL,
  quarter TEXT NOT NULL CHECK(quarter IN ('1Q','2Q','3Q','4Q')),
  value_json TEXT NOT NULL,
  statement_basis TEXT,
  receipt_no TEXT,
  source_run_id TEXT NOT NULL,
  source_collected_at TEXT NOT NULL,
  source_status_json TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY(thesis_id,thesis_revision) REFERENCES investment_thesis_revisions(thesis_id,revision)
);
CREATE INDEX IF NOT EXISTS research_financial_evidence_thesis ON research_financial_evidence(thesis_id,archived_at,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS research_financial_evidence_active_snapshot ON research_financial_evidence(thesis_id,snapshot_hash) WHERE archived_at IS NULL;

-- User-entered links, reports, news excerpts, and notes. URLs are stored as
-- references only; the application does not claim to have fetched or verified them.
CREATE TABLE IF NOT EXISTS research_manual_evidence (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL REFERENCES watchlist(code),
  thesis_id TEXT NOT NULL REFERENCES investment_theses(id),
  thesis_revision INTEGER NOT NULL CHECK(thesis_revision >= 1),
  relation TEXT NOT NULL CHECK(relation IN ('supports','challenges','context')),
  source_type TEXT NOT NULL CHECK(source_type IN ('news','broker_report','ir','industry','academic','memo','other')),
  title TEXT NOT NULL,
  url TEXT,
  source_name TEXT NOT NULL,
  published_at TEXT,
  body TEXT NOT NULL,
  note TEXT NOT NULL,
  source_status TEXT NOT NULL CHECK(source_status='user_supplied'),
  snapshot_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY(thesis_id,thesis_revision) REFERENCES investment_thesis_revisions(thesis_id,revision)
);
CREATE INDEX IF NOT EXISTS research_manual_evidence_thesis ON research_manual_evidence(thesis_id,archived_at,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS research_manual_evidence_active_snapshot ON research_manual_evidence(thesis_id,snapshot_hash) WHERE archived_at IS NULL;

-- Optional structured memo; legacy plain text and its hashes remain unchanged.
CREATE TABLE IF NOT EXISTS research_manual_documents (
  manual_id TEXT PRIMARY KEY REFERENCES research_manual_evidence(id),
  document_json TEXT NOT NULL
);

-- Per-item review state for the derived update inbox. Source data remains in its
-- collector-owned tables/files; this stores only the user's review decision.
CREATE TABLE IF NOT EXISTS research_update_states (
  item_key TEXT PRIMARY KEY,
  code TEXT NOT NULL REFERENCES watchlist(code),
  status TEXT NOT NULL CHECK(status IN ('open','reviewed')),
  note TEXT NOT NULL,
  reviewed_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS research_update_states_code ON research_update_states(code,status,updated_at);

-- User assessment of an investment hypothesis. It is deliberately separate
-- from the thesis text and from AI output.
CREATE TABLE IF NOT EXISTS investment_thesis_status (
  thesis_id TEXT PRIMARY KEY REFERENCES investment_theses(id),
  code TEXT NOT NULL REFERENCES watchlist(code),
  state TEXT NOT NULL CHECK(state IN ('open','strengthened','weakened','on_hold')),
  note TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS investment_thesis_status_code ON investment_thesis_status(code,state,updated_at);

-- Evidence-aware AI review. Inputs and outputs are immutable snapshots bound to
-- one thesis revision and one linked-evidence signature.
CREATE TABLE IF NOT EXISTS thesis_evidence_ai_runs (
  id TEXT PRIMARY KEY REFERENCES ai_request_attempts(id),
  thesis_id TEXT NOT NULL,
  thesis_revision INTEGER NOT NULL,
  evidence_signature TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  state TEXT NOT NULL CHECK(state IN ('pending','completed','error')),
  error_message TEXT,
  answer_json TEXT,
  usage_json TEXT,
  FOREIGN KEY(thesis_id,thesis_revision) REFERENCES investment_thesis_revisions(thesis_id,revision)
);
CREATE INDEX IF NOT EXISTS thesis_evidence_ai_runs_point ON thesis_evidence_ai_runs(thesis_id,created_at);

-- Company-specific operating metrics. These are user-authored observations,
-- independent from collector-owned financial statements.
CREATE TABLE IF NOT EXISTS research_kpis (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL REFERENCES watchlist(code),
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('price','quantity','cost','business','other')),
  description TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS research_kpis_code ON research_kpis(code,archived_at,updated_at);
CREATE TABLE IF NOT EXISTS research_kpi_observations (
  id TEXT PRIMARY KEY,
  kpi_id TEXT NOT NULL REFERENCES research_kpis(id),
  period TEXT NOT NULL,
  actual REAL,
  estimate REAL,
  source_label TEXT NOT NULL,
  source_url TEXT,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  CHECK(actual IS NOT NULL OR estimate IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS research_kpi_observations_kpi ON research_kpi_observations(kpi_id,archived_at,period);

-- Chronological user decision notes. A rejected idea remains recoverable.
CREATE TABLE IF NOT EXISTS research_journal_entries (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL REFERENCES watchlist(code),
  kind TEXT NOT NULL CHECK(kind IN ('insight','question','thesis_change','feedback','hold','rejected','revisit')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  source_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS research_journal_entries_code ON research_journal_entries(code,archived_at,occurred_at);

-- Learning records are reusable across companies and never collector-owned.
CREATE TABLE IF NOT EXISTS learning_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('book','lecture','article','other')),
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('to_read','reading','finished')),
  started_at TEXT,
  finished_at TEXT,
  tags_json TEXT NOT NULL,
  summary TEXT NOT NULL,
  lessons TEXT NOT NULL,
  changed_view TEXT NOT NULL,
  applications TEXT NOT NULL,
  disagreements TEXT NOT NULL,
  source_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS learning_items_status ON learning_items(archived_at,status,updated_at);
CREATE TABLE IF NOT EXISTS learning_stock_links (
  learning_id TEXT NOT NULL REFERENCES learning_items(id),
  code TEXT NOT NULL REFERENCES watchlist(code),
  created_at TEXT NOT NULL,
  PRIMARY KEY(learning_id,code)
);
