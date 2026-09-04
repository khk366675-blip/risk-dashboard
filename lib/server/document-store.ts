import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { ThesisStore } from './thesis-store.ts';
import { ThesisError, uuidPattern } from '../investment-thesis.ts';
import {
  documentConfig,
  filingReceipt,
  supportedReport,
  documentUrl,
  type FilingDocument,
  type DocumentExtraction,
  type DocumentView,
  type DocumentBlock,
  type DocumentSection,
  type DocumentGroup,
  type DocumentSearchResponse,
  type DocumentSearchResult,
  type DocumentCompareResponse,
  type DocumentChange,
  type DocumentChangeSource,
} from '../filing-documents.ts';
import type { StockDetail } from '../stock-detail';

function comparisonText(block: DocumentBlock) {
  return block.text.replace(/\s+/g, ' ').trim();
}

function comparisonSectionTitle(title: string) {
  return title
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/\s+/g, ' ')
    .trim();
}

export class DocumentStore {
  db: DatabaseSync;
  directory: string;
  now: () => number;
  constructor(db: DatabaseSync, directory: string, now = Date.now) {
    this.db = db;
    this.directory = directory;
    this.now = now;
  }
  list(code: string): { items: FilingDocument[]; source_status: unknown } {
    if (!/^\d{6}$/.test(code))
      throw new ThesisError('종목코드를 확인해 주세요.');
    const membership = this.db
      .prepare('SELECT active FROM watchlist WHERE code=?')
      .get(code);
    if (!membership) throw new ThesisError('관심종목을 찾지 못했습니다.', 404);
    if (membership.active !== 1)
      throw new ThesisError(
        '관심종목으로 다시 등록한 후 원문을 확인해 주세요. 저장본은 보존되어 있습니다.',
        409,
      );
    const stock = JSON.parse(
      String(
        this.db
          .prepare('SELECT detail_json FROM watchlist WHERE code=?')
          .get(code)!.detail_json,
      ),
    ) as StockDetail;
    const items = new Map<string, FilingDocument>();
    for (const event of stock.events ?? []) {
      const receipt = filingReceipt(event);
      if (!receipt || !supportedReport(event.title ?? '')) continue;
      items.set(receipt, {
        receipt,
        title: event.title ?? '보고서 제목 미확인',
        filing_date: event.date,
        source_url: documentUrl(receipt),
        state: 'not_collected',
        error: null,
        current_version: null,
        checked_at: null,
        requested_at: null,
        cached: false,
        supported: true,
      });
    }
    for (const row of this.db
      .prepare('SELECT * FROM filing_documents WHERE code=?')
      .all(code)) {
      const interrupted =
        ['queued', 'running'].includes(String(row.state)) &&
        this.now() - Date.parse(String(row.requested_at)) >
          documentConfig.job_timeout_ms;
      const receipt = String(row.receipt);
      items.set(receipt, {
        receipt,
        title: String(row.title),
        filing_date: row.filing_date as string | null,
        source_url: documentUrl(receipt),
        state: interrupted ? 'interrupted' : String(row.state),
        error: interrupted
          ? '수집 제한 시간이 지났습니다. 저장본은 유지하며 자동 재실행하지 않습니다.'
          : (row.error as string | null),
        current_version: row.current_version as string | null,
        checked_at: row.checked_at as string | null,
        requested_at: row.requested_at as string | null,
        cached:
          !!row.checked_at &&
          this.now() >= Date.parse(String(row.checked_at)) &&
          this.now() - Date.parse(String(row.checked_at)) <
            documentConfig.cache_ttl_hours * 3600000,
        supported: supportedReport(String(row.title)),
      });
    }
    return {
      items: [...items.values()].sort((a, b) =>
        b.receipt.localeCompare(a.receipt),
      ),
      source_status: stock.source_status.dart_events ?? null,
    };
  }
  enqueue(code: string, receipt: string, id: string, refresh: boolean) {
    if (
      typeof receipt !== 'string' ||
      !/^\d{14}$/.test(receipt) ||
      !uuidPattern.test(id) ||
      typeof refresh !== 'boolean'
    )
      throw new ThesisError('원문 수집 요청을 확인해 주세요.');
    return new ThesisStore(this.db).transaction(() => {
      const current = this.list(code).items.find((d) => d.receipt === receipt);
      if (!current?.supported)
        throw new ThesisError(
          '수집한 공시 목록의 정기보고서만 원문을 요청할 수 있습니다.',
          404,
        );
      const row = this.db
        .prepare(
          'SELECT job_id FROM filing_documents WHERE code=? AND receipt=?',
        )
        .get(code, receipt);
      if (row?.job_id === id || ['queued', 'running'].includes(current.state))
        return false;
      if (
        !refresh &&
        current.cached &&
        ['ready', 'partial'].includes(current.state)
      )
        return false;
      if (
        this.db
          .prepare(
            "SELECT 1 FROM filing_documents WHERE state IN ('queued','running') AND requested_at>?",
          )
          .get(
            new Date(this.now() - documentConfig.job_timeout_ms).toISOString(),
          )
      )
        throw new ThesisError(
          '다른 원문을 수집 중입니다. 완료 후 실행해 주세요.',
          429,
        );
      this.db
        .prepare(
          "INSERT INTO filing_documents(code,receipt,title,filing_date,job_id,state,requested_at) VALUES(?,?,?,?,?,'queued',?) ON CONFLICT(code,receipt) DO UPDATE SET job_id=excluded.job_id,state='queued',error=NULL,requested_at=excluded.requested_at",
        )
        .run(
          code,
          receipt,
          current.title,
          current.filing_date,
          id,
          new Date(this.now()).toISOString(),
        );
      return true;
    });
  }
  fail(code: string, receipt: string, id: string) {
    this.db
      .prepare(
        "UPDATE filing_documents SET state='error',error='원문 수집기를 시작하지 못했습니다. 로컬 Python 실행 환경을 확인해 주세요.' WHERE code=? AND receipt=? AND job_id=? AND state IN ('queued','running')",
      )
      .run(code, receipt, id);
  }
  source(
    code: string,
    receipt: string,
    version?: string,
  ): {
    document: FilingDocument;
    version: string;
    collected_at: string;
    archive_sha256: string;
    parser_version: string;
    data: DocumentExtraction;
  } {
    const document = this.list(code).items.find((d) => d.receipt === receipt);
    if (!document) throw new ThesisError('보고서를 찾지 못했습니다.', 404);
    const selected = version || document.current_version;
    if (!selected) throw new ThesisError('저장된 원문 추출본이 없습니다.', 404);
    const row = this.db
      .prepare(
        'SELECT * FROM filing_document_versions WHERE code=? AND receipt=? AND version=?',
      )
      .get(code, receipt, selected);
    if (!row?.extracted_path)
      throw new ThesisError(
        '이 버전은 추출 미지원입니다. DART 원문에서 확인해 주세요.',
        422,
      );
    const relative = String(row.extracted_path);
    if (
      !new RegExp(
        `^${documentConfig.directory}/[0-9]{6}/[0-9]{14}/[a-f0-9]{64}\\.json$`,
      ).test(relative)
    )
      throw new ThesisError('원문 저장 경로를 확인하지 못했습니다.', 503);
    const resolved = realpathSync(path.join(this.directory, relative));
    const root = realpathSync(this.directory);
    if (
      !resolved.startsWith(root + path.sep) ||
      statSync(resolved).size > documentConfig.max_extracted_bytes
    )
      throw new ThesisError('원문 저장 파일을 확인하지 못했습니다.', 503);
    const bytes = readFileSync(resolved);
    if (
      createHash('sha256').update(bytes).digest('hex') !== row.extracted_sha256
    )
      throw new ThesisError(
        '저장된 추출본 무결성 검사에 실패했습니다. 원문을 다시 수집해 주세요.',
        503,
      );
    const data = JSON.parse(bytes.toString('utf8')) as DocumentExtraction;
    if (
      data.receipt !== receipt ||
      !Array.isArray(data.sections) ||
      !Array.isArray(data.blocks)
    )
      throw new ThesisError('원문 추출 구조를 확인하지 못했습니다.', 503);
    return {
      document,
      version: selected,
      collected_at: String(row.collected_at),
      archive_sha256: String(row.archive_sha256),
      parser_version: String(row.parser_version),
      data,
    };
  }
  sourceBlock(
    code: string,
    receipt: string,
    version: string,
    sectionId: string,
    blockId: string,
  ): {
    document: FilingDocument;
    version: string;
    collected_at: string;
    section: DocumentSection;
    block: DocumentBlock;
  } {
    const source = this.source(code, receipt, version);
    const section = source.data.sections.find((item) => item.id === sectionId);
    const block = source.data.blocks.find(
      (item) => item.id === blockId && item.section_id === sectionId,
    );
    if (!section || !block)
      throw new ThesisError('연결할 원문 위치를 찾지 못했습니다.', 404);
    return { ...source, section, block };
  }
  search(
    code: string,
    options: {
      query: string;
      group?: DocumentGroup;
      receipt?: string;
      versions?: 'current' | 'all';
    },
  ): DocumentSearchResponse {
    // list() provides the same active-watchlist and code validation used by the reader.
    const documents = this.list(code).items;
    const query = String(options.query ?? '')
      .trim()
      .replace(/\s+/g, ' ');
    if (
      query.length < documentConfig.search_min_chars ||
      query.length > documentConfig.search_max_chars
    )
      throw new ThesisError(
        `검색어는 ${documentConfig.search_min_chars}~${documentConfig.search_max_chars}자로 입력해 주세요.`,
      );
    const group = options.group ?? 'all';
    if (!['all', 'business', 'notes', 'financials', 'other'].includes(group))
      throw new ThesisError('검색할 목차 분류를 확인해 주세요.');
    const versions = options.versions ?? 'current';
    if (!['current', 'all'].includes(versions))
      throw new ThesisError('검색할 저장 버전을 확인해 주세요.');
    if (options.receipt && !/^\d{14}$/.test(options.receipt))
      throw new ThesisError('검색할 보고서 접수번호를 확인해 주세요.');
    if (
      options.receipt &&
      !documents.some((document) => document.receipt === options.receipt)
    )
      throw new ThesisError('검색할 보고서를 찾지 못했습니다.', 404);

    const filters = ['v.code=?'];
    const params: string[] = [code];
    if (options.receipt) {
      filters.push('v.receipt=?');
      params.push(options.receipt);
    }
    if (versions === 'current') filters.push('v.version=d.current_version');
    const rows = this.db
      .prepare(
        `SELECT v.receipt,v.version,v.collected_at,d.current_version
         FROM filing_document_versions v
         JOIN filing_documents d ON d.code=v.code AND d.receipt=v.receipt
         WHERE ${filters.join(' AND ')}
         ORDER BY CASE WHEN v.version=d.current_version THEN 0 ELSE 1 END,
                  v.receipt DESC,v.collected_at DESC,v.rowid DESC
         LIMIT ?`,
      )
      .all(...params, documentConfig.search_max_versions + 1) as {
      receipt: string;
      version: string;
      collected_at: string;
      current_version: string | null;
    }[];
    const versionLimitReached =
      rows.length > documentConfig.search_max_versions;
    const candidates = rows.slice(0, documentConfig.search_max_versions);
    const terms = query.toLocaleLowerCase('ko-KR').split(' ');
    const items: DocumentSearchResult[] = [];
    const warnings: string[] = [];
    let searchedVersions = 0;
    let failedVersions = 0;
    let truncated = false;
    for (const row of candidates) {
      try {
        const source = this.source(code, row.receipt, row.version);
        searchedVersions += 1;
        const sections = new Map(source.data.sections.map((s) => [s.id, s]));
        for (const block of source.data.blocks) {
          const section = sections.get(block.section_id);
          if (!section || (group !== 'all' && section.group !== group))
            continue;
          const normalized = block.text.replace(/\s+/g, ' ').trim();
          const lower = normalized.toLocaleLowerCase('ko-KR');
          if (!terms.every((term) => lower.includes(term))) continue;
          if (items.length >= documentConfig.search_max_results) {
            truncated = true;
            break;
          }
          const first = Math.min(
            ...terms.map((term) => lower.indexOf(term)).filter((at) => at >= 0),
          );
          const start = Math.max(0, first - 90);
          const end = Math.min(normalized.length, first + query.length + 150);
          items.push({
            receipt: row.receipt,
            title: source.document.title,
            filing_date: source.document.filing_date,
            version: row.version,
            collected_at: row.collected_at,
            current: row.version === row.current_version,
            section_id: section.id,
            section_title: section.title,
            section_group: section.group,
            block_id: block.id,
            block_kind: block.kind,
            source_path: block.source_path,
            excerpt: `${start ? '…' : ''}${normalized.slice(start, end)}${end < normalized.length ? '…' : ''}`,
          });
        }
        if (truncated) break;
      } catch (error) {
        failedVersions += 1;
        warnings.push(
          `${row.receipt} · ${row.version.slice(0, 8)} 저장본을 읽지 못해 검색에서 제외했습니다: ${(error as Error).message}`,
        );
      }
    }
    if (versionLimitReached)
      warnings.push(
        `저장본이 ${documentConfig.search_max_versions}개를 넘어 최근 범위만 검색했습니다.`,
      );
    if (truncated)
      warnings.push(
        `결과가 ${documentConfig.search_max_results}개를 넘어 일부만 표시합니다. 검색어 또는 필터를 좁혀 주세요.`,
      );
    const status = !candidates.length
      ? 'missing'
      : failedVersions || versionLimitReached || truncated
        ? 'partial'
        : 'ok';
    return {
      query,
      group,
      receipt: options.receipt ?? null,
      versions,
      items,
      result_count: items.length,
      truncated,
      warnings,
      coverage: {
        status,
        candidate_versions: candidates.length,
        searched_versions: searchedVersions,
        failed_versions: failedVersions,
        version_limit_reached: versionLimitReached,
      },
    };
  }
  compare(
    code: string,
    options: {
      fromReceipt: string;
      toReceipt: string;
      group?: DocumentGroup;
      query?: string;
    },
  ): DocumentCompareResponse {
    if (
      !/^\d{14}$/.test(options.fromReceipt) ||
      !/^\d{14}$/.test(options.toReceipt) ||
      options.fromReceipt === options.toReceipt
    )
      throw new ThesisError('서로 다른 두 저장 보고서를 선택해 주세요.');
    const group = options.group ?? 'all';
    if (!['all', 'business', 'notes', 'financials', 'other'].includes(group))
      throw new ThesisError('비교할 목차 분류를 확인해 주세요.');
    const query = String(options.query ?? '')
      .trim()
      .replace(/\s+/g, ' ');
    if (
      query &&
      (query.length < documentConfig.search_min_chars ||
        query.length > documentConfig.search_max_chars)
    )
      throw new ThesisError(
        `변화 검색어는 비워두거나 ${documentConfig.search_min_chars}~${documentConfig.search_max_chars}자로 입력해 주세요.`,
      );
    const listed = this.list(code).items;
    const fromDocument = listed.find(
      (item) => item.receipt === options.fromReceipt,
    );
    const toDocument = listed.find(
      (item) => item.receipt === options.toReceipt,
    );
    if (!fromDocument?.current_version || !toDocument?.current_version)
      throw new ThesisError(
        '두 보고서 모두 저장된 원문 추출본이 있어야 변화 대조를 할 수 있습니다.',
        409,
      );
    const from = this.source(
      code,
      options.fromReceipt,
      fromDocument.current_version,
    );
    const to = this.source(code, options.toReceipt, toDocument.current_version);
    type SectionBlocks = {
      section: DocumentSection;
      blocks: DocumentBlock[];
    };
    const indexedSections = (data: DocumentExtraction) => {
      const counts = new Map<string, number>();
      const result = new Map<string, SectionBlocks>();
      for (const section of data.sections) {
        if (group !== 'all' && section.group !== group) continue;
        const title = comparisonSectionTitle(section.title);
        const occurrence = (counts.get(title) ?? 0) + 1;
        counts.set(title, occurrence);
        result.set(`${title}#${occurrence}`, {
          section,
          blocks: data.blocks.filter(
            (block) => block.section_id === section.id && comparisonText(block),
          ),
        });
      }
      return result;
    };
    const fromSections = indexedSections(from.data);
    const toSections = indexedSections(to.data);
    const warnings: string[] = [];
    let alignedSections = 0;
    let fallbackSections = 0;
    const changes: DocumentChange[] = [];
    const sourceValue = (
      side: typeof from,
      section: DocumentSection,
      block: DocumentBlock,
    ): DocumentChangeSource => ({
      receipt: side.document.receipt,
      title: side.document.title,
      filing_date: side.document.filing_date,
      version: side.version,
      collected_at: side.collected_at,
      section_id: section.id,
      section_title: section.title,
      section_group: section.group,
      block_id: block.id,
      block_kind: block.kind,
      source_path: block.source_path,
      excerpt: comparisonText(block).slice(
        0,
        documentConfig.compare_excerpt_chars,
      ),
    });
    const addChange = (
      kind: DocumentChange['kind'],
      before: DocumentChangeSource | null,
      after: DocumentChangeSource | null,
    ) => {
      changes.push({
        id: `${kind}:${before?.receipt ?? ''}:${before?.block_id ?? ''}:${after?.receipt ?? ''}:${after?.block_id ?? ''}`,
        kind,
        before,
        after,
      });
    };
    const compareSection = (older: SectionBlocks, newer: SectionBlocks) => {
      alignedSections += 1;
      const left = older.blocks;
      const right = newer.blocks;
      const leftText = left.map(
        (block) => `${block.kind}:${comparisonText(block)}`,
      );
      const rightText = right.map(
        (block) => `${block.kind}:${comparisonText(block)}`,
      );
      const emitSegment = (
        leftStart: number,
        leftEnd: number,
        rightStart: number,
        rightEnd: number,
      ) => {
        const pairs = Math.min(leftEnd - leftStart, rightEnd - rightStart);
        for (let index = 0; index < pairs; index += 1)
          addChange(
            'changed',
            sourceValue(from, older.section, left[leftStart + index]),
            sourceValue(to, newer.section, right[rightStart + index]),
          );
        for (let index = leftStart + pairs; index < leftEnd; index += 1)
          addChange(
            'removed',
            sourceValue(from, older.section, left[index]),
            null,
          );
        for (let index = rightStart + pairs; index < rightEnd; index += 1)
          addChange(
            'added',
            null,
            sourceValue(to, newer.section, right[index]),
          );
      };
      if (
        left.length * right.length >
        documentConfig.compare_max_section_product
      ) {
        fallbackSections += 1;
        let index = 0;
        for (; index < Math.min(left.length, right.length); index += 1) {
          if (leftText[index] !== rightText[index])
            addChange(
              'changed',
              sourceValue(from, older.section, left[index]),
              sourceValue(to, newer.section, right[index]),
            );
        }
        for (; index < left.length; index += 1)
          addChange(
            'removed',
            sourceValue(from, older.section, left[index]),
            null,
          );
        for (; index < right.length; index += 1)
          addChange(
            'added',
            null,
            sourceValue(to, newer.section, right[index]),
          );
        return;
      }
      const matrix = Array.from(
        { length: left.length + 1 },
        () => new Uint32Array(right.length + 1),
      );
      for (let i = 1; i <= left.length; i += 1)
        for (let j = 1; j <= right.length; j += 1)
          matrix[i][j] =
            leftText[i - 1] === rightText[j - 1]
              ? matrix[i - 1][j - 1] + 1
              : Math.max(matrix[i - 1][j], matrix[i][j - 1]);
      const anchors: [number, number][] = [];
      let i = left.length;
      let j = right.length;
      while (i && j) {
        if (leftText[i - 1] === rightText[j - 1]) {
          anchors.push([i - 1, j - 1]);
          i -= 1;
          j -= 1;
        } else if (matrix[i - 1][j] >= matrix[i][j - 1]) i -= 1;
        else j -= 1;
      }
      anchors.reverse();
      let leftStart = 0;
      let rightStart = 0;
      for (const [leftAnchor, rightAnchor] of anchors) {
        emitSegment(leftStart, leftAnchor, rightStart, rightAnchor);
        leftStart = leftAnchor + 1;
        rightStart = rightAnchor + 1;
      }
      emitSegment(leftStart, left.length, rightStart, right.length);
    };
    for (const [key, newer] of toSections) {
      const older = fromSections.get(key);
      if (older) compareSection(older, newer);
      else
        for (const block of newer.blocks)
          addChange('added', null, sourceValue(to, newer.section, block));
    }
    for (const [key, older] of fromSections) {
      if (toSections.has(key)) continue;
      for (const block of older.blocks)
        addChange('removed', sourceValue(from, older.section, block), null);
    }
    if (fallbackSections)
      warnings.push(
        `큰 목차 ${fallbackSections}개는 문단 순서 기준으로 비교했습니다. 원문에서 위치를 다시 확인해 주세요.`,
      );
    const terms = query ? query.toLocaleLowerCase('ko-KR').split(' ') : [];
    const filtered = terms.length
      ? changes.filter((change) => {
          const haystack =
            `${change.before?.excerpt ?? ''} ${change.after?.excerpt ?? ''}`.toLocaleLowerCase(
              'ko-KR',
            );
          return terms.every((term) => haystack.includes(term));
        })
      : changes;
    const counts = {
      added: filtered.filter((change) => change.kind === 'added').length,
      removed: filtered.filter((change) => change.kind === 'removed').length,
      changed: filtered.filter((change) => change.kind === 'changed').length,
    };
    const truncated = filtered.length > documentConfig.compare_max_results;
    if (truncated)
      warnings.push(
        `변화가 ${documentConfig.compare_max_results}개를 넘어 일부만 표시합니다. 목차 분류나 검색어로 범위를 좁혀 주세요.`,
      );
    const documentInfo = (source: typeof from) => ({
      receipt: source.document.receipt,
      title: source.document.title,
      filing_date: source.document.filing_date,
      version: source.version,
      collected_at: source.collected_at,
    });
    return {
      from: documentInfo(from),
      to: documentInfo(to),
      group,
      query,
      items: filtered.slice(0, documentConfig.compare_max_results),
      counts,
      truncated,
      warnings,
      coverage: {
        status: fallbackSections || truncated ? 'partial' : 'ok',
        from_sections: fromSections.size,
        to_sections: toSections.size,
        aligned_sections: alignedSections,
        fallback_sections: fallbackSections,
      },
    };
  }
  view(
    code: string,
    receipt: string,
    version?: string,
    sectionId?: string,
    offset = 0,
    blockId?: string,
  ): DocumentView {
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new ThesisError('문단 위치를 확인해 주세요.');
    const source = this.source(code, receipt, version);
    const { document, data } = source;
    const selected = source.version;
    const section = sectionId
      ? data.sections.find((s) => s.id === sectionId)
      : (data.sections.find(
          (s) => s.group === 'business' && s.block_count > 1,
        ) ?? data.sections[0]);
    if (!section) throw new ThesisError('목차 항목을 찾지 못했습니다.', 404);
    const blocks = data.blocks.filter((b) => b.section_id === section.id);
    let pageOffset = offset;
    if (blockId) {
      const blockIndex = blocks.findIndex((block) => block.id === blockId);
      if (blockIndex < 0)
        throw new ThesisError('원문 문단 위치를 찾지 못했습니다.', 404);
      pageOffset =
        Math.floor(blockIndex / documentConfig.blocks_per_page) *
        documentConfig.blocks_per_page;
    }
    return {
      document,
      version: selected,
      collected_at: source.collected_at,
      archive_sha256: source.archive_sha256,
      parser_version: source.parser_version,
      versions: this.db
        .prepare(
          'SELECT version,collected_at FROM filing_document_versions WHERE code=? AND receipt=? ORDER BY collected_at DESC,rowid DESC',
        )
        .all(code, receipt) as { version: string; collected_at: string }[],
      sections: data.sections,
      section_id: section.id,
      blocks: blocks.slice(
        pageOffset,
        pageOffset + documentConfig.blocks_per_page,
      ),
      total_blocks: blocks.length,
      offset: pageOffset,
      warnings: data.warnings,
      member: data.member,
      omitted_members: data.omitted_members,
    };
  }
}
