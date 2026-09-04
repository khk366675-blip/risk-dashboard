import config from '../research/evidence-config.json' with { type: 'json' };

export const researchEvidenceConfig = config;

export const evidenceRelations = {
  supports: '뒷받침 검토',
  challenges: '반대·약화 검토',
  context: '참고·미확인',
} as const;

export type EvidenceRelation = keyof typeof evidenceRelations;
export type ResearchEvidence = {
  id: string;
  code: string;
  thesis_id: string;
  thesis_revision: number;
  relation: EvidenceRelation;
  note: string;
  receipt: string;
  document_title: string;
  document_version: string;
  collected_at: string;
  section_id: string;
  section_title: string;
  block_id: string;
  block_kind: 'text' | 'table';
  source_path: string;
  excerpt: {
    text: string;
    rows?: {
      text: string;
      header: boolean;
      rowspan: number;
      colspan: number;
    }[][];
  };
  created_at: string;
  archived_at: string | null;
};
