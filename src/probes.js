const LIMITS = Object.freeze({ timeoutMs: 20_000, streamBytes: 1_048_576 });

const PROBES = [
  {
    id: "C1", code: "TOOL_CALL_BUDGET_CLIP", title: "Truncation honesty",
    request: {
      max_tokens: 12,
      messages: [{ role: "user", content: "Call record_probe with a paragraph of at least 150 words about lighthouses in the passage field. Start the tool call now." }],
      tools: [{ type: "function", function: {
        name: "record_probe",
        description: "Record a passage for the streaming diagnostic.",
        parameters: {
          type: "object", properties: { passage: { type: "string" } },
          required: ["passage"], additionalProperties: false,
        },
      } }],
      tool_choice: { type: "function", function: { name: "record_probe" } },
    },
    inspect: inspectTruncation,
  },
  {
    id: "C4", code: "STREAM_INCLUDE_USAGE", title: "Usage accounting",
    request: {
      max_tokens: 24, stream_options: { include_usage: true },
      messages: [{ role: "user", content: "Reply with exactly these words: streaming usage check." }],
    },
    inspect: inspectUsage,
  },
  {
    id: "C6", code: "UTF8_MULTIBYTE_INTEGRITY", title: "UTF-8 integrity",
    request: {
      max_tokens: 48,
      messages: [{ role: "user", content: "Reply with exactly this text, keeping the Chinese characters and emoji: 你好，世界 🌍🚀" }],
    },
    inspect: inspectUnicode,
  },
  {
    id: "C7", code: "STREAM_BUFFERING", title: "Streaming cadence",
    request: {
      max_tokens: 160,
      messages: [{ role: "user", content: "List the integers from 1 through 100, separated by commas. Write every integer, in order, with no other text." }],
    },
    inspect: inspectCadence,
  },
];

const MESSAGES = Object.freeze({
  c1Clipped: "Incomplete tool arguments correctly ended with finish_reason: length.",
  c1InvalidFinish: "Invalid or truncated tool arguments received a non-length finish reason.",
  c1NoClip: "Tool arguments formed valid JSON. The small token budget did not yield a truncation sample.",
  c1NoArguments: "The response did not provide tool argument bytes to assess.",
  c4Usage: "The trailing usage frame contained positive and consistent token counts.",
  c4MissingUsage: "The stream omitted the trailing usage frame after the finish reason.",
  c4InvalidUsage: "The trailing usage frame had missing, zero, or inconsistent token counts.",
  c6Intact: "CJK text and four-byte emoji arrived without U+FFFD replacement characters.",
  c6Replacement: "The stream contained U+FFFD replacement characters.",
  c6MissingSample: "The completion did not contain both CJK text and a four-byte emoji.",
  c7Streaming: "The content deltas did not meet the buffering threshold.",
  c7Buffered: "The first content delta arrived after more than 95% of elapsed time, with all deltas spanning under 15 ms.",
  c7TooFewDeltas: "Fewer than two content deltas arrived, so stream cadence could not be assessed.",
  badContentType: "The response was not a text/event-stream.",
  incompleteStream: "The stream ended without a finish reason or a [DONE] frame.",
  invalidSse: "The stream contained an invalid SSE JSON event.",
  responseError: "The endpoint returned an error event in the stream.",
  httpError: "The endpoint rejected the request.",
  timeout: "The probe reached its time limit.",
  networkError: "The request failed. Check the target, host access, TLS, and whether the endpoint redirects.",
  responseTooLarge: "The stream exceeded the diagnostic size limit.",
});

export function normalizeTarget(baseUrl) {
  let url;
  try {
    url = new URL(String(baseUrl).trim());
  } catch {
    throw new Error("Enter an absolute API base URL.");
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error("Use HTTPS, or HTTP on localhost or 127.0.0.1.");
  }
  if (url.username || url.password || url.href.includes("?") || url.href.includes("#")) {
    throw new Error("Remove credentials, query parameters, and fragments from the base URL.");
  }
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/chat/completions") ? path : `${path}/chat/completions`;
  return url.href;
}

function result(status, findingCode, severity = null) {
  return { status, severity, findingCode, findings: [MESSAGES[findingCode]] };
}

