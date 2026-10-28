#!/usr/bin/env node
// Shared CLI and plugin bootstrap: validate native dependencies before launching dist/index.js.
const { createRequire } = require("node:module");
const { spawn, spawnSync } = require("node:child_process");
const { readFileSync, existsSync, mkdirSync } = require("node:fs");
const path = require("node:path");

const root = __dirname;
const dist = path.join(root, "dist");
const entry = path.join(dist, "index.js");
const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const required = manifest.dependencies?.["node-pty"];
const optional = manifest.optionalDependencies?.["@resvg/resvg-js"];

if (!required || !existsSync(entry)) {
  console.error("terminal-toolkit: missing node-pty declaration or dist/index.js");
  process.exit(1);
}

const localRequire = createRequire(entry);
function ready(name, spec) {
  if (!spec) return false;
  try {
    // npm handles the declared version range; validate that the native API loads.
    const loaded = localRequire(name);
    return name === "node-pty"
      ? typeof loaded.spawn === "function"
      : typeof loaded.Resvg === "function";
  } catch (error) {
    console.error(`terminal-toolkit: ${name} could not be loaded: ${error.message}`);
    return false;
  }
}

function install(name, spec) {
  mkdirSync(dist, { recursive: true });
  console.error(`terminal-toolkit: installing ${name} in dist/node_modules...`);
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npm, [
    "install", "--prefix", dist, "--no-save", "--no-package-lock",
    "--omit=dev", "--no-audit", "--no-fund", "--ignore-scripts=false",
    `${name}@${spec}`
  ], { stdio: "inherit", shell: process.platform === "win32" });
  if (result.error) console.error(`terminal-toolkit: npm failed to start: ${result.error.message}`);
  else if (result.status !== 0) console.error(`terminal-toolkit: npm exited with status ${result.status}`);
  return !result.error && result.status === 0 && ready(name, spec);
}

if (!ready("node-pty", required) && !install("node-pty", required)) {
  console.error("terminal-toolkit: required node-pty installation or validation failed");
  process.exit(1);
}

// Optional SVG rasterization must not block MCP startup with an npm download.
// Users who need PNG screenshots can explicitly request the optional install.
if (optional && process.env.TERMINAL_TOOLKIT_INSTALL_OPTIONAL_RESVG === "1" && !ready("@resvg/resvg-js", optional)) {
  if (!install("@resvg/resvg-js", optional)) {
    console.error("terminal-toolkit: optional resvg unavailable; continuing without it");
  }
}

const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit"
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (error) => {
  console.error("terminal-toolkit: failed to launch MCP:", error);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
