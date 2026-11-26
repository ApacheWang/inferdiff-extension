import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatPkMarkdown, prepareCompareTargets, runComparison, selectWinner } from '../src/compare.js';

const summary = { grade: 'A+', probeCount: 5, passed: 4, p0: 0, p1: 0, ttftMs: 80 };

test('PK ranks grade ahead of every other metric', () => {
  const weaker = { ...summary, grade: 'A', passed: 5, ttftMs: 4 };
  assert.equal(selectWinner(summary, weaker), 'A');
  assert.equal(selectWinner(weaker, summary), 'B');
});

test('PK uses passed probes, then P0, then P1, before TTFT', () => {
  const slower = { ...summary, ttftMs: 150 };
  assert.equal(selectWinner(slower, { ...summary, passed: 3 }), 'A');
  assert.equal(selectWinner({ ...summary, p0: 1 }, { ...slower, p1: 2 }), 'B');
  assert.equal(selectWinner({ ...summary, p1: 1 }, slower), 'B');
});

test('PK breaks an otherwise equal score by effective TTFT and handles ties', () => {
  assert.equal(selectWinner(summary, { ...summary, ttftMs: 79 }), 'B');
  assert.equal(selectWinner(summary, { ...summary, ttftMs: 81 }), 'A');
  assert.equal(selectWinner(summary, { ...summary }), 'Tie');
  assert.equal(selectWinner(summary, { ...summary, ttftMs: null }), 'A');
  assert.equal(selectWinner({ ...summary, ttftMs: null }, { ...summary, ttftMs: null }), 'Tie');
});

test('PK counts passing probes on original live reports', () => {
  const a = { ...summary, passed: undefined, probes: [{ status: 'pass' }, { status: 'fail' }] };
  const b = { ...summary, passed: undefined, probes: [{ status: 'pass' }, { status: 'pass' }] };
  assert.equal(selectWinner(a, b), 'B');
});

test('PK normalizes each endpoint separately, with auto detection and Gemini URL model support', () => {
  const targets = prepareCompareTargets(
    { baseUrl: 'https://relay-a.example/v1/responses/', protocol: 'auto', model: ' test-model ', apiKey: ' opaque-key-a ' },
    { baseUrl: 'http://localhost:8765/v1beta/models/test-model:streamGenerateContent', protocol: 'gemini' },
  );
  assert.deepEqual(targets, [
    { baseUrl: 'https://relay-a.example/v1/responses', protocol: 'openai-responses', model: 'test-model', apiKey: 'opaque-key-a' },
    { baseUrl: 'http://localhost:8765/v1beta/models/test-model:streamGenerateContent', protocol: 'gemini', model: '', apiKey: '' },
  ]);
});

test('PK rejects keys in either endpoint or model and reports the field and side', () => {
  const key = 'opaque/fixture+secret';
  const a = { baseUrl: 'https://relay-a.example/v1', model: 'test-model', apiKey: key };
  const b = { baseUrl: 'https://relay-b.example/v1', model: 'test-model' };
  assert.throws(() => prepareCompareTargets(a, { ...b, baseUrl: `${b.baseUrl}/${encodeURIComponent(key)}` }),
    { message: 'invalidBaseUrl', side: 'B' });
  assert.throws(() => prepareCompareTargets(a, { ...b, model: `stealth-${key}` }),
    { message: 'invalidModel', side: 'B' });
  const encodedKey = 'opaque-fixturé';
  assert.throws(() => prepareCompareTargets({ ...a, apiKey: encodedKey },
    { ...b, baseUrl: `${b.baseUrl}/${encodeURIComponent(encodedKey)}` }), { message: 'invalidBaseUrl', side: 'B' });
  assert.throws(() => prepareCompareTargets(a, { ...b, apiKey: 'fixture\nheader' }),
    { message: 'invalidApiKey', side: 'B' });
  assert.throws(() => prepareCompareTargets(a, { ...b, protocol: 'gemini', model: '' }),
    { message: 'invalidModel', side: 'B' });
  assert.throws(() => prepareCompareTargets({ ...a, baseUrl: 'http://relay-a.example/v1' }, b),
    { message: 'invalidBaseUrl', side: 'A' });
  assert.throws(() => prepareCompareTargets({ ...a, apiKey: 'non-ascii-🔑' }, b),
    { message: 'invalidApiKey', side: 'A' });
});

