import { CLOUD_DESTINATION, PROVIDERS, destinationUrl } from './src/config.js';
import { formatJSON, formatMarkdown, normalizeTarget, runChecks } from './src/probes.js';

const copy = {
  en: {
    languages: 'Language',
    targetFields: 'API endpoint settings',
    presets: 'Provider presets',
    baseUrl: 'Base URL',
    model: 'Model',
    apiKey: 'API key',
    keyPlaceholder: 'If required',
    rememberKey: 'Remember key for this browser session',
    run: 'Run Check',
    checking: 'Checking…',
    progress: 'Probe progress',
    wireHealth: 'Wire health',
    C1: 'Truncation honesty',
    C4: 'Usage accounting',
    C6: 'UTF-8 integrity',
    C7: 'Stream buffering',
    pending: 'Ready',
    running: 'Running',
    pass: 'Pass',
    fail: 'Fail',
    inconclusive: 'Inconclusive',
    copyMarkdown: 'Copy Markdown',
    exportJson: 'Export JSON',
    cloud: 'Watch 24/7 in inferdiff Cloud',
    cloudDisabled: 'Set a valid inferdiff Cloud destination in src/config.js.',
    invalidBaseUrl: 'Enter an HTTPS base URL or HTTP on localhost or 127.0.0.1. Remove credentials, query strings, and fragments.',
    invalidModel: 'Enter a model ID.',
    invalidApiKey: 'Use a single-line API key.',
    keyCleared: 'The endpoint changed. Enter its API key if required.',
    sessionError: 'Browser session storage is unavailable.',
    permission: 'Confirm browser access to this host.',
    denied: 'Host access was declined. Run the check again to request it.',
    permissionError: 'Could not request host access. Open Relay Radar from the browser toolbar and try again.',
    checkError: 'Could not finish the check. Verify the settings and try again.',
    complete: 'Check complete.',
    copied: 'Markdown copied.',
    copyError: 'Clipboard access is unavailable. You can export the JSON report.',
    exportError: 'Could not export the report.',
    mismatch: 'Model ID differs from the request. Reported',
    c1Clipped: 'Partial tool arguments ended with length.',
    c1InvalidFinish: 'Partial tool arguments require length for every finish reason.',
    c1NoClip: 'Tool arguments arrived complete. No truncation was observed.',
    c1NoArguments: 'No partial tool arguments to inspect.',
    c4Usage: 'Trailing frame contained positive token counts.',
    c4MissingUsage: 'The trailing usage frame was missing.',
    c4InvalidUsage: 'The trailing frame lacked valid positive token counts.',
    c6Intact: 'CJK and emoji arrived with no replacement characters.',
    c6Replacement: 'The stream contained U+FFFD replacement characters.',
    c6MissingSample: 'The stream did not include both Unicode samples.',
    c7Streaming: 'Delta timing passed the late-burst check.',
    c7Buffered: 'Content deltas arrived in a single late burst.',
    c7TooFewDeltas: 'Too few content deltas to measure buffering.',
    badContentType: 'Response was not an SSE stream.',
    incompleteStream: 'The stream ended before the probe could verify it.',
    invalidSse: 'The stream contained a malformed SSE payload.',
    responseError: 'The server reported a streaming error.',
    httpError: 'The server returned an HTTP error.',
    timeout: 'The request timed out.',
    networkError: 'The request failed. Check the endpoint and access.',
    responseTooLarge: 'The response exceeded the local safety limit.',
  },
  zh: {
    languages: '语言',
    targetFields: 'API 端点设置',
    presets: '服务商预设',
    baseUrl: '基础地址',
    model: '模型',
    apiKey: 'API 密钥',
    keyPlaceholder: '如需鉴权请填写',
    rememberKey: '在本次浏览器会话中记住密钥',
    run: '一键验真',
    checking: '验真中…',
    progress: '探测进度',
    wireHealth: '协议健康评分',
    C1: '截断状态真实性',
    C4: '用量统计',
    C6: 'UTF-8 完整性',
    C7: '流式缓冲检测',
    pending: '待测',
    running: '检测中',
    pass: '通过',
    fail: '失败',
    inconclusive: '证据不足',
    copyMarkdown: '复制论坛评测',
    exportJson: '导出 JSON',
    cloud: '升级 24/7 中转站监控',
    cloudDisabled: '请在 src/config.js 中设置有效的 inferdiff Cloud 地址。',
    invalidBaseUrl: '请输入 HTTPS 基础地址，或使用 localhost、127.0.0.1 的 HTTP 地址。请移除凭据、查询参数和片段。',
    invalidModel: '请输入模型 ID。',
    invalidApiKey: '请输入单行 API 密钥。',
    keyCleared: '端点已变更。如需鉴权，请输入新端点的 API 密钥。',
    sessionError: '浏览器会话存储不可用。',
    permission: '请确认浏览器允许访问此主机。',
    denied: '主机访问权限未获批准。再次运行可重新申请。',
    permissionError: '无法申请主机访问权限。请从浏览器工具栏打开 Relay Radar 后重试。',
    checkError: '检测未完成。请检查设置后重试。',
    complete: '检测完成。',
    copied: '已复制 Markdown。',
    copyError: '剪贴板不可用。可导出 JSON 报告。',
    exportError: '无法导出报告。',
    mismatch: '返回的模型 ID 与请求不同。返回模型',
    c1Clipped: '工具参数被截断，结束原因为 length。',
    c1InvalidFinish: '工具参数被截断时，所有结束原因均应为 length。',
    c1NoClip: '工具参数完整，本次未观察到截断。',
    c1NoArguments: '未收到可检查的截断工具参数。',
    c4Usage: '尾部用量帧中包含正数 token 计数。',
    c4MissingUsage: '缺少尾部用量帧。',
    c4InvalidUsage: '尾部帧缺少有效的正数 token 计数。',
    c6Intact: '中日韩字符与表情均完整，无替换字符。',
    c6Replacement: '流中出现 U+FFFD 替换字符。',
    c6MissingSample: '流中未同时出现两种 Unicode 样本。',
    c7Streaming: '内容增量的到达时序通过集中缓冲检测。',
    c7Buffered: '内容增量在接近结束时集中到达。',
    c7TooFewDeltas: '内容增量过少，无法评估缓冲。',
    badContentType: '响应不是 SSE 流。',
    incompleteStream: '流在验证完成前中断。',
    invalidSse: '流中包含格式无效的 SSE 数据。',
    responseError: '服务端报告了流式响应错误。',
    httpError: '服务端返回了 HTTP 错误。',
    timeout: '请求超时。',
    networkError: '请求失败，请检查端点与访问权限。',
    responseTooLarge: '响应大小超过本地上限。',
  },
};

