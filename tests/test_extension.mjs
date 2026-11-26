import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { formatJSON, formatMarkdown, normalizeTarget, runChecks } from '../src/probes.js';

const API_KEY = 'fixtureSecretKey482e94bd';
const MODEL = 'fixture-model';
const DONE = 'data: [DONE]\r\n\r\n';
const usage = { prompt_tokens: 34, completion_tokens: 12, total_tokens: 46 };
const probeCodes = [
  'TOOL_CALL_BUDGET_CLIP',
  'STREAM_INCLUDE_USAGE',
  'UTF8_MULTIBYTE_INTEGRITY',
  'STREAM_BUFFERING',
];

function frame(payload) {
  return `data: ${JSON.stringify(payload)}\r\n\r\n`;
}

function chunk(model, delta, finishReason = null, includeUsage = false) {
  return {
    id: 'chatcmpl-fixture',
    object: 'chat.completion.chunk',
    created: 1_748_000_000,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(includeUsage ? { usage: null } : {}),
  };
}

async function writeSplitContent(response, model, corrupt) {
  const contentFrame = Buffer.from(frame(chunk(model, { content: '你好🌍' })));
  const boundary = contentFrame.indexOf(Buffer.from('🌍')) + 2;
  if (corrupt) {
    contentFrame[contentFrame.indexOf(Buffer.from('你')) + 1] = 0xff;
  }
  response.write(contentFrame.subarray(0, boundary));
  await delay(12);
  response.write(contentFrame.subarray(boundary));
}

async function serveCompletion(response, body, honest) {
  const model = body.model === 'unresolved-alias' ? 'served-checkpoint' : body.model;
  const includeUsage = body.stream_options?.include_usage === true;
  const role = frame(chunk(model, { role: 'assistant', content: '' }, null, includeUsage));
  const finish = (reason) => frame(chunk(model, {}, reason, includeUsage));
  const usageFrame = frame({ ...chunk(model, {}), choices: [], usage });

  response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
  response.flushHeaders();

  if (body.tools?.length) {
    const toolName = body.tools[0].function.name;
    const emptyArguments = body.model === 'empty-tool-arguments';
    const first = frame(chunk(model, {
      tool_calls: [{
        index: 0,
        id: 'call_fixture',
        type: 'function',
        function: { name: toolName, arguments: emptyArguments ? '' : '{"text":' },
      }],
    }));
    const second = frame(chunk(model, {
      tool_calls: [{ index: 0, function: { arguments: '"unfinished' } }],
    }));
    if (emptyArguments) {
      response.end(role + first + finish('tool_calls') + DONE);
    } else {
      const earlierFinish = body.model === 'contradictory-tool-finish' ? finish('stop') : '';
      response.end(role + first + second + earlierFinish + finish(honest ? 'length' : 'tool_calls') + DONE);
    }
    return;
  }

  const first = frame(chunk(model, { content: '你好🌍' }, null, includeUsage));
  const second = frame(chunk(model, { content: ' 世界🌐' }, null, includeUsage));
  if (includeUsage) {
    const premature = body.model === 'premature-usage';
    response.end(
      role + first + (honest && premature ? usageFrame : '') + second + finish('stop')
      + (honest && !premature ? usageFrame : '') + DONE,
    );
    return;
  }

  if (!honest) {
    await delay(150);
    response.end(role + first + second + finish('stop') + DONE);
    return;
  }

  response.write(': fixture comment\r\n\r\n' + role);
  await delay(12);
  await writeSplitContent(response, model, body.model === 'corrupt-utf8');
  await delay(24);
  // SSE joins these data lines before JSON parsing.
  response.write(second.replace('data: {', 'data: {\r\ndata: '));
  await delay(12);
  response.end(finish('stop') + DONE);
}

async function startFixture(honest, redirectTarget) {
  const calls = [];
  const server = createServer(async (request, response) => {
    try {
      const parts = [];
      for await (const part of request) parts.push(part);
      const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
      calls.push({
        method: request.method,
        path: request.url,
        authorization: request.headers.authorization,
        body,
      });

      if (body.model === 'redirect-model' && redirectTarget) {
        response.writeHead(307, { Location: `${redirectTarget}/chat/completions` }).end();
        return;
      }
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions'
        || request.headers.authorization !== `Bearer ${API_KEY}` || body.stream !== true) {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'Unexpected fixture request' } }));
        return;
      }
      if (body.model === 'echo-http-error') {
        response.writeHead(401, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({
          error: { message: `Rejected authorization ${request.headers.authorization}` },
        }));
        return;
      }
      await serveCompletion(response, body, honest);
    } catch (error) {
      if (response.headersSent) response.destroy(error);
      else response.writeHead(500).end();
    }
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, calls, baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
}

let honest;
let liar;

before(async () => {
  liar = await startFixture(false);
  honest = await startFixture(true, liar.baseUrl);
});

after(async () => {
  await Promise.all([honest, liar].filter(Boolean).map(async ({ server }) => {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  }));
});

function checks(fixture, model = MODEL, options = {}) {
  return runChecks({ baseUrl: fixture.baseUrl, model, apiKey: API_KEY, timeoutMs: 3_000, ...options });
}

