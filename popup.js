import { formatPkMarkdown, prepareCompareTargets, runComparison } from './src/compare.js';
import { CLOUD_DESTINATION, PROVIDERS, destinationUrl } from './src/config.js';
import { formatIssueMarkdown } from './src/issue-report.js';
import { auditOffline, formatOfflineIssueMarkdown } from './src/offline-audit.js';
import { containsCredential, containsSuppliedCredential } from './src/privacy.js';
import { detectProtocol, formatJSON, formatMarkdown, getProbeIds, normalizeTarget, runChecks } from './src/probes.js';

const copy = {
  en: {
    languages: 'Language',
    targetFields: 'API endpoint settings',
    presets: 'Provider presets',
    protocol: 'API protocol',
    autoProtocol: 'Auto-detect from URL',
    baseUrl: 'Base URL',
    model: 'Model',
    apiKey: 'API key',
    keyPlaceholder: 'If required',
    run: 'Run Check',
    checking: 'Checking…',
    progress: 'Probe progress',
    wireHealth: 'Wire health',
    C1: 'Truncation honesty',
    C4: 'Usage accounting',
    C5: 'Role and tool indices',
    C6: 'UTF-8 integrity',
    C7: 'Stream buffering',
    C9: 'Tool input truncation',
    C10: 'Finish and stream integrity',
    pending: 'Ready',
    running: 'Running',
    pass: 'Pass',
    fail: 'Fail',
    inconclusive: 'Inconclusive',
    copyMarkdown: 'Copy Markdown',
    copyIssue: 'Copy Redacted Issue Report',
    exportJson: 'Export JSON',
    cloud: 'Watch 24/7 in inferdiff Cloud',
    cloudDisabled: 'Set a valid inferdiff Cloud destination in src/config.js.',
    invalidBaseUrl: 'Enter an HTTPS base URL or HTTP on localhost or 127.0.0.1. Remove credentials, query strings, and fragments.',
    invalidModel: 'Enter a model ID.',
    invalidApiKey: 'Use a single-line API key.',
    keyCleared: 'The endpoint changed. Enter its API key if required.',
    permission: 'Confirm browser access to this host.',
    denied: 'Host access was declined. Run the check again to request it.',
    permissionError: 'Could not request host access. Open Relay Radar from the browser toolbar and try again.',
    checkError: 'Could not finish the check. Verify the settings and try again.',
    complete: 'Check complete.',
    copied: 'Markdown copied.',
    issueCopied: 'Redacted Issue report copied.',
    copyError: 'Clipboard access is unavailable.',
    exportError: 'Could not export the report.',
    mismatch: 'Model ID differs from the request. Reported',
    c1Clipped: 'Partial tool arguments ended with length.',
    c1InvalidFinish: 'Partial tool arguments require length for every finish reason.',
    c1NoClip: 'Tool arguments arrived complete. No truncation was observed.',
    c1NoArguments: 'No partial tool arguments to inspect.',
    c1ResponsesClipped: 'The response correctly reported a token limit after incomplete tool arguments.',
    c1ResponsesInvalidFinish: 'The response claimed completion with incomplete tool arguments.',
    c4Usage: 'Trailing frame contained positive token counts.',
    c4MissingUsage: 'The trailing usage frame was missing.',
    c4InvalidUsage: 'The trailing frame lacked valid positive token counts.',
    c5NoChoice: 'No streamed choice was available to inspect.',
    c5OpeningRole: 'The opening choice did not declare the assistant role.',
    c5ToolIndices: 'Tool call indices were missing, invalid, or conflicting.',
    c5Intact: 'The opening role and tool call indices were intact.',
    c6Intact: 'CJK and emoji arrived with no replacement characters.',
    c6Replacement: 'The stream contained U+FFFD replacement characters.',
    c6MissingSample: 'The stream did not include both Unicode samples.',
    c7Streaming: 'Delta timing passed the late-burst check.',
    c7Buffered: 'Content deltas arrived in a single late burst.',
    c7TooFewDeltas: 'Too few content deltas to measure buffering.',
    c9InvalidFinish: 'The stream reported end_turn with incomplete tool input JSON.',
    c9Clipped: 'The stream correctly reported a token limit for incomplete tool input.',
    c9Complete: 'The stream finished with valid tool input or visible text.',
    c9NoSample: 'No completed message with tool input or text was available to inspect.',
    c10Empty: 'The stream reported STOP with no output.',
    c10InvalidFinish: 'The stream reported STOP with evidence of truncation.',
    c10Buffered: 'The output arrived in a single late burst before STOP.',
    c10Clipped: 'The stream correctly reported a token limit.',
    c10Complete: 'The stream reported STOP after output arrived.',
    c10OtherFinish: 'The finish reason did not provide a completion sample.',
    badContentType: 'Response was not an SSE stream.',
    incompleteStream: 'The stream ended before the probe could verify it.',
    invalidSse: 'The stream contained a malformed SSE payload.',
    responseError: 'The server reported a streaming error.',
    httpError: 'The server returned an HTTP error.',
    timeout: 'The request timed out.',
    networkError: 'The request failed. Check the endpoint and access.',
    responseTooLarge: 'The response exceeded the local safety limit.',
    radarTabs: 'Relay Radar views',
    checkTab: 'Check',
    compareTab: 'PK Compare',
    auditTab: 'Offline Audit',
    endpointA: 'Endpoint A',
    endpointB: 'Endpoint B',
    runCompare: 'Run PK Compare',
    comparing: 'Comparing endpoints…',
    compareDone: 'Comparison complete.',
    winner: 'Winner',
    tie: 'Tie',
    passedProbes: 'Passed probes',
    effectiveTtft: 'Effective TTFT',
    ttftDelta: 'TTFT Δ (B − A)',
    copyPk: 'Copy Redacted PK Card',
    pkCopied: 'Redacted PK card copied.',
    autoAuditProtocol: 'Auto-detect from stream',
    auditSource: 'Raw SSE or .trace.jsonl',
    auditHelp: 'Paste a stream to audit it locally. No network requests are made.',
    usageRequested: 'Usage requested (Chat Completions)',
    clearPaste: 'Clear paste',
    auditVerdict: 'Audit verdict',
    frames: 'Frames',
    auditPass: 'A+ · Pass',
    auditWarn: 'WARN · Review',
    auditBreach: 'F P0 BREACH',
    auditClean: 'No breaches detected.',
    D1: 'The stream claimed completion with malformed or incomplete tool arguments.',
    D2: 'The stream contains a U+FFFD replacement character.',
    D3: 'Multiple tool calls used the same index.',
    D4: 'The requested usage frame was missing.',
    auditC9: 'Anthropic reported end_turn with malformed or incomplete tool input.',
    auditC10: 'Gemini reported STOP with empty or malformed output or conflicting finish reasons.',
    unrecognized: 'No supported stream frames were recognized.',
    malformed: 'Some pasted frames could not be parsed.',
    incomplete: 'The paste lacks a terminal frame for this protocol.',
  },
  zh: {
    languages: '语言',
    targetFields: 'API 端点设置',
    presets: '服务商预设',
    protocol: 'API 协议',
    autoProtocol: '根据地址自动识别',
    baseUrl: '基础地址',
    model: '模型',
    apiKey: 'API 密钥',
    keyPlaceholder: '如需鉴权请填写',
    run: '一键验真',
    checking: '验真中…',
    progress: '探测进度',
    wireHealth: '协议健康评分',
    C1: '截断状态真实性',
    C4: '用量统计',
    C5: '角色与工具调用索引',
    C6: 'UTF-8 完整性',
    C7: '流式缓冲检测',
    C9: '工具输入截断',
    C10: '结束状态与流式完整性',
    pending: '待测',
    running: '检测中',
    pass: '通过',
    fail: '失败',
    inconclusive: '证据不足',
    copyMarkdown: '复制论坛评测',
    copyIssue: '复制脱敏 Issue 报告',
    exportJson: '导出 JSON',
    cloud: '升级 24/7 中转站监控',
    cloudDisabled: '请在 src/config.js 中设置有效的 inferdiff Cloud 地址。',
    invalidBaseUrl: '请输入 HTTPS 基础地址，或使用 localhost、127.0.0.1 的 HTTP 地址。请移除凭据、查询参数和片段。',
    invalidModel: '请输入模型 ID。',
    invalidApiKey: '请输入单行 API 密钥。',
    keyCleared: '端点已变更。如需鉴权，请输入新端点的 API 密钥。',
    permission: '请确认浏览器允许访问此主机。',
    denied: '主机访问权限未获批准。再次运行可重新申请。',
    permissionError: '无法申请主机访问权限。请从浏览器工具栏打开 Relay Radar 后重试。',
    checkError: '检测未完成。请检查设置后重试。',
    complete: '检测完成。',
    copied: '已复制 Markdown。',
    issueCopied: '已复制脱敏 Issue 报告。',
    copyError: '剪贴板不可用。',
    exportError: '无法导出报告。',
    mismatch: '返回的模型 ID 与请求不同。返回模型',
    c1Clipped: '工具参数被截断，结束原因为 length。',
    c1InvalidFinish: '工具参数被截断时，所有结束原因均应为 length。',
    c1NoClip: '工具参数完整，本次未观察到截断。',
    c1NoArguments: '未收到可检查的截断工具参数。',
    c1ResponsesClipped: '工具参数未完成，响应正确报告了 token 上限。',
    c1ResponsesInvalidFinish: '工具参数未完成，响应却报告已完成。',
    c4Usage: '尾部用量帧中包含正数 token 计数。',
    c4MissingUsage: '缺少尾部用量帧。',
    c4InvalidUsage: '尾部帧缺少有效的正数 token 计数。',
    c5NoChoice: '未收到可检查的流式选项。',
    c5OpeningRole: '首个选项未声明 assistant 角色。',
    c5ToolIndices: '工具调用索引缺失、无效或冲突。',
    c5Intact: '首个角色与工具调用索引均有效。',
    c6Intact: '中日韩字符与表情均完整，无替换字符。',
    c6Replacement: '流中出现 U+FFFD 替换字符。',
    c6MissingSample: '流中未同时出现两种 Unicode 样本。',
    c7Streaming: '内容增量的到达时序通过集中缓冲检测。',
    c7Buffered: '内容增量在接近结束时集中到达。',
    c7TooFewDeltas: '内容增量过少，无法评估缓冲。',
    c9InvalidFinish: '工具输入 JSON 不完整，流却报告了 end_turn。',
    c9Clipped: '工具输入不完整，流正确报告了 token 上限。',
    c9Complete: '流正常结束，工具输入有效或包含可见文本。',
    c9NoSample: '未收到包含工具输入或文本的完整消息。',
    c10Empty: '流报告了 STOP，但没有输出。',
    c10InvalidFinish: '流报告了 STOP，但输出存在截断迹象。',
    c10Buffered: '流报告 STOP 前，输出在接近结束时集中到达。',
    c10Clipped: '流正确报告了 token 上限。',
    c10Complete: '流在输出到达后报告了 STOP。',
    c10OtherFinish: '当前结束原因无法用于验证正常完成。',
    badContentType: '响应不是 SSE 流。',
    incompleteStream: '流在验证完成前中断。',
    invalidSse: '流中包含格式无效的 SSE 数据。',
    responseError: '服务端报告了流式响应错误。',
    httpError: '服务端返回了 HTTP 错误。',
    timeout: '请求超时。',
    networkError: '请求失败，请检查端点与访问权限。',
    responseTooLarge: '响应大小超过本地上限。',
    radarTabs: 'Relay Radar 功能',
    checkTab: '验真',
    compareTab: '中转站 PK',
    auditTab: '离线审计',
    endpointA: '端点 A',
    endpointB: '端点 B',
    runCompare: '开始 PK 对比',
    comparing: '正在对比端点…',
    compareDone: '对比完成。',
    winner: '胜方',
    tie: '平局',
    passedProbes: '通过探针',
    effectiveTtft: '有效 TTFT',
    ttftDelta: 'TTFT 差值（B − A）',
    copyPk: '复制脱敏 PK 卡片',
    pkCopied: '已复制脱敏 PK 卡片。',
    autoAuditProtocol: '根据流内容自动识别',
    auditSource: '原始 SSE 或 .trace.jsonl',
    auditHelp: '粘贴流数据即可在本地审计，过程无需联网。',
    usageRequested: '已请求用量统计（Chat Completions）',
    clearPaste: '清空',
    auditVerdict: '审计结果',
    frames: '帧数',
    auditPass: 'A+ · 通过',
    auditWarn: 'WARN · 需检查',
    auditBreach: 'F P0 BREACH · 严重异常',
    auditClean: '未检测到异常。',
    D1: '工具参数格式错误或不完整，但流报告已完成。',
    D2: '流中出现 U+FFFD 替换字符。',
    D3: '多个工具调用使用了相同索引。',
    D4: '缺少已请求的用量帧。',
    auditC9: '工具输入格式错误或不完整，但 Anthropic 报告了 end_turn。',
    auditC10: 'Gemini 报告 STOP，但输出为空、格式错误或结束状态冲突。',
    unrecognized: '未识别到受支持的流数据帧。',
    malformed: '部分粘贴的帧无法解析。',
    incomplete: '粘贴内容缺少该协议的结束帧。',
  },
};