function inspectTruncation(stream) {
  const argumentsSeen = [...stream.arguments.values()];
  if (argumentsSeen.length === 0) return result("inconclusive", "c1NoArguments");
  const invalidJson = argumentsSeen.some(value => {
    try {
      JSON.parse(value);
      return false;
    } catch {
      return true;
    }
  });
  if (!invalidJson) return result("inconclusive", "c1NoClip");
  if (stream.finishReasons.size === 0) return result("inconclusive", "incompleteStream");
  if ([...stream.finishReasons].some(reason => reason !== "length")) return result("fail", "c1InvalidFinish", "P0");
  return argumentsSeen.some(Boolean) ? result("pass", "c1Clipped") : result("inconclusive", "c1NoArguments");
}

function inspectUsage(stream) {
  const usage = stream.trailingUsage;
  if (!usage) return result("fail", "c4MissingUsage", "P1");
  const { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total } = usage;
  const positive = [prompt, completion, total].every(value => Number.isSafeInteger(value) && value > 0);
  return positive && total === prompt + completion
    ? result("pass", "c4Usage") : result("fail", "c4InvalidUsage", "P1");
}

function inspectUnicode(stream) {
  const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
  const emoji = /(?=[\u{10000}-\u{10ffff}])\p{Emoji}/u;
  if (!cjk.test(stream.content) || !emoji.test(stream.content)) return result("inconclusive", "c6MissingSample");
  return result("pass", "c6Intact");
}

function inspectCadence(stream) {
  if (stream.contentFrames < 2) return result("inconclusive", "c7TooFewDeltas");
  const frameSpan = stream.lastContent - stream.firstContent;
  const bufferingRatio = stream.firstContent / stream.duration;
  return bufferingRatio > 0.95 && frameSpan < 15
    ? result("fail", "c7Buffered", "P1") : result("pass", "c7Streaming");
}

function createStreamState() {
  return {
    arguments: new Map(), models: new Set(), content: "", contentFrames: 0,
    firstDelta: null, firstContent: null, lastContent: null, duration: null,
    finishReasons: new Set(), trailingUsage: null, done: false, replacement: false, error: null,
  };
}

function consumeFrame(state, data, arrival) {
  if (data.trim() === "[DONE]") {
    state.done = true;
    state.duration = arrival;
    return;
  }

  let frame;
  try {
    frame = JSON.parse(data);
  } catch {
    state.error = "invalidSse";
    return;
  }
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
    state.error = "invalidSse";
    return;
  }
  if (frame.error) {
    state.error = "responseError";
    return;
  }
  if (typeof frame.model === "string" && frame.model) state.models.add(frame.model);
  if (!Array.isArray(frame.choices)) return;

  // The usage frame follows the terminal choice and has an empty choices array.
  state.trailingUsage = state.finishReasons.size > 0 && frame.choices.length === 0 ? frame.usage ?? null : null;
  const choice = frame.choices.find(value => value && (value.index ?? 0) === 0);
  if (!choice) return;
  if (typeof choice.finish_reason === "string" && choice.finish_reason) state.finishReasons.add(choice.finish_reason);
  const delta = choice.delta;
  if (!delta) return;

  if (typeof delta.content === "string" && delta.content.length > 0) {
    state.content += delta.content;
    state.contentFrames++;
    state.firstDelta ??= arrival;
    state.firstContent ??= arrival;
    state.lastContent = arrival;
  }
  if (!Array.isArray(delta.tool_calls)) return;
  for (const [position, call] of delta.tool_calls.entries()) {
    const fragment = call?.function?.arguments;
    if (typeof fragment !== "string") continue;
    const index = call.index ?? position;
    state.arguments.set(index, (state.arguments.get(index) ?? "") + fragment);
    if (fragment) state.firstDelta ??= arrival;
  }
}