const get = id => document.getElementById(id);
const form = get('check-form');
const targetFields = get('target-fields');
const baseUrlInput = get('base-url');
const modelInput = get('model');
const keyInput = get('api-key');
const rememberKey = get('remember-key');
const runButton = get('run-check');
const progressBar = get('progress');
const feedback = get('feedback');
const exportFeedback = get('export-feedback');
const copyButton = get('copy-markdown');
const jsonButton = get('export-json');
const cloud = get('cloud-link');
const presets = [...document.querySelectorAll('[data-preset]')];
const cards = [...document.querySelectorAll('[data-probe]')];
const platform = globalThis.chrome;
const session = platform?.storage?.session;
const local = platform?.storage?.local;
const sessionName = 'radarRememberedTarget';
const languageName = 'radarLanguage';

let language = 'en';
let languageChanged = false;
let sessionTouched = false;
let keyEndpoint = null;
let running = false;
let report = null;
const probeProgress = new Map();

function message(name) {
  return copy[language][name] ?? '';
}

function setFeedback(element, name, kind = 'info') {
  element.dataset.message = name ?? '';
  element.dataset.kind = kind;
  element.textContent = name ? message(name) : '';
  element.hidden = !name;
}

function currentEndpoint() {
  try {
    return normalizeTarget(baseUrlInput.value);
  } catch {
    return null;
  }
}

function storeSession() {
  const key = keyInput.value.trim();
  const endpoint = currentEndpoint();
  const save = rememberKey.checked && key && endpoint === keyEndpoint;
  const record = save ? {
    endpoint,
    key,
    baseUrl: baseUrlInput.value.trim(),
    model: modelInput.value.trim(),
  } : null;
  const operation = record ? session?.set({ [sessionName]: record }) : session?.remove(sessionName);
  operation?.catch(() => setFeedback(feedback, 'sessionError', 'error'));
}

function updatePreset() {
  const base = baseUrlInput.value.trim().replace(/\/+$/, '');
  for (const button of presets) {
    button.setAttribute('aria-pressed', String(base === destinationUrl(PROVIDERS[button.dataset.preset])));
  }
}

function handleTargetChange() {
  sessionTouched = true;
  baseUrlInput.removeAttribute('aria-invalid');
  modelInput.removeAttribute('aria-invalid');
  updatePreset();
  const endpoint = currentEndpoint();
  if (keyInput.value && keyEndpoint && keyEndpoint !== endpoint) {
    keyInput.value = '';
    keyEndpoint = null;
    rememberKey.checked = false;
    setFeedback(feedback, 'keyCleared');
  }
  if (keyInput.value && !keyEndpoint) {
    keyEndpoint = endpoint;
  }
  storeSession();
}

function usePreset(name) {
  const preset = PROVIDERS[name];
  baseUrlInput.value = destinationUrl(preset);
  modelInput.value = preset.model;
  updatePreset();
}

function formatMs(value) {
  return Number.isFinite(value) ? Math.round(value) + ' ms' : '—';
}

function renderProgress(completed = 0, total = cards.length) {
  progressBar.value = completed;
  progressBar.max = total;
  get('progress-count').value = completed + ' / ' + total;
}