const get = id => document.getElementById(id);
const form = get('check-form');
const targetFields = get('target-fields');
const protocolSelect = get('protocol');
const baseUrlInput = get('base-url');
const modelInput = get('model');
const keyInput = get('api-key');
const runButton = get('run-check');
const progressBar = get('progress');
const feedback = get('feedback');
const exportFeedback = get('export-feedback');
const copyButton = get('copy-markdown');
const issueButton = get('copy-issue');
const jsonButton = get('export-json');
const cloud = get('cloud-link');
const presets = [...document.querySelectorAll('[data-preset]')];
const cards = [...document.querySelectorAll('[data-probe]')];
const tabs = [...document.querySelectorAll('[role="tab"]')];
const compareFields = get('compare-fields');
const compareFeedback = get('compare-feedback');
const pkFeedback = get('pk-feedback');
const auditSource = get('audit-source');
const auditProtocol = get('audit-protocol');
const auditUsage = get('audit-usage');
const auditFeedback = get('audit-feedback');
const platform = globalThis.chrome;
const local = platform?.storage?.local;
const languageName = 'radarLanguage';

let language = 'en';
let languageChanged = false;
let running = false;
let report = null;
const probeProgress = new Map();
let compareRunning = false;
let comparison = null;
let audit = null;
const endpoints = ['A', 'B'].map(side => {
  const suffix = side.toLowerCase();
  const card = get('compare-card-template').content.firstElementChild.cloneNode(true);
  get('compare-cards').append(card);
  return {
    side, card, progress: null,
    url: get(`pk-url-${suffix}`), model: get(`pk-model-${suffix}`),
    key: get(`pk-key-${suffix}`), protocol: get(`pk-protocol-${suffix}`),
  };
});

