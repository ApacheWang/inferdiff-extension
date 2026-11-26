import { containsCredential, containsSuppliedCredential, createRedactor } from './privacy.js';
import { detectProtocol, normalizeTarget, runChecks } from './probes.js';

const SIDES = ['A', 'B'];
const GRADES = ['F', 'D', 'C', 'B', 'A', 'A+'];
const PROTOCOLS = new Map([
  ['openai-chat', 'OpenAI Chat Completions'],
  ['openai-responses', 'OpenAI Responses'],
  ['anthropic', 'Anthropic Messages'],
  ['gemini', 'Gemini SSE'],
]);

function fieldError(side, code) {
  return Object.assign(new Error(code), { side, code });
}

function normalizeEndpoint(baseUrl, protocol, model, side) {
  try {
    return normalizeTarget(baseUrl, protocol, model);
  } catch {
    if (protocol === 'gemini') {
      // A known valid model distinguishes Gemini model errors from bad URLs.
      try {
        normalizeTarget(baseUrl, protocol, 'example-model');
      } catch {
        throw fieldError(side, 'invalidBaseUrl');
      }
      throw fieldError(side, 'invalidModel');
    }
    throw fieldError(side, 'invalidBaseUrl');
  }
}

function containsAnySuppliedKey(value, keys) {
  return keys.some(key => key && (value === key || containsSuppliedCredential(value, key)
    || (key.length >= 8 && createRedactor(key)(value) !== value)));
}

/** Validate both sides before requesting host access or starting either probe suite. */
export function prepareCompareTargets(a, b) {
  const inputs = [a, b];
  const keys = inputs.map((target, index) => {
    const key = String(target.apiKey ?? '');
    if (/[^\u0020-\u007e\u00a0-\u00ff]/u.test(key)) throw fieldError(SIDES[index], 'invalidApiKey');
    return key.trim();
  });

  return inputs.map((target, index) => {
    const side = SIDES[index];
    const protocol = target.protocol && target.protocol !== 'auto' ? target.protocol : detectProtocol(target.baseUrl);
    const model = String(target.model ?? '').trim();
    if ((!model && protocol !== 'gemini') || containsCredential(model) || containsAnySuppliedKey(model, keys)) {
      throw fieldError(side, 'invalidModel');
    }
    const baseUrl = normalizeEndpoint(target.baseUrl, protocol, model, side);
    if (containsAnySuppliedKey(baseUrl, keys) || containsAnySuppliedKey(String(target.baseUrl), keys)) {
      throw fieldError(side, 'invalidBaseUrl');
    }
    return { baseUrl, protocol, model, apiKey: keys[index] };
  });
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function summarize(report) {
  const probes = Array.isArray(report?.probes) ? report.probes : null;
  const ttftMs = report?.ttftMs;
  return {
    protocol: PROTOCOLS.has(report?.protocol) ? report.protocol : null,
    grade: GRADES.includes(report?.grade) ? report.grade : null,
    passed: count(report?.passed) ?? probes?.filter(probe => probe?.status === 'pass').length ?? null,
    probeCount: count(report?.probeCount) ?? probes?.length ?? null,
    p0: count(report?.p0),
    p1: count(report?.p1),
    inconclusive: count(report?.inconclusive),
    ttftMs: Number.isFinite(ttftMs) && ttftMs >= 0 ? ttftMs : null,
  };
}

function rank(report) {
  return [GRADES.indexOf(report.grade), report.passed ?? -1,
    -(report.p0 ?? Infinity), -(report.p1 ?? Infinity), -(report.ttftMs ?? Infinity)];
}

function winner(a, b) {
  const rankA = rank(a);
  const rankB = rank(b);
  for (const [index, value] of rankA.entries()) {
    if (value !== rankB[index]) return value > rankB[index] ? 'A' : 'B';
  }
  return 'Tie';
}

export function selectWinner(a, b) {
  return winner(summarize(a), summarize(b));
}

function delta(a, b) {
  return a.ttftMs === null || b.ttftMs === null ? null : b.ttftMs - a.ttftMs;
}

export async function runComparison(a, b, { onProgress } = {}) {
  const targets = prepareCompareTargets(a, b);
  const checks = targets.map(async (target, index) => {
    const report = await runChecks({
      ...target,
      onProgress: ({ completed, total, probeId, status }) => {
        onProgress?.(SIDES[index], { completed, total, probeId, status });
      },
    });
    return summarize(report);
  });
  const [reportA, reportB] = await Promise.all(checks);
  return { a: reportA, b: reportB, winner: winner(reportA, reportB), ttftDeltaMs: delta(reportA, reportB) };
}

function ms(value) {
  return value === null ? 'Unavailable' : `${value} ms`;
}

/** Build a shareable card using only fixed labels and validated metrics. */
export function formatPkMarkdown(comparison) {
  const a = summarize(comparison?.a);
  const b = summarize(comparison?.b);
  const rows = [a, b].map((report, index) => {
    const protocol = PROTOCOLS.get(report.protocol) ?? 'Unavailable';
    const passed = report.passed === null || report.probeCount === null
      ? 'Unavailable' : `${report.passed}/${report.probeCount}`;
    const cells = [`Endpoint ${SIDES[index]}`, protocol, report.grade ?? 'Unavailable', passed,
      report.p0 ?? 'Unavailable', report.p1 ?? 'Unavailable', ms(report.ttftMs)];
    return `| ${cells.join(' | ')} |`;
  });
  const ttftDeltaMs = delta(a, b);
  const deltaText = ttftDeltaMs > 0 ? `+${ms(ttftDeltaMs)}` : ms(ttftDeltaMs);
  return [
    '## Relay Radar PK Compare',
    '',
    `**Winner: ${winner(a, b)}**`,
    '',
    '| Endpoint | Protocol | Grade | Passed | P0 | P1 | Effective TTFT |',
    '| :--- | :--- | :--- | ---: | ---: | ---: | ---: |',
    ...rows,
    '',
    `- TTFT delta (B − A): ${deltaText}`,
  ].join('\n');
}
