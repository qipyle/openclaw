---
summary: "Cybertron WebSocket dialog stream integration"
read_when:
  - You want to call a Cybertron-style dialog API over WebSocket from OpenClaw
  - You need to configure base URL, robot key/token, and timeouts
title: "Cybertron WebSocket"
---

# Cybertron WebSocket

OpenClaw 提供 Cybertron 风格 WebSocket 对话流客户端：连接可配置的 `wss` URL，发送首条 JSON（question、username、cybertron-robot-key、cybertron-robot-token），按行消费 JSON 直至 `flow_stage === "flow_exit"` 或流超时。行为与参考项目中的 `WebSocketService.callDialogStreamJson` 一致。

**配置对应关系**：与参考项目 `E:\work\code\websocket` 的 `src/main/resources/application.yml` 中 **websocket.client.systems.cybertron** 一一对应：

| OpenClaw `cybertron` | websocket application.yml |
|----------------------|---------------------------|
| `wsUrl` | `websocket.client.systems.cybertron.url` |
| `robotKey` | `websocket.client.systems.cybertron.headers.cybertron-robot-key` |
| `robotToken` | `websocket.client.systems.cybertron.headers.cybertron-robot-token` |
| `username` | `websocket.client.systems.cybertron.headers.username` |
| `appId`（可选） | `websocket.client.systems.cybertron.headers.cybertron-app-id`（如 `agent_cyber`） |

首条消息体必须包含：`question`、`username`、`cybertron-robot-key`、`cybertron-robot-token`（见 websocket 项目中的 websocket接口.docx / WebSocket修改与FAQ.md）。

## Configuration

可选顶层配置键 `cybertron`：

| Field | Description |
|-------|-------------|
| `wsUrl` | 直接 WebSocket URL（对应 websocket 的 `url`，如 `wss://www.cybotstar.cn/openapi/v1/ws/dialog/`）。若设置则忽略 `baseUrl`/`apiPath`。 |
| `baseUrl` | HTTP(S) 基地址；未设置 `wsUrl` 时与 `apiPath` 拼接并转为 wss。 |
| `apiPath` | 拼在 `baseUrl` 后的路径（默认 `/openapi/v1/ws/dialog/`）。 |
| `robotKey` | 首条消息体 `cybertron-robot-key`（对应 websocket headers 同名项）。 |
| `robotToken` | 首条消息体 `cybertron-robot-token`（对应 websocket headers 同名项）。 |
| `username` | 首条消息体 `username`（对应 websocket headers 同名项）。 |
| `appId` | 可选请求头 `cybertron-app-id`（对应 websocket 的 `agent_cyber` 等）。 |
| `connectTimeoutSec` | 连接超时秒数（默认 30）。 |
| `streamTimeoutMin` | 流超时分钟数（未收到 flow_exit 时，默认 20）。 |

示例（与 websocket 的 `application.yml` 中 cybertron 段结构一致；请勿提交真实凭证）：

```yaml
cybertron:
  wsUrl: wss://www.cybotstar.cn/openapi/v1/ws/dialog/
  robotKey: "从 websocket headers.cybertron-robot-key 复制"
  robotToken: "从 websocket headers.cybertron-robot-token 复制"
  username: "从 websocket headers.username 复制"
  appId: "agent_cyber"
  connectTimeoutSec: 30
  streamTimeoutMin: 20
```

或使用 baseUrl + apiPath（与 http.client 的 base-url + apis.flowStream 转 wss 一致）：

```yaml
cybertron:
  baseUrl: https://www.cybotstar.cn
  apiPath: /openapi/v1/ws/dialog/
  robotKey: "..."
  robotToken: "..."
  username: "user@gateway-host"
  appId: "agent_cyber"
```

## Usage in code

- **Client**: `src/agents/cybertron-ws-client.ts`
  - `callDialogStreamJson(options)` — connect, send `requestData`, collect messages until `flow_stage === "flow_exit"` or timeout; returns the full response as concatenated JSON lines.
  - `buildDialogOptionsFromConfig(config, question)` — builds options from a `cybertron` config block and a question string; returns `null` if config is missing or URL cannot be determined.
  - `httpUrlToWsUrl(httpUrl)` — converts `http`/`https` to `ws`/`wss`.

Use `config.cybertron` (after config load) with `buildDialogOptionsFromConfig` to get options, then call `callDialogStreamJson(opts)`. Resolve any secret refs (e.g. for `robotKey`/`robotToken`) before building the request body if you use secret refs in config.

## 在网关/对话中作为模型使用

当配置了 `cybertron` 且存在 `wsUrl` 或 `baseUrl` 时，OpenClaw 会将 **cybertron** 注册为隐式模型 provider。在会话或 agent 中将模型选为 **cybertron/default** 后，`chat.send` 与 agent 跑模型时会通过 Cybertron WebSocket 发送用户最后一条消息作为 `question`，并将返回的对话流作为助手回复。

1. 在 `openclaw.json` 中配置 `cybertron`（同上）。
2. 将默认模型设为 `cybertron/default`，例如：
   - `agents.defaults.model.primary: "cybertron/default"`
   - 或在 WebChat/控制台中为该会话选择模型 `cybertron/default`。
3. 发送消息后，网关会使用 Cybertron WebSocket 请求并流式返回回复（当前为单轮问答，无 Pi 工具调用）。

## Reference

- 配置与调用方式参考：**E:\\work\\code\\websocket** 的 `application.yml`（`websocket.client.systems.cybertron`、`http.client.systems.cybertron`）及 `WebSocketService.callDialogStreamJson`、`HealthController` 的 `/api/ws-ask`。
- 首条消息体字段与完成条件与参考项目一致：`question`、`username`、`cybertron-robot-key`、`cybertron-robot-token`；结束条件 `flow_stage === "flow_exit"`。
