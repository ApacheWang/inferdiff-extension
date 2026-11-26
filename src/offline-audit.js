const PROTOCOLS = new Map([
  ['openai-chat', 'OpenAI Chat Completions'],
  ['openai-responses', 'OpenAI Responses'],
  ['anthropic', 'Anthropic Messages'],
  ['gemini', 'Gemini SSE'],
]);
const TRACE_DIALECTS = new Map([['anthropic-messages', 'anthropic'], ['gemini-sse', 'gemini']]);
const FINDINGS = new Map([
  ['D1', ['P0', 'Incomplete or malformed tool JSON claimed success.']],
  ['D2', ['P0', 'The stream contains a U+FFFD replacement character.']],
  ['D3', ['P0', 'Tool call indices collide.']],
  ['D4', ['P1', 'Requested usage is missing.']],
  ['C9', ['P0', 'Anthropic claimed completion with malformed tool input.']],
  ['C10', ['P0', 'Gemini reported STOP with empty, malformed, or inconsistent output.']],
  ['unrecognized', ['WARN', 'No frames matched the selected protocol.']],
  ['malformed', ['WARN', 'One or more frames could not be parsed.']],
  ['incomplete', ['WARN', 'The capture ended without a finish for every stream.']],
]);
const VERDICTS = new Set(['A+', 'WARN', 'F P0 BREACH']);
const INVALID = Symbol('invalid JSON');
const DONE = Symbol('done');
const ANTHROPIC_EVENTS = new Set([
  'message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop',
]);
const CHAT_SUCCESS = new Set(['stop', 'tool_calls', 'function_call']);
const ANTHROPIC_SUCCESS = new Set(['end_turn', 'tool_use', 'stop_sequence', 'pause_turn']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = value => Array.isArray(value) ? value : [];
const index = (value, fallback) => Number.isSafeInteger(value) && value >= 0 ? value : fallback;
const text = value => typeof value === 'string' ? value : '';
const sseLine = /^(?:data|event|id|retry)(?::|$)|^:/;

function parseJson(value) {
  if (typeof value !== 'string') return INVALID;
  try {
    return JSON.parse(value);
  } catch {
    return INVALID;
  }
}

function readFrame(data, event) {
  const value = typeof data === 'string'
    ? (data.trim() === '[DONE]' ? DONE : parseJson(data))
    : data;
  return {
    value: record(value) || value === DONE ? value : INVALID,
    event: text(event),
    replacement: text(data).includes('\uFFFD') || text(event).includes('\uFFFD'),
  };
}

function* sseFrames(input, fallbackEvent = '') {
  let event = '';
  let data = [];
  function* flush() {
    if (data.length) {
      const frame = readFrame(data.join('\n'), event || fallbackEvent);
      if (frame.value === INVALID && data.length > 1) {
        // Some DevTools copies join individually complete data lines without blank separators.
        const singles = data.map(line => readFrame(line, event || fallbackEvent));
        yield* singles.some(single => single.value !== INVALID) ? singles : [frame];
      } else {
        yield frame;
      }
    }
    event = '';
    data = [];
  }
  for (const line of input.split(/\r\n|\n|\r/)) {
    if (!line) {
      yield* flush();
      continue;
    }
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? '' : line.slice(separator + 1).replace(/^ /, '');
    if (field === 'event') {
      if (event && data.length) yield* flush();
      event = value;
    }
    if (field === 'data') data.push(value);
  }
  yield* flush();
}

function* traceFrames(input, metadata) {
  for (const line of input.split(/\r\n|\n|\r/)) {
    if (!line.trim()) continue;
    const row = parseJson(line);
    if (row?.type === 'header') {
      metadata.protocol = TRACE_DIALECTS.get(row.dialect) ?? row.dialect;
      metadata.includeUsage ||= row.request?.body?.stream_options?.include_usage === true;
      continue;
    }
    if (row?.type === 'summary') {
      metadata.interrupted ||= row.eof_clean === false;
      continue;
    }
    if (row?.type === 'frame') {
      if (row.parse_error === 'invalid_utf8') metadata.replacement = true;
      else if (row.parse_error === 'incomplete_event') metadata.interrupted = true;
      else if (text(row.parse_error)) metadata.malformed = true;
    }
    if (row?.type === 'frame' && typeof row.raw_wire === 'string' && row.raw_wire.trim()) {
      const raw = row.raw_wire.trimStart();
      if (sseLine.test(raw)) {
        const frames = [...sseFrames(raw, row.sse_event)];
        yield* frames.length ? frames : [readFrame(raw, row.sse_event)];
      } else {
        yield readFrame(raw, row.sse_event);
      }
      continue;
    }
    const data = row?.data ?? row?.payload;
    if (data !== undefined) {
      yield readFrame(data, row.event ?? row.sse_event);
    } else if (row?.type === 'frame' && row.is_done_sentinel === true) {
      yield readFrame('[DONE]');
    } else {
      yield readFrame(row === INVALID ? line : row);
    }
  }
}

function frameType({ value, event }) {
  return (event && event !== 'message' ? event : text(value?.type));
}

function frameProtocol(frame) {
  const { value } = frame;
  const type = frameType(frame);
  if (value === INVALID || value === DONE) return null;
  if (type.startsWith('response.')) return 'openai-responses';
  if (ANTHROPIC_EVENTS.has(type)) return 'anthropic';
  if (Array.isArray(value.choices) || value.object === 'chat.completion.chunk') return 'openai-chat';
  if (Array.isArray(value.candidates) || record(value.usageMetadata) || record(value.promptFeedback)) return 'gemini';
  return null;
}

function hasReplacement(value) {
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (typeof item === 'string' && item.includes('\uFFFD')) return true;
    if (Array.isArray(item)) {
      for (const value of item) pending.push(value);
    } else if (record(item)) {
      for (const key of Object.keys(item)) {
        if (key.includes('\uFFFD')) return true;
        pending.push(item[key]);
      }
    }
  }
  return false;
}