test('PK validates both settings before starting any probe', async t => {
  const a = { baseUrl: 'https://relay-a.example/v1', model: 'test-model' };
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 400 }));
  await assert.rejects(runComparison(a, { baseUrl: 'not-a-url', model: 'test-model' }),
    { message: 'invalidBaseUrl', side: 'B' });
  assert.equal(fetch.mock.callCount(), 0);
});

test('PK runs separate concurrent probe suites with independent authentication and progress', async t => {
  const credentialA = 'opaque-private-key-A';
  const credentialB = 'opaque-private-key-B';
  const a = { baseUrl: 'https://relay-a.example/v1', model: 'test-model', protocol: 'anthropic', apiKey: credentialA };
  const b = { baseUrl: 'https://relay-b.example/v1/responses', model: 'test-model', apiKey: credentialB };
  const progress = [];
  const sse = (...frames) => new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join(''),
    { headers: { 'Content-Type': 'text/event-stream' } });
  const mock = t.mock.method(globalThis, 'fetch', async url => {
    if (new URL(url).hostname === 'relay-a.example') {
      return sse({ type: 'message_start', message: { model: a.model } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"incomplete":' } },
        { type: 'message_delta', delta: { stop_reason: 'max_tokens' } }, { type: 'message_stop' });
    }
    return sse({ type: 'response.function_call_arguments.delta', delta: '{"incomplete":' },
      { type: 'response.completed', response: { model: b.model } });
  });

  const result = runComparison(a, b, { onProgress: (side, entry) => progress.push([side, entry]) });
  const concurrentStarts = mock.mock.callCount();
  const comparison = await result;
  assert.equal(concurrentStarts, 2);
  const [[urlA, optionsA], [urlB, optionsB]] = mock.mock.calls.map(({ arguments: args }) => args);
  assert.equal(urlA, `${a.baseUrl}/messages`);
  assert.equal(urlB, b.baseUrl);
  assert.equal(optionsA.headers['x-api-key'], credentialA);
  assert.equal(optionsA.headers.Authorization, undefined);
  assert.equal(optionsB.headers.Authorization, `Bearer ${credentialB}`);
  assert.equal(optionsB.headers['x-api-key'], undefined);
  assert.equal(optionsA.redirect, 'error');
  assert.equal(optionsB.credentials, 'omit');
  assert.deepEqual(progress.slice(0, 2).map(([side]) => side), ['A', 'B']);
  const statuses = side => progress.filter(([label]) => label === side).map(([, { status }]) => status);
  assert.deepEqual(statuses('A'), ['running', 'pass']);
  assert.deepEqual(statuses('B'), ['running', 'fail']);
  assert.equal(comparison.winner, 'A');
  assert.equal(comparison.a.grade, 'A+');
  assert.equal(comparison.a.passed, 1);
  assert.equal(comparison.b.grade, 'F');
  assert.equal(comparison.b.p0, 1);
  assert.equal(comparison.ttftDeltaMs, comparison.b.ttftMs - comparison.a.ttftMs);
  assert.doesNotMatch(JSON.stringify(comparison), /opaque-private|relay-[ab]\.example|test-model|incomplete/iu);
});

test('PK Markdown includes only allowlisted diagnostic fields and omits all endpoint metadata', () => {
  const key = 'Bearer synthetic-private-key';
  const prompt = 'confidential prompt line';
  const url = 'https://private.relay.example/internal?token=credential';
  const markdown = formatPkMarkdown({
    a: { ...summary, protocol: 'openai-chat', endpoint: url, model: key, prompt, findings: [url] },
    b: { ...summary, protocol: key, grade: prompt, p1: url, ttftMs: 83, response: 'remote response' },
    winner: url, ttftDeltaMs: key,
  });
  assert.match(markdown, /Winner: A/u);
  assert.match(markdown, /\| Endpoint A \| OpenAI Chat Completions \| A\+ \| 4\/5 \| 0 \| 0 \| 80 ms \|/u);
  assert.match(markdown, /TTFT delta \(B − A\): \+3 ms/u);
  for (const value of [key, prompt, url, 'private.relay.example', 'remote response', '?token=', 'https://']) {
    assert.equal(markdown.includes(value), false);
  }
});

test('PK Markdown keeps unavailable timing explicit and shows a tie', () => {
  const a = { ...summary, ttftMs: null };
  const markdown = formatPkMarkdown({ a, b: { ...a } });
  assert.match(markdown, /Winner: Tie/u);
  assert.match(markdown, /TTFT delta \(B − A\): Unavailable/u);
});
