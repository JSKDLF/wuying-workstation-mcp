# 无影云电脑开关机 MCP

这是一个纯 Node.js 实现的 stdio MCP Server，用来控制无影灵构工作站的开机、关机、列表查询，以及生成场景访问 URL。

项目结构采用常见的 Node MCP 形态：

- `package.json`
- `src/index.js`
- `dist/index.js`
- `scripts/build.js`

## 已实现的工具

- `list_workstations`
  - 查询工作站列表
  - 底层调用 `DescribeDesktops`
- `start_workstation`
  - 开机指定工作站
  - 可选等待直到 `Running`
  - 底层调用 `StartDesktop`
- `stop_workstation`
  - 关机指定工作站
  - 可选等待直到 `Stopped`
  - 底层调用 `StopDesktop`
- `generate_scene_url`
  - 生成场景 URL
  - 底层调用 `GenerateWuyingServerSceneUrl`

## 官方接口依据

我按无影灵构官方文档里的默认调用方式实现了这版 MCP：

- 开发者中心示例页：
  - `https://lincore.wuying.aliyun.com/#/developerCenter/workstationApi`
- Cookbook：
  - `https://docs-lincore.wuying.com/zh/docs/api/api-cookbook/`

从官方示例中提取到的默认配置如下：

- `Endpoint`: `https://wuying-personal-pc.cn-hangzhou.aliyuncs.com`
- `Version`: `2025-11-11`
- `SignatureVersion`: `1.0`
- `Format`: `JSON`
- `ApiKey` 默认放在 `Body JSON`

## 环境变量

至少需要配置：

- `WUYING_API_KEY`

可选环境变量见 [.env.example](.env.example)。

## MCP 客户端配置示例

推荐这样配置（把 `args` 里的路径替换成你本机 clone 后 `dist/index.js` 的实际路径）：

```json
{
  "mcpServers": {
    "wuying-workstation": {
      "command": "node",
      "args": [
        "/path/to/wuying-workstation-mcp/dist/index.js"
      ],
      "env": {
        "WUYING_API_KEY": "你的ApiKey",
        "WUYING_API_VERSION": "2025-11-11",
        "WUYING_SIGNATURE_VERSION": "1.0",
        "WUYING_API_KEY_PLACEMENT": "body"
      }
    }
  }
}
```

## 工具示例

### 1. 查询工作站

```json
{
  "name": "list_workstations",
  "arguments": {}
}
```

### 2. 开机

```json
{
  "name": "start_workstation",
  "arguments": {
    "desktopId": "ws-xxxxxxxx",
    "waitForRunning": true
  }
}
```

### 3. 关机

```json
{
  "name": "stop_workstation",
  "arguments": {
    "desktopId": "ws-xxxxxxxx",
    "waitForStopped": true
  }
}
```

### 4. 生成 ComfyUI 场景 URL

```json
{
  "name": "generate_scene_url",
  "arguments": {
    "desktopId": "ws-xxxxxxxx",
    "scene": "ComfyUi"
  }
}
```

## 本地协议自测

可以用下面这段命令验证 MCP 协议层是否正常：

```powershell
$lines = @'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"local-test","version":"1.0.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
'@ -split "`r?`n" | Where-Object { $_ -ne "" }
$lines | node .\dist\index.js
```

## 注意事项

- `start_workstation` 和 `stop_workstation` 在调用前会先查当前状态，避免无意义重复操作。
- 根据官方说明，`StartDesktop` 主要对 `Stopped` 有意义，`StopDesktop` 主要对 `Running` 有意义。
- 当前代理环境里的 `node.exe` 进程启动存在宿主异常，所以我已经把 Node 版源码和构建产物落好，但没法在这里完成真实运行联调。
