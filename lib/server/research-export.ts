import type { DatabaseSync } from 'node:sqlite';
import type { StockDetail } from '../stock-detail.ts';
import { ThesisStore } from './thesis-store.ts';
import { ResearchSystemStore } from './research-system-store.ts';

export function researchMarkdown(db: DatabaseSync, stock: StockDetail): string {
  const lines = [
    `# ${stock.name} (${stock.code})`,
    `내보내기: ${new Date().toISOString()}`,
    `가격 기준일: ${stock.summary.price_as_of ?? '미확인'} · 자료 실행: ${stock.research_run_id ?? stock.run_id ?? '미확인'}`,
    '사용자가 작성한 가설·분류·답변이며 투자 결론이 아닙니다.',
  ];
  for (const point of new ThesisStore(db)
    .list(stock.code)
    .filter((p) => !p.archived)) {
    lines.push(
      `## ${point.content.title || '투자포인트'} · v${point.revision}`,
      point.content.body,
      `예상 시기: ${point.content.timing || '미작성'}`,
      `약화 조건: ${point.content.weakens || '미작성'}`,
      `원문: ${point.content.source_url || '미연결'}`,
    );
    for (const check of point.content.checks)
      lines.push(
        `### 질문: ${check.text}`,
        `상태: ${check.status === 'answered' ? '답변 기록됨' : check.status === 'reviewing' ? '확인 중' : '미확인'}`,
        `확인한 내용: ${check.answer || '미작성'}`,
        `남은 질문: ${check.unresolved || '미작성'}`,
        `참조 자료: ${(check.evidence_ids ?? []).join(', ') || '미연결'}`,
      );
    for (const [kind, table] of [
      ['document', 'research_evidence'],
      ['financial', 'research_financial_evidence'],
      ['manual', 'research_manual_evidence'],
    ]) {
      for (const row of db
        .prepare(
          `SELECT * FROM ${table} WHERE thesis_id=? AND archived_at IS NULL ORDER BY created_at`,
        )
        .all(point.id)) {
        const title = String(
          row.document_title ?? row.metric_label ?? row.title,
        );
        const relation =
          row.relation === 'supports'
            ? '뒷받침'
            : row.relation === 'challenges'
              ? '약화'
              : '미확인';
        lines.push(
          `### ${title} · ${relation}`,
          `자료 ID: ${kind}:${String(row.id)} · 연결한 가설 버전: ${String(row.thesis_revision)}`,
          `메모: ${String(row.note || '없음')}`,
        );
        if (kind === 'document')
          lines.push(
            String(JSON.parse(String(row.excerpt_json)).text ?? ''),
            `원문: https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${String(row.receipt)}`,
            `위치: ${String(row.section_title)} / ${String(row.block_id)} · 원문 버전: ${String(row.document_version)} · 수집일: ${String(row.document_collected_at)}`,
          );
        if (kind === 'financial')
          lines.push(
            `대상 기간: ${String(row.year)} ${String(row.quarter)} · 기준: ${String(row.statement_basis ?? '미확인')}`,
            `값: ${String(JSON.parse(String(row.value_json)).value ?? '누락')} ${String(row.unit)}`,
            `원문: ${row.receipt_no ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${String(row.receipt_no)}` : '미연결'}`,
            `실행: ${String(row.source_run_id)} · 수집일: ${String(row.source_collected_at)} · 상태: ${String(row.source_status_json)}`,
          );
        if (kind === 'manual')
          lines.push(
            String(row.body),
            `원문: ${String(row.url || '미연결')}`,
            `출처: ${String(row.source_name || '미입력')} · 발행일: ${String(row.published_at || '미입력')} · 사용자 입력·미검증`,
          );
      }
    }
  }
  const system = new ResearchSystemStore(db).snapshot(stock.code);
  lines.push('## 사업 KPI');
  for (const kpi of system.kpis) {
    lines.push(`### ${kpi.name} (${kpi.unit})`);
    for (const observation of kpi.observations)
      lines.push(
        `${observation.period}: ${observation.actual ?? '누락'} · 출처: ${observation.source_label || '미입력'} ${observation.source_url || ''}`,
      );
  }
  lines.push('## 리서치 로그');
  for (const entry of system.journal)
    lines.push(
      `### ${entry.occurred_at} · ${entry.title}`,
      entry.body,
      entry.source_url || '',
    );
  lines.push('## 연결된 Learning');
  for (const item of system.learning)
    lines.push(
      `### ${item.title}`,
      item.summary,
      item.lessons,
      item.source_url || '',
    );
  lines.push('## 데이터 상태', JSON.stringify(stock.source_status, null, 2));
  return lines.join('\n\n') + '\n';
}
