"use strict";

const http = require("http");
const https = require("https");
const readline = require("readline");

const SERVER_NAME = "wuying-workstation-mcp";
const SERVER_VERSION = "0.1.0";
const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05"
];

function log(message) {
  process.stderr.write(`[wuying-mcp] ${message}\n`);
}

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function getEnv(name, defaultValue) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") {
    return defaultValue;
  }
  return value.trim();
}

function getConfig() {
  const apiKey = process.env.WUYING_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("缺少环境变量 WUYING_API_KEY。请在 MCP 客户端配置中注入 ApiKey。");
  }

  const apiKeyPlacement = getEnv("WUYING_API_KEY_PLACEMENT", "body").toLowerCase();
  if (!["body", "query"].includes(apiKeyPlacement)) {
    throw new Error("WUYING_API_KEY_PLACEMENT 仅支持 body 或 query。");
  }

  const timeoutSeconds = Number.parseInt(getEnv("WUYING_HTTP_TIMEOUT_SECONDS", "30"), 10);

  return {
    apiKey: apiKey.trim(),
    endpoint: getEnv("WUYING_API_ENDPOINT", "https://wuying-personal-pc.cn-hangzhou.aliyuncs.com"),
    version: getEnv("WUYING_API_VERSION", "2025-11-11"),
    format: getEnv("WUYING_RESPONSE_FORMAT", "JSON"),
    signatureVersion: getEnv("WUYING_SIGNATURE_VERSION", "1.0"),
    apiKeyPlacement,
    defaultDisplayType: getEnv("WUYING_DEFAULT_DISPLAY_TYPE", "Linggou"),
    defaultProductType: getEnv("WUYING_DEFAULT_PRODUCT_TYPE", "WuyingWorkStation"),
    defaultScene: getEnv("WUYING_DEFAULT_SCENE", "ComfyUi"),
    timeoutSeconds: Number.isFinite(timeoutSeconds) && timeoutSeconds >= 5 ? timeoutSeconds : 30
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildWuyingUrl(config, action, queryExtra = {}) {
  const url = new URL(config.endpoint);
  url.searchParams.set("Action", action);
  url.searchParams.set("Format", config.format);
  url.searchParams.set("Version", config.version);
  url.searchParams.set("SignatureVersion", config.signatureVersion);

  for (const [key, value] of Object.entries(queryExtra)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    url.searchParams.set(key, String(value));
  }

  if (config.apiKeyPlacement === "query") {
    url.searchParams.set("ApiKey", config.apiKey);
  }

  return url;
}

function requestText(url, jsonBody, timeoutSeconds) {
  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(jsonBody, "utf8")
        },
        timeout: timeoutSeconds * 1000
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          const statusCode = res.statusCode || 0;
          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`无影 API 返回 HTTP ${statusCode}：${body}`));
            return;
          }
          resolve(body);
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error("请求超时"));
    });

    req.on("error", (error) => {
      reject(error);
    });

    req.write(jsonBody);
    req.end();
  });
}

async function invokeWuyingAction(action, body = {}, queryExtra = {}) {
  const config = getConfig();
  const url = buildWuyingUrl(config, action, queryExtra);
  const requestBody = { ...body };

  if (config.apiKeyPlacement === "body") {
    requestBody.ApiKey = config.apiKey;
  }

  const rawText = await requestText(url, JSON.stringify(requestBody), config.timeoutSeconds);
  let data = null;
  try {
    data = JSON.parse(rawText);
  } catch {
    data = null;
  }

  return {
    action,
    url: url.toString(),
    rawText,
    data
  };
}

function normalizeDesktop(desktop) {
  return {
    desktopId: desktop?.DesktopId ?? null,
    desktopName: desktop?.DesktopName ?? null,
    status: desktop?.DesktopStatus ?? null,
    managementFlag: desktop?.ManagementFlag ?? null,
    desktopType: desktop?.DesktopType ?? null,
    productCode: desktop?.ProductCode ?? null,
    imageId: desktop?.ImageId ?? null,
    expiredTime: desktop?.ExpiredTime ?? null,
    creationTime: desktop?.CreationTime ?? null,
    desktopRaw: desktop ?? null
  };
}