function lookup(map, key, initial) {
  if (!map.has(key)) map.set(key, initial());
  return map.get(key);
}

function createTool() {
  return { deltas: [], validSnapshot: false, invalid: false };
}

function appendTool(tool, delta) {
  if (typeof delta === 'string') tool.deltas.push(delta);
  else if (delta !== undefined) tool.invalid = true;
}

function invalidTool(tool) {
  const streamed = tool.deltas.join('');
  return tool.invalid || !(streamed ? record(parseJson(streamed)) : tool.validSnapshot);
}

function usageCounts(usage, input, output) {
  return [usage?.[input], usage?.[output]].every(count => Number.isSafeInteger(count) && count >= 0);
}

function inspectChat(frames, findings) {
  const choices = new Map();
  let usage = false;
  for (const { value } of frames) {
    const present = list(value.choices);
    usage = present.length === 0 && choices.size > 0
      && [...choices.values()].every(choice => choice.finished)
      && usageCounts(value.usage, 'prompt_tokens', 'completion_tokens');
    for (const [position, choice] of present.entries()) {
      if (!record(choice)) continue;
      const state = lookup(choices, index(choice.index, position), () => ({ tools: new Map(), ids: new Map() }));
      const calls = list(choice.delta?.tool_calls);
      const legacy = choice.delta?.function_call;
      const seen = new Set();
      for (const [slot, call] of (calls.length || !record(legacy) ? calls : [{ function: legacy }]).entries()) {
        if (!record(call)) continue;
        const key = index(call.index, slot);
        const tool = lookup(state.tools, key, createTool);
        if (seen.has(key)) findings.add('D3');
        seen.add(key);
        if (text(call.id)) {
          if ((tool.id && tool.id !== call.id) || (state.ids.has(call.id) && state.ids.get(call.id) !== key)) findings.add('D3');
          tool.id = call.id;
          state.ids.set(call.id, key);
        }
        appendTool(tool, call.function?.arguments);
      }
      if (CHAT_SUCCESS.has(choice.finish_reason) && [...state.tools.values()].some(invalidTool)) findings.add('D1');
      state.finished ||= Boolean(text(choice.finish_reason));
    }
  }
  return { complete: choices.size > 0 && [...choices.values()].every(choice => choice.finished), usage };
}

