import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TerminalManager } from "../terminal/index.js";
import { getMcpToolDefinitions } from "./definitions.js";
import { runCodemode, codemodeDefinition } from "./codemode.js";
import { handleOperatorTool } from "./operators.js";
import { handleExtraOperatorTool } from "./extra-operators.js";

import { handleType } from "./type.js";
import { handleSendKey } from "./sendKey.js";
import { handleSleep } from "./sleep.js";
import { handleGetContent } from "./getContent.js";
import { handleGetBufferInfo } from "./getBufferInfo.js";
import { handleScreenshot } from "./screenshot.js";
import { handleStartRecording } from "./startRecording.js";
import { handleStopRecording } from "./stopRecording.js";
import { handleCreateSession } from "./createSession.js";
import { handleListSessions } from "./listSessions.js";
import { handleDestroySession } from "./destroySession.js";
import { handleResize } from "./resize.js";
import { handleGetClipboard } from "./getClipboard.js";
import { handleSetClipboard } from "./setClipboard.js";
import { handleNotify } from "./notify.js";

import { limitToolResponse } from "./outputLimit.js";

export function registerTools(server: Server, manager: TerminalManager, piOperators = true, piExtraOperators = false, codemode = false): void {
  // Register list tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: codemode ? [codemodeDefinition] : getMcpToolDefinitions(piOperators, piExtraOperators),
  }));

  // Register call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;

    try {
      if (codemode) {
        if (name !== "codemode") throw new Error(`Unknown tool: ${name}`);
        return await runCodemode(manager, args, piOperators, piExtraOperators, extra.signal);
      }
      return limitToolResponse(await dispatchTool(manager, name, args, piOperators, piExtraOperators, extra.signal));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  });
}

export async function dispatchTool(manager: TerminalManager, name: string, args: unknown, piOperators = true, piExtraOperators = false, signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("Tool call aborted");
  switch (name) {
    case "ls":
    case "grep":
    case "find":
      if (!piExtraOperators) throw new Error("Unknown tool: " + name);
      return await handleExtraOperatorTool(name, args);
    case "read":
    case "write":
    case "edit":
    case "shell":
      if (!piOperators) throw new Error(`Unknown tool: ${name}`);
      return await handleOperatorTool(name, args, manager.getConfiguredShell(), signal);
    case "type":
      return await handleType(manager, args);

    case "sendKey":
      return handleSendKey(manager, args);

    case "sleep":
      return await handleSleep(manager, args, signal);

    case "getContent":
      return await handleGetContent(manager, args);

    case "getBufferInfo":
      return handleGetBufferInfo(manager, args);

    case "takeScreenshot":
      return handleScreenshot(manager, args);

    case "startRecording":
      return handleStartRecording(manager, args);

    case "stopRecording":
      return await handleStopRecording(manager, args);

    case "createSession":
      return await handleCreateSession(manager, args);

    case "listSessions":
      return handleListSessions(manager, args);

    case "destroySession":
      return handleDestroySession(manager, args);

    case "resize":
      return handleResize(manager, args);

    case "getClipboard":
      return await handleGetClipboard(manager, args);

    case "setClipboard":
      return await handleSetClipboard(manager, args);

    case "notify":
      return await handleNotify(manager, args);

        default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
