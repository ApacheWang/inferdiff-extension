const PROTOCOLS = new Map([
  ['openai-chat', 'OpenAI Chat Completions'],
  ['openai-responses', 'OpenAI Responses'],
  ['anthropic', 'Anthropic Messages'],
  ['gemini', 'Gemini SSE'],
]);
const GRADES = new Set(['A+', 'A', 'B', 'C', 'D', 'F']);
const BREACH_CODES = ['C1', 'C4', 'C5', 'C6', 'C7', 'C9', 'C10'];
const PUBLIC_HOSTS = new Set([
  'api.openai.com', 'api.anthropic.com', 'generativelanguage.googleapis.com',
  'api.deepseek.com', 'openrouter.ai', 'api.siliconflow.cn',
]);

function redactedHost(endpoint) {
  if (typeof endpoint === 'string') {
    try {
      const { hostname } = new URL(endpoint);
      if (PUBLIC_HOSTS.has(hostname)) return `\`${hostname}\``;
    } catch {
      // Sanitized endpoints may no longer be valid URLs.
    }
  }
  return '[redacted]';
}

function count(value, unit = '') {
  return Number.isSafeInteger(value) && value >= 0 ? `${value}${unit}` : 'Unavailable';
}

export function formatIssueMarkdown(report, { includeHost = true } = {}) {
  const probes = Array.isArray(report.probes) ? report.probes : [];
  const breaches = BREACH_CODES.filter(id => probes.some(probe => probe?.id === id && probe.status === 'fail'));
  return [
    '## Relay Radar incident report',
    '',
    `- Protocol: ${PROTOCOLS.get(report.protocol) ?? 'Unknown'}`,
    `- Grade: ${GRADES.has(report.grade) ? report.grade : 'Unavailable'}`,
    `- Breach codes: ${breaches.join(', ') || 'None'}`,
    `- SSE frames: ${count(report.frameCount)}`,
    `- TTFT: ${count(report.ttftMs, ' ms')}`,
    ...(includeHost ? [`- Host: ${redactedHost(report.endpoint)}`] : []),
  ].join('\n');
}