for (const select of [auditProtocol, ...endpoints.map(endpoint => endpoint.protocol)]) {
  select.replaceChildren(...Array.from(protocolSelect.options, option => option.cloneNode(true)));
}
auditProtocol.options[0].dataset.copy = 'autoAuditProtocol';

function message(name) {
  return copy[language][name] ?? '';
}

function setFeedback(element, name, kind = 'info') {
  element.dataset.message = name ?? '';
  element.dataset.kind = kind;
  element.textContent = name ? message(name) : '';
  element.hidden = !name;
}

function selectedProtocol() {
  return protocolSelect.value === 'auto' ? detectProtocol(baseUrlInput.value) : protocolSelect.value;
}

function updatePreset() {
  const base = baseUrlInput.value.trim().replace(/\/+$/, '');
  for (const button of presets) {
    button.setAttribute('aria-pressed', String(base === destinationUrl(PROVIDERS[button.dataset.preset])));
  }
}

function handleTargetChange() {
  baseUrlInput.removeAttribute('aria-invalid');
  modelInput.removeAttribute('aria-invalid');
  updatePreset();
  clearReport();
  if (keyInput.value) {
    keyInput.value = '';
    setFeedback(feedback, 'keyCleared');
  }
}

function usePreset(name) {
  const preset = PROVIDERS[name];
  protocolSelect.value = 'auto';
  baseUrlInput.value = destinationUrl(preset);
  modelInput.value = preset.model;
  updatePreset();
}

