# inferdiff Relay Radar

[English](#english) · [中文](#中文)

## English

Verify an OpenAI-compatible API or relay from your browser toolbar. Relay Radar runs four streaming probes, grades what arrived over the wire, and exports a forum-ready Markdown scorecard or JSON report. The Manifest V3 extension loads directly from source with no build or external runtime assets.

### Load unpacked

1. Open your browser’s extension manager.

   | Browser | Where to open it |
   | --- | --- |
   | Chrome | `chrome://extensions` |
   | Edge | `edge://extensions` |
   | Arc | Open the Command Bar with ⌘T or Ctrl+T, then choose **Manage Extensions** |
   | Brave | `brave://extensions` |

2. Turn on **Developer mode**, choose **Load unpacked**, and select the cloned repository folder containing `manifest.json`.
3. Open **inferdiff Relay Radar** from the browser’s extensions menu. Pin it for toolbar access if you prefer.
4. After edits, select **Reload** on the extension’s card and reopen the popup.

[Chrome installation](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world) · [Edge sideloading](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading) · [Arc Command Bar](https://start.arc.net/command-bar-actions) · [Brave extensions](https://support.brave.app/hc/en-us/articles/360017909112-How-can-I-add-extensions-to-Brave)

Arc’s publisher says the browser will shut down on December 22, 2026. [Arc Help Center](https://resources.arc.net/hc/en-us/articles/19335714372759-Troubleshoot-or-Report-a-Problem-in-Arc)

### Run a check

1. Choose a provider preset or enter your own Base URL and model. Use a base such as `https://your-relay.example/v1`. The probe posts to its `/chat/completions` endpoint. HTTPS and loopback HTTP via `localhost` or `127.0.0.1` are supported.
2. Enter an API key if the endpoint requires one. Select **Run Check** and approve access to the API host when the browser prompts you. Keep the popup open until the probes finish.
3. Review the grade, findings, and TTFT (time to first token). Select **Copy Markdown** or export JSON to share the report.

The Ollama and llama-server presets include example model IDs. Replace the example with the model ID your local server serves.

| Probe | What it checks |
| --- | --- |
| C1 · Truncation honesty | Partial tool-call JSON from a tight token budget should end with `finish_reason: "length"`. |
| C4 · Usage accounting | `stream_options.include_usage` should produce a trailing usage frame with non-zero token counts. |
| C6 · UTF-8 integrity | The CJK and emoji check looks for replacement characters in streamed content. |
| C7 · Buffering | A burst is flagged when the first content delta arrives after 95% of the run and multiple deltas arrive within a span under 15 ms. |

Four passes with a matching model earn **A+**. Confirmed failures count by severity (P0 or P1), and inconclusive checks are reported separately. A reported model ID that differs from the requested one is highlighted. Providers may return aliases. Buffering reflects timing observed by the browser and can depend on the network.

### Privacy and Cloud configuration

The API key lives in popup memory by default. The optional session toggle keeps it in memory across popup openings using `chrome.storage.session`, which clears on browser restart or extension reload. The extension sends the key only in the authorization header to your selected endpoint and blocks HTTP redirects. Markdown and JSON reports redact the key.

The **Watch 24/7 in inferdiff Cloud** link opens the Cloud instance configured in [`src/config.js`](src/config.js). Its default is `http://127.0.0.1:8765/` for a local Cloud deployment. For a hosted instance, set the `CLOUD_DESTINATION` protocol to `https:`, update its host and pathname, and reload the extension. Clicking the link opens Cloud independently of the check.

### Verify locally

With Python 3.12 and Node.js 22.7+ on your PATH, run:

```sh
python verify.py
```

The verifier checks the MV3 manifest, icon integrity, local assets, and JS syntax, then runs `node --test tests/test_extension.mjs` against two localhost mock API servers. No credentials or external network access are needed.

## 中文

从浏览器工具栏检测兼容 OpenAI 的 API 或中转站。Relay Radar 运行四项流式探针，根据浏览器收到的响应评分，并支持导出适合论坛分享的 Markdown 或 JSON 报告。扩展使用 Manifest V3，直接加载源文件即可，无需构建或加载外部资源。

### 加载未打包的扩展

1. 打开浏览器的扩展管理页面。

   | 浏览器 | 打开方式 |
   | --- | --- |
   | Chrome | `chrome://extensions` |
   | Edge | `edge://extensions` |
   | Arc | 按 ⌘T 或 Ctrl+T 打开命令栏，选择 **Manage Extensions** |
   | Brave | `brave://extensions` |

2. 开启 **开发者模式**，点击 **加载已解压的扩展程序（Load unpacked）**，选择包含 `manifest.json` 的仓库目录。
3. 从扩展菜单打开 **inferdiff Relay Radar**，也可以固定到工具栏。
4. 修改文件后，在扩展卡片上点击 **重新加载**，再打开弹窗。

Arc 官方公告称浏览器将于 2026 年 12 月 22 日停止服务。[Arc 帮助中心](https://resources.arc.net/hc/en-us/articles/19335714372759-Troubleshoot-or-Report-a-Problem-in-Arc)

### 一键验真

1. 选择供应商预设，或手动填写 API 基础地址和模型。基础地址示例为 `https://your-relay.example/v1`，探针会向对应的 `/chat/completions` 端点发起请求。支持 HTTPS，以及 `localhost` 或 `127.0.0.1` 上的 HTTP。
2. 按需填写 API 密钥，点击 **一键验真**。浏览器提示授权时，允许扩展访问该 API 主机。检测期间保持弹窗打开。
3. 查看评级、检测结果与首个 token 的耗时（TTFT）。可点击 **复制论坛评测**，也可导出 JSON。

Ollama 和 llama-server 预设中的模型 ID 为示例。请填写本地服务器实际提供的模型 ID。

| 探针 | 检测内容 |
| --- | --- |
| C1 · 截断诚实性 | token 预算耗尽后，未完成的工具调用 JSON 应标记为 `finish_reason: "length"`。 |
| C4 · 用量统计 | 启用 `stream_options.include_usage` 后，流末尾应包含 token 计数大于零的用量帧。 |
| C6 · UTF-8 完整性 | 检查中日韩字符与四字节表情符号的流式输出是否含有替换字符。 |
| C7 · 流式缓冲 | 若首个内容增量在超过总耗时 95% 后到达，且多个内容增量在不足 15 毫秒内集中到达，则标记缓冲现象。 |

四项全部通过且模型一致时评级为 **A+**。确认的异常按 P0、P1 统计，无法判定的探针单独显示。服务返回的模型 ID 与请求不一致时会提示，模型别名也可能触发提示。缓冲检测基于浏览器观察到的时间，可能受网络影响。

### 隐私与 Cloud 配置

API 密钥默认只保存在弹窗内存中。开启会话记忆后，密钥会通过 `chrome.storage.session` 保存在浏览器内存中，浏览器重启或扩展重新加载后会清除。扩展只向选定的端点发送含密钥的授权请求头，并阻止 HTTP 重定向。Markdown 和 JSON 报告都会脱敏。

**升级 24/7 中转站监控**链接打开 [`src/config.js`](src/config.js) 中配置的 inferdiff Cloud 实例，默认地址为本地部署的 `http://127.0.0.1:8765/`。若使用托管实例，将 `CLOUD_DESTINATION` 的 protocol 改为 `https:`，更新 host 和 pathname，再重新加载扩展。打开 Cloud 的操作与检测请求相互独立。

### 本地验证

将 Python 3.12 和 Node.js 22.7 或更新版本加入 PATH，然后运行 `python verify.py`。脚本验证 MV3 清单、图标、本地资源和 JS 语法，再通过 `node --test tests/test_extension.mjs` 对两个本地模拟服务器运行测试。验证无需密钥，也无需访问外网。
