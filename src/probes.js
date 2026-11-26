import { containsCredential, containsSuppliedCredential, createRedactor, safeLabel } from "./privacy.js";

const LIMITS = Object.freeze({ timeoutMs: 20_000, streamBytes: 1_048_576 });
const CHAT = "openai-chat";
const RESPONSES = "openai-responses";
const ANTHROPIC = "anthropic";
const GEMINI = "gemini";
const GEMINI_ENDPOINT = /\/models\/([a-zA-Z0-9._-]+):streamGenerateContent$/;
const ENDPOINT_SUFFIXES = {
  [CHAT]: "/chat/completions", [RESPONSES]: "/responses", [ANTHROPIC]: "/messages",
};
const PASSAGE_PROMPT = "Call record_probe with a paragraph of at least 150 words about lighthouses in the passage field. Start the tool call now.";
const PASSAGE_PARAMETERS = {
  type: "object", properties: { passage: { type: "string" } },
  required: ["passage"], additionalProperties: false,
};
const PASSAGE_TOOL = {
  name: "record_probe", description: "Record a passage for the streaming diagnostic.",
};

const CHAT_PROBES = [
  {
    id: "C1", code: "TOOL_CALL_BUDGET_CLIP", title: "Truncation honesty",
    request: {
      max_tokens: 12,
      messages: [{ role: "user", content: PASSAGE_PROMPT }],
      tools: [{ type: "function", function: { ...PASSAGE_TOOL, parameters: PASSAGE_PARAMETERS } }],
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
    id: "C5", code: "INITIAL_ROLE_AND_TOOL_INDEX", title: "Role and tool indices",
    request: {
      max_tokens: 96,
      messages: [{ role: "user", content: "In parallel, call record_probe twice. Use the word alpha in the first passage and beta in the second." }],
      tools: [{ type: "function", function: { ...PASSAGE_TOOL, parameters: PASSAGE_PARAMETERS } }],
      tool_choice: "required", parallel_tool_calls: true,
    },
    inspect: inspectChatRole,
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

const PROTOCOL_PROBES = new Map([
  [CHAT, CHAT_PROBES],
  [RESPONSES, [{
    id: "C1", code: "TOOL_CALL_BUDGET_CLIP", title: "Truncation honesty",
    request: {
      store: false, max_output_tokens: 32, input: PASSAGE_PROMPT,
      tools: [{ type: "function", ...PASSAGE_TOOL, parameters: PASSAGE_PARAMETERS, strict: true }],
      tool_choice: { type: "function", name: "record_probe" },
    },
    inspect: inspectTruncation,
  }]],
  [ANTHROPIC, [{
    id: "C9", code: "ANTHROPIC_STREAM_CONTRACT", title: "Anthropic tool input",
    request: {
      max_tokens: 32, messages: [{ role: "user", content: PASSAGE_PROMPT }],
      tools: [{ ...PASSAGE_TOOL, input_schema: PASSAGE_PARAMETERS, eager_input_streaming: true }],
      tool_choice: { type: "tool", name: "record_probe" },
    },
    inspect: inspectAnthropic,
  }]],
  [GEMINI, [{
    id: "C10", code: "GEMINI_STREAM_CONTRACT", title: "Gemini stream finish",
    request: {
      contents: [{ role: "user", parts: [{ text: "Return a JSON object with a values array containing the integers 1 through 100 in order." }] }],
      generationConfig: { maxOutputTokens: 256, responseMimeType: "application/json" },
    },
    inspect: inspectGemini,
  }]],
]);

const MESSAGES = Object.freeze({
  c1Clipped: "Incomplete tool arguments correctly ended with finish_reason: length.",
  c1InvalidFinish: "Invalid or truncated tool arguments received a non-length finish reason.",
  c1NoClip: "Tool arguments formed valid JSON. The small token budget did not yield a truncation sample.",
  c1NoArguments: "The response did not provide tool argument bytes to assess.",
  c1ResponsesClipped: "Incomplete function arguments correctly ended with response.incomplete and max_output_tokens.",
  c1ResponsesInvalidFinish: "Invalid or truncated function arguments received a completed response.",
  c4Usage: "The trailing usage frame contained positive and consistent token counts.",
  c4MissingUsage: "The stream omitted the trailing usage frame after the finish reason.",
  c4InvalidUsage: "The trailing usage frame had missing, zero, or inconsistent token counts.",
  c5NoChoice: "The stream did not contain a Chat Completions choice to assess.",
  c5OpeningRole: "The first streamed choice did not declare the assistant role.",
  c5ToolIndices: "A streamed tool index was invalid, noncontiguous, or reused for another call.",
  c5Intact: "The first choice declared assistant and any tool call indices were consistent.",
  c6Intact: "CJK text and four-byte emoji arrived without U+FFFD replacement characters.",
  c6Replacement: "The stream contained U+FFFD replacement characters.",
  c6MissingSample: "The completion did not contain both CJK text and a four-byte emoji.",
  c7Streaming: "The content deltas did not meet the buffering threshold.",
  c7Buffered: "The first content delta arrived after more than 95% of elapsed time, with all deltas spanning under 15 ms.",
  c7TooFewDeltas: "Fewer than two content deltas arrived, so stream cadence could not be assessed.",
  c9InvalidFinish: "Anthropic reported end_turn after incomplete or malformed tool input JSON.",
  c9Clipped: "Anthropic reported the output limit with stop_reason: max_tokens.",
  c9Complete: "Anthropic reported a valid finish with complete streamed input or visible text.",
  c9NoSample: "The stream did not complete an Anthropic message with tool input or text to assess.",
  c10Empty: "Gemini reported STOP without visible candidate content.",
  c10InvalidFinish: "Gemini reported STOP with malformed JSON content or conflicting terminal frames.",
  c10Buffered: "Gemini reported STOP after a late burst of content deltas under 15 ms apart.",
  c10Clipped: "Gemini reported the output limit with finishReason: MAX_TOKENS.",
  c10Complete: "Gemini reported STOP with visible candidate content.",
  c10OtherFinish: "Gemini returned a finish reason outside the STOP and MAX_TOKENS checks.",
  badContentType: "The response was not a text/event-stream.",
  incompleteStream: "The stream ended without a finish reason or a [DONE] frame.",
  invalidSse: "The stream contained an invalid SSE JSON event.",
  responseError: "The endpoint returned an error event in the stream.",
  httpError: "The endpoint rejected the request.",
  timeout: "The probe reached its time limit.",
  networkError: "The request failed. Check the target, host access, TLS, and whether the endpoint redirects.",
  responseTooLarge: "The stream exceeded the diagnostic size limit.",
});

function endpointProtocol(path) {
  if (GEMINI_ENDPOINT.test(path)) return GEMINI;
  return Object.keys(ENDPOINT_SUFFIXES).find(protocol => path.endsWith(ENDPOINT_SUFFIXES[protocol]));
}

export function detectProtocol(baseUrl) {
  try {
    const url = new URL(String(baseUrl).trim());
    const path = url.pathname.replace(/\/+$/, "");
    return endpointProtocol(path)
      ?? (url.hostname === "api.anthropic.com" ? ANTHROPIC : null)
      ?? (url.hostname === "generativelanguage.googleapis.com" && !path.endsWith("/openai") ? GEMINI : CHAT);
  } catch {
    return CHAT;
  }
}

function protocolProbes(protocol) {
  const probes = PROTOCOL_PROBES.get(protocol);
  if (!probes) throw new Error("Choose a supported streaming protocol.");
  return probes;
}

export function getProbeIds(protocol = CHAT) {
  return protocolProbes(protocol).map(probe => probe.id);
}

export function normalizeTarget(baseUrl, protocol = detectProtocol(baseUrl), model) {
  protocolProbes(protocol);
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
  if (url.hostname.includes("*")) throw new Error("Enter a specific API hostname.");
  if (url.username || url.password || url.href.includes("?") || url.href.includes("#") || containsCredential(url.href)) {
    throw new Error("Remove credentials, query parameters, and fragments from the base URL.");
  }
  const path = url.pathname.replace(/\/+$/, "");
  const existing = endpointProtocol(path);
  if (existing && existing !== protocol) throw new Error("Use an endpoint for the selected streaming protocol.");
  if (existing) {
    url.pathname = path;
  } else if (protocol === GEMINI) {
    const name = String(model ?? "").trim().replace(/^models\//, "");
    if (!/^[a-zA-Z0-9._-]+$/.test(name) || containsCredential(name)) {
      throw new Error("Enter a Gemini model identifier without credentials.");
    }
    const base = (path || "/v1beta").replace(/\/models$/, "");
    url.pathname = `${base}/models/${name}:streamGenerateContent`;
  } else {
    const base = protocol === CHAT ? path : (path || "/v1");
    url.pathname = base + ENDPOINT_SUFFIXES[protocol];
  }
  return url.href;
}

function result(status, findingCode, severity = null) {
  return { status, severity, findingCode, findings: [MESSAGES[findingCode]] };
}

function isJson(value, objectOnly = false) {
  try {
    const parsed = JSON.parse(value);
    return !objectOnly || (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed));
  } catch {
    return false;
  }
}

function inspectTruncation(stream) {
  const argumentsSeen = [...stream.arguments.values()];
  if (argumentsSeen.length === 0) return result("inconclusive", "c1NoArguments");
  const invalidJson = argumentsSeen.some(value => !isJson(value, stream.protocol === RESPONSES));
  if (!invalidJson) return result("inconclusive", "c1NoClip");
  if (stream.finishReasons.size === 0) return result("inconclusive", "incompleteStream");
  if (stream.protocol === RESPONSES) {
    if (stream.finishReasons.has("completed")) return result("fail", "c1ResponsesInvalidFinish", "P0");
    return stream.finishReasons.has("max_output_tokens") && argumentsSeen.some(Boolean)
      ? result("pass", "c1ResponsesClipped") : result("inconclusive", "c1NoArguments");
  }
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

function inspectChatRole(stream) {
  if (stream.openingAssistant === null) return result("inconclusive", "c5NoChoice");
  if (!stream.openingAssistant) return result("fail", "c5OpeningRole", "P1");
  const indices = [...stream.toolIds.keys()].sort((a, b) => a - b);
  if (stream.toolIndexError || indices.some((index, position) => index !== position)) {
    return result("fail", "c5ToolIndices", "P0");
  }
  return result("pass", "c5Intact");
}

function inspectUnicode(stream) {
  const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
  const emoji = /(?=[\u{10000}-\u{10ffff}])\p{Emoji}/u;
  if (!cjk.test(stream.content) || !emoji.test(stream.content)) return result("inconclusive", "c6MissingSample");
  return result("pass", "c6Intact");
}

function inspectCadence(stream) {
  if (stream.contentFrames < 2) return result("inconclusive", "c7TooFewDeltas");
  return isBuffered(stream)
    ? result("fail", "c7Buffered", "P1") : result("pass", "c7Streaming");
}

function isBuffered(stream) {
  return stream.contentFrames >= 2 && stream.firstContent / stream.duration > 0.95
    && stream.lastContent - stream.firstContent < 15;
}

function malformedToolInput(stream) {
  return stream.malformedArgument || [...stream.arguments.values()].some(value => value && !isJson(value, true));
}

function inspectAnthropic(stream) {
  const malformed = malformedToolInput(stream);
  if (stream.malformedAtFinish || (malformed && stream.finishReasons.has("end_turn"))) {
    return result("fail", "c9InvalidFinish", "P0");
  }
  if (!stream.messageStopped || stream.firstDelta === null) return result("inconclusive", "c9NoSample");
  if (stream.finishReasons.has("max_tokens")) return result("pass", "c9Clipped");
  if (stream.finishReasons.size && !malformed) {
    return result("pass", "c9Complete");
  }
  return result("inconclusive", "c9NoSample");
}

function inspectGemini(stream) {
  if (stream.finishReasons.has("STOP")) {
    if (stream.contentAfterFinish || stream.finishReasons.size > 1) {
      return result("fail", "c10InvalidFinish", "P0");
    }
    const text = stream.content.trim();
    if (!text && !stream.structuredContent) return result("fail", "c10Empty", "P0");
    // Only JSON-shaped text has a syntax boundary the stream can verify.
    if (text && '{["'.includes(text[0]) && !isJson(text)) {
      return result("fail", "c10InvalidFinish", "P0");
    }
    if (isBuffered(stream)) return result("fail", "c10Buffered", "P1");
    return result("pass", "c10Complete");
  }
  if (stream.finishReasons.has("MAX_TOKENS")) return result("pass", "c10Clipped");
  return result("inconclusive", "c10OtherFinish");
}

function createStreamState(protocol) {
  return {
    protocol, arguments: new Map(), models: new Set(), content: "", frameCount: 0, contentFrames: 0,
    firstDelta: null, firstContent: null, lastContent: null, duration: null,
    finishReasons: new Set(), trailingUsage: null, done: false, replacement: false, error: null,
    openingAssistant: null, toolIds: new Map(), toolIndices: new Map(), toolIndexError: false,
    malformedArgument: false, malformedAtFinish: false, messageStopped: false,
    structuredContent: false, contentAfterFinish: false,
  };
}

function consumeFrame(state, data, event, arrival) {
  state.frameCount++;
  if (data.trim() === "[DONE]") {
    state.done = true;
    state.duration ??= arrival;
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
  const type = event || frame.type;
  if (frame.error || type === "error" || type === "response.failed") {
    state.error = "responseError";
    return;
  }
  switch (state.protocol) {
    case CHAT: consumeChat(state, frame, arrival); break;
    case RESPONSES: consumeResponses(state, frame, type, arrival); break;
    case ANTHROPIC: consumeAnthropic(state, frame, type, arrival); break;
    case GEMINI: consumeGemini(state, frame, arrival); break;
  }
}

function observeModel(state, model) {
  if (typeof model === "string" && model) state.models.add(model);
}

function observeContent(state, text, arrival) {
  state.content += text;
  state.contentFrames++;
  state.firstDelta ??= arrival;
  state.firstContent ??= arrival;
  state.lastContent = arrival;
}

function appendArguments(state, index, fragment, arrival) {
  state.arguments.set(index, (state.arguments.get(index) ?? "") + fragment);
  if (fragment) state.firstDelta ??= arrival;
}

function observeToolIndex(state, call) {
  const index = call?.index;
  if (!Number.isSafeInteger(index) || index < 0) {
    state.toolIndexError = true;
    return;
  }
  const id = call.id;
  if (!id) {
    if (!state.toolIds.has(index)) state.toolIds.set(index, undefined);
    return;
  }
  const priorId = state.toolIds.get(index);
  const priorIndex = state.toolIndices.get(id);
  state.toolIndexError ||= (priorId !== undefined && priorId !== id)
    || (priorIndex !== undefined && priorIndex !== index);
  state.toolIds.set(index, id);
  state.toolIndices.set(id, index);
}

function consumeChat(state, frame, arrival) {
  observeModel(state, frame.model);
  if (!Array.isArray(frame.choices)) return;

  // The usage frame follows the terminal choice and has an empty choices array.
  state.trailingUsage = state.finishReasons.size > 0 && frame.choices.length === 0 ? frame.usage ?? null : null;
  const choice = frame.choices.find(value => value && (value.index ?? 0) === 0);
  if (!choice) return;
  if (typeof choice.finish_reason === "string" && choice.finish_reason) state.finishReasons.add(choice.finish_reason);
  const delta = choice.delta;
  state.openingAssistant ??= delta?.role === "assistant";
  if (!delta) return;

  if (typeof delta.content === "string" && delta.content.length > 0) {
    observeContent(state, delta.content, arrival);
  }
  if (!Array.isArray(delta.tool_calls)) return;
  for (const [position, call] of delta.tool_calls.entries()) {
    observeToolIndex(state, call);
    const fragment = call?.function?.arguments;
    if (typeof fragment !== "string") continue;
    appendArguments(state, call.index ?? position, fragment, arrival);
  }
}

function consumeResponses(state, frame, type, arrival) {
  observeModel(state, frame.response?.model);
  const index = frame.output_index ?? frame.item_id ?? 0;
  if (type === "response.function_call_arguments.delta" && typeof frame.delta === "string") {
    appendArguments(state, index, frame.delta, arrival);
  } else if (type === "response.function_call_arguments.done" && typeof frame.arguments === "string"
    && !state.arguments.has(index)) {
    appendArguments(state, index, frame.arguments, arrival);
  } else if (type === "response.output_text.delta" && typeof frame.delta === "string" && frame.delta) {
    observeContent(state, frame.delta, arrival);
  } else if (type === "response.completed") {
    state.finishReasons.add("completed");
  } else if (type === "response.incomplete") {
    state.finishReasons.add(frame.response?.incomplete_details?.reason === "max_output_tokens"
      ? "max_output_tokens" : "incomplete");
  }
}

function consumeAnthropic(state, frame, type, arrival) {
  if (type === "message_start") observeModel(state, frame.message?.model);
  if (type === "content_block_delta") {
    const delta = frame.delta;
    if (delta?.type === "input_json_delta") {
      if (typeof delta.partial_json === "string") appendArguments(state, frame.index ?? 0, delta.partial_json, arrival);
      else state.malformedArgument = true;
    } else if (delta?.type === "text_delta" && typeof delta.text === "string" && delta.text) {
      observeContent(state, delta.text, arrival);
    }
  } else if (type === "message_delta") {
    const reason = frame.delta?.stop_reason;
    if (reason === "end_turn" && !state.finishReasons.has(reason)) state.malformedAtFinish = malformedToolInput(state);
    if (typeof reason === "string" && reason) state.finishReasons.add(reason);
  } else if (type === "message_stop") {
    state.messageStopped = true;
    state.done = true;
    state.duration = arrival;
  }
}

function consumeGemini(state, frame, arrival) {
  observeModel(state, frame.modelVersion);
  if (!Array.isArray(frame.candidates)) return;
  const candidate = frame.candidates.find((value, index) => value && (value.index ?? index) === 0);
  if (!candidate) return;
  const parts = Array.isArray(candidate.content?.parts)
    ? candidate.content.parts.filter(part => part && part.thought !== true) : [];
  const text = parts.map(part => typeof part.text === "string" ? part.text : "").join("");
  const structured = parts.some(part => part.functionCall?.name || part.inlineData?.data || part.fileData?.fileUri);
  if (text || structured) {
    state.structuredContent ||= structured;
    state.contentAfterFinish ||= state.finishReasons.size > 0;
    observeContent(state, text, arrival);
  }
  const reason = candidate.finishReason;
  if (typeof reason === "string" && reason && reason !== "FINISH_REASON_UNSPECIFIED") {
    state.finishReasons.add(reason);
    state.duration ??= arrival;
  }
}

async function readStream(body, started, state) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines = [];
  let event = "";
  let bytes = 0;
  let eof = false;

  function consumeLine(line, arrival) {
    if (line === "") {
      if (dataLines.length) consumeFrame(state, dataLines.join("\n"), event, arrival);
      dataLines = [];
      event = "";
    } else if (line === "data" || line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    } else if (line === "event" || line.startsWith("event:")) {
      event = line.slice(6).replace(/^ /, "");
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
        if (dataLines.length) consumeFrame(state, dataLines.join("\n"), event, arrival);
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

async function runProbe(probe, endpoint, protocol, model, apiKey, timeoutMs) {
  const stream = createStreamState(protocol);
  const controller = new AbortController();
  const started = performance.now();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { "Content-Type": "application/json", Accept: "text/event-stream" };
  if (protocol === ANTHROPIC) headers["anthropic-version"] = "2023-06-01";
  if (apiKey) {
    if (protocol === ANTHROPIC) headers["x-api-key"] = apiKey;
    else if (protocol === GEMINI) headers["x-goog-api-key"] = apiKey;
    else headers.Authorization = `Bearer ${apiKey}`;
  }
  const requestUrl = protocol === GEMINI ? `${endpoint}?alt=sse` : endpoint;
  const body = protocol === GEMINI ? probe.request : { model, stream: true, ...probe.request };
  let httpStatus;

  try {
    const response = await fetch(requestUrl, {
      method: "POST", headers, body: JSON.stringify(body),
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
      durationMs: Math.round(duration), frameCount: stream.frameCount, contentFrames: stream.contentFrames,
      frameSpanMs: firstContent === null ? null : Math.round(lastContent - firstContent),
      bufferingRatio: firstContent === null || !duration ? null : Number((firstContent / duration).toFixed(3)),
      ...(httpStatus === undefined ? {} : { httpStatus }),
    },
  };
}

function wireGrade(probes, p0, p1, inconclusive) {
  if (!probes.some(probe => probe.status === "pass") || p0 >= 2 || (p0 && p1 >= 2)) return "F";
  if (p0) return "D";
  const penalty = 2 * p1 + inconclusive;
  return ["A+", "A", "B", "C", "D"][penalty] ?? "F";
}

/** Execute the selected contract checks sequentially against a single target. */
export async function runChecks({ baseUrl, protocol, model, apiKey = "", timeoutMs = LIMITS.timeoutMs, onProgress }) {
  const selected = protocol ?? detectProtocol(baseUrl);
  const endpoint = normalizeTarget(baseUrl, selected, model);
  const requested = selected === GEMINI ? new URL(endpoint).pathname.match(GEMINI_ENDPOINT)[1] : String(model ?? "").trim();
  const key = String(apiKey).trim();
  if (containsSuppliedCredential(endpoint, key)) throw new Error("Remove credentials from the base URL.");
  if (!requested) throw new Error("Enter a model identifier.");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("The probe timeout must be positive.");

  // Calls made before protocol selection was available keep the original Chat checks.
  const planned = protocolProbes(selected).filter(probe => protocol !== undefined || probe.id !== "C5");
  const redact = createRedactor(key);
  const probes = [];
  const models = new Set();
  for (const probe of planned) {
    onProgress?.({ completed: probes.length, total: planned.length, probeId: probe.id, status: "running" });
    const { models: observed, probeResult } = await runProbe(probe, endpoint, selected, requested, key, timeoutMs);
    for (const value of observed) models.add(value);
    probeResult.findings = probeResult.findings.map(redact);
    probes.push(probeResult);
    onProgress?.({ completed: probes.length, total: planned.length, probeId: probe.id, status: probeResult.status, result: { ...probeResult, findings: [...probeResult.findings] } });
  }

  const modelMismatch = [...models].some(observed => observed !== requested);
  const reportedModels = [...new Set([...models].map(value => safeLabel(value, redact)))].sort();
  const p0 = probes.filter(probe => probe.severity === "P0").length;
  const p1 = probes.filter(probe => probe.severity === "P1").length + Number(modelMismatch);
  const inconclusive = probes.filter(probe => probe.status === "inconclusive").length;
  const ttftMs = (probes.find(probe => probe.id === "C7" && probe.ttftMs !== null)
    ?? probes.find(probe => probe.ttftMs !== null))?.ttftMs ?? null;
  const frameCount = probes.reduce((total, probe) => total + probe.frameCount, 0);
  return {
    protocol: selected, grade: wireGrade(probes, p0, p1, inconclusive), p0, p1, inconclusive, ttftMs, frameCount, modelMismatch,
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
export function formatMarkdown(report, { includeTarget = true } = {}) {
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
    ...(includeTarget ? [
      `- Endpoint: ${markdownCell(report.endpoint)}`,
      `- Requested model: ${markdownCell(report.requestedModel)}`,
      `- Reported model(s): ${report.reportedModels.map(markdownCell).join(", ") || "Unavailable"}`,
    ] : []),
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