function responseTool(registry, outputIndex, itemId, findings) {
  const { byIndex, byId, tools } = registry;
  const key = index(outputIndex, null);
  const id = text(itemId);
  const tool = byIndex.get(key) ?? byId.get(id) ?? createTool();
  if ((key !== null && tool.index !== undefined && tool.index !== key)
    || (id && ((tool.id && tool.id !== id) || (byId.has(id) && byId.get(id) !== tool)))) findings.add('D3');
  if (key !== null) {
    byIndex.set(key, tool);
    tool.index = key;
  }
  if (id) {
    byId.set(id, tool);
    tool.id = id;
  }
  if (key === null && !id) return registry.unnamed;
  tools.add(tool);
  return tool;
}

function inspectResponses(frames, findings) {
  const unnamed = createTool();
  const registry = { byIndex: new Map(), byId: new Map(), tools: new Set(), unnamed };
  let complete = false;
  let usage = false;
  function inspectItem(item, outputIndex, finalized) {
    if (item?.type !== 'function_call') return;
    const tool = responseTool(registry, outputIndex, item.id, findings);
    tool.validSnapshot = record(parseJson(item.arguments));
    if (finalized) tool.invalid ||= !tool.validSnapshot;
  }
  for (const frame of frames) {
    const { value } = frame;
    const type = frameType(frame);
    usage ||= usageCounts(value.response?.usage, 'input_tokens', 'output_tokens');
    if (type === 'response.output_item.added' || type === 'response.output_item.done') {
      inspectItem(value.item, value.output_index, type === 'response.output_item.done');
    }
    if (type === 'response.function_call_arguments.delta' || type === 'response.function_call_arguments.done') {
      const tool = responseTool(registry, value.output_index, value.item_id, findings);
      registry.tools.add(tool);
      if (type.endsWith('.delta')) {
        appendTool(tool, value.delta);
      } else {
        tool.validSnapshot = record(parseJson(value.arguments));
        tool.invalid ||= !tool.validSnapshot;
      }
    }
    if (type === 'response.completed') {
      list(value.response?.output).forEach((item, position) => inspectItem(item, position, true));
      if ([...registry.tools].some(invalidTool)) findings.add('D1');
    }
    complete ||= type === 'response.completed' || type === 'response.incomplete';
  }
  return { complete, usage };
}

function inspectAnthropic(frames, findings) {
  const tools = new Map();
  const usage = {};
  let finished = false;
  let stopped = false;
  for (const frame of frames) {
    const { value } = frame;
    const type = frameType(frame);
    const key = index(value.index, 0);
    if (type === 'content_block_start' && ['tool_use', 'server_tool_use'].includes(value.content_block?.type)) {
      const tool = lookup(tools, key, createTool);
      const input = value.content_block.input;
      if (tool.started) findings.add('D3');
      tool.started = true;
      tool.validSnapshot = record(input);
      tool.invalid ||= input !== undefined && !tool.validSnapshot;
    }
    if (type === 'content_block_delta' && value.delta?.type === 'input_json_delta') {
      appendTool(lookup(tools, key, createTool), value.delta.partial_json ?? null);
    }
    if (type === 'message_start' || type === 'message_delta') {
      const counts = type === 'message_start' ? value.message?.usage : value.usage;
      for (const field of ['input_tokens', 'output_tokens']) {
        if (counts?.[field] !== undefined) usage[field] = counts[field];
      }
    }
    if (type === 'message_delta') {
      const reason = text(value.delta?.stop_reason);
      finished ||= Boolean(reason);
      if (ANTHROPIC_SUCCESS.has(reason) && [...tools.values()].some(invalidTool)) {
        findings.add('D1');
        if (reason === 'end_turn') findings.add('C9');
      }
    }
    stopped ||= type === 'message_stop';
  }
  return { complete: finished && stopped, usage: usageCounts(usage, 'input_tokens', 'output_tokens') };
}

