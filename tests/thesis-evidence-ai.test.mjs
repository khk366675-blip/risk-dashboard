import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ResearchStore } from '../lib/server/research-store.ts';
import { ThesisStore } from '../lib/server/thesis-store.ts';
import { ManualEvidenceStore } from '../lib/server/manual-evidence-store.ts';
import { ThesisEvidenceAiService } from '../lib/server/thesis-evidence-ai-service.ts';
import { emptyThesis } from '../lib/investment-thesis.ts';

const radar = JSON.parse(readFileSync('public/data/radar/latest.json', 'utf8'));
const candidate = radar.candidates[0];

function fixture(t, fetcher) {
  const directory = mkdtempSync(path.join(tmpdir(), 'value-evidence-ai-'));
  const owner = new ResearchStore(directory);
  const stock = JSON.parse(
    readFileSync(`public/data/radar/stocks/${candidate.code}.json`, 'utf8'),
  );
  owner.register(candidate, radar, stock);
  const thesis = new ThesisStore(owner.db).create(
    candidate.code,
    randomUUID(),
    {
      ...emptyThesis(),
      title: '해외 채널 확장',
      body: '해외 채널 확대가 매출 성장으로 이어지는지 확인한다.',
    },
  );
  const evidence = new ManualEvidenceStore(owner.db).create(candidate.code, {
    id: randomUUID(),
    thesis_id: thesis.id,
    thesis_revision: thesis.revision,
    relation: 'context',
    source_type: 'news',
    title: '현지 매장 기사',
    url: 'https://example.com/news',
    source_name: '테스트 매체',
    published_at: '2026-09-04',
    body: '해외 매장 수는 늘었지만 매출 기여도는 기사에서 확인되지 않았다.',
    note: '',
  });
  const service = new ThesisEvidenceAiService(
    owner.db,
    undefined,
    () => 'test-key',
    fetcher(evidence),
    () => 1_800_000_000_000,
  );
  t.after(() => {
    owner.close();
    const resolved = realpathSync(directory);
    assert.equal(path.dirname(resolved), realpathSync(tmpdir()));
    rmSync(resolved, { recursive: true });
  });
  return { owner, thesis, service, evidence };
}

function success(evidence) {
  return async () =>
    new Response(
      JSON.stringify({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  status: 'review_ready',
                  findings: [
                    {
                      kind: 'gap',
                      source_ids: [`manual:${evidence.id}`],
                      point_quote: '매출 성장으로 이어지는지',
                      explanation:
                        '매장 확대와 매출 기여를 연결하는 관측이 현재 자료에 없습니다.',
                      question:
                        '해외 채널 매출과 기존점 성과를 같은 기간 기준으로 확인할 수 있습니까?',
                    },
                  ],
                }),
              },
            ],
          },
        ],
        usage: { input_tokens: 120, output_tokens: 60 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
}

test('evidence AI snapshots only linked evidence and returns source-bound checks', async (t) => {
  const { thesis, service, evidence } = fixture(t, success);
  const view = service.view(candidate.code, thesis.id);
  assert.equal(view.evidence_count, 1);
  assert.equal(view.input.evidence[0].source_status, 'user_supplied');
  assert.equal('url' in view.input.evidence[0], false);
  const run = await service.generate(candidate.code, thesis.id, {
    id: randomUUID(),
    revision: view.revision,
    signature: view.signature,
    consent: true,
  });
  assert.equal(run.state, 'completed');
  assert.deepEqual(run.answer.findings[0].source_ids, [
    `manual:${evidence.id}`,
  ]);
  assert.equal(run.usage.input_tokens, 120);
  assert.equal(service.view(candidate.code, thesis.id).run.id, run.id);
});

test('evidence AI does not send without linked evidence or explicit consent', async (t) => {
  let calls = 0;
  const { owner, thesis, service, evidence } = fixture(t, () => async () => {
    calls += 1;
    return new Response('{}', { status: 500 });
  });
  new ManualEvidenceStore(owner.db).archive(candidate.code, evidence.id, true);
  const emptyView = service.view(candidate.code, thesis.id);
  assert.equal(emptyView.evidence_count, 0);
  await assert.rejects(
    service.generate(candidate.code, thesis.id, {
      id: randomUUID(),
      revision: emptyView.revision,
      signature: emptyView.signature,
      consent: true,
    }),
    { status: 422 },
  );
  assert.equal(calls, 0);
  await assert.rejects(
    service.generate(candidate.code, thesis.id, {
      id: randomUUID(),
      revision: emptyView.revision,
      signature: emptyView.signature,
      consent: false,
    }),
    { status: 400 },
  );
});

test('focused question uses only chosen evidence and preserves answers in versioned input', async t=>{
  const {owner,thesis,evidence,service}=fixture(t,success);
  const check={id:randomUUID(),text:'해외 채널 확대를 어떻게 확인할까?',answer:'매장 수는 확인했으나 매출 기여는 미확인',unresolved:'동일 기간 채널 매출 필요',status:'reviewing',evidence_ids:[`manual:${evidence.id}`]};
  new ThesisStore(owner.db).update(candidate.code,thesis.id,thesis.revision,{content:{...thesis.content,checks:[check]}});
  const view=service.view(candidate.code,thesis.id,check.id);
  assert.deepEqual(view.input.evidence.map(e=>e.id),check.evidence_ids);assert.equal(view.input.focus.answer,check.answer);
  assert.notEqual(view.signature,service.view(candidate.code,thesis.id).signature);
  const run=await service.generate(candidate.code,thesis.id,{id:randomUUID(),revision:view.revision,signature:view.signature,consent:true,check_id:check.id});
  assert.equal(run.state,'completed');assert.equal(service.view(candidate.code,thesis.id).run,null);assert.equal(service.view(candidate.code,thesis.id,check.id).run.id,run.id);
  const point=new ThesisStore(owner.db).list(candidate.code)[0];assert.equal(point.content.checks[0].status,'reviewing');
  new ThesisStore(owner.db).update(candidate.code,point.id,point.revision,{content:{...point.content,checks:[{...check,evidence_ids:[]}]}});
  const noEvidence=service.view(candidate.code,point.id,check.id);assert.equal(noEvidence.evidence_count,0);
  await assert.rejects(service.generate(candidate.code,point.id,{id:randomUUID(),revision:noEvidence.revision,signature:noEvidence.signature,consent:true,check_id:check.id}),{status:422});
});
