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

async function decodeSkillUri(uri: string): Promise<{ namespace?: string; name: string; relative: string }> {
  // Reject traversal both before and after percent-decoding; URL normalizes dot segments itself.
  if (!uri.startsWith("skill://") || /[?#]/.test(uri)) invalid("Invalid skill URI");
  const raw = uri.slice("skill://".length);
  if (!raw || raw.includes("\\") || raw.split("/").some((s) => !s || s === "." || s === ".." || /%2f|%5c/i.test(s))) invalid("Invalid skill path");
  let segments: string[];
  try { segments = raw.split("/").map(decodeURIComponent); } catch { invalid("Invalid URI encoding"); }
  if (segments.some((s) => !s || s === "." || s === ".." || s.includes("/") || s.includes("\\") || s.includes("\0"))) invalid("Invalid skill path");
  const locations = await skillLocations();
  // Match registered namespace + skill prefixes, longest first; never infer boundaries from path depth.
  const matches = locations.filter(location => {
    const prefix = [...location.namespace.slice("skills/".length).split("/"), location.name];
    return segments.length > prefix.length && prefix.every((part, i) => segments[i] === part);
  }).sort((a, b) => b.namespace.length - a.namespace.length);
  if (matches.length) {
    const match = matches[0];
    return { namespace: match.namespace, name: match.name, relative: segments.slice(match.namespace.split("/").length).join("/") };
  }
  const [first, ...rest] = segments;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(first)) invalid("Invalid skill name");
  return { name: first, relative: rest.join("/") };
}

const skillWarnings = new Set<string>();

export interface SkillLocation { namespace: string; name: string; directory: string; source: "builtin" | "file" }

export async function skillLocations(overrideRoots?: string[]): Promise<SkillLocation[]> {
  const roots = overrideRoots ?? [SKILLS_ROOT];
  if (!overrideRoots) try {
    const config = JSON.parse(await readFile(path.join(os.homedir(), ".config", "terminal-toolkit", "settings.json"), "utf8"));
    if (Array.isArray(config.skills)) for (const value of config.skills) {
      if (typeof value !== "string" || !value.trim()) continue;
      const expanded = value === "~" ? os.homedir() : value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
      roots.push(path.resolve(expanded));
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      skillWarnings.add("Cannot read settings.json: " + (error instanceof Error ? error.message : String(error)));
  }
  const locations: SkillLocation[] = [];
  const namespaces = new Map<string, string>();
  for (const rootPath of roots) {
    try {
      const root = await realpath(rootPath);
      const builtin = rootPath === SKILLS_ROOT;
      const parts = root.split(path.sep).filter(Boolean);
      const anchor = parts.lastIndexOf("skills");
      const namespaceParts = anchor > 0 ? [parts[anchor - 1], ...parts.slice(anchor + 1)] : [path.basename(root)];
      const namespace = builtin ? "skills/builtin" : "skills/" + namespaceParts.join("/");
      const previous = namespaces.get(namespace);
      if (previous && previous !== root) {
        const warning = `Skill namespace conflict ${namespace}: keeping ${previous}; skipping ${root}`;
        if (!skillWarnings.has(warning)) console.error("[Terminal Toolkit] " + warning);
        skillWarnings.add(warning);
        continue;
      }
      namespaces.set(namespace, root);
      for (const item of await readdir(root, { withFileTypes: true })) {
        if (!item.isDirectory() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.name)) continue;
        const dir = await realpath(path.join(root, item.name));
        if (path.dirname(dir) === root) locations.push({ namespace, name: item.name, directory: dir, source: builtin ? "builtin" : "file" });
      }
    } catch (error) {
      if (rootPath !== SKILLS_ROOT) skillWarnings.add("Cannot load skills directory " + rootPath + ": " + (error instanceof Error ? error.message : String(error)));
    }
  }
  return locations;
}

export async function skillCatalog(overrideRoots?: string[]) {
  const result = [];
  for (const location of await skillLocations(overrideRoots)) {
    try {
      const { frontmatter, size } = await readSkillMetadata(location);
      result.push({ namespace: location.namespace, name: location.name, description: frontmatter.description as string, frontmatter, source: location.source, path: location.source === "builtin" ? `builtin://skills/${location.name}/` : location.directory + path.sep, entrypoint: "SKILL.md", size });
    } catch { /* Invalid skills are omitted from discovery. */ }
  }
  return result;
}

async function readSkillMetadata(location: SkillLocation) {
  const file = await secureSkillFile(location.directory, "SKILL.md");
  const source = await readFile(file, "utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match) invalid("Skill frontmatter missing");
  let frontmatter: Record<string, unknown>;
  try { frontmatter = YAML.parse(match[1]); } catch { invalid("Invalid YAML frontmatter"); }
  if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter) || frontmatter.name !== location.name || typeof frontmatter.description !== "string" || !frontmatter.description.trim()) invalid("Invalid skill frontmatter");
  return { frontmatter, size: (await stat(file)).size };
}

