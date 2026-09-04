import config from '../research/documents-config.json' with { type: 'json' };
import type { StockEvent } from './stock-detail';
export const documentConfig = config;
export const documentGroups = {
  all: '전체 목차',
  business: '사업 내용',
  notes: '주석',
  financials: '재무',
  other: '기타',
};
export type DocumentGroup = keyof typeof documentGroups;
export type DocumentBlock = {
  id: string;
  section_id: string;
  kind: 'text' | 'table';
  text: string;
  source_path: string;
  rows?: {
    text: string;
    header: boolean;
    rowspan: number;
    colspan: number;
  }[][];
};
export type DocumentSection = {
  id: string;
  title: string;
  group: Exclude<DocumentGroup, 'all'>;
  block_count: number;
};
export type DocumentExtraction = {
  parser_version: string;
  receipt: string;
  member: string;
  xml_sha256: string;
  omitted_members: string[];
  warnings: string[];
  sections: DocumentSection[];
  blocks: DocumentBlock[];
  status: 'ready' | 'partial';
};
export type FilingDocument = {
  receipt: string;
  title: string;
  filing_date: string | null;
  source_url: string;
  state: string;
  error: string | null;
  current_version: string | null;
  checked_at: string | null;
  requested_at: string | null;
  cached: boolean;
  supported: boolean;
};
export type DocumentView = {
  document: FilingDocument;
  version: string;
  collected_at: string;
  archive_sha256: string;
  parser_version: string;
  versions: { version: string; collected_at: string }[];
  sections: DocumentSection[];
  section_id: string;
  blocks: DocumentBlock[];
  total_blocks: number;
  offset: number;
  warnings: string[];
  member: string;
  omitted_members: string[];
};
export type DocumentSearchResult = {
  receipt: string;
  title: string;
  filing_date: string | null;
  version: string;
  collected_at: string;
  current: boolean;
  section_id: string;
  section_title: string;
  section_group: Exclude<DocumentGroup, 'all'>;
  block_id: string;
  block_kind: DocumentBlock['kind'];
  source_path: string;
  excerpt: string;
};
export type DocumentSearchResponse = {
  query: string;
  group: DocumentGroup;
  receipt: string | null;
  versions: 'current' | 'all';
  items: DocumentSearchResult[];
  result_count: number;
  truncated: boolean;
  warnings: string[];
  coverage: {
    status: 'ok' | 'partial' | 'missing';
    candidate_versions: number;
    searched_versions: number;
    failed_versions: number;
    version_limit_reached: boolean;
  };
};
export type DocumentChangeSource = {
  receipt: string;
  title: string;
  filing_date: string | null;
  version: string;
  collected_at: string;
  section_id: string;
  section_title: string;
  section_group: Exclude<DocumentGroup, 'all'>;
  block_id: string;
  block_kind: DocumentBlock['kind'];
  source_path: string;
  excerpt: string;
};
export type DocumentChange = {
  id: string;
  kind: 'added' | 'removed' | 'changed';
  before: DocumentChangeSource | null;
  after: DocumentChangeSource | null;
};
export type DocumentCompareResponse = {
  from: Pick<
    DocumentChangeSource,
    'receipt' | 'title' | 'filing_date' | 'version' | 'collected_at'
  >;
  to: Pick<
    DocumentChangeSource,
    'receipt' | 'title' | 'filing_date' | 'version' | 'collected_at'
  >;
  group: DocumentGroup;
  query: string;
  items: DocumentChange[];
  counts: { added: number; removed: number; changed: number };
  truncated: boolean;
  warnings: string[];
  coverage: {
    status: 'ok' | 'partial';
    from_sections: number;
    to_sections: number;
    aligned_sections: number;
    fallback_sections: number;
  };
};
export const documentStateLabels: Record<string, string> = {
  not_collected: '미수집',
  queued: '수집 대기',
  running: '수집 중',
  ready: '추출본 있음',
  partial: '일부 추출',
  error: '수집 실패',
  unsupported: '추출 미지원',
  interrupted: '수집 응답 끊김',
};
export function filingReceipt(event: StockEvent) {
  const receipt = /^(?:dart:)?(\d{14})$/.exec(event.id ?? '')?.[1];
  if (!receipt) return null;
  try {
    const url = new URL(event.url ?? '');
    return url.protocol === 'https:' &&
      url.hostname === 'dart.fss.or.kr' &&
      url.searchParams.get('rcpNo') === receipt
      ? receipt
      : null;
  } catch {
    return null;
  }
}
export function supportedReport(title: string) {
  return /사업보고서|분기보고서|반기보고서/.test(title);
}
export const documentUrl = (receipt: string) =>
  `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${receipt}`;
