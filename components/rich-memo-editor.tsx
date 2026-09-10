'use client';
/* oxlint-disable next/no-img-element -- Locally resized raster data URLs, never remote image URLs. */

import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ImagePlus,
  Table2,
  Type,
  Undo2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { MemoChart, RichMemoView } from '@/components/rich-memo-view';
import {
  memoPlainText,
  pasteMemoCells,
  richMemoConfig as limits,
  type MemoBlock,
  type MemoTable,
  type RichMemo,
} from '@/lib/rich-memo';

async function imageBlock(file: File): Promise<MemoBlock> {
  if (
    !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
    file.size > limits.max_upload_bytes
  )
    throw new Error('PNG·JPG·WebP 이미지(15MB 이하)를 선택해 주세요.');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(
      1,
      limits.max_image_side / Math.max(bitmap.width, bitmap.height),
    );
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('이미지를 준비하지 못했습니다.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let src = canvas.toDataURL('image/png');
    if ((src.length * 3) / 4 > limits.max_image_bytes) {
      for (const quality of [0.9, 0.8, 0.65, 0.5]) {
        src = canvas.toDataURL('image/jpeg', quality);
        if ((src.length * 3) / 4 <= limits.max_image_bytes) break;
      }
    }
    if ((src.length * 3) / 4 > limits.max_image_bytes)
      throw new Error(
        '이미지가 너무 복잡합니다. 필요한 부분만 잘라서 다시 넣어 주세요.',
      );
    return { type: 'image', src, caption: '' };
  } finally {
    bitmap.close();
  }
}

export const emptyMemo = (): RichMemo => ({
  version: 1,
  blocks: [{ type: 'text', style: 'paragraph', text: '' }],
});

