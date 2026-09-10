import config from '../research/rich-memo-config.json' with { type: 'json' };
import { ThesisError } from './investment-thesis.ts';

export const richMemoConfig = config;
export type MemoText = {
  type: 'text';
  style: 'paragraph' | 'heading' | 'quote' | 'bullets';
  text: string;
};
export type MemoTable = {
  type: 'table';
  title: string;
  unit: string;
  rows: string[][];
  chart: 'none' | 'line' | 'bar';
};
export type MemoImage = { type: 'image'; src: string; caption: string };
export type MemoBlock = MemoText | MemoTable | MemoImage;
export type RichMemo = { version: 1; blocks: MemoBlock[] };

const bad = () => new ThesisError('메모의 표·이미지·내용을 확인해 주세요.');
function text(value: unknown, limit: number) {
  if (typeof value !== 'string' || value.length > limit || value.includes('\0'))
    throw bad();
  return value.replace(/\r\n/g, '\n');
}
/** No HTML, external resources, formulas, executable links or SVG in this format. */
export function parseRichMemo(raw: unknown): RichMemo | null {
  if (raw === undefined || raw === null) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad();
  if (
    new TextEncoder().encode(JSON.stringify(raw)).length >
    config.max_document_bytes
  )
    throw new ThesisError(
      '메모 용량을 줄여 주세요. 이미지는 최대 3개까지 저장합니다.',
      413,
    );
  const value = raw as Record<string, unknown>;
  if (
    value.version !== 1 ||
    !Array.isArray(value.blocks) ||
    value.blocks.length > config.max_blocks
  )
    throw bad();
  let images = 0;
  const blocks: MemoBlock[] = value.blocks.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw bad();
    const block = item as Record<string, unknown>;
    if (block.type === 'text') {
      if (
        !['paragraph', 'heading', 'quote', 'bullets'].includes(
          String(block.style),
        )
      )
        throw bad();
      return {
        type: 'text',
        style: block.style as MemoText['style'],
        text: text(block.text, config.max_text_chars),
      };
    }
    if (block.type === 'table') {
      if (
        !['none', 'line', 'bar'].includes(String(block.chart)) ||
        !Array.isArray(block.rows) ||
        block.rows.length < 2 ||
        block.rows.length > config.max_rows
      )
        throw bad();
      const width = Array.isArray(block.rows[0]) ? block.rows[0].length : 0;
      if (width < 2 || width > config.max_columns) throw bad();
      const rows = block.rows.map((row: unknown) => {
        if (!Array.isArray(row) || row.length !== width) throw bad();
        return row.map((cell) => text(cell, config.max_cell_chars));
      });
      return {
        type: 'table',
        title: text(block.title, 160),
        unit: text(block.unit, 40),
        rows,
        chart: block.chart as MemoTable['chart'],
      };
    }
    if (block.type === 'image') {
      images++;
      if (images > config.max_images) throw bad();
      const src = text(
        block.src,
        Math.ceil(config.max_image_bytes / 3) * 4 + 40,
      );
      if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(src))
        throw bad();
      const encoded = src.split(',')[1];
      if (
        encoded.length % 4 !== 0 ||
        (encoded.length * 3) / 4 -
          (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0) >
          config.max_image_bytes
      )
        throw bad();
      // Signature validation; image bytes remain raster-only and are never interpreted as markup.
      if (
        !(
          src.startsWith('data:image/png;base64,iVBORw0KGgo') ||
          src.startsWith('data:image/jpeg;base64,/9j/')
        )
      )
        throw bad();
      return { type: 'image', src, caption: text(block.caption, 500) };
    }
    throw bad();
  });
  const result: RichMemo = { version: 1, blocks };
  if (memoPlainText(result).length > config.max_text_chars)
    throw new ThesisError(
      `표와 설명을 포함한 메모는 ${config.max_text_chars.toLocaleString()}자까지입니다.`,
    );
  return result;
}

/** Stored text is also the explicitly previewed AI input. Images are not sent to AI. */
export function memoPlainText(document: RichMemo): string {
  return document.blocks
    .map((block) => {
      if (block.type === 'image')
        return `[첨부 이미지 · 내용 자동 판독 안 함]${block.caption ? ` ${block.caption}` : ''}`;
      if (block.type === 'text') return block.text.trim();
      if (
        !block.title.trim() &&
        !block.unit.trim() &&
        block.rows.every((row) => row.every((cell) => !cell.trim()))
      )
        return '';
      return [
        block.title,
        block.unit ? `단위: ${block.unit}` : '',
        ...block.rows.map((row) => row.join(' | ')),
      ]
        .filter(Boolean)
        .join('\n');
    })
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

/** Deliberately do not parse currency symbols, percentages, unit suffixes or formulas. */
export function memoNumber(value: string): number | null {
  const raw = value.trim();
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw)) return null;
  const number = Number(raw.replaceAll(',', ''));
  return Number.isFinite(number) && Math.abs(number) <= Number.MAX_SAFE_INTEGER
    ? number
    : null;
}

export function pasteMemoCells(
  rows: string[][],
  pasted: string,
  startRow: number,
  startColumn: number,
): string[][] {
  if (pasted.length > config.max_text_chars * 2)
    throw new Error('붙여넣을 표를 나누어 입력해 주세요.');
  const source = pasted.replace(/\r\n?/g, '\n');
  const cells: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === '\t') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      cells.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (quoted)
    throw new Error(
      '표의 따옴표가 닫히지 않았습니다. 셀 범위를 다시 복사해 주세요.',
    );
  if (cell || row.length || !source.endsWith('\n')) {
    row.push(cell);
    cells.push(row);
  }
  if (!cells.length) return rows.map((r) => [...r]);
  const height = Math.max(rows.length, startRow + cells.length);
  const width = Math.max(
    rows[0].length,
    startColumn + Math.max(...cells.map((row) => row.length)),
  );
  if (
    height > config.max_rows ||
    width > config.max_columns ||
    cells.some((row) => row.some((cell) => cell.length > config.max_cell_chars))
  )
    throw new Error(
      `표는 ${config.max_rows}행·${config.max_columns}열까지입니다. 셀은 ${config.max_cell_chars}자 이내로 입력해 주세요.`,
    );
  const next = Array.from({ length: height }, (_, r) =>
    Array.from({ length: width }, (_, c) => rows[r]?.[c] ?? ''),
  );
  cells.forEach((row, r) =>
    row.forEach((cell, c) => {
      next[startRow + r][startColumn + c] = cell;
    }),
  );
  return next;
}
