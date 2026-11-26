# inferdiff Relay Radar

[![CI](https://github.com/ApacheWang/inferdiff-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/ApacheWang/inferdiff-extension/actions/workflows/ci.yml)

[English](#english) · [中文](#中文)

## English

Check OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, and Gemini streams from your browser toolbar. Relay Radar grades the SSE frames it receives during each check. The Manifest V3 extension loads directly from source with no external runtime assets.

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

1. Choose a preset or enter a Base URL and model, then select the API protocol. **Auto-detect from URL** recognizes full endpoint paths such as `/v1/responses`, `/v1/messages`, and `/v1beta/models/MODEL:streamGenerateContent`. It defaults to Chat Completions for shared bases such as `https://your-relay.example/v1`. HTTPS and loopback HTTP via `localhost` or `127.0.0.1` are supported.
2. Enter an API key if the endpoint requires one. Select **Run Check** and approve access to the API host when the browser prompts you. Keep the popup open until the probes finish.
3. Review the grade, findings, and TTFT (time to first token). Select **Copy Redacted Issue Report** to paste a short summary into GitHub Issues, Linux.do, or V2EX. The detailed Markdown scorecard and JSON report are also available.

The Ollama and llama-server presets include example model IDs. Replace the example with the model ID your local server serves. With a full Gemini endpoint, Relay Radar uses the model in the URL. With a Gemini base URL, enter the model in the Model field.

| Probe | What it checks |
| --- | --- |
| C1 · Truncation honesty | Chat Completions should report `length` for incomplete tool JSON. Responses should report incomplete output when the token limit cuts off tool arguments. |
| C4 · Usage accounting | `stream_options.include_usage` should produce a trailing usage frame with non-zero token counts. |
| C5 · Role and tool indices | Chat Completions should open with the assistant role and include valid tool call indices. |
| C6 · UTF-8 integrity | The CJK and emoji check looks for replacement characters in streamed content. |
| C7 · Buffering | A burst is flagged when the first content delta arrives after 95% of the run and multiple deltas arrive within a span under 15 ms. |
| C9 · Anthropic tool input | `end_turn` is flagged if accumulated tool-input deltas form malformed or truncated JSON. |
| C10 · Gemini finish and cadence | `STOP` is flagged when output is empty, shows evidence of truncation, or arrives in a late burst. |

Passing all checks for the chosen protocol with a matching model earns **A+**. Findings show the severity of confirmed failures (P0 or P1) and flag inconclusive checks. Providers may return model aliases that trigger a mismatch. Buffering reflects timing observed by the browser and can depend on the network.

### Privacy and Cloud configuration

The API key is held in memory for the check and sent only in the authentication header to the selected endpoint. Relay Radar blocks redirects and clears the key field when the check starts. The Issue report includes the protocol, grade, breach codes, SSE frame count, TTFT, and redacted host. It shows known public provider hostnames and masks custom and local hostnames. It omits credentials, URL paths and parameters, model IDs, prompts, and responses.

The **Watch 24/7 in inferdiff Cloud** link opens the Cloud instance configured in [`src/config.js`](src/config.js). Its default is `http://127.0.0.1:8765/` for a local Cloud deployment. For a hosted instance, set the `CLOUD_DESTINATION` protocol to `https:`, update its host and pathname, and reload the extension. Clicking the link opens Cloud independently of the check.

### Verify locally

With Python 3.12 and Node.js 20.19+ or 22.7+ on your PATH, run:

```sh
node --test
python -B pack.py --check
```

The tests use local mock API servers. The pack check verifies the MV3 manifest and local runtime assets, then builds and checks a temporary unpacked extension and ZIP archive. Run `python -B pack.py` to produce `dist/unpacked` and `dist/inferdiff-relay-radar.zip`.

## 中文

从浏览器工具栏检测 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages 和 Gemini 的流式响应。Relay Radar 根据浏览器收到的 SSE 帧评分。扩展使用 Manifest V3，直接加载源文件即可，无需外部运行时资源。

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

1. 选择供应商预设，或手动填写 API 基础地址和模型，再选择 API 协议。**根据地址自动识别** 支持 `/v1/responses`、`/v1/messages` 和 `/v1beta/models/MODEL:streamGenerateContent` 等完整端点路径。`https://your-relay.example/v1` 等通用基础地址默认使用 Chat Completions。支持 HTTPS，以及 `localhost` 或 `127.0.0.1` 上的 HTTP。
2. 按需填写 API 密钥，点击 **一键验真**。浏览器提示授权时，允许扩展访问该 API 主机。检测期间保持弹窗打开。
3. 查看评级、检测结果与首个 token 的耗时（TTFT）。点击 **复制脱敏 Issue 报告**，即可将简报粘贴到 GitHub Issues、Linux.do 或 V2EX。也可以复制详细的论坛评测或导出 JSON。

Ollama 和 llama-server 预设中的模型 ID 为示例。请填写本地服务器实际提供的模型 ID。使用完整 Gemini 端点时，Relay Radar 采用 URL 中的模型。使用 Gemini 基础地址时，请在模型字段中填写模型 ID。

| 探针 | 检测内容 |
| --- | --- |
| C1 · 截断诚实性 | Chat Completions 应以 `length` 标记未完成的工具调用 JSON。Responses 应在 token 上限截断工具参数时标记输出未完成。 |
| C4 · 用量统计 | 启用 `stream_options.include_usage` 后，流末尾应包含 token 计数大于零的用量帧。 |
| C5 · 角色与工具调用索引 | Chat Completions 首帧应声明 assistant 角色，工具调用增量应包含有效索引。 |
| C6 · UTF-8 完整性 | 检查中日韩字符与四字节表情符号的流式输出是否含有替换字符。 |
| C7 · 流式缓冲 | 若首个内容增量在超过总耗时 95% 后到达，且多个内容增量在不足 15 毫秒内集中到达，则标记缓冲现象。 |
| C9 · Anthropic 工具输入 | 工具输入增量拼接后是格式错误或截断的 JSON，而结束原因却是 `end_turn` 时，标记异常。 |
| C10 · Gemini 结束状态与时序 | 流报告 `STOP`，而输出为空、存在截断迹象或在接近结束时集中到达时，标记异常。 |

所选协议的检测项全部通过且模型一致时评级为 **A+**。确认的异常按 P0、P1 统计，无法判定的探针单独显示。服务返回的模型 ID 与请求不一致时会提示，模型别名也可能触发提示。缓冲检测基于浏览器观察到的时间，可能受网络影响。

### 隐私与 Cloud 配置

API 密钥仅在检测期间保存在内存中，通过鉴权请求头发送给所选端点。Relay Radar 会阻止重定向，并在检测开始时清空密钥输入框。Issue 报告仅包含协议、评级、异常代码、SSE 帧数、TTFT 和脱敏主机名。已知公开供应商的主机名会保留，自定义和本地主机名会隐藏。报告省略凭据、URL 路径及参数、模型 ID、提示词和响应内容。

**升级 24/7 中转站监控**链接打开 [`src/config.js`](src/config.js) 中配置的 inferdiff Cloud 实例，默认地址为本地部署的 `http://127.0.0.1:8765/`。若使用托管实例，将 `CLOUD_DESTINATION` 的 protocol 改为 `https:`，更新 host 和 pathname，再重新加载扩展。打开 Cloud 的操作与检测请求相互独立。

### 本地验证

将 Python 3.12 以及 Node.js 20.19+ 或 22.7+ 加入 PATH，运行 `node --test` 和 `python -B pack.py --check`。测试使用本地模拟服务器。打包检查会验证 MV3 清单和本地运行时资源，并在临时目录生成和检查解包目录与 ZIP。运行 `python -B pack.py` 可生成 `dist/unpacked` 和 `dist/inferdiff-relay-radar.zip`。
