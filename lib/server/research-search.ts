import type { DatabaseSync } from 'node:sqlite';
export type SearchHit = {
  id: string;
  kind: string;
  title: string;
  excerpt: string;
  href: string;
};
export function searchResearch(db: DatabaseSync, query: string): SearchHit[] {
  const q = query.trim().toLocaleLowerCase('ko-KR').slice(0, 120);
  if (!q) return [];
  const sources = [
    {
      kind: '투자포인트',
      sql: `SELECT t.id,t.code,t.content_json AS body,w.name AS title FROM investment_theses t JOIN watchlist w ON w.code=t.code WHERE t.archived=0 AND w.active=1`,
      tab: 'thesis',
    },
    {
      kind: '외부 자료',
      sql: `SELECT m.id,m.code,m.thesis_id,m.title,m.body || ' ' || m.note AS body FROM research_manual_evidence m WHERE m.archived_at IS NULL AND m.code IN (SELECT code FROM watchlist WHERE active=1)`,
      tab: 'thesis',
    },
    {
      kind: '연결 원문',
      sql: `SELECT id,code,receipt,document_version,section_id,block_id,document_title AS title,excerpt_json AS body FROM research_evidence WHERE archived_at IS NULL AND code IN (SELECT code FROM watchlist WHERE active=1)`,
      tab: 'documents',
    },
    {
      kind: '리서치 로그',
      sql: `SELECT id,code,title,body FROM research_journal_entries WHERE archived_at IS NULL AND code IN (SELECT code FROM watchlist WHERE active=1)`,
      tab: 'journal',
    },
    {
      kind: '학습·저장 자료',
      sql: `SELECT id,'' AS code,title,summary || ' ' || lessons || ' ' || changed_view || ' ' || applications || ' ' || disagreements || ' ' || author || ' ' || tags_json AS body FROM learning_items WHERE archived_at IS NULL`,
      tab: 'learning',
    },
  ];
  return sources
    .flatMap((source) =>
      db
        .prepare(
          `SELECT * FROM (${source.sql}) WHERE instr(lower(title || ' ' || body),?)>0 LIMIT 20`,
        )
        .all(q)
        .map((row) => {
          let body = String(row.body);
          if (source.tab === 'thesis' && source.kind === '투자포인트') {
            const c = JSON.parse(body);
            body = [
              c.title,
              c.body,
              ...c.checks.map(
                (v: { text: string; answer?: string; unresolved?: string }) =>
                  [v.text, v.answer, v.unresolved].filter(Boolean).join(' '),
              ),
            ].join(' ');
          }
          if (source.kind === '연결 원문') {
            const c = JSON.parse(body);
            body = String(c.text ?? '');
          }
          const start = Math.max(
            0,
            body.toLocaleLowerCase('ko-KR').indexOf(q) - 35,
          );
          const query = new URLSearchParams({ tab: source.tab });
          if (source.kind === '투자포인트') query.set('thesis', String(row.id));
          if (source.kind === '외부 자료')
            query.set('thesis', String(row.thesis_id));
          if (source.kind === '연결 원문')
            for (const [param, column] of [
              ['receipt', 'receipt'],
              ['version', 'document_version'],
              ['section', 'section_id'],
              ['block', 'block_id'],
            ])
              query.set(param, String(row[column]));
          return {
            id: `${source.kind}:${String(row.id)}`,
            kind: source.kind,
            title: String(row.title),
            excerpt: body.slice(start, start + 220),
            href:
              source.tab === 'learning'
                ? `/learning?item=${String(row.id)}`
                : `/stocks/${String(row.code)}?${query}`,
          };
        }),
    )
    .slice(0, 80);
}