function formatMs(value) {
  return Number.isFinite(value) ? Math.round(value) + ' ms' : '—';
}

function hostAccess(endpoints) {
  const origins = new Set(endpoints.map(endpoint => {
    const { protocol, hostname } = new URL(endpoint);
    // Match patterns with an omitted port cover every port on this host.
    return `${protocol}//${hostname}/*`;
  }));
  return platform.permissions.request({ origins: [...origins] });
}

function renderGrade(element, grade) {
  element.textContent = grade ?? '—';
  element.dataset.tone = grade?.startsWith('A') ? 'healthy' : grade === 'F' ? 'failed' : 'mixed';
  if (!grade) delete element.dataset.tone;
}

function renderProgress(completed = 0, total = getProbeIds(selectedProtocol()).length) {
  progressBar.value = completed;
  progressBar.max = total;
  get('progress-count').value = completed + ' / ' + total;
}

function renderCards() {
  const activeIds = getProbeIds(report?.protocol ?? selectedProtocol());
  for (const card of cards) {
    card.hidden = !activeIds.includes(card.dataset.probe);
    if (card.hidden) continue;
    const progress = probeProgress.get(card.dataset.probe);
    const status = progress?.status ?? 'pending';
    const result = progress?.result;
    card.dataset.status = status;
    card.querySelector('.probe-status').textContent = message(status);
    const elapsed = result?.ttftMs ?? result?.durationMs;
    card.querySelector('.latency').textContent = Number.isFinite(elapsed) ? formatMs(elapsed) : '';
    const finding = card.querySelector('.finding');
    const localized = message(result?.findingCode);
    const detail = result?.findingCode === 'httpError' && Number.isInteger(result.httpStatus)
      ? ' (' + result.httpStatus + ')'
      : '';
    finding.textContent = localized ? localized + detail : (result?.findings ?? []).join(' ');
    finding.hidden = !finding.textContent;
  }
}