export function RichMemoEditor({
  value,
  onChange,
  disabled,
  expanded,
  onBusyChange,
}: {
  value: RichMemo;
  onChange: (value: RichMemo) => void;
  disabled?: boolean;
  expanded?: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const upload = useRef<HTMLInputElement>(null);
  const current = useRef(value);
  useEffect(() => {
    current.current = value;
  }, [value]);
  const [preview, setPreview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [removed, setRemoved] = useState<{
    block: MemoBlock;
    index: number;
  } | null>(null);
  const [tableUndo, setTableUndo] = useState<{
    index: number;
    block: MemoTable;
  } | null>(null);
  const locked = disabled || loading;
  const update = (blocks: MemoBlock[]) => {
    onChange({ version: 1, blocks });
    setError('');
  };
  const patch = (index: number, block: MemoBlock) =>
    update(value.blocks.map((old, i) => (i === index ? block : old)));
  const add = (block: MemoBlock) => {
    if (value.blocks.length >= limits.max_blocks) {
      setError(`메모 구성 요소는 ${limits.max_blocks}개까지입니다.`);
      return;
    }
    update([...value.blocks, block]);
  };
  const attach = async (files: File[]) => {
    if (locked || !files.length) return;
    if (
      files.length + value.blocks.filter((b) => b.type === 'image').length >
        limits.max_images ||
      files.length + value.blocks.length > limits.max_blocks
    ) {
      setError('이미지는 메모당 3개까지 넣을 수 있습니다.');
      return;
    }
    setLoading(true);
    onBusyChange(true);
    setError('');
    try {
      const blocks = await Promise.all(files.map(imageBlock));
      update([...current.current.blocks, ...blocks]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '이미지를 읽지 못했습니다.');
    } finally {
      setLoading(false);
      onBusyChange(false);
    }
  };
  const tableChange = (
    index: number,
    block: MemoTable,
    row: number,
    col: number,
    text: string,
  ) =>
    patch(index, {
      ...block,
      rows: block.rows.map((r, i) =>
        i === row ? r.map((cell, j) => (j === col ? text : cell)) : r,
      ),
    });
  const move = (index: number, offset: number) => {
    setTableUndo(null);
    const blocks = [...value.blocks];
    [blocks[index], blocks[index + offset]] = [
      blocks[index + offset],
      blocks[index],
    ];
    update(blocks);
  };
  return (
    <div
      className="overflow-hidden rounded-lg border bg-background"
      onPaste={(event) => {
        const images = Array.from(event.clipboardData.files).filter((file) =>
          file.type.startsWith('image/'),
        );
        if (images.length) {
          event.preventDefault();
          void attach(images);
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-1 border-b bg-muted/25 p-1.5">
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={locked || preview}
          onClick={() => add({ type: 'text', style: 'paragraph', text: '' })}
        >
          <Type />글
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={locked || preview}
          onClick={() =>
            add({
              type: 'table',
              title: '',
              unit: '',
              chart: 'none',
              rows: [
                ['항목', '값'],
                ['', ''],
                ['', ''],
              ],
            })
          }
        >
          <Table2 />
          표·그래프
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={locked || preview}
          onClick={() => upload.current?.click()}
        >
          <ImagePlus />
          {loading ? '이미지 준비 중…' : '이미지'}
        </Button>
        <input
          ref={upload}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="sr-only"
          aria-label="메모 이미지 첨부"
          disabled={locked}
          onChange={(event) => {
            void attach(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
        <Button
          type="button"
          size="xs"
          variant={preview ? 'secondary' : 'ghost'}
          className="ml-auto"
          onClick={() => setPreview(!preview)}
        >
          {preview ? '편집' : '미리보기'}
        </Button>
      </div>
      <div
        className={`${expanded ? 'h-[calc(100dvh-22rem)]' : 'max-h-[46dvh]'} min-h-40 space-y-3 overflow-y-auto p-3`}
      >
        {preview ? (
          <RichMemoView document={value} />
        ) : (
          value.blocks.map((block, index) => (
            <section
              key={index}
              className="space-y-2 rounded-md border border-border/60 p-2.5"
            >
              <div className="flex items-center gap-1">
                {block.type === 'text' ? (
                  <select
                    aria-label={`글 ${index + 1} 서식`}
                    className="h-7 rounded border bg-background px-1 text-[11px]"
                    disabled={locked}
                    value={block.style}
                    onChange={(e) =>
                      patch(index, {
                        ...block,
                        style: e.target.value as typeof block.style,
                      })
                    }
                  >
                    <option value="paragraph">본문</option>
                    <option value="heading">제목</option>
                    <option value="quote">인용</option>
                    <option value="bullets">목록</option>
                  </select>
                ) : (
                  <span className="text-[11px] text-muted-foreground">
                    {block.type === 'table' ? '표·그래프' : '이미지'}
                  </span>
                )}
                <div className="ml-auto flex gap-0.5">
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`구성 ${index + 1} 위로`}
                    disabled={locked || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`구성 ${index + 1} 아래로`}
                    disabled={locked || index === value.blocks.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`구성 ${index + 1} 삭제`}
                    disabled={locked}
                    onClick={() => {
                      setRemoved({ block, index });
                      setTableUndo(null);
                      update(value.blocks.filter((_, i) => i !== index));
                    }}
                  >
                    <X />
                  </Button>
                </div>
              </div>
              {block.type === 'text' && (
                <Textarea
                  aria-label={
                    index === 0
                      ? '직접 추가 자료 핵심 내용'
                      : `메모 글 ${index + 1}`
                  }
                  value={block.text}
                  disabled={locked}
                  maxLength={limits.max_text_chars}
                  rows={block.style === 'heading' ? 2 : 4}
                  className={block.style === 'heading' ? 'font-semibold' : ''}
                  placeholder={
                    block.style === 'bullets'
                      ? '한 줄에 하나씩 입력'
                      : '내용을 적거나 캡처 이미지를 붙여넣으세요.'
                  }
                  onChange={(e) =>
                    patch(index, { ...block, text: e.target.value })
                  }
                />
              )}
              {block.type === 'image' && (
                <>
                  <img
                    src={block.src}
                    alt={block.caption || '첨부 미리보기'}
                    className="max-h-60 w-full rounded object-contain"
                  />
                  <Input
                    aria-label={`이미지 ${index + 1} 설명`}
                    value={block.caption}
                    disabled={locked}
                    maxLength={500}
                    placeholder="이미지 설명·출처 · 선택"
                    onChange={(e) =>
                      patch(index, { ...block, caption: e.target.value })
                    }
                  />
                </>
              )}
              {block.type === 'table' && (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      aria-label={`표 ${index + 1} 제목`}
                      value={block.title}
                      disabled={locked}
                      maxLength={160}
                      placeholder="표 제목 · 선택"
                      className="min-w-32 flex-1"
                      onChange={(e) =>
                        patch(index, { ...block, title: e.target.value })
                      }
                    />
                    <Input
                      aria-label={`표 ${index + 1} 단위`}
                      value={block.unit}
                      disabled={locked}
                      maxLength={40}
                      placeholder="단위: 억원, % 등"
                      className="w-36"
                      onChange={(e) =>
                        patch(index, { ...block, unit: e.target.value })
                      }
                    />
                  </div>
                  <div className="overflow-x-auto rounded border">
                    <table className="w-full border-collapse">
                      <tbody>
                        {block.rows.map((row, r) => (
                          <tr key={r}>
                            {row.map((cell, c) => (
                              <td
                                key={c}
                                className={`min-w-28 border p-0 ${r === 0 ? 'bg-muted/40' : ''}`}
                              >
                                <input
                                  aria-label={`표 ${index + 1} ${r + 1}행 ${c + 1}열`}
                                  className="w-full bg-transparent px-2 py-2 text-xs outline-primary"
                                  value={cell}
                                  disabled={locked}
                                  maxLength={limits.max_cell_chars}
                                  onChange={(e) =>
                                    tableChange(
                                      index,
                                      block,
                                      r,
                                      c,
                                      e.target.value,
                                    )
                                  }
                                  onPaste={(e) => {
                                    const pasted =
                                      e.clipboardData.getData('text/plain');
                                    if (
                                      pasted.includes('\t') ||
                                      pasted.includes('\n')
                                    ) {
                                      e.preventDefault();
                                      try {
                                        patch(index, {
                                          ...block,
                                          rows: pasteMemoCells(
                                            block.rows,
                                            pasted,
                                            r,
                                            c,
                                          ),
                                        });
                                      } catch (err) {
                                        setError(
                                          err instanceof Error
                                            ? err.message
                                            : '표를 붙여넣지 못했습니다.',
                                        );
                                      }
                                    }
                                  }}
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      disabled={locked || block.rows.length >= limits.max_rows}
                      onClick={() =>
                        patch(index, {
                          ...block,
                          rows: [...block.rows, block.rows[0].map(() => '')],
                        })
                      }
                    >
                      + 행
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      disabled={
                        locked || block.rows[0].length >= limits.max_columns
                      }
                      onClick={() =>
                        patch(index, {
                          ...block,
                          rows: block.rows.map((row) => [...row, '']),
                        })
                      }
                    >
                      + 열
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      disabled={locked || block.rows.length <= 2}
                      onClick={() => {
                        setTableUndo({ index, block });
                        patch(index, {
                          ...block,
                          rows: block.rows.slice(0, -1),
                        });
                      }}
                    >
                      끝 행 삭제
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      disabled={locked || block.rows[0].length <= 2}
                      onClick={() => {
                        setTableUndo({ index, block });
                        patch(index, {
                          ...block,
                          rows: block.rows.map((row) => row.slice(0, -1)),
                        });
                      }}
                    >
                      끝 열 삭제
                    </Button>
                    {tableUndo?.index === index && (
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        disabled={locked}
                        onClick={() => {
                          patch(index, tableUndo.block);
                          setTableUndo(null);
                        }}
                      >
                        삭제 복원
                      </Button>
                    )}
                    <select
                      aria-label={`표 ${index + 1} 그래프 표시`}
                      value={block.chart}
                      disabled={locked}
                      className="ml-auto h-7 rounded border bg-background px-1 text-[11px]"
                      onChange={(e) =>
                        patch(index, {
                          ...block,
                          chart: e.target.value as MemoTable['chart'],
                        })
                      }
                    >
                      <option value="none">표만 표시</option>
                      <option value="line">선그래프 + 표</option>
                      <option value="bar">막대그래프 + 표</option>
                    </select>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    첫 행은 열 이름입니다. 엑셀 셀을 복사해 붙여넣을 수
                    있습니다.
                  </p>
                  <MemoChart block={block} />
                </>
              )}
            </section>
          ))
        )}
        {removed && !preview && (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={locked || value.blocks.length >= limits.max_blocks}
            onClick={() => {
              const blocks = [...value.blocks];
              blocks.splice(removed.index, 0, removed.block);
              update(blocks);
              setRemoved(null);
            }}
          >
            <Undo2 />
            삭제한 구성 복원
          </Button>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 border-t px-3 py-2 text-[10px] text-muted-foreground">
        <span>이미지는 최대 3개 · 저장용으로 크기 조정</span>
        <span
          className={
            memoPlainText(value).length > limits.max_text_chars
              ? 'text-destructive'
              : ''
          }
        >
          {memoPlainText(value).length.toLocaleString()} /{' '}
          {limits.max_text_chars.toLocaleString()}자
        </span>
      </div>
      {error && (
        <p role="alert" className="px-3 pb-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