function renderCards() {
  for (const card of cards) {
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
  const grade = get('grade');
  grade.value = report?.grade ?? '—';
  if (report) {
    grade.dataset.tone = report.grade.startsWith('A') ? 'healthy' : report.grade === 'F' ? 'failed' : 'mixed';
  } else {
    delete grade.dataset.tone;
  }
  get('p0').textContent = report?.p0 ?? '—';
  get('p1').textContent = report?.p1 ?? '—';
  get('ttft').textContent = formatMs(report?.ttftMs);
  const mismatch = get('model-mismatch');
  mismatch.hidden = !report?.modelMismatch;
  mismatch.textContent = report?.modelMismatch
    ? message('mismatch') + ' · ' + report.reportedModels.join(', ')
    : '';
  copyButton.disabled = !report;
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
  keyInput.placeholder = message(keyInput.dataset.placeholder);
  get('lang-en').setAttribute('aria-pressed', String(language === 'en'));
  get('lang-zh').setAttribute('aria-pressed', String(language === 'zh'));
  get('run-label').textContent = message(running ? 'checking' : 'run');
  if (cloud.getAttribute('aria-disabled') === 'true') {
    cloud.title = message('cloudDisabled');
  }
  setFeedback(feedback, feedback.dataset.message, feedback.dataset.kind);
  setFeedback(exportFeedback, exportFeedback.dataset.message, exportFeedback.dataset.kind);
  renderSummary();
  renderCards();
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

async function checkEndpoint(event) {
  event.preventDefault();
  if (running) return;
  sessionTouched = true;
  setFeedback(feedback, null);
  const endpoint = currentEndpoint();
  if (!endpoint) {
    setFeedback(feedback, 'invalidBaseUrl', 'error');
    baseUrlInput.setAttribute('aria-invalid', 'true');
    baseUrlInput.focus();
    return;
  }
  const model = modelInput.value.trim();
  if (!model) {
    setFeedback(feedback, 'invalidModel', 'error');
    modelInput.setAttribute('aria-invalid', 'true');
    modelInput.focus();
    return;
  }
  const apiKey = keyInput.value.trim();
  if (apiKey && keyEndpoint && keyEndpoint !== endpoint) {
    handleTargetChange();
    keyInput.focus();
    return;
  }
  if (/[\r\n]/u.test(apiKey)) {
    setFeedback(feedback, 'invalidApiKey', 'error');
    keyInput.focus();
    return;
  }

  report = null;
  probeProgress.clear();
  renderProgress();
  renderSummary();
  renderCards();
  setFeedback(exportFeedback, null);
  setFeedback(feedback, 'permission');
  setRunning(true);

  try {
    const target = new URL(endpoint);
    // Match patterns with an omitted port cover every port on this host.
    const origin = target.origin + '/*';
    let allowed;
    try {
      // Call directly from the submit gesture so the browser can show its prompt.
      allowed = await platform.permissions.request({ origins: [origin] });
    } catch {
      setFeedback(feedback, 'permissionError', 'error');
      return;
    }
    if (!allowed) {
      setFeedback(feedback, 'denied', 'error');
      return;
    }
    setFeedback(feedback, null);
    report = await runChecks({ baseUrl: endpoint, model, apiKey, onProgress });
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

async function copyReport() {
  if (!report) return;
  try {
    await navigator.clipboard.writeText(formatMarkdown(report));
    setFeedback(exportFeedback, 'copied', 'success');
  } catch {
    setFeedback(exportFeedback, 'copyError', 'error');
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
modelInput.addEventListener('input', () => {
  sessionTouched = true;
  modelInput.removeAttribute('aria-invalid');
  if (rememberKey.checked) storeSession();
});
keyInput.addEventListener('input', () => {
  sessionTouched = true;
  keyEndpoint = currentEndpoint();
  if (rememberKey.checked) storeSession();
});
rememberKey.addEventListener('change', () => {
  sessionTouched = true;
  storeSession();
});
form.addEventListener('submit', checkEndpoint);
copyButton.addEventListener('click', copyReport);
jsonButton.addEventListener('click', downloadReport);

try {
  cloud.href = destinationUrl(CLOUD_DESTINATION);
} catch {
  cloud.setAttribute('aria-disabled', 'true');
}

rememberKey.disabled = !session;
usePreset('openai');
renderLanguage();
local?.get(languageName).then(saved => {
  if (!languageChanged && saved[languageName] === 'zh') {
    language = 'zh';
    renderLanguage();
  }
}).catch(() => {});
session?.get(sessionName).then(saved => {
  const record = saved[sessionName];
  if (sessionTouched || !record?.key || normalizeTarget(record.baseUrl) !== record.endpoint) return;
  baseUrlInput.value = record.baseUrl;
  modelInput.value = record.model;
  keyInput.value = record.key;
  keyEndpoint = record.endpoint;
  rememberKey.checked = true;
  updatePreset();
}).catch(() => {});
