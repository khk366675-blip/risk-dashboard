import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// A small hook runtime verifies the confirmation gate without a browser,
// external API requests, or a new test dependency.
function fixture() {
  const slots = [];
  let index = 0;
  const cleanups = [];
  const react = {
    useState(initial) {
      const id = index++;
      if (!(id in slots)) slots[id] = initial;
      return [
        slots[id],
        (value) => {
          slots[id] = value;
        },
      ];
    },
    useRef(initial) {
      const id = index++;
      return (slots[id] ??= { current: initial });
    },
    useCallback(fn) {
      return fn;
    },
    useEffect(fn) {
      if (!cleanups.length) cleanups.push(fn());
    },
  };
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  const source = ts.transpileModule(
    readFileSync('components/use-action-confirmation.tsx', 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  vm.runInNewContext(source, {
    exports,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      return new Proxy({}, { get: (_, key) => key });
    },
  });
  return {
    render() {
      index = 0;
      return exports.useActionConfirmation();
    },
    unmount() {
      cleanups.forEach((fn) => fn?.());
    },
  };
}
const prompt = {
  title: '작업 확인',
  description: '확인 후에만 실행합니다.',
  actionLabel: '실행',
};
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  const children = node.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const matched = find(child, predicate);
    if (matched) return matched;
  }
  return null;
}

test('opening confirmation makes no mutation; dismissal cancels and explicit approval runs once', async () => {
  const f = fixture();
  let calls = 0;
  const run = async () => {
    if (await f.render().confirmAction(prompt)) calls++;
  };
  const cancelled = run();
  await Promise.resolve();
  assert.equal(calls, 0);
  assert.equal(f.render().confirmationDialog.props.open, true);
  f.render().confirmationDialog.props.onOpenChange(false);
  await cancelled;
  assert.equal(calls, 0);
  const accepted = run();
  const button = find(
    f.render().confirmationDialog,
    (node) => node.type === 'Button' && node.props.children === '실행',
  );
  button.props.onClick();
  button.props.onClick();
  await accepted;
  assert.equal(calls, 1);
  assert.equal(f.render().confirmationDialog.props.open, false);
  f.unmount();
});

test('repeat clicks do not queue a second confirmation; cancel and unmount never approve', async () => {
  const f = fixture();
  const first = f.render().confirmAction(prompt);
  assert.equal(await f.render().confirmAction(prompt), false);
  const cancel = find(
    f.render().confirmationDialog,
    (node) => node.type === 'Button' && node.props.children === '취소',
  );
  cancel.props.onClick();
  assert.equal(await first, false);
  const abandoned = f.render().confirmAction(prompt);
  f.unmount();
  assert.equal(await abandoned, false);
});