async function secureSkillFile(directory: string, relative: string): Promise<string> {
  const candidate = await realpath(path.join(directory, relative));
  if (!candidate.startsWith(directory + path.sep) || !(await stat(candidate)).isFile()) throw new Error("Invalid skill resource path");
  return candidate;
}

export async function resolveBuiltinSkillPath(uri: string): Promise<string> {
  if (!uri.startsWith("builtin://skills/")) throw new Error("Invalid builtin path");
  const relative = uri.slice("builtin://skills/".length);
  if (!relative || /[?#\\\\]/.test(relative) || relative.split("/").some(s => !s || s === "." || s === ".." || /%2f|%5c/i.test(s))) throw new Error("Invalid builtin path");
  const segments = relative.split("/");
  if (segments.length < 2 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(segments[0])) throw new Error("Invalid builtin skill name");
  const location = (await skillLocations()).find(s => s.source === "builtin" && s.name === segments[0]);
  if (!location) throw new Error("Builtin skill not found");
  return secureSkillFile(location.directory, segments.slice(1).join("/"));
}

async function locateSkill(name: string, namespace?: string): Promise<SkillLocation> {
  const matches = (await skillLocations()).filter(s => s.name === name && (!namespace || s.namespace === namespace));
  if (matches.length !== 1) invalid(matches.length ? "Ambiguous skill name; use a namespaced URI" : "Skill not found");
  return matches[0];
}

async function secureFile(name: string, relative: string, namespace?: string): Promise<string> {
  if (!relative) invalid("Expected a file URI");
  const skill = await locateSkill(name, namespace);
  return secureSkillFile(skill.directory, relative).catch(() => invalid("Resource not found"));
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

export async function skillEntry(location: SkillLocation, locations?: SkillLocation[]) {
  const { name, namespace } = location;
  const duplicateName = (locations ?? await skillLocations()).some(s => s.name === name && s.namespace !== namespace);
  const prefix = !duplicateName && namespace === "skills/builtin" ? `skill://${name}` : `skill://${namespace.slice("skills/".length)}/${name}`;
  const { frontmatter } = await readSkillMetadata(location);
  const dir = location.directory;
  const resources = [];
  for (const rel of (await enumerateFiles(dir)).sort()) {
    const bytes = await readFile(await secureSkillFile(location.directory, rel));
    resources.push({ uri: `${prefix}/${rel.split("/").map(encodeURIComponent).join("/")}`,
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, size: bytes.length });
  }
  return { uri: `${prefix}/SKILL.md`, frontmatter, resources };
}

let loggedSkillSummary = false;

async function skills() {
  const locations = await skillLocations();
  const result = [];
  const skipped: string[] = [];
  let builtIn = 0;
  for (const location of locations.sort((a, b) => (a.namespace + "/" + a.name).localeCompare(b.namespace + "/" + b.name))) {
    try {
      result.push(await skillEntry(location, locations));
      if (location.source === "builtin") builtIn++;
    } catch (error) {
      skipped.push(location.namespace + "/" + location.name + ": " + (error instanceof Error ? error.message : String(error)));
    }
  }
  if (!loggedSkillSummary) {
    loggedSkillSummary = true;
    console.error("[Terminal Toolkit] Skills: " + result.length + " available (" + builtIn + " built-in, " + (result.length - builtIn) + " external)" + (skipped.length ? ", " + skipped.length + " skipped" : "") + ".");
    for (const detail of skipped) console.error("[Terminal Toolkit] Skill skipped: " + detail);
    for (const warning of skillWarnings) console.error("[Terminal Toolkit] Skills warning: " + warning);
  }
  return result;
}

export async function logSkillsOnStartup(): Promise<void> {
  await skills();
}

export function registerSkills(server: Server): void {
  server.setRequestHandler(listRequest, async (request) => {
    if (request.params?.cursor) invalid("Unknown skills cursor");
    return { resultType: "complete" as const, skills: await skills(), ttlMs: 0, cacheScope: "public" as const };
  });
  server.setRequestHandler(getRequest, async ({ params }) => {
    const { name, namespace, relative } = await decodeSkillUri(params.uri);
    if (relative !== "SKILL.md") invalid("skills/get expects a SKILL.md URI");
    return { resultType: "complete" as const, skill: await skillEntry(await locateSkill(name, namespace)), ttlMs: 0, cacheScope: "public" as const };
  });
  server.setRequestHandler(readRequest, async ({ params }) => {
    const { name, namespace, relative } = await decodeSkillUri(params.uri);
    const bytes = await readFile(await secureFile(name, relative, namespace));
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