async function readStream(body, started, state) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines = [];
  let bytes = 0;
  let eof = false;

  function consumeLine(line, arrival) {
    if (line === "") {
      if (dataLines.length) consumeFrame(state, dataLines.join("\n"), arrival);
      dataLines = [];
    } else if (line === "data" || line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }

  try {
    while (!state.done && !state.error && !eof) {
      const packet = await reader.read();
      const arrival = performance.now() - started;
      eof = packet.done;
      bytes += packet.value?.byteLength ?? 0;
      if (bytes > LIMITS.streamBytes) {
        state.error = "responseTooLarge";
        break;
      }
      const text = eof ? decoder.decode() : decoder.decode(packet.value, { stream: true });
      state.replacement ||= text.includes("\uFFFD");
      buffer += text;

      const newlines = /\r\n|[\r\n]/g;
      let lineStart = 0;
      for (const match of buffer.matchAll(newlines)) {
        if (!eof && match[0] === "\r" && match.index === buffer.length - 1) break;
        consumeLine(buffer.slice(lineStart, match.index), arrival);
        lineStart = match.index + match[0].length;
        if (state.done || state.error) break;
      }
      buffer = buffer.slice(lineStart);
      if (eof && !state.done && !state.error) {
        if (buffer) consumeLine(buffer, arrival);
        if (dataLines.length) consumeFrame(state, dataLines.join("\n"), arrival);
        state.duration ??= arrival;
      }
    }
  } finally {
    if (!eof) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function getVerdict(probe, stream) {
  if (probe.id === "C6" && (stream.replacement || stream.content.includes("\uFFFD"))) {
    return result("fail", "c6Replacement", "P0");
  }
  if (stream.error) return result("inconclusive", stream.error);
  if (!stream.done && stream.finishReasons.size === 0) return result("inconclusive", "incompleteStream");
  return probe.inspect(stream);
}

async function runProbe(probe, endpoint, model, apiKey, timeoutMs) {
  const stream = createStreamState();
  const controller = new AbortController();
  const started = performance.now();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { "Content-Type": "application/json", Accept: "text/event-stream" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  let httpStatus;

  try {
    const response = await fetch(endpoint, {
      method: "POST", headers, body: JSON.stringify({ model, stream: true, ...probe.request }),
      signal: controller.signal, redirect: "error", credentials: "omit",
      cache: "no-store", referrerPolicy: "no-referrer",
    });
    if (!response.ok) {
      httpStatus = response.status;
      stream.error = "httpError";
    } else if (!response.body || !/^text\/event-stream\s*(?:;|$)/i.test(response.headers.get("content-type") ?? "")) {
      stream.error = "badContentType";
    } else {
      await readStream(response.body, started, stream);
    }
    if (stream.error && response.body && !response.body.locked) void response.body.cancel().catch(() => {});
  } catch {
    stream.error = controller.signal.aborted ? "timeout" : "networkError";
  } finally {
    clearTimeout(timeout);
    stream.duration ??= performance.now() - started;
  }

  const { firstContent, lastContent, duration } = stream;
  return {
    models: stream.models,
    probeResult: {
      id: probe.id, code: probe.code, title: probe.title, ...getVerdict(probe, stream),
      ttftMs: stream.firstDelta === null ? null : Math.round(stream.firstDelta),
      durationMs: Math.round(duration), contentFrames: stream.contentFrames,
      frameSpanMs: firstContent === null ? null : Math.round(lastContent - firstContent),
      bufferingRatio: firstContent === null ? null : Number((firstContent / duration).toFixed(3)),
      ...(httpStatus === undefined ? {} : { httpStatus }),
    },
  };
}

function createRedactor(apiKey) {
  if (!apiKey) return text => text;
  const variants = new Set([apiKey, JSON.stringify(apiKey).slice(1, -1)]);
  // Some servers echo URI-encoded values in diagnostic metadata.
  try {
    const encoded = encodeURIComponent(apiKey);
    variants.add(encoded);
    variants.add(encoded.replace(/%[\da-f]{2}/gi, match => match.toLowerCase()));
  } catch {
    // An ill-formed input still gets exact and JSON-escaped redaction.
  }
  const escaped = [...variants].sort((a, b) => b.length - a.length)
    .map(value => value.replace(/[.*+?^$\x7b\x7d()|[\]\\]/g, "\\$&"));
  const secret = new RegExp(escaped.join("|"), "g");
  return text => text.replace(secret, "[REDACTED]");
}

function safeLabel(text, redact) {
  return redact(text).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 240);
}

function wireGrade(probes, p0, p1, inconclusive) {
  if (!probes.some(probe => probe.status === "pass") || p0 >= 2 || (p0 && p1 >= 2)) return "F";
  if (p0) return "D";
  const penalty = 2 * p1 + inconclusive;
  return ["A+", "A", "B", "C", "D"][penalty] ?? "F";
}

/** Execute the four contract checks sequentially against a single target. */
export async function runChecks({ baseUrl, model, apiKey = "", timeoutMs = LIMITS.timeoutMs, onProgress }) {
  const endpoint = normalizeTarget(baseUrl);
  const requested = String(model ?? "").trim();
  const key = String(apiKey).trim();
  if (!requested) throw new Error("Enter a model identifier.");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("The probe timeout must be positive.");

  const redact = createRedactor(key);
  const probes = [];
  const models = new Set();
  for (const probe of PROBES) {
    onProgress?.({ completed: probes.length, total: PROBES.length, probeId: probe.id, status: "running" });
    const { models: observed, probeResult } = await runProbe(probe, endpoint, requested, key, timeoutMs);
    for (const value of observed) models.add(value);
    probeResult.findings = probeResult.findings.map(redact);
    probes.push(probeResult);
    onProgress?.({ completed: probes.length, total: PROBES.length, probeId: probe.id, status: probeResult.status, result: { ...probeResult, findings: [...probeResult.findings] } });
  }

  const modelMismatch = [...models].some(observed => observed !== requested);
  const reportedModels = [...new Set([...models].map(value => safeLabel(value, redact)))].sort();
  const p0 = probes.filter(probe => probe.severity === "P0").length;
  const p1 = probes.filter(probe => probe.severity === "P1").length + Number(modelMismatch);
  const inconclusive = probes.filter(probe => probe.status === "inconclusive").length;
  const ttftMs = (probes.find(probe => probe.id === "C7" && probe.ttftMs !== null)
    ?? probes.find(probe => probe.ttftMs !== null))?.ttftMs ?? null;
  return {
    grade: wireGrade(probes, p0, p1, inconclusive), p0, p1, inconclusive, ttftMs, modelMismatch,
    endpoint: redact(endpoint), requestedModel: safeLabel(requested, redact), reportedModels, probes,
  };
}

function markdownCell(value) {
  return String(value).replace(/[\r\n]+/g, " ").replace(/[\\`*_{}[\]<>|]/g, "\\$&");
}

function milliseconds(value) {
  return value === null ? "—" : `${value} ms`;
}

/** The report returned by runChecks already contains only redacted diagnostic data. */
export function formatMarkdown(report) {
  const rows = report.probes.map(probe => {
    const status = [probe.status, probe.severity].filter(Boolean).join(" / ");
    const evidence = [...probe.findings];
    if (probe.httpStatus) evidence.push(`HTTP ${probe.httpStatus}.`);
    if (probe.id === "C7" && probe.frameSpanMs !== null && probe.bufferingRatio !== null) {
      evidence.push(`${probe.contentFrames} content frames over ${milliseconds(probe.frameSpanMs)}. First content at ${Math.round(probe.bufferingRatio * 100)}% of elapsed time.`);
    }
    return `| ${probe.id} ${probe.title} | ${status} | ${milliseconds(probe.ttftMs)} | ${markdownCell(evidence.join(" "))} |`;
  });
  return [
    "## inferdiff Relay Radar — Wire Health Scorecard",
    "",
    `**Grade ${report.grade}** · ${report.p0} P0 · ${report.p1} P1 · ${report.inconclusive} inconclusive · TTFT ${milliseconds(report.ttftMs)}`,
    "",
    `- Endpoint: ${markdownCell(report.endpoint)}`,
    `- Requested model: ${markdownCell(report.requestedModel)}`,
    `- Reported model(s): ${report.reportedModels.map(markdownCell).join(", ") || "Unavailable"}`,
    `- Model mismatch: ${report.modelMismatch ? "Yes (check for provider aliases)" : report.reportedModels.length ? "No" : "Unknown"}`,
    "",
    "| Probe | Status | TTFT | Findings |",
    "| :--- | :--- | ---: | :--- |",
    ...rows,
    "",
  ].join("\n");
}

export function formatJSON(report) {
  return JSON.stringify(report, null, 2);
}
