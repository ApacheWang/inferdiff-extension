import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditOffline, formatOfflineIssueMarkdown } from '../src/offline-audit.js';

const done = 'data: [DONE]\n\n';
const sse = (data, event) => `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`;
const chat = (delta = {}, finish_reason = null, index = 0) =>
  sse({ choices: [{ index, delta, finish_reason }] });
const anthropic = (type, fields = {}) => sse(fields, type);
const gemini = (...candidates) => sse({ candidates });
const codes = result => result.findings.map(finding => finding.code);

test('recognizes honest SSE, comments, CRLF, multiline data, and trailing requested usage', () => {
  const input = '\uFEFF: keepalive\r\nid: 1\r\ndata: {\r\ndata: "choices": [{"delta": {"content": "中文🧪"}}]}\r\n\r\n'
    + chat({}, 'stop') + sse({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 0 } }) + done.trimEnd();
  assert.deepEqual(auditOffline(input, { includeUsage: true }), {
    protocol: 'openai-chat', verdict: 'A+', frameCount: 4, findings: [],
  });
});

test('D1 flags an empty or malformed Chat tool call at a success finish but accepts honest length', () => {
  for (const args of ['', '{"value":', '[]']) {
    const tool = chat({ tool_calls: [{ index: 0, id: 'tool', function: { arguments: args } }] });
    assert.deepEqual(codes(auditOffline(tool + chat({}, 'stop') + done)), ['D1']);
    assert.equal(auditOffline(tool + chat({}, 'stop') + done).verdict, 'F P0 BREACH');
    assert.equal(auditOffline(tool + chat({}, 'length') + done).verdict, 'A+');
  }
});

test('accepts split Chat calls and reuses index zero independently across choices', () => {
  const input = chat({ tool_calls: [{ index: 0, id: 'a', function: { arguments: '{"a":' } }] })
    + chat({ tool_calls: [{ index: 0, id: 'b', function: { arguments: '{"b":' } }] }, null, 1)
    + chat({ tool_calls: [{ index: 0, function: { arguments: 'true}' } }] }, 'tool_calls')
    + chat({ tool_calls: [{ index: 0, function: { arguments: 'true}' } }] }, 'tool_calls', 1) + done;
  assert.equal(auditOffline(input).verdict, 'A+');
});

test('D2 detects literal and JSON-escaped U+FFFD without mistaking escaped text or emoji for corruption', () => {
  for (const corrupt of ['\uFFFD', '\\uFFFD']) {
    const input = `data: {"choices":[{"delta":{"content":"abc${corrupt}"},"finish_reason":"stop"}]}\n\n` + done;
    assert.deepEqual(codes(auditOffline(input)), ['D2']);
  }
  assert.deepEqual(codes(auditOffline(': \uFFFD keepalive\n\n' + chat({}, 'stop') + done)), ['D2']);
  assert.equal(auditOffline(chat({ content: '\\uFFFD 🧪' }, 'stop') + done).verdict, 'A+');
});

test('D3 flags colliding Chat tool index declarations in and across frames', () => {
  const call = id => ({ index: 0, id, function: { arguments: '{}' } });
  const sameFrame = chat({ tool_calls: [call('a'), call('b')] }, 'length') + done;
  const acrossFrames = chat({ tool_calls: [call('a')] }) + chat({ tool_calls: [call('b')] }, 'length') + done;
  for (const input of [sameFrame, acrossFrames]) assert.deepEqual(codes(auditOffline(input)), ['D3']);
});

test('D4 is a warning when requested usage is missing or appeared before the finish', () => {
  const finish = chat({}, 'stop') + done;
  for (const input of [finish, sse({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 1 } }) + finish]) {
    const result = auditOffline(input, { includeUsage: true });
    assert.equal(result.verdict, 'WARN');
    assert.deepEqual(result.findings, [{ code: 'D4', severity: 'P1' }]);
  }
  assert.equal(auditOffline(finish).verdict, 'A+');
});