async function describeDesktops(argumentsObject = {}) {
  const config = getConfig();
  const displayType = typeof argumentsObject.displayType === "string" && argumentsObject.displayType.trim() !== ""
    ? argumentsObject.displayType.trim()
    : config.defaultDisplayType;

  const apiResult = await invokeWuyingAction("DescribeDesktops", { DisplayType: displayType });
  const desktops = Array.isArray(apiResult.data?.Result?.PrivateDesktops)
    ? apiResult.data.Result.PrivateDesktops
    : [];

  const desktopIdFilter = typeof argumentsObject.desktopId === "string" && argumentsObject.desktopId.trim() !== ""
    ? argumentsObject.desktopId.trim()
    : null;

  const statusFilter = typeof argumentsObject.desktopStatus === "string" && argumentsObject.desktopStatus.trim() !== ""
    ? argumentsObject.desktopStatus.trim()
    : null;

  const normalized = desktops
    .map(normalizeDesktop)
    .filter((item) => !desktopIdFilter || item.desktopId === desktopIdFilter)
    .filter((item) => !statusFilter || item.status === statusFilter);

  return {
    displayType,
    count: normalized.length,
    desktops: normalized,
    rawResponse: apiResult.data
  };
}

function requireStringArg(argumentsObject, name) {
  const value = argumentsObject?.[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`缺少必填参数 ${name}。`);
  }
  return value.trim();
}

function getBooleanArg(argumentsObject, name, defaultValue) {
  const value = argumentsObject?.[name];
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value === "boolean") {
    return value;
  }
  throw new Error(`参数 ${name} 必须是布尔值。`);
}

function getIntArg(argumentsObject, name, defaultValue, minValue) {
  const value = argumentsObject?.[name];
  if (value === undefined) {
    return defaultValue;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < minValue) {
    throw new Error(`参数 ${name} 必须是不小于 ${minValue} 的整数。`);
  }
  return parsed;
}

async function getDesktopSnapshot(desktopId, displayType) {
  const result = await describeDesktops({ desktopId, displayType });
  if (result.count === 0) {
    throw new Error(`未找到桌面 ${desktopId}。`);
  }
  return result.desktops[0];
}

async function waitDesktopStatus(desktopId, desiredStatus, timeoutSeconds, pollIntervalSeconds) {
  const startedAt = Date.now();

  while (true) {
    const desktop = await getDesktopSnapshot(desktopId);
    const currentStatus = desktop.status;
    const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);

    if (currentStatus === desiredStatus) {
      return {
        reached: true,
        desiredStatus,
        currentStatus,
        elapsedSeconds,
        desktop
      };
    }

    if (currentStatus === "Expired" || currentStatus === "Deleted") {
      return {
        reached: false,
        desiredStatus,
        currentStatus,
        elapsedSeconds,
        desktop
      };
    }

    if (elapsedSeconds >= timeoutSeconds) {
      return {
        reached: false,
        desiredStatus,
        currentStatus,
        elapsedSeconds,
        desktop
      };
    }

    await delay(pollIntervalSeconds * 1000);
  }
}

async function startWorkstation(argumentsObject = {}) {
  const desktopId = requireStringArg(argumentsObject, "desktopId");
  const waitForRunning = getBooleanArg(argumentsObject, "waitForRunning", true);
  const timeoutSeconds = getIntArg(argumentsObject, "timeoutSeconds", 600, 10);
  const pollIntervalSeconds = getIntArg(argumentsObject, "pollIntervalSeconds", 5, 1);

  const current = await getDesktopSnapshot(desktopId);
  const initialStatus = current.status;

  if (initialStatus === "Running") {
    return {
      message: "桌面已经是 Running，无需重复开机。",
      desktopId,
      initialStatus,
      finalStatus: initialStatus,
      changed: false,
      desktop: current
    };
  }

  if (initialStatus === "Starting") {
    if (!waitForRunning) {
      return {
        message: "桌面已处于 Starting，未执行额外操作。",
        desktopId,
        initialStatus,
        finalStatus: initialStatus,
        changed: false,
        desktop: current
      };
    }

    const waitResult = await waitDesktopStatus(desktopId, "Running", timeoutSeconds, pollIntervalSeconds);
    return {
      message: waitResult.reached ? "桌面已从 Starting 进入 Running。" : "等待桌面进入 Running 超时或遇到终止状态。",
      desktopId,
      initialStatus,
      finalStatus: waitResult.currentStatus,
      changed: false,
      waited: true,
      waitResult,
      desktop: waitResult.desktop
    };
  }

  if (initialStatus !== "Stopped") {
    throw new Error(`根据官方文档，StartDesktop 主要对 Stopped 状态有意义。当前状态为 ${initialStatus}。`);
  }

  const actionResponse = await invokeWuyingAction("StartDesktop", { DesktopId: desktopId });

  if (!waitForRunning) {
    const desktop = await getDesktopSnapshot(desktopId);
    return {
      message: "已发送开机请求。",
      desktopId,
      initialStatus,
      finalStatus: desktop.status,
      changed: true,
      waited: false,
      actionResponse: actionResponse.data,
      desktop
    };
  }

  const waitResult = await waitDesktopStatus(desktopId, "Running", timeoutSeconds, pollIntervalSeconds);
  return {
    message: waitResult.reached ? "桌面已成功开机并进入 Running。" : "已发送开机请求，但在等待 Running 时超时或遇到终止状态。",
    desktopId,
    initialStatus,
    finalStatus: waitResult.currentStatus,
    changed: true,
    waited: true,
    actionResponse: actionResponse.data,
    waitResult,
    desktop: waitResult.desktop
  };
}

