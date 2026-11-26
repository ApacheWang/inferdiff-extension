export const PROVIDERS = Object.freeze({
  openai: { protocol: 'https:', host: 'api.openai.com', pathname: '/v1', model: 'gpt-4o-mini' },
  deepseek: { protocol: 'https:', host: 'api.deepseek.com', pathname: '/v1', model: 'deepseek-flash' },
  openrouter: { protocol: 'https:', host: 'openrouter.ai', pathname: '/api/v1', model: 'openai/gpt-4o-mini' },
  siliconflow: { protocol: 'https:', host: 'api.siliconflow.cn', pathname: '/v1', model: 'deepseek-ai/DeepSeek-V4-Flash' },
  ollama: { protocol: 'http:', host: 'localhost:11434', pathname: '/v1', model: 'qwen3:4b' },
  llama: { protocol: 'http:', host: '127.0.0.1:8080', pathname: '/v1', model: 'Qwen3-0.6B-Q8_0.gguf' },
});

// Defaults to the documented local inferdiff Cloud deployment. Set your HTTPS
// deployment's protocol, host, and path to send users to a hosted Watchdog.
export const CLOUD_DESTINATION = Object.freeze({
  protocol: 'http:',
  host: '127.0.0.1:8765',
  pathname: '/',
});

export function destinationUrl({ protocol, host, pathname }) {
  const url = new URL(protocol + '//' + host);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new TypeError('Use a hostname and optional port in host.');
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new TypeError('Use HTTPS or loopback HTTP.');
  }
  url.pathname = pathname;
  return url.href;
}