test('honest SSE earns A+ with live progress, usage, and intact split Unicode', async () => {
  const progress = [];
  const initialCalls = honest.calls.length;
  const report = await checks(honest, MODEL, { onProgress: (event) => progress.push(event) });

  assert.equal(report.grade, 'A+');
  assert.equal(report.p0, 0);
  assert.equal(report.p1, 0);
  assert.equal(report.requestedModel, MODEL);
  assert.deepEqual(report.reportedModels, [MODEL]);
  assert.equal(report.modelMismatch, false);
  assert.ok(Number.isFinite(report.ttftMs) && report.ttftMs >= 0);
  assert.deepEqual(report.probes.map(({ id }) => id), ['C1', 'C4', 'C6', 'C7']);
  assert.deepEqual(report.probes.map(({ code }) => code), probeCodes);
  assert.deepEqual(report.probes.map(({ status }) => status), ['pass', 'pass', 'pass', 'pass']);
  assert.equal(progress.length, 8);

  const requests = honest.calls.slice(initialCalls);
  assert.equal(requests.length, 4);
  assert.ok(requests.every(({ body }) => body.model === MODEL));
  assert.ok(requests.some(({ body }) => body.tools?.length > 0
    && Number.isInteger(body.max_tokens) && body.max_tokens > 0 && body.max_tokens <= 32));
  assert.ok(requests.some(({ body }) => body.stream_options?.include_usage === true));
});

test('lying finish reason, missing usage and buffered deltas earn F', async () => {
  const report = await checks(liar);

  assert.equal(report.grade, 'F');
  assert.ok(report.p0 >= 1);
  assert.ok(report.p1 >= 1);
  assert.deepEqual(report.probes.map(({ status }) => status), ['fail', 'fail', 'pass', 'fail']);
  for (const probe of report.probes.filter(({ status }) => status === 'fail')) {
    assert.ok(probe.findings.length > 0, `${probe.id} should explain its failure`);
  }
});

test('C1 rejects an empty JSON argument stream claimed as a finished tool call', async () => {
  const report = await checks(honest, 'empty-tool-arguments');
  assert.equal(report.probes.find(({ id }) => id === 'C1').status, 'fail');
});

test('C1 retains a false stop if a later frame also claims length', async () => {
  const report = await checks(honest, 'contradictory-tool-finish');
  assert.equal(report.probes.find(({ id }) => id === 'C1').status, 'fail');
});

test('usage reported before a finish reason does not satisfy C4', async () => {
  const report = await checks(honest, 'premature-usage');
  assert.equal(report.probes.find(({ id }) => id === 'C4').status, 'fail');
});

test('C6 detects invalid UTF-8 even when other CJK and emoji survive', async () => {
  const report = await checks(honest, 'corrupt-utf8');
  assert.equal(report.probes.find(({ id }) => id === 'C6').status, 'fail');
});

test('model substitution is visible in the report and Markdown', async () => {
  const report = await checks(honest, 'unresolved-alias');
  assert.equal(report.modelMismatch, true);
  assert.equal(report.requestedModel, 'unresolved-alias');
  assert.deepEqual(report.reportedModels, ['served-checkpoint']);
  assert.match(formatMarkdown(report), /served-checkpoint/);
});

test('reports redact a credential echoed in model data and in an HTTP error', async () => {
  const echoedModel = await checks(honest, `echo-model-${API_KEY}`);
  const httpError = await checks(honest, 'echo-http-error');

  assert.equal(echoedModel.grade, 'A+');
  assert.notEqual(httpError.grade, 'A+');
  for (const report of [echoedModel, httpError]) {
    const markdown = formatMarkdown(report);
    const json = formatJSON(report);
    assert.ok(markdown.includes(report.grade));
    assert.equal(JSON.parse(json).grade, report.grade);
    assert.equal(markdown.includes(API_KEY), false, 'Markdown leaked the key');
    assert.equal(json.includes(API_KEY), false, 'JSON leaked the key');
  }
});

test('a redirect cannot send another request to a different target', async () => {
  const initialCalls = liar.calls.length;
  const report = await checks(honest, 'redirect-model');

  assert.notEqual(report.grade, 'A+');
  assert.equal(liar.calls.length, initialCalls, 'redirect target received a request');
});

test('normalizes an API base or an existing completion endpoint without duplicating its path', () => {
  assert.equal(normalizeTarget(`${honest.baseUrl}/`), `${honest.baseUrl}/chat/completions`);
  assert.equal(
    normalizeTarget(`${honest.baseUrl}/chat/completions/`),
    `${honest.baseUrl}/chat/completions`,
  );
});

test('rejects public cleartext and URL-embedded credentials and parameters', () => {
  assert.throws(() => normalizeTarget('https://*'));
  assert.throws(() => normalizeTarget('https://%2A.example'));
  const rejectedTargets = [
    'http://relay.example/v1',
    'https://user:secret@relay.example/v1',
    'https://relay.example/v1?api_key=secret',
    'https://relay.example/v1#ignored',
  ];
  for (const target of rejectedTargets) {
    assert.throws(() => normalizeTarget(target));
  }
});
