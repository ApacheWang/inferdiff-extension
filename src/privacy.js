const REDACTED = '[REDACTED]';
const CREDENTIAL_PATTERNS = [
  /(?<![a-z0-9])sk-[\w-]+|sk-(?:ant|or-v1|proj|svcacct)-[\w-]+|AIza[\w-]{20,}/i,
  /(?<![a-z0-9])(?:authorization|x-api-key|x-goog-api-key|api[_-]?key)["']?\s*[:=]/i,
  /\bbearer\s+\S|[?&]key\s*=/i,
];

function decodeAscii(value) {
  // Inspect escaped labels even if a neighboring escape is invalid UTF-8.
  return value.replace(/%([0-7][\da-f])|\\u00([0-7][\da-f])/gi,
    (_, percent, unicode) => String.fromCharCode(Number.parseInt(percent ?? unicode, 16)));
}

export function containsCredential(value) {
  const decoded = decodeAscii(decodeAscii(value));
  return CREDENTIAL_PATTERNS.some(pattern => pattern.test(value) || pattern.test(decoded));
}

export function containsSuppliedCredential(value, apiKey) {
  // Short inputs can coincide with ordinary URL segments rather than credentials.
  if (apiKey.length < 8) return false;
  const normalizedKey = apiKey.toLowerCase();
  return value.toLowerCase().includes(normalizedKey)
    || decodeAscii(decodeAscii(value)).toLowerCase().includes(normalizedKey);
}

export function createRedactor(apiKey) {
  const variants = new Set([apiKey, JSON.stringify(apiKey).slice(1, -1)]);
  try {
    variants.add(encodeURIComponent(apiKey));
  } catch {
    // The original and JSON-escaped values still cover ill-formed Unicode.
  }
  const escaped = [...variants].sort((a, b) => b.length - a.length)
    .map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const secret = apiKey ? new RegExp(escaped.join('|'), 'gi') : null;
  return value => {
    if (containsCredential(value)) return REDACTED;
    const redacted = secret ? value.replace(secret, REDACTED) : value;
    return containsSuppliedCredential(redacted, apiKey) ? REDACTED : redacted;
  };
}

export function safeLabel(value, redact) {
  return redact(value).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 240);
}
