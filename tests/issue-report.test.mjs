import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as reports from '../src/issue-report.js';
import { containsCredential, containsSuppliedCredential, createRedactor } from '../src/privacy.js';
import { formatJSON, formatMarkdown, runChecks } from '../src/probes.js';

test('clipboard options omit endpoint and model metadata from Check Markdown', () => {
  const report = {
    protocol: 'openai-chat', grade: 'A+', p0: 0, p1: 0, inconclusive: 0, ttftMs: 12, frameCount: 4,
    endpoint: 'https://api.openai.com/private-path', requestedModel: 'opaque-secret-model',
    reportedModels: ['private-response-fragment'], probes: [], modelMismatch: true,
  };

  const scorecard = formatMarkdown(report, { includeTarget: false });
  const issue = reports.formatIssueMarkdown(report, { includeHost: false });
  for (const markdown of [scorecard, issue]) {
    assert.match(markdown, /Grade/);
    assert.doesNotMatch(markdown, /api\.openai\.com|private-path|opaque-secret-model|private-response-fragment/);
  }
});

test('Issue Markdown contains only compact redacted diagnostics', () => {
  const key = ['sk', 'fixture-only-token'].join('-');
  const content = 'private prompt and response fixture';
  const markdown = reports.formatIssueMarkdown({
    protocol: 'anthropic', grade: 'F', frameCount: 6, ttftMs: 24,
    endpoint: `https://${key}.relay.example:8443/${encodeURIComponent(content)}?key=${key}`,
    requestedModel: content, reportedModels: [key], prompt: content, response: content,
    probes: [{ id: 'C9', status: 'fail', code: key, findings: [content] }],
  });

  assert.match(markdown, /Protocol: Anthropic Messages/);
  assert.match(markdown, /Grade: F/);
  assert.match(markdown, /Breach codes: C9/);
  assert.match(markdown, /SSE frames: 6/);
  assert.match(markdown, /TTFT: 24 ms/);
  assert.match(markdown, /Host: \[redacted\]/);
  assert.ok(markdown.split('\n').length <= 25);
  for (const unexpected of [key, content, encodeURIComponent(content), 'relay.example', ':8443', '?key=']) {
    assert.equal(markdown.includes(unexpected), false);
  }
});

test('Issue Markdown rejects arbitrary values in report fields and preserves public provider hosts', () => {
  const credential = 'Bearer fixture-secret';
  const markdown = reports.formatIssueMarkdown({
    protocol: credential, grade: credential, frameCount: Infinity, ttftMs: credential,
    endpoint: 'https://api.openai.com/v1/responses',
    probes: [{ id: credential, status: 'fail' }, { id: 'C1', status: 'pass' }],
  });

  assert.match(markdown, /Host: `api\.openai\.com`/);
  assert.match(markdown, /Breach codes: None/);
  assert.doesNotMatch(markdown, /Bearer|fixture-secret|Infinity|\/v1/);
});

test('diagnostic metadata redaction covers supplied keys and independent credential syntax', () => {
  const suppliedKey = 'Fixture/opaque+key';
  const redact = createRedactor(suppliedKey);
  const independentKey = ['sk', 'fixture-independent'].join('-');
  const samples = [
    `https://relay.example/${encodeURIComponent(suppliedKey).toLowerCase()}`,
    `echo-${independentKey}`,
    `echo_${independentKey}`,
    'Authorization:\nBearer synthetic-token',
    '{"x-api-key":"synthetic-token"}',
    'relay%3Fkey%3Dsynthetic-token',
    'relay%3F%6Bey%3Dsynthetic-token%FF',
  ];

  assert.equal(redact('ordinary-model'), 'ordinary-model');
  assert.equal(containsSuppliedCredential(samples[0], suppliedKey), true);
  assert.ok(samples.slice(1).every(containsCredential));
  for (const sample of samples) {
    assert.match(redact(sample), /\[REDACTED\]/);
    for (const credential of [independentKey, 'synthetic-token', 'opaque']) {
      assert.equal(redact(sample).includes(credential), false);
    }
  }
});

test('probe reports redact provider-echoed credentials before reaching any export', async t => {
  const key = ['sk', 'independent-fixture-token'].join('-');
  const rawFrame = {
    type: 'message_start', message: { model: `provider_${key}` },
  };
  t.mock.method(globalThis, 'fetch', async () => new Response(
    `data: ${JSON.stringify(rawFrame)}\n\ndata: {"type":"message_stop"}\n\n`,
    { headers: { 'Content-Type': 'text/event-stream' } },
  ));

  const report = await runChecks({ baseUrl: 'https://api.anthropic.com/v1/messages', model: 'sample' });
  assert.deepEqual(report.reportedModels, ['[REDACTED]']);
  for (const format of [formatMarkdown, formatJSON, reports.formatIssueMarkdown]) {
    assert.equal(format(report).includes(key), false);
    assert.doesNotMatch(format(report), /Authorization|Bearer/);
  }
});
