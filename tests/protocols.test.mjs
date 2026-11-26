import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { normalizeTarget, runChecks } from '../src/probes.js';

const credential = 'fixture-protocol-credential';
const model = 'diagnostic-model';

function sse(data, event) {
  return `${event ? `event: ${event}\r\n` : ''}data: ${JSON.stringify(data)}\r\n\r\n`;
}

async function checkFixture(serverHandler, path, options = {}) {
  const server = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks));
      await serverHandler(request, response, body);
    } catch {
      if (!response.headersSent) response.writeHead(400);
      response.end();
    }
  });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}${path}`;
    return await runChecks({ baseUrl, model, apiKey: credential, timeoutMs: 3000, ...options });
  } finally {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  }
}

function anthropicFixture({ fragments, stopReason, extraStop, messageStop = true, reportedModel = model }) {
  return (request, response, body) => {
    assert.equal(request.url, '/v1/messages');
    assert.equal(request.headers['x-api-key'], credential);
    assert.equal(request.headers['anthropic-version'], '2023-06-01');
    assert.equal(request.headers.authorization, undefined);
    assert.equal(body.model, model);
    assert.equal(body.stream, true);
    assert.ok(body.tools?.[0]?.input_schema);
    const event = (type, payload = {}) => sse(payload, type);
    const delta = (index, fragment) => event('content_block_delta', {
      index, delta: { type: 'input_json_delta', partial_json: fragment },
    });
    const stop = reason => event('message_delta', { delta: { stop_reason: reason }, usage: { output_tokens: 32 } });
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end(event('message_start', { message: { model: reportedModel, content: [] } })
      + event('ping')
      + event('content_block_start', { index: 0, content_block: { type: 'tool_use', input: {} } })
      + fragments.map(fragment => delta(0, fragment)).join('')
      + event('content_block_stop', { index: 0 })
      + stop(stopReason) + (extraStop ? stop(extraStop) : '') + (messageStop ? event('message_stop') : ''));
  };
}

test('Anthropic C9 rejects end_turn after split tool input is left malformed', async () => {
  const report = await checkFixture(anthropicFixture({
    fragments: ['{"passage":', '"unfinished'], stopReason: 'end_turn', extraStop: 'max_tokens',
  }), '/v1/messages');
  assert.equal(report.protocol, 'anthropic');
  assert.equal(report.frameCount, 9);
  assert.equal(report.probes[0].id, 'C9');
  assert.equal(report.probes[0].status, 'fail');
  assert.equal(report.probes[0].severity, 'P0');
  assert.ok(Number.isFinite(report.ttftMs));
});

test('Anthropic C9 accepts a token-limit stop after partial tool input', async () => {
  const report = await checkFixture(anthropicFixture({
    fragments: ['', '{"passage":'], stopReason: 'max_tokens',
  }), '/v1', { protocol: 'anthropic' });
  assert.equal(report.grade, 'A+');
  assert.equal(report.probes[0].status, 'pass');
});

test('Anthropic C9 accepts a complete split tool input', async () => {
  const report = await checkFixture(anthropicFixture({
    fragments: ['', '{"passage":', '"complete"}'], stopReason: 'tool_use',
  }), '/v1/messages');
  assert.equal(report.probes[0].status, 'pass');
});

test('Anthropic C9 leaves an otherwise honest finish without message_stop inconclusive', async () => {
  const report = await checkFixture(anthropicFixture({
    fragments: ['{"passage":'], stopReason: 'max_tokens', messageStop: false,
  }), '/v1/messages');
  assert.equal(report.probes[0].status, 'inconclusive');
});

test('Anthropic model metadata is redacted before it reaches the report', async () => {
  const report = await checkFixture(anthropicFixture({
    fragments: ['{"passage":'], stopReason: 'max_tokens', reportedModel: `echo-${credential}`,
  }), '/v1/messages');
  assert.equal(report.modelMismatch, true);
  assert.equal(JSON.stringify(report).includes(credential), false);
});

function geminiFixture(frames, waits = []) {
  return async (request, response, body) => {
    assert.equal(request.url, `/v1beta/models/${model}:streamGenerateContent?alt=sse`);
    assert.equal(request.headers['x-goog-api-key'], credential);
    assert.equal(request.headers.authorization, undefined);
    assert.ok(body.contents?.[0]?.parts?.[0]?.text);
    response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=UTF-8' });
    response.flushHeaders();
    for (const [index, frame] of frames.entries()) {
      if (waits[index]) await delay(waits[index]);
      response.write(frame);
    }
    response.end();
  };
}

function gemini(text, finishReason) {
  return sse({ modelVersion: model, candidates: [{ index: 0,
    content: { role: 'model', parts: text === undefined ? [] : [{ text }] }, finishReason,
  }] });
}

test('Gemini C10 rejects STOP for a response with no visible content', async () => {
  const report = await checkFixture(geminiFixture([gemini('', 'STOP')]), '/v1beta', { protocol: 'gemini' });
  assert.equal(report.protocol, 'gemini');
  assert.equal(report.frameCount, 1);
  assert.equal(report.probes[0].id, 'C10');
  assert.equal(report.probes[0].status, 'fail');
  assert.equal(report.ttftMs, null);
});

test('Gemini C10 rejects STOP after malformed JSON content', async () => {
  for (const partial of ['{"values":[1,', '"unfinished']) {
    const report = await checkFixture(geminiFixture([gemini(partial), gemini(undefined, 'STOP')]),
      `/v1beta/models/${model}:streamGenerateContent`);
    assert.equal(report.probes[0].status, 'fail');
  }
});

test('Gemini C10 rejects a late fake-stream burst claiming STOP', async () => {
  const report = await checkFixture(geminiFixture([
    gemini('{"values":') + gemini('[1,2,3]}') + gemini(undefined, 'STOP'),
  ], [220]), '/v1beta', { protocol: 'gemini' });
  assert.equal(report.frameCount, 3);
  assert.equal(report.probes[0].status, 'fail');
  assert.equal(report.probes[0].severity, 'P1');
});

test('Gemini C10 accepts an empty terminal frame after meaningful content', async () => {
  const report = await checkFixture(geminiFixture([
    gemini('{"values":'), gemini('[1,2,3]}'), gemini(undefined, 'STOP'),
  ], [0, 45, 20]), `/v1beta/models/${model}:streamGenerateContent`);
  assert.equal(report.frameCount, 3);
  assert.equal(report.grade, 'A+');
  assert.equal(report.probes[0].status, 'pass');
  assert.ok(Number.isFinite(report.ttftMs));
});

test('Gemini C10 accepts MAX_TOKENS for clipped content', async () => {
  const report = await checkFixture(geminiFixture([gemini('{"values":[1,', 'MAX_TOKENS')]),
    '/v1beta', { protocol: 'gemini' });
  assert.equal(report.probes[0].status, 'pass');
});

test('Gemini normalization preserves full stream endpoints and rejects query credentials', () => {
  const endpoint = `https://relay.example/v1beta/models/${model}:streamGenerateContent`;
  assert.equal(normalizeTarget('https://relay.example/v1beta', 'gemini', `models/${model}`), endpoint);
  assert.equal(normalizeTarget(`${endpoint}/`), endpoint);
  assert.throws(() => normalizeTarget(`${endpoint}?${new URLSearchParams({ key: credential })}`));
});