function renderSummary() {
  renderGrade(get('grade'), report?.grade);
  get('p0').textContent = report?.p0 ?? '—';
  get('p1').textContent = report?.p1 ?? '—';
  get('ttft').textContent = formatMs(report?.ttftMs);
  const mismatch = get('model-mismatch');
  mismatch.hidden = !report?.modelMismatch;
  mismatch.textContent = report?.modelMismatch
    ? message('mismatch') + ' · ' + report.reportedModels.join(', ')
    : '';
  copyButton.disabled = !report;
  issueButton.disabled = !report;
  jsonButton.disabled = !report;
}

function renderLanguage() {
  document.documentElement.lang = language === 'zh' ? 'zh-Hans' : 'en';
  for (const element of document.querySelectorAll('[data-copy]')) {
    element.textContent = message(element.dataset.copy);
  }
  for (const element of document.querySelectorAll('[data-aria]')) {
    element.setAttribute('aria-label', message(element.dataset.aria));
  }
  for (const key of [keyInput, ...endpoints.map(endpoint => endpoint.key)]) {
    key.placeholder = message('keyPlaceholder');
  }
  get('lang-en').setAttribute('aria-pressed', String(language === 'en'));
  get('lang-zh').setAttribute('aria-pressed', String(language === 'zh'));
  get('run-label').textContent = message(running ? 'checking' : 'run');
  if (cloud.getAttribute('aria-disabled') === 'true') {
    cloud.title = message('cloudDisabled');
  }
  for (const status of [feedback, exportFeedback, compareFeedback, pkFeedback, auditFeedback]) {
    setFeedback(status, status.dataset.message, status.dataset.kind);
  }
  renderSummary();
  renderCards();
  renderCompare();
  renderAudit();
}