function inspectGemini(frames, findings) {
  const candidates = new Map();
  let usage = false;
  for (const { value } of frames) {
    usage ||= usageCounts(value.usageMetadata, 'promptTokenCount', 'candidatesTokenCount');
    for (const [position, candidate] of list(value.candidates).entries()) {
      if (!record(candidate)) continue;
      const state = lookup(candidates, index(candidate.index, position), () => ({ chunks: [] }));
      for (const part of list(candidate.content?.parts)) {
        if (!record(part) || part.thought === true) continue;
        const chunk = text(part.text);
        const structured = Boolean(part.functionCall?.name || part.inlineData?.data || part.fileData?.fileUri);
        if ((chunk || structured) && state.finish) state.afterFinish = true;
        if (chunk) state.chunks.push(chunk);
        state.structured ||= structured;
        if (part.functionCall && part.functionCall.args !== undefined && !record(part.functionCall.args)) {
          state.invalid = true;
        }
      }
      const reason = text(candidate.finishReason);
      if (!reason || reason === 'FINISH_REASON_UNSPECIFIED') continue;
      state.conflict ||= Boolean(state.finish && state.finish !== reason);
      state.finish = reason;
      state.stopped ||= reason === 'STOP';
    }
  }
  for (const state of candidates.values()) {
    if (!state.stopped) continue;
    const content = state.chunks.join('').trim();
    // An opening quote may start ordinary prose. Only an unclosed quote is a truncation signal.
    const malformed = (content.startsWith('{') || content.startsWith('[')) && parseJson(content) === INVALID;
    const unclosedQuote = content.startsWith('"') && !/^"(?:[^"\\]|\\.)*"/su.test(content);
    if (state.afterFinish || state.conflict || state.invalid || malformed || unclosedQuote || (!content && !state.structured)) {
      findings.add('C10');
    }
  }
  return { complete: candidates.size > 0 && [...candidates.values()].every(candidate => candidate.finish), usage };
}

const INSPECTORS = new Map([
  ['openai-chat', inspectChat], ['openai-responses', inspectResponses],
  ['anthropic', inspectAnthropic], ['gemini', inspectGemini],
]);

/** Analyze a pasted capture. The returned diagnostics contain no capture text. */
export function auditOffline(input, { protocol = 'auto', includeUsage = false } = {}) {
  const source = text(input).trimStart();
  const trace = source.startsWith('{') || source.startsWith('[');
  const metadata = { protocol: null, includeUsage, interrupted: false, replacement: false, malformed: false };
  const frames = [...(trace ? traceFrames(source, metadata) : sseFrames(source))];
  const detected = frames.map(frameProtocol);
  const selected = PROTOCOLS.has(protocol) ? protocol : (PROTOCOLS.has(metadata.protocol) ? metadata.protocol : detected.find(Boolean));
  const findings = new Set();
  if ((!trace && source.includes('\uFFFD')) || metadata.replacement
    || frames.some(frame => frame.replacement || hasReplacement(frame.value))) findings.add('D2');
  if (metadata.malformed || frames.some(frame => frame.value === INVALID)) findings.add('malformed');
  const matching = frames.filter((_, position) => detected[position] === selected);
  if (!matching.length || !INSPECTORS.has(selected)) {
    findings.add('unrecognized');
  } else {
    const { complete, usage } = INSPECTORS.get(selected)(matching, findings);
    const streamError = frames.some(frame => frame.value?.error || ['error', 'response.failed'].includes(frameType(frame)));
    if (!complete || metadata.interrupted || streamError) findings.add('incomplete');
    if (metadata.includeUsage && !usage) findings.add('D4');
  }
  const diagnostics = [...FINDINGS].filter(([code]) => findings.has(code))
    .map(([code, [severity]]) => ({ code, severity }));
  return {
    protocol: selected ?? 'unknown',
    verdict: diagnostics.some(finding => finding.severity === 'P0') ? 'F P0 BREACH' : (diagnostics.length ? 'WARN' : 'A+'),
    frameCount: frames.length,
    findings: diagnostics,
  };
}

export function formatOfflineIssueMarkdown(report) {
  const codes = new Set(list(report.findings).map(finding => finding?.code));
  const findings = [...FINDINGS].filter(([code]) => codes.has(code))
    .map(([code, [severity, detail]]) => `- ${code} (${severity}) · ${detail}`);
  return [
    '## Relay Radar offline incident report',
    '',
    `- Protocol: ${PROTOCOLS.get(report.protocol) ?? 'Unknown'}`,
    `- Verdict: ${VERDICTS.has(report.verdict) ? report.verdict : 'Unavailable'}`,
    `- Frames: ${Number.isSafeInteger(report.frameCount) && report.frameCount >= 0 ? report.frameCount : 'Unavailable'}`,
    ...(findings.length ? findings : ['- Findings: None']),
  ].join('\n');
}
