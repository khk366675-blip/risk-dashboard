// Synthetic hypotheses and manually authored provider responses, never live AI output.
import { emptyThesis } from '../../lib/investment-thesis.ts';
export const thesisAiWriting = () => ({
  ...emptyThesis(),
  title: '[테스트] 증설과 현금흐름 가설',
  body: '증설 이후 출하 증가가 현금흐름 개선으로 이어질 수 있다.',
  weakens: '비용이 더 크게 늘면 논리가 약해질 수 있다.',
});
export const thesisAiAnswer = () => ({
  status: 'questions',
  suggestions: [
    {
      kind: 'support',
      anchor_field: 'body',
      anchor_quote: '증설 이후 출하 증가',
      question:
        '증설을 가정할 때 가동 시점과 출하 변화는 어떻게 확인할 수 있나요?',
      why: '가동과 출하의 연결이 성립하는지 확인할 질문입니다.',
      source_kind: 'company_report',
      look_for: '생산능력과 가동률의 기간별 표, 출하 자료가 필요한지 확인',
      weakening_signal: '출하가 늘지 않는다면 가동과 수요의 연결을 재검토',
    },
    {
      kind: 'challenge',
      anchor_field: 'body',
      anchor_quote: '현금흐름 개선',
      question:
        '출하가 늘더라도 재고와 비용 부담으로 현금흐름이 약해질 수 있나요?',
      why: '매출 변화가 현금으로 이어진다는 가정을 점검합니다.',
      source_kind: 'financial_statement',
      look_for: '재고와 매출채권, 영업현금흐름의 같은 기간 비교',
      weakening_signal: '재고·채권 증가로 현금 유입이 늦어진다면 가정 재검토',
    },
  ],
});
export const thesisAiResponse = () =>
  new Response(
    JSON.stringify({
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [
            { type: 'output_text', text: JSON.stringify(thesisAiAnswer()) },
          ],
        },
      ],
      usage: { input_tokens: 650, output_tokens: 220 },
    }),
  );