function responsesFixture(terminal) {
  return (request, response, body) => {
    assert.equal(request.url, '/v1/responses');
    assert.equal(request.headers.authorization, `Bearer ${credential}`);
    assert.equal(body.store, false);
    assert.equal(body.model, model);
    assert.equal(body.stream, true);
    assert.ok(body.tools?.[0]?.parameters);
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end(sse({ response: { model } }, 'response.created')
      + sse({ item_id: 'item_test', output_index: 0, delta: '{"passage":' }, 'response.function_call_arguments.delta')
      + sse({ response: { model, status: terminal,
        incomplete_details: terminal === 'incomplete' ? { reason: 'max_output_tokens' } : null,
      } }, `response.${terminal}`));
  };
}

test('OpenAI Responses C1 rejects completed after clipped function arguments', async () => {
  const report = await checkFixture(responsesFixture('completed'), '/v1/responses');
  assert.equal(report.protocol, 'openai-responses');
  assert.equal(report.probes[0].id, 'C1');
  assert.equal(report.probes[0].status, 'fail');
});

test('OpenAI Responses C1 accepts an incomplete token-limit termination', async () => {
  const report = await checkFixture(responsesFixture('incomplete'), '/v1/responses');
  assert.equal(report.probes[0].status, 'pass');
});

function chatFixture(toolCalls, role = 'assistant') {
  return (_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const choice = (delta, finish_reason = null) => sse({ model, choices: [{ index: 0, delta, finish_reason }] });
    response.end(choice({ role }) + choice({ tool_calls: toolCalls }) + choice({}, 'tool_calls'));
  };
}

test('explicit Chat protocol C5 passes contiguous tool indices and the opening assistant role', async () => {
  const report = await checkFixture(chatFixture([{ index: 0, id: 'call_a' }, { index: 1, id: 'call_b' }]),
    '/v1', { protocol: 'openai-chat' });
  assert.equal(report.probes.find(({ id }) => id === 'C5')?.status, 'pass');
});

test('explicit Chat protocol C5 rejects colliding tool indices', async () => {
  const report = await checkFixture(chatFixture([{ index: 0, id: 'call_a' }, { index: 0, id: 'call_b' }]),
    '/v1', { protocol: 'openai-chat' });
  assert.equal(report.probes.find(({ id }) => id === 'C5')?.status, 'fail');
});