async function stopWorkstation(argumentsObject = {}) {
  const desktopId = requireStringArg(argumentsObject, "desktopId");
  const waitForStopped = getBooleanArg(argumentsObject, "waitForStopped", true);
  const timeoutSeconds = getIntArg(argumentsObject, "timeoutSeconds", 600, 10);
  const pollIntervalSeconds = getIntArg(argumentsObject, "pollIntervalSeconds", 5, 1);

  const current = await getDesktopSnapshot(desktopId);
  const initialStatus = current.status;

  if (initialStatus === "Stopped") {
    return {
      message: "桌面已经是 Stopped，无需重复关机。",
      desktopId,
      initialStatus,
      finalStatus: initialStatus,
      changed: false,
      desktop: current
    };
  }

  if (initialStatus === "Stopping") {
    if (!waitForStopped) {
      return {
        message: "桌面已处于 Stopping，未执行额外操作。",
        desktopId,
        initialStatus,
        finalStatus: initialStatus,
        changed: false,
        desktop: current
      };
    }

    const waitResult = await waitDesktopStatus(desktopId, "Stopped", timeoutSeconds, pollIntervalSeconds);
    return {
      message: waitResult.reached ? "桌面已从 Stopping 进入 Stopped。" : "等待桌面进入 Stopped 超时或遇到终止状态。",
      desktopId,
      initialStatus,
      finalStatus: waitResult.currentStatus,
      changed: false,
      waited: true,
      waitResult,
      desktop: waitResult.desktop
    };
  }

  if (initialStatus !== "Running") {
    throw new Error(`根据官方文档，StopDesktop 主要对 Running 状态有意义。当前状态为 ${initialStatus}。`);
  }

  const actionResponse = await invokeWuyingAction("StopDesktop", { DesktopId: desktopId });

  if (!waitForStopped) {
    const desktop = await getDesktopSnapshot(desktopId);
    return {
      message: "已发送关机请求。",
      desktopId,
      initialStatus,
      finalStatus: desktop.status,
      changed: true,
      waited: false,
      actionResponse: actionResponse.data,
      desktop
    };
  }

  const waitResult = await waitDesktopStatus(desktopId, "Stopped", timeoutSeconds, pollIntervalSeconds);
  return {
    message: waitResult.reached ? "桌面已成功关机并进入 Stopped。" : "已发送关机请求，但在等待 Stopped 时超时或遇到终止状态。",
    desktopId,
    initialStatus,
    finalStatus: waitResult.currentStatus,
    changed: true,
    waited: true,
    actionResponse: actionResponse.data,
    waitResult,
    desktop: waitResult.desktop
  };
}

async function generateSceneUrl(argumentsObject = {}) {
  const config = getConfig();
  const desktopId = requireStringArg(argumentsObject, "desktopId");
  const scene = typeof argumentsObject.scene === "string" && argumentsObject.scene.trim() !== ""
    ? argumentsObject.scene.trim()
    : config.defaultScene;
  const productType = typeof argumentsObject.productType === "string" && argumentsObject.productType.trim() !== ""
    ? argumentsObject.productType.trim()
    : config.defaultProductType;

  const body = {
    WuyingServerId: desktopId,
    ProductType: productType,
    Scene: scene
  };

  if (typeof argumentsObject.clientType === "string" && argumentsObject.clientType.trim() !== "") {
    body.ClientType = argumentsObject.clientType.trim();
  }

  const apiResult = await invokeWuyingAction("GenerateWuyingServerSceneUrl", body);

  return {
    desktopId,
    scene,
    productType,
    url: apiResult.data?.Url ?? null,
    expireTime: apiResult.data?.ExpireTime ?? null,
    rawResponse: apiResult.data
  };
}

function toToolResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ],
    structuredContent: payload
  };
}