test('Responses audits malformed accumulated and final tool arguments independently', () => {
  const added = sse({ type: 'response.output_item.added', output_index: 0,
    item: { id: 'tool', type: 'function_call', arguments: '' } });
  const delta = sse({ type: 'response.function_call_arguments.delta', item_id: 'tool', delta: '{"value":' });
  const final = args => sse({ type: 'response.function_call_arguments.done', item_id: 'tool', arguments: args });
  const completed = sse({ type: 'response.completed', response: { status: 'completed' } });
  const incomplete = sse({ type: 'response.incomplete', response: { status: 'incomplete' } });
  assert.deepEqual(codes(auditOffline(added + delta + final('{"value":true}') + completed)), ['D1']);
  assert.deepEqual(codes(auditOffline(added + final('{"value":') + completed)), ['D1']);
  assert.equal(auditOffline(added + delta + incomplete).verdict, 'A+');
  assert.equal(auditOffline(added + final('{}') + completed).verdict, 'A+');
  assert.deepEqual(codes(auditOffline(sse({ type: 'response.completed', response: {
    output: [{ type: 'function_call', arguments: '{' }],
  } }))), ['D1']);
});

test('Anthropic malformed tool input claiming end_turn reports D1 and C9', () => {
  const start = anthropic('content_block_start', { index: 0, content_block: { type: 'tool_use', input: {} } });
  const delta = partial_json => anthropic('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json } });
  const finish = reason => anthropic('content_block_stop', { index: 0 })
    + anthropic('message_delta', { delta: { stop_reason: reason } }) + anthropic('message_stop');
  assert.deepEqual(codes(auditOffline(start + delta('{"value":') + finish('end_turn'))), ['D1', 'C9']);
  assert.deepEqual(codes(auditOffline(start + delta('{"value":') + finish('tool_use'))), ['D1']);
  assert.equal(auditOffline(start + delta('{"value":') + finish('max_tokens')).verdict, 'A+');
  assert.equal(auditOffline(start + delta('{"value":') + delta('0}') + finish('tool_use')).verdict, 'A+');
});

test('Anthropic accepts event fields after data and flags duplicate tool block indices', () => {
  const start = id => anthropic('content_block_start', { index: 0, content_block: { type: 'tool_use', id, input: {} } });
  const end = 'data: {"delta":{"stop_reason":"tool_use"}}\nevent: message_delta\n\n'
    + 'data: {}\nevent: message_stop\n\n';
  assert.equal(auditOffline(start('call_a') + end).verdict, 'A+');
  assert.deepEqual(codes(auditOffline(start('call_a') + start('call_b') + end)), ['D3']);
});

test('Gemini C10 detects empty, malformed, and false STOP per candidate', () => {
  for (const candidate of [
    { index: 0, finishReason: 'STOP' },
    { index: 0, finishReason: 'STOP', content: { parts: [{ text: '{"value":' }] } },
    { index: 0, finishReason: 'STOP', content: { parts: [{ text: '"unterminated' }] } },
    { index: 0, finishReason: 'STOP', content: { parts: [{ thought: true, text: 'hidden' }] } },
    { index: 0, finishReason: 'STOP', content: { parts: [{ functionCall: { name: 'lookup', args: '{' } }] } },
  ]) assert.deepEqual(codes(auditOffline(gemini(candidate))), ['C10']);
  const initial = gemini({ index: 1, content: { parts: [{ text: 'ok' }] } });
  assert.deepEqual(codes(auditOffline(initial + gemini({ index: 0, finishReason: 'STOP' },
    { index: 1, finishReason: 'STOP' }))), ['C10']);
  assert.equal(auditOffline(initial + gemini({ index: 1, finishReason: 'STOP' })).verdict, 'A+');
  assert.deepEqual(codes(auditOffline(initial + gemini({ index: 1, finishReason: 'STOP' }) + initial)), ['C10']);
  assert.equal(auditOffline(gemini({ finishReason: 'STOP', content: { parts: [{ text: '"Hello," she said.' }] } })).verdict, 'A+');
  assert.equal(auditOffline(gemini({ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{' }] } })).verdict, 'A+');
});

test('reads inferdiff.trace.v1 raw wire and counts only frames', () => {
  const input = [
    { type: 'header', schema_version: 'inferdiff.trace.v1', dialect: 'openai-chat',
      request: { body: { stream_options: { include_usage: true } } } },
    { type: 'frame', seq: 0, raw_wire: chat({ content: 'ok' }, 'stop') },
    { type: 'frame', seq: 1, raw_wire: done, is_done_sentinel: true },
    { type: 'summary', eof_clean: true, total_frames: 1000 },
  ].map(record => JSON.stringify(record)).join('\n');
  assert.deepEqual(auditOffline(input), {
    protocol: 'openai-chat', verdict: 'WARN', frameCount: 2, findings: [{ code: 'D4', severity: 'P1' }],
  });
});

test('trace frame parse metadata preserves evidence of corruption and a missing terminal frame', () => {
  const input = [
    { type: 'header', dialect: 'openai-chat' },
    { type: 'frame', raw_wire: chat({ content: 'ok' }, 'stop'), parse_error: 'invalid_utf8' },
    { type: 'summary', eof_clean: false },
  ].map(record => JSON.stringify(record)).join('\n');
  assert.deepEqual(codes(auditOffline(input)), ['D2', 'incomplete']);
});

test('accepts frame objects and event/data wrappers in JSONL, plus DevTools SSE without blank lines', () => {
  const input = [
    { event: 'response.output_text.delta', data: '{"delta":"ok"}' },
    { type: 'response.completed', response: { status: 'completed' } },
  ].map(record => JSON.stringify(record)).join('\n');
  assert.equal(auditOffline(input).verdict, 'A+');
  const chatInput = (chat({ content: 'ok' }) + chat({}, 'stop') + done).replaceAll('\n\n', '\n');
  assert.equal(auditOffline(chatInput).frameCount, 3);
  assert.equal(auditOffline(chatInput).verdict, 'A+');
});

test('warns for unrecognized, malformed, and interrupted captures', () => {
  assert.deepEqual(codes(auditOffline('arbitrary text')), ['unrecognized']);
  assert.deepEqual(codes(auditOffline('data: invalid json\n\n' + chat({}, 'stop') + done)), ['malformed']);
  assert.deepEqual(codes(auditOffline(chat({ content: 'partial' }))), ['incomplete']);
  assert.deepEqual(codes(auditOffline(chat({}, 'stop') + sse({ error: { message: 'private' } }, 'error'))), ['incomplete']);
  assert.deepEqual(codes(auditOffline(chat({}, 'stop') + done, { protocol: 'gemini' })), ['unrecognized']);
});

test('offline diagnostics and copied reports omit raw inputs and reject injected report fields', () => {
  const secrets = ['token-no-prefix-secret', 'sk-fixture-123456789', 'private prompt input',
    'https://some-private.example/path?key=private', 'private tool arguments'];
  const input = [
    { type: 'header', dialect: 'openai-chat', request: { headers: { Authorization: secrets[0] },
      url: secrets[3], body: { prompt: secrets[2] } } },
    { type: 'frame', raw_wire: chat({ tool_calls: [{ id: secrets[1], index: 0,
      function: { arguments: secrets[4] } }] }, 'stop') },
    { type: 'frame', raw_wire: done },
  ].map(record => JSON.stringify(record)).join('\n');
  const result = auditOffline(input);
  const report = formatOfflineIssueMarkdown(result);
  const forged = formatOfflineIssueMarkdown({ protocol: secrets[0], verdict: secrets[1], frameCount: secrets[3],
    findings: [{ code: secrets[2] }, { code: 'D1', severity: secrets[4], detail: secrets[0] }] });
  assert.match(report, /D1/);
  assert.ok(report.split('\n').length <= 15);
  for (const secret of secrets) assert.ok(![JSON.stringify(result), report, forged].join('\n').includes(secret));
});