function setLanguage(value) {
  language = value;
  languageChanged = true;
  renderLanguage();
  local?.set({ [languageName]: value }).catch(() => {});
}

function setRunning(value) {
  running = value;
  targetFields.disabled = value;
  runButton.disabled = value;
  get('run-label').textContent = message(value ? 'checking' : 'run');
}

function onProgress({ completed, total, probeId, status, result }) {
  probeProgress.set(probeId, { status, result });
  renderProgress(completed, total);
  renderCards();
}

function clearReport() {
  report = null;
  probeProgress.clear();
  renderProgress();
  renderSummary();
  renderCards();
  setFeedback(exportFeedback, null);
}

async function checkEndpoint(event) {
  event.preventDefault();
  if (running) return;
  setFeedback(feedback, null);
  const apiKey = keyInput.value.trim();
  keyInput.value = '';
  const protocol = selectedProtocol();
  const model = modelInput.value.trim();
  if ((!model && protocol !== 'gemini') || containsCredential(model)
    || (apiKey && (model === apiKey || containsSuppliedCredential(model, apiKey)))) {
    setFeedback(feedback, 'invalidModel', 'error');
    modelInput.setAttribute('aria-invalid', 'true');
    modelInput.focus();
    return;
  }
  if (/[\r\n]/u.test(apiKey)) {
    setFeedback(feedback, 'invalidApiKey', 'error');
    keyInput.focus();
    return;
  }
  let endpoint;
  try {
    endpoint = normalizeTarget(baseUrlInput.value, protocol, model);
    if (containsSuppliedCredential(endpoint, apiKey)) throw new Error('Credential in endpoint');
  } catch {
    const input = model ? baseUrlInput : modelInput;
    setFeedback(feedback, model ? 'invalidBaseUrl' : 'invalidModel', 'error');
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return;
  }

  clearReport();
  setFeedback(feedback, 'permission');
  setRunning(true);

  try {
    let allowed;
    try {
      allowed = await hostAccess([endpoint]);
    } catch {
      setFeedback(feedback, 'permissionError', 'error');
      return;
    }
    if (!allowed) {
      setFeedback(feedback, 'denied', 'error');
      return;
    }
    setFeedback(feedback, null);
    report = await runChecks({ baseUrl: endpoint, protocol, model, apiKey, onProgress });
    for (const result of report.probes) {
      probeProgress.set(result.id, { status: result.status, result });
    }
    renderProgress(report.probes.length);
    renderSummary();
    renderCards();
    setFeedback(feedback, 'complete', 'success');
  } catch {
    setFeedback(feedback, 'checkError', 'error');
  } finally {
    setRunning(false);
  }
}

function selectTab(selected) {
  for (const tab of tabs) {
    const active = tab === selected;
    tab.tabIndex = active ? 0 : -1;
    tab.setAttribute('aria-selected', String(active));
    get(tab.getAttribute('aria-controls')).hidden = !active;
  }
}

