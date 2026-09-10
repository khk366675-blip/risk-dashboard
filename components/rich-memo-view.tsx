'use client';
/* oxlint-disable next/no-img-element -- Already resized raster data URLs; Next image optimization would not apply. */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { memoNumber, type RichMemo, type MemoTable } from '@/lib/rich-memo';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const colors = [
  'var(--primary)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  '#64748b',
  '#a16207',
];

export function MemoChart({ block }: { block: MemoTable }) {
  if (block.chart === 'none') return null;
  const rows = block.rows
    .slice(1)
    .map((row) =>
      Object.fromEntries([
        ['label', row[0]],
        ...row.slice(1).map((cell, c) => [`v${c}`, memoNumber(cell)]),
      ]),
    );
  const invalid = block.rows
    .slice(1)
    .some((row) =>
      row.slice(1).some((cell) => cell.trim() && memoNumber(cell) === null),
    );
  const hasValues = block.rows
    .slice(1)
    .some((row) => row.slice(1).some((cell) => memoNumber(cell) !== null));
  const series = block.rows[0].slice(1);
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke="var(--border)" />
      <XAxis
        dataKey="label"
        tick={{ fontSize: 10 }}
        tickLine={false}
        axisLine={false}
      />
      <YAxis
        width={65}
        tick={{ fontSize: 10 }}
        tickLine={false}
        axisLine={false}
        domain={[
          (min: number) => Math.min(0, min),
          (max: number) => Math.max(0, max),
        ]}
      />
      <Tooltip />
      <Legend wrapperStyle={{ fontSize: 11 }} />
    </>
  );
  return (
    <div className="space-y-2">
      {block.unit && (
        <p className="text-right text-[10px] text-muted-foreground">
          단위: {block.unit}
        </p>
      )}
      {hasValues ? (
        <figure
          className="h-60 w-full min-w-0"
          aria-label={`${block.title || '메모'} ${block.chart === 'bar' ? '막대' : '선'}그래프. 아래 표에 원수치가 있습니다.`}
        >
          <ResponsiveContainer width="100%" height="100%">
            {block.chart === 'bar' ? (
              <BarChart
                data={rows}
                margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
              >
                {axes}
                {series.map((name, c) => (
                  <Bar
                    key={c}
                    dataKey={`v${c}`}
                    name={name || `열 ${c + 2}`}
                    fill={colors[c]}
                    maxBarSize={36}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            ) : (
              <LineChart
                data={rows}
                margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
              >
                {axes}
                {series.map((name, c) => (
                  <Line
                    key={c}
                    dataKey={`v${c}`}
                    name={name || `열 ${c + 2}`}
                    stroke={colors[c]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls={false}
                    type="linear"
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        </figure>
      ) : (
        <p className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
          첫 열은 항목, 나머지 열은 수치를 입력하면 그래프가 표시됩니다.
        </p>
      )}
      {invalid && (
        <p className="text-[10px] text-amber-700">
          숫자로 확인되지 않는 셀은 그래프에서 비워 두었습니다. 단위는 별도 칸에
          입력해 주세요.
        </p>
      )}
    </div>
  );
}

export function RichMemoView({ document }: { document: RichMemo }) {
  const [zoom, setZoom] = useState<string | null>(null);
  return (
    <div className="min-w-0 space-y-4 text-xs leading-6">
      <Dialog
        open={zoom !== null}
        onOpenChange={(open) => {
          if (!open) setZoom(null);
        }}
      >
        <DialogContent className="max-h-[95dvh] overflow-auto sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>첨부 이미지</DialogTitle>
          </DialogHeader>
          {zoom && (
            <img
              src={zoom}
              alt="첨부 이미지 확대"
              className="w-full object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
      {document.blocks.map((block, index) => {
        if (block.type === 'image')
          return (
            <figure key={index} className="space-y-1.5">
              {/* Raster data is embedded and size-limited at save time; no remote tracking requests. */}
              <button
                type="button"
                className="block w-full cursor-zoom-in"
                onClick={() => setZoom(block.src)}
                aria-label="첨부 이미지 크게 보기"
              >
                <img
                  src={block.src}
                  alt={block.caption || '사용자 첨부 이미지'}
                  className="max-h-[65dvh] w-full rounded-md border object-contain"
                  loading="lazy"
                />
              </button>
              {block.caption && (
                <figcaption className="whitespace-pre-wrap text-[11px] text-muted-foreground">
                  {block.caption}
                </figcaption>
              )}
            </figure>
          );
        if (block.type === 'text') {
          const cls = 'whitespace-pre-wrap break-words';
          if (block.style === 'heading')
            return (
              <h4 key={index} className={`${cls} text-sm font-semibold`}>
                {block.text}
              </h4>
            );
          if (block.style === 'quote')
            return (
              <blockquote
                key={index}
                className={`${cls} border-l-2 border-primary/50 bg-muted/30 py-1 pl-3`}
              >
                {block.text}
              </blockquote>
            );
          if (block.style === 'bullets')
            return (
              <ul key={index} className="list-disc space-y-1 pl-5">
                {block.text
                  .split('\n')
                  .filter(Boolean)
                  .map((line, i) => (
                    <li key={i} className="whitespace-pre-wrap break-words">
                      {line}
                    </li>
                  ))}
              </ul>
            );
          return (
            <p key={index} className={cls}>
              {block.text}
            </p>
          );
        }
        return (
          <section key={index} className="min-w-0 space-y-2">
            {block.title && <h4 className="font-semibold">{block.title}</h4>}
            <MemoChart block={block} />
            {block.chart === 'none' && block.unit && (
              <p className="text-[10px] text-muted-foreground">
                단위: {block.unit}
              </p>
            )}
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full border-collapse text-left text-[11px]">
                <thead className="bg-muted/50">
                  <tr>
                    {block.rows[0].map((cell, c) => (
                      <th
                        key={c}
                        className="min-w-24 border-b px-3 py-2 font-medium whitespace-pre-wrap"
                      >
                        {cell}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.slice(1).map((row, r) => (
                    <tr key={r} className="border-b last:border-0">
                      {row.map((cell, c) => (
                        <td
                          key={c}
                          className="px-3 py-2 whitespace-pre-wrap break-words"
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function RichMemoOpen({
  document,
  title,
}: {
  document: RichMemo;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => setOpen(true)}
      >
        메모·표·이미지 보기
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="pr-8 leading-6">{title}</DialogTitle>
          </DialogHeader>
          <RichMemoView document={document} />
        </DialogContent>
      </Dialog>
    </>
  );
}
