import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import YAML from "yaml";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";

const SKILLS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../skills");
const listRequest = z.object({ method: z.literal("skills/list"), params: z.object({ cursor: z.string().optional() }).passthrough().optional() });
const getRequest = z.object({ method: z.literal("skills/get"), params: z.object({ uri: z.string() }).passthrough() });
const readRequest = z.object({ method: z.literal("resources/read"), params: z.object({ uri: z.string() }).passthrough() });
const listResourcesRequest = z.object({ method: z.literal("resources/list"), params: z.object({ cursor: z.string().optional() }).passthrough().optional() });

function invalid(message: string): never {
  throw new McpError(ErrorCode.InvalidParams, message);
}

function decodeSkillUri(uri: string): { name: string; relative: string } {
  // Reject traversal both before and after percent-decoding; URL normalizes dot segments itself.
  if (!uri.startsWith("skill://") || /[?#]/.test(uri)) invalid("Invalid skill URI");
  const raw = uri.slice("skill://".length);
  if (!raw || raw.includes("\\") || raw.split("/").some((s) => !s || s === "." || s === ".." || /%2f|%5c/i.test(s))) invalid("Invalid skill path");
  let segments: string[];
  try { segments = raw.split("/").map(decodeURIComponent); } catch { invalid("Invalid URI encoding"); }
  if (segments.some((s) => !s || s === "." || s === ".." || s.includes("/") || s.includes("\\") || s.includes("\0"))) invalid("Invalid skill path");
  const [name, ...files] = segments;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) invalid("Invalid skill name");
  return { name, relative: files.join("/") };
}

async function skillDirectories(): Promise<Map<string, string>> {
  const roots = [SKILLS_ROOT];
  try {
    const config = JSON.parse(await readFile(path.join(os.homedir(), ".config", "terminal-toolkit", "settings.json"), "utf8"));
    if (Array.isArray(config.skills)) for (const value of config.skills) {
      if (typeof value !== "string" || !value.trim()) continue;
      const expanded = value === "~" ? os.homedir() : value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
      roots.push(path.resolve(expanded));
    }
  } catch { /* Missing or invalid configuration preserves built-in skills. */ }
  const dirs = new Map<string, string>();
  for (const rootPath of roots) {
    try {
      const root = await realpath(rootPath);
      for (const item of await readdir(root, { withFileTypes: true })) {
        if (!item.isDirectory() || dirs.has(item.name) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.name)) continue;
        const dir = await realpath(path.join(root, item.name));
        if (path.dirname(dir) === root) dirs.set(item.name, dir);
      }
    } catch { /* Missing roots are optional. */ }
  }
  return dirs;
}
async function secureFile(name: string, relative: string): Promise<string> {
  if (!relative) invalid("Expected a file URI");
  const dir = (await skillDirectories()).get(name);
  if (!dir) invalid("Skill not found");
  const candidate = await realpath(path.join(dir, relative)).catch(() => invalid("Resource not found"));
  if (!candidate.startsWith(dir + path.sep)) invalid("Resource escapes skill directory");
  if (!(await stat(candidate)).isFile()) invalid("Resource is not a file");
  return candidate;
}

async function enumerateFiles(dir: string, base = ""): Promise<string[]> {
  const entries = await readdir(path.join(dir, base), { withFileTypes: true });
  const files: string[] = [];
  for (const item of entries) {
    const rel = path.posix.join(base, item.name);
    if (item.isSymbolicLink()) continue; // Never include symlink targets outside the manifest.
    if (item.isDirectory()) files.push(...await enumerateFiles(dir, rel));
    else if (item.isFile()) files.push(rel);
  }
  return files;
}

async function skillEntry(name: string) {
  const file = await secureFile(name, "SKILL.md");
  const source = await readFile(file, "utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match) invalid("Skill frontmatter missing");
  let frontmatter: Record<string, unknown>;
  try { frontmatter = YAML.parse(match[1]); } catch { invalid("Invalid YAML frontmatter"); }
  if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter) ||
      frontmatter.name !== name || typeof frontmatter.description !== "string" || !frontmatter.description.trim()) {
    invalid("Invalid skill frontmatter");
  }
  const dir = path.dirname(file);
  const resources = [];
  for (const rel of (await enumerateFiles(dir)).sort()) {
    const bytes = await readFile(await secureFile(name, rel));
    resources.push({ uri: `skill://${name}/${rel.split("/").map(encodeURIComponent).join("/")}`,
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, size: bytes.length });
  }
  return { uri: `skill://${name}/SKILL.md`, frontmatter, resources };
}

async function skills() {
  const result = [];
  for (const name of [...(await skillDirectories()).keys()].sort()) {
    try { result.push(await skillEntry(name)); } catch { /* Ignore invalid skill folders. */ }
  }
  return result;
}

export function registerSkills(server: Server): void {
  server.setRequestHandler(listRequest, async (request) => {
    if (request.params?.cursor) invalid("Unknown skills cursor");
    return { resultType: "complete" as const, skills: await skills(), ttlMs: 0, cacheScope: "public" as const };
  });
  server.setRequestHandler(getRequest, async ({ params }) => {
    const { name, relative } = decodeSkillUri(params.uri);
    if (relative !== "SKILL.md") invalid("skills/get expects a SKILL.md URI");
    return { resultType: "complete" as const, skill: await skillEntry(name), ttlMs: 0, cacheScope: "public" as const };
  });
  server.setRequestHandler(readRequest, async ({ params }) => {
    const { name, relative } = decodeSkillUri(params.uri);
    const bytes = await readFile(await secureFile(name, relative));
    const isText = /\.(md|txt|json|yaml|yml|ts|js|mjs|cjs|sh|py|html|css|xml|svg)$/i.test(relative);
    return { resultType: "complete" as const, ttlMs: 0, cacheScope: "public" as const, contents: [isText
      ? { uri: params.uri, mimeType: relative.endsWith(".md") ? "text/markdown" : "text/plain", text: bytes.toString("utf8") }
      : { uri: params.uri, mimeType: "application/octet-stream", blob: bytes.toString("base64") }] };
  });
  server.setRequestHandler(listResourcesRequest, async ({ params }) => {
    if (params?.cursor) invalid("Unknown resources cursor");
    return { resultType: "complete" as const, ttlMs: 0, cacheScope: "public" as const, resources: (await skills()).map((skill) => ({
      uri: skill.uri, name: skill.frontmatter.name as string, description: skill.frontmatter.description as string,
      mimeType: "text/markdown",
    })) };
  });
}
