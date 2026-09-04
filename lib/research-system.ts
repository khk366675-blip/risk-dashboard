export type KpiCategory = 'price' | 'quantity' | 'cost' | 'business' | 'other';
export const kpiCategoryLabels: Record<KpiCategory, string> = {
  price: 'P · 가격',
  quantity: 'Q · 수량',
  cost: 'C · 비용',
  business: '사업 지표',
  other: '기타',
};
export type KpiObservation = {
  id: string;
  period: string;
  actual: number | null;
  estimate: number | null;
  source_label: string;
  source_url: string | null;
  note: string;
  created_at: string;
  updated_at: string;
};
export type ResearchKpi = {
  id: string;
  code: string;
  name: string;
  unit: string;
  category: KpiCategory;
  description: string;
  created_at: string;
  updated_at: string;
  observations: KpiObservation[];
};
export type JournalKind =
  | 'insight'
  | 'question'
  | 'thesis_change'
  | 'feedback'
  | 'hold'
  | 'rejected'
  | 'revisit';
export const journalKindLabels: Record<JournalKind, string> = {
  insight: '인사이트',
  question: '확인 질문',
  thesis_change: '논리 변경',
  feedback: '피드백',
  hold: '보류',
  rejected: '검토 중단',
  revisit: '재검토',
};
export type JournalEntry = {
  id: string;
  code: string;
  kind: JournalKind;
  title: string;
  body: string;
  occurred_at: string;
  source_url: string | null;
  created_at: string;
  updated_at: string;
};
export type LearningStatus = 'to_read' | 'reading' | 'finished';
export const learningStatusLabels: Record<LearningStatus, string> = {
  to_read: '읽을 예정',
  reading: '읽는 중',
  finished: '완독',
};
export type LearningKind = 'book' | 'lecture' | 'article' | 'other';
export const learningKindLabels: Record<LearningKind, string> = {
  book: '책',
  lecture: '특강',
  article: '아티클',
  other: '기타',
};
export type LearningItem = {
  id: string;
  kind: LearningKind;
  title: string;
  author: string;
  status: LearningStatus;
  started_at: string | null;
  finished_at: string | null;
  tags: string[];
  summary: string;
  lessons: string;
  changed_view: string;
  applications: string;
  disagreements: string;
  source_url: string | null;
  linked_stocks: { code: string; name: string }[];
  created_at: string;
  updated_at: string;
};
export type ResearchSystemSnapshot = {
  kpis: ResearchKpi[];
  archived_kpis: ResearchKpi[];
  journal: JournalEntry[];
  archived_journal: JournalEntry[];
  learning: LearningItem[];
  generated_at: string;
};
