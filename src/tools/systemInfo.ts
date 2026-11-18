import os from "node:os";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { TerminalManager } from "../terminal/index.js";

export const systemInfoTool = {
  name: "systemInfo",
  description: "Get a concise read-only summary of the Terminal Toolkit host OS, distribution, compatibility environment (WSL/MSYS2/Termux), runtime, shell, paths and Primary Session state. Useful when first connecting to an unfamiliar host; does not create a session or probe with shell commands.",
  inputSchema: { type: "object" as const, properties: {}, required: [] },
};

function readOptional(path: string): string | null {
  try { return readFileSync(path, "utf8"); } catch { return null; }
}

function linuxDistribution(): { name: string; version: string | null } | null {
  const content = readOptional("/etc/os-release");
  if (!content) return null;
  const entries = Object.fromEntries(content.split("\n").flatMap(line => {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, "")]] : [];
  }));
  return { name: entries.PRETTY_NAME ?? entries.NAME ?? "Linux", version: entries.VERSION_ID ?? null };
}

export function getSystemInfo(manager: TerminalManager) {
  const platform = process.platform;
  const env = process.env;
  const kernel = os.release();
  const linux = platform === "linux" ? linuxDistribution() : null;
  const isTermux = platform === "android" || Boolean(env.TERMUX_VERSION || env.PREFIX?.includes("com.termux"));
  const isWsl = platform === "linux" && !isTermux && (Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP) || /microsoft|wsl/i.test(kernel) || /microsoft|wsl/i.test(readOptional("/proc/version") ?? ""));
  const isWsl2 = isWsl && (/wsl2|microsoft-standard/i.test(kernel) || Boolean(env.WSL_INTEROP));
  const isMsys = Boolean(env.MSYSTEM);
  const environment = isTermux ? "termux" : isWsl ? (isWsl2 ? "wsl2" : "wsl") : isMsys ? "msys2" : "native";
  const shellPath = manager.getConfiguredShell();
  const sessions = manager.listSessions().sessions;
  const primary = sessions.find(session => session.isDefault) ?? null;
  return {
    system: {
      platform,
      distribution: linux?.name ?? (platform === "darwin" ? "macOS" : platform === "win32" ? "Windows" : os.type()),
      version: linux?.version ?? (platform === "darwin" ? null : os.release()),
      kernel,
      arch: os.arch(),
      environment,
      hostOS: isWsl ? "windows" : isTermux ? "android" : platform,
      pathStyle: platform === "win32" && !isMsys ? "windows" : "posix",
    },
    runtime: {
      node: process.version,
      bun: typeof process.versions.bun === "string" ? process.versions.bun : null,
      shell: { name: basename(shellPath), path: shellPath },
      user: os.userInfo().username,
      home: os.homedir(),
      cwd: process.cwd(),
      terminal: env.TERM ?? null,
    },
    primarySession: primary ? {
      connected: primary.mode !== "uninitialized" && (primary.role !== "client" || primary.clientCount > 0),
      sessionId: primary.mode === "uninitialized" ? null : primary.sessionId,
      mode: primary.mode,
      role: primary.role,
      shell: primary.shell,
      clientCount: primary.clientCount,
      createdAt: primary.createdAt || null,
      lastInputAt: primary.lastInputAt,
      lastOutputAt: primary.lastOutputAt,
    } : null,
  };
}

export function handleSystemInfo(manager: TerminalManager, _args: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(getSystemInfo(manager), null, 2) }] };
}