function getToolDefinitions() {
  return [
    {
      name: "list_workstations",
      description: "查询无影灵构工作站列表，可按 desktopId 或状态过滤。底层调用 DescribeDesktops。",
      inputSchema: {
        type: "object",
        properties: {
          desktopId: { type: "string", description: "可选。只返回指定桌面 ID。" },
          desktopStatus: { type: "string", description: "可选。按状态过滤，例如 Running、Stopped。" },
          displayType: { type: "string", description: "可选。默认 Linggou。" }
        },
        additionalProperties: false
      }
    },
    {
      name: "start_workstation",
      description: "开机指定工作站。若 waitForRunning=true，会轮询直到 Running 或超时。底层调用 StartDesktop。",
      inputSchema: {
        type: "object",
        properties: {
          desktopId: { type: "string", description: "必填。目标桌面 ID，例如 ws-xxxx。" },
          waitForRunning: { type: "boolean", description: "可选。默认 true，等待直到状态变为 Running。" },
          timeoutSeconds: { type: "integer", minimum: 10, description: "可选。等待超时时间，默认 600 秒。" },
          pollIntervalSeconds: { type: "integer", minimum: 1, description: "可选。轮询间隔，默认 5 秒。" }
        },
        required: ["desktopId"],
        additionalProperties: false
      }
    },
    {
      name: "stop_workstation",
      description: "关机指定工作站。若 waitForStopped=true，会轮询直到 Stopped 或超时。底层调用 StopDesktop。",
      inputSchema: {
        type: "object",
        properties: {
          desktopId: { type: "string", description: "必填。目标桌面 ID，例如 ws-xxxx。" },
          waitForStopped: { type: "boolean", description: "可选。默认 true，等待直到状态变为 Stopped。" },
          timeoutSeconds: { type: "integer", minimum: 10, description: "可选。等待超时时间，默认 600 秒。" },
          pollIntervalSeconds: { type: "integer", minimum: 1, description: "可选。轮询间隔，默认 5 秒。" }
        },
        required: ["desktopId"],
        additionalProperties: false
      }
    },
    {
      name: "generate_scene_url",
      description: "为指定工作站生成场景访问 URL。底层调用 GenerateWuyingServerSceneUrl。",
      inputSchema: {
        type: "object",
        properties: {
          desktopId: { type: "string", description: "必填。目标桌面 ID。" },
          scene: { type: "string", description: "可选。默认 ComfyUi，可改为 Jupyter 等。" },
          productType: { type: "string", description: "可选。默认 WuyingWorkStation。" },
          clientType: { type: "string", description: "可选。客户端类型。" }
        },
        required: ["desktopId"],
        additionalProperties: false
      }
    }
  ];
}

async function invokeTool(name, argumentsObject) {
  switch (name) {
    case "list_workstations":
      return toToolResult(await describeDesktops(argumentsObject));
    case "start_workstation":
      return toToolResult(await startWorkstation(argumentsObject));
    case "stop_workstation":
      return toToolResult(await stopWorkstation(argumentsObject));
    case "generate_scene_url":
      return toToolResult(await generateSceneUrl(argumentsObject));
    default:
      throw new Error(`未知工具：${name}`);
  }
}

function makeResult(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result
  };
}

function makeError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) {
    error.data = data;
  }
  return {
    jsonrpc: "2.0",
    id,
    error
  };
}

async function handleRequest(request) {
  const id = request?.id;
  const method = request?.method;

  switch (method) {
    case "initialize": {
      const requestedVersion = request?.params?.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)
        ? requestedVersion
        : SUPPORTED_PROTOCOL_VERSIONS[0];

      return makeResult(id, {
        protocolVersion,
        capabilities: {
          tools: {
            listChanged: false
          }
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION
        },
        instructions: "通过无影灵构官方工作站 API 控制云电脑开关机，并支持查询列表和生成场景 URL。请用环境变量 WUYING_API_KEY 注入 ApiKey。"
      });
    }
    case "ping":
      return makeResult(id, {});
    case "tools/list":
      return makeResult(id, { tools: getToolDefinitions() });
    case "tools/call": {
      const toolName = request?.params?.name;
      if (typeof toolName !== "string" || toolName.trim() === "") {
        return makeError(id, -32602, "tools/call 缺少 name。");
      }

      try {
        const result = await invokeTool(toolName.trim(), request?.params?.arguments ?? {});
        return makeResult(id, result);
      } catch (error) {
        return makeResult(id, {
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : String(error)
            }
          ],
          isError: true
        });
      }
    }
    case "notifications/initialized":
      return null;
    default:
      if (id !== undefined) {
        return makeError(id, -32601, `不支持的方法：${method}`);
      }
      return null;
  }
}

async function processInputLine(line) {
  if (!line || line.trim() === "") {
    return;
  }

  let payload;
  try {
    payload = JSON.parse(line);
  } catch {
    send(makeError(null, -32700, "JSON 解析失败", { raw: line }));
    return;
  }

  if (Array.isArray(payload)) {
    const responses = [];
    for (const request of payload) {
      const response = await handleRequest(request);
      if (response) {
        responses.push(response);
      }
    }
    if (responses.length > 0) {
      send(responses);
    }
    return;
  }

  const response = await handleRequest(payload);
  if (response) {
    send(response);
  }
}

async function main() {
  log("server starting");

  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    try {
      await processInputLine(line);
    } catch (error) {
      log(error instanceof Error ? error.message : String(error));
    }
  }

  log("server stopped");
}

main().catch((error) => {
  log(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