function renderCompare() {
  const button = get('run-compare');
  button.disabled = compareRunning;
  button.textContent = message(compareRunning ? 'comparing' : 'runCompare');
  compareFields.disabled = compareRunning;
  get('copy-pk').disabled = !comparison;
  get('compare-scoreboard').hidden = !compareRunning && !comparison;
  get('compare-summary').hidden = !comparison;

  const winner = get('compare-winner');
  winner.textContent = comparison?.winner === 'Tie' ? message('tie') : comparison?.winner ?? '—';
  winner.dataset.tone = comparison?.winner === 'Tie' ? 'mixed' : 'healthy';
  const delta = comparison?.ttftDeltaMs;
  get('compare-delta').textContent = (delta > 0 ? '+' : '') + formatMs(delta);

  for (const { side, card, progress } of endpoints) {
    const outcome = comparison?.[side.toLowerCase()];
    const label = message(`endpoint${side}`);
    card.querySelector('.endpoint-label').textContent = label;
    card.classList.toggle('winner-card', comparison?.winner === side);
    renderGrade(card.querySelector('.grade'), outcome?.grade);
    const bar = card.querySelector('progress');
    bar.max = progress?.total || 1;
    bar.value = progress?.completed ?? 0;
    bar.setAttribute('aria-label', `${label} · ${message('progress')}`);
    card.querySelector('.progress-row').hidden = !compareRunning;
    card.querySelector('.probe-count').textContent = `${bar.value} / ${progress?.total ?? 0}`;
    card.querySelector('.passed').textContent = outcome ? `${outcome.passed} / ${outcome.probeCount}` : '—';
    card.querySelector('.ttft').textContent = formatMs(outcome?.ttftMs);
    card.querySelector('.p0').textContent = outcome?.p0 ?? '—';
    card.querySelector('.p1').textContent = outcome?.p1 ?? '—';
  }
}

function clearComparison() {
  comparison = null;
  setFeedback(compareFeedback, null);
  setFeedback(pkFeedback, null);
  renderCompare();
}

async function compareEndpoints(event) {
  event.preventDefault();
  if (compareRunning) return;
  clearComparison();
  const inputs = endpoints.map(({ url, model, key, protocol }) => {
    const target = { baseUrl: url.value, model: model.value, apiKey: key.value, protocol: protocol.value };
    key.value = '';
    return target;
  });

  let targets;
  try {
    targets = prepareCompareTargets(...inputs);
  } catch (error) {
    const field = { invalidBaseUrl: 'url', invalidModel: 'model', invalidApiKey: 'key' }[error?.code];
    const endpoint = endpoints.find(({ side }) => side === error?.side);
    setFeedback(compareFeedback, field ? error.code : 'checkError', 'error');
    if (field && endpoint) {
      endpoint[field].setAttribute('aria-invalid', 'true');
      endpoint[field].focus();
    }
    return;
  }

  compareRunning = true;
  endpoints.forEach((endpoint, index) => {
    endpoint.progress = { completed: 0, total: getProbeIds(targets[index].protocol).length };
  });
  renderCompare();
  setFeedback(compareFeedback, 'permission');
  try {
    let allowed;
    try {
      allowed = await hostAccess(targets.map(target => target.baseUrl));
    } catch {
      setFeedback(compareFeedback, 'permissionError', 'error');
      return;
    }
    if (!allowed) {
      setFeedback(compareFeedback, 'denied', 'error');
      return;
    }

    setFeedback(compareFeedback, null);
    comparison = await runComparison(...targets, {
      onProgress(side, progress) {
        endpoints.find(endpoint => endpoint.side === side).progress = progress;
        renderCompare();
      },
    });
    setFeedback(compareFeedback, 'compareDone', 'success');
  } catch {
    setFeedback(compareFeedback, 'checkError', 'error');
  } finally {
    compareRunning = false;
    renderCompare();
  }
}

function renderAudit() {
  get('clear-audit').disabled = !auditSource.value;
  get('audit-results').hidden = !audit;
  get('copy-audit').disabled = !audit;
  if (!audit) return;

  const pass = audit.verdict === 'A+';
  const warn = audit.verdict === 'WARN';
  const verdict = get('audit-verdict');
  verdict.textContent = message(pass ? 'auditPass' : warn ? 'auditWarn' : 'auditBreach');
  verdict.dataset.tone = pass ? 'healthy' : warn ? 'mixed' : 'failed';
  get('audit-frames').textContent = audit.frameCount;

  const findings = get('audit-findings');
  findings.replaceChildren();
  if (audit.findings.length === 0) {
    const item = document.createElement('li');
    item.textContent = message('auditClean');
    findings.append(item);
  }
  for (const { code, severity } of audit.findings) {
    const item = document.createElement('li');
    const badge = document.createElement('span');
    const description = document.createElement('span');
    const finding = { C9: 'auditC9', C10: 'auditC10' }[code] ?? code;
    badge.className = 'audit-code';
    badge.dataset.severity = severity;
    badge.textContent = severity === 'WARN' ? 'WARN' : `${code} · ${severity}`;
    description.textContent = message(finding);
    item.append(badge, description);
    findings.append(item);
  }
}

