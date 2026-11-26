# inferdiff Relay Radar

[![CI](https://github.com/ApacheWang/inferdiff-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/ApacheWang/inferdiff-extension/actions/workflows/ci.yml)

[English](#english) · [中文](#中文)

## English

Relay Radar v0.2.0 checks OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, and Gemini streams from your browser toolbar. Use **Check** for one live endpoint, **PK Compare** for two, or **Offline Audit** for a captured stream. The Manifest V3 extension loads directly from source with all runtime assets bundled locally.

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

### Compare two live endpoints

1. Open **PK Compare** and enter a URL, protocol, model, and any required API key for each endpoint. Select **Run PK Compare** and grant browser access to the two hosts when prompted.
2. Review the side-by-side grades, passed probes, P0 and P1 counts, and effective TTFT. The winner is chosen by higher grade, then more passed probes, then fewer P0 findings, then fewer P1 findings, then lower TTFT. A measured TTFT ranks ahead of a missing one. Equal results are a **Tie**.
3. The TTFT delta is B minus A when both endpoints have a measurement. Select **Copy Redacted PK Card** to share the comparison on Linux.do, V2EX, or Reddit. The card identifies the endpoints only as A and B.

Each endpoint runs the probes for its selected protocol. Use the same protocol on both sides to compare the same set of probes.

### Audit a captured stream offline

1. In DevTools **Network**, open the streaming request and copy its raw SSE response, or copy the lines from a `.trace.jsonl` capture. Paste the text into **Offline Audit** to see the frame count and findings.
2. Use **Auto-detect from stream** to infer the protocol from the frames, or choose it explicitly. If your Chat Completions request set `stream_options.include_usage`, select **Usage requested (Chat Completions)** to check for a missing usage frame even when the paste contains only the response.
3. Review the verdict. **A+** means the audited frames passed, **WARN** means there is a warning or insufficient evidence, and **F P0 BREACH** means the capture contains a critical finding. Select **Copy Redacted Issue Report** for a summary of up to 15 lines.

| Code | What the auditor found |
| --- | --- |
| D1 | A success finish such as `stop`, `completed`, or `end_turn` with incomplete or malformed tool JSON. |
| D2 | A U+FFFD replacement character in the stream. |
| D3 | Two tool calls collided at the same index. |
| D4 | Requested usage was missing. |
| C9 | Anthropic reported `end_turn` with malformed tool input. |
| C10 | Gemini reported `STOP` with empty output or evidence of a malformed finish. |

### Privacy and Cloud configuration

Live checks clear the API key fields when they start. Keys are held in memory for the run, sent only in authentication headers to the configured endpoints, and never saved to browser storage. Relay Radar blocks redirects. Offline Audit processes the paste in the popup without network requests or storage. Copied Markdown contains diagnostic fields only. It omits credentials, endpoint URLs, model IDs, prompts, and raw responses. Use the **Check** tab’s JSON download for detailed endpoint and model diagnostics.

The **Watch 24/7 in inferdiff Cloud** link opens the Cloud instance configured in [`src/config.js`](src/config.js). Its default is `http://127.0.0.1:8765/` for a local Cloud deployment. For a hosted instance, set the `CLOUD_DESTINATION` protocol to `https:`, update its host and pathname, and reload the extension. Clicking the link opens Cloud independently of the check.

### Verify locally

With Python 3.12 and Node.js 20.19+ or 22.7+ on your PATH, run:

```sh
node --test
python -B verify.py
python -B pack.py --check
```

The tests use local mock API servers and offline stream fixtures. `verify.py` validates the MV3 manifest and runtime assets and runs the Node tests. The pack check builds and verifies a temporary unpacked extension and ZIP archive. Run `python -B pack.py` to produce `dist/unpacked` and `dist/inferdiff-relay-radar.zip`.

## 中文

Relay Radar v0.2.0 可在浏览器工具栏检测 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages 和 Gemini 的流式响应。**验真**检测单个端点，**中转站 PK** 同时检测两个端点，**离线审计**分析已捕获的响应。扩展使用 Manifest V3，所需运行时资源均包含在扩展内，可直接加载源文件。

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

### PK 对比两个端点

1. 打开 **中转站 PK**，分别填写端点的地址、协议、模型及所需的 API 密钥。点击 **开始 PK 对比**，按浏览器提示授权访问两个主机。
2. 查看并排显示的评级、通过的探针数、P0 和 P1 数量以及有效 TTFT。先比较评级，再比较通过数，随后比较 P0、P1 数量，最后比较 TTFT。评级和通过数越高越好，异常数和 TTFT 越低越好。有 TTFT 实测值的一方优先于缺失的一方。各项相同则为**平局**。
3. 两边均有 TTFT 时，弹窗显示 B 减 A 的差值。点击 **复制脱敏 PK 卡片**，即可将仅以 A、B 标识端点的对比结果分享到 Linux.do、V2EX 或 Reddit。

两边各自运行所选协议的探针。要按同一组探针对比，请为两边选择相同协议。

### 离线审计流式响应

1. 在 DevTools 的 **Network** 面板找到流式请求，复制原始 SSE 响应，或复制 `.trace.jsonl` 捕获文件中的内容。粘贴到**离线审计**后即可查看帧数和异常。
2. 选择**根据流内容自动识别**或手动指定协议。若 Chat Completions 请求设置了 `stream_options.include_usage`，请勾选**已请求用量统计（Chat Completions）**。这样即使只粘贴响应，也能检查是否缺少用量帧。
3. **A+** 表示已审计的帧通过，**WARN** 表示存在警告或证据不足，**F P0 BREACH** 表示发现严重异常。点击 **复制脱敏 Issue 报告**可获得不超过 15 行的摘要。

| 代码 | 异常 |
| --- | --- |
| D1 | 流以 `stop`、`completed` 或 `end_turn` 等状态宣告完成，但工具调用 JSON 不完整或格式错误。 |
| D2 | 流中出现 U+FFFD 替换字符。 |
| D3 | 两次工具调用使用了同一索引。 |
| D4 | 请求了用量信息，但响应缺少用量信息。 |
| C9 | Anthropic 报告 `end_turn`，但工具输入格式错误。 |
| C10 | Gemini 报告 `STOP`，但输出为空或存在异常结束的迹象。 |

### 隐私与 Cloud 配置

在线检测开始时会清空密钥输入框。API 密钥仅在检测期间保存在内存中，通过鉴权请求头发送给对应端点，不写入浏览器存储。Relay Radar 会阻止重定向。离线审计仅在弹窗内处理粘贴内容，无需联网，也不保存原文。复制的 Markdown 仅含诊断数据，省略凭据、端点地址、模型 ID、提示词和原始响应。需要查看端点和模型的详细诊断时，可在**验真**页导出 JSON。

**升级 24/7 中转站监控**链接打开 [`src/config.js`](src/config.js) 中配置的 inferdiff Cloud 实例，默认地址为本地部署的 `http://127.0.0.1:8765/`。若使用托管实例，将 `CLOUD_DESTINATION` 的 protocol 改为 `https:`，更新 host 和 pathname，再重新加载扩展。打开 Cloud 的操作与检测请求相互独立。

### 本地验证

将 Python 3.12 以及 Node.js 20.19+ 或 22.7+ 加入 PATH，运行 `node --test`、`python -B verify.py` 和 `python -B pack.py --check`。测试使用本地模拟服务器和离线流样本。`verify.py` 检查 MV3 清单及运行时资源，并运行 Node 测试。打包检查会在临时目录生成和验证解包目录与 ZIP。运行 `python -B pack.py` 可生成 `dist/unpacked` 和 `dist/inferdiff-relay-radar.zip`。