function auditPaste() {
  const protocol = auditProtocol.value;
  auditUsage.disabled = protocol !== 'auto' && protocol !== 'openai-chat';
  audit = auditSource.value.trim() ? auditOffline(auditSource.value, {
    protocol, includeUsage: auditUsage.checked && !auditUsage.disabled,
  }) : null;
  setFeedback(auditFeedback, null);
  renderAudit();
}

async function copyReport(value, format, status, successMessage) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(format(value));
    setFeedback(status, successMessage, 'success');
  } catch {
    setFeedback(status, 'copyError', 'error');
  }
}

function downloadReport() {
  if (!report) return;
  try {
    const file = new Blob([formatJSON(report)], { type: 'application/json' });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'inferdiff-relay-radar.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    setFeedback(exportFeedback, 'exportError', 'error');
  }
}

get('lang-en').addEventListener('click', () => setLanguage('en'));
get('lang-zh').addEventListener('click', () => setLanguage('zh'));
for (const button of presets) {
  button.addEventListener('click', () => {
    usePreset(button.dataset.preset);
    handleTargetChange();
  });
}
baseUrlInput.addEventListener('input', handleTargetChange);
protocolSelect.addEventListener('change', handleTargetChange);
modelInput.addEventListener('input', () => {
  modelInput.removeAttribute('aria-invalid');
  clearReport();
});
form.addEventListener('submit', checkEndpoint);
copyButton.addEventListener('click', () => copyReport(report,
  value => formatMarkdown(value, { includeTarget: false }), exportFeedback, 'copied'));
issueButton.addEventListener('click', () => copyReport(report,
  value => formatIssueMarkdown(value, { includeHost: false }), exportFeedback, 'issueCopied'));
jsonButton.addEventListener('click', downloadReport);

for (const [index, tab] of tabs.entries()) {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', event => {
    const target = {
      ArrowLeft: tabs[(index + tabs.length - 1) % tabs.length],
      ArrowRight: tabs[(index + 1) % tabs.length], Home: tabs[0], End: tabs.at(-1),
    }[event.key];
    if (!target) return;
    event.preventDefault();
    selectTab(target);
    target.focus();
  });
}

for (const { url, model, key, protocol } of endpoints) {
  for (const field of [url, model, key, protocol]) {
    field.addEventListener('input', () => {
      for (const input of [url, model, key]) input.removeAttribute('aria-invalid');
      clearComparison();
      if ((field === url || field === protocol) && key.value) {
        key.value = '';
        setFeedback(compareFeedback, 'keyCleared');
      }
    });
  }
}
get('compare-form').addEventListener('submit', compareEndpoints);
get('copy-pk').addEventListener('click', () => copyReport(comparison, formatPkMarkdown, pkFeedback, 'pkCopied'));

auditSource.addEventListener('input', auditPaste);
auditProtocol.addEventListener('change', auditPaste);
auditUsage.addEventListener('change', auditPaste);
get('clear-audit').addEventListener('click', () => {
  auditSource.value = '';
  auditPaste();
  auditSource.focus();
});
get('copy-audit').addEventListener('click', () => copyReport(audit, formatOfflineIssueMarkdown, auditFeedback, 'issueCopied'));

try {
  cloud.href = destinationUrl(CLOUD_DESTINATION);
} catch {
  cloud.setAttribute('aria-disabled', 'true');
}

// Remove a legacy credential record without reading it into this popup.
platform?.storage?.session?.remove('radarRememberedTarget').catch(() => {});
usePreset('openai');
renderProgress();
renderLanguage();
local?.get(languageName).then(saved => {
  if (!languageChanged && saved[languageName] === 'zh') {
    language = 'zh';
    renderLanguage();
  }
}).catch(() => {});
