import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { skillLocations, skillEntry, skillCatalog } from "../src/skills.ts";

test("skill namespace comes from the parent of the skills directory", async () => {
  const base = await mkdtemp(join(tmpdir(), "tt-skills-"));
  try {
    const root = join(base, "mattpocock", "skills");
    await mkdir(join(root, "typescript"), { recursive: true });
    const result = await skillLocations([root]);
    assert.equal(result.length, 1);
    assert.equal(result[0].namespace, "skills/mattpocock");
    assert.equal(result[0].name, "typescript");
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("nested skills roots retain their path after the skills anchor", async () => {
  const base = await mkdtemp(join(tmpdir(), "tt-skills-nested-"));
  try {
    const roots = ["engineering", "productivity"].map(part => join(base, "mattpocock", "skills", part));
    for (const root of roots) {
      await mkdir(join(root, "shared"), { recursive: true });
      await writeFile(join(root, "shared", "SKILL.md"), "---\nname: shared\ndescription: Example\n---\n");
    }
    const locations = await skillLocations(roots);
    assert.deepEqual(locations.map(x => x.namespace), ["skills/mattpocock/engineering", "skills/mattpocock/productivity"]);
    const entries = await Promise.all(locations.map(location => skillEntry(location, locations)));
    assert.deepEqual(entries.map(x => x.uri), ["skill://mattpocock/engineering/shared/SKILL.md", "skill://mattpocock/productivity/shared/SKILL.md"]);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("roots without skills anchor use their basename", async () => {
  const base = await mkdtemp(join(tmpdir(), "tt-skills-fallback-"));
  try {
    const root = join(base, "my-agents");
    await mkdir(join(root, "demo"), { recursive: true });
    assert.equal((await skillLocations([root]))[0].namespace, "skills/my-agents");
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("identically named skills in separate namespaces retain distinct SEP URIs", async () => {
  const base = await mkdtemp(join(tmpdir(), "tt-skills-duplicate-"));
  try {
    const first = join(base, "alpha", "skills");
    const second = join(base, "beta", "skills");
    for (const root of [first, second]) {
      await mkdir(join(root, "shared"), { recursive: true });
      await writeFile(join(root, "shared", "SKILL.md"), "---\nname: shared\ndescription: Example\n---\n");
    }
    const locations = await skillLocations([first, second]);
    const entries = await Promise.all(locations.map(location => skillEntry(location, locations)));
    assert.deepEqual(entries.map(x => x.uri), ["skill://alpha/shared/SKILL.md", "skill://beta/shared/SKILL.md"]);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("discovery and SEP reject the same malformed skill metadata", async () => {
  const base = await mkdtemp(join(tmpdir(), "tt-skills-invalid-"));
  const root = join(base, "source", "skills");
  try {
    await mkdir(join(root, "invalid"), { recursive: true });
    await writeFile(join(root, "invalid", "SKILL.md"), "---\nname: wrong\ndescription: Example\n---\n");
    const locations = await skillLocations([root]);
    assert.deepEqual(await skillCatalog([root]), []);
    await assert.rejects(skillEntry(locations[0], locations), /Invalid skill frontmatter/);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("namespace conflicts warn and retain only the first source", async () => {
  const base = await mkdtemp(join(tmpdir(), "tt-skills-conflict-"));
  const first = join(base, "a", "same", "skills");
  const second = join(base, "b", "same", "skills");
  const warnings: string[] = [];
  const original = console.error;
  try {
    await mkdir(join(first, "alpha"), { recursive: true });
    await mkdir(join(second, "beta"), { recursive: true });
    console.error = (...args: unknown[]) => { warnings.push(args.join(" ")); };
    const result = await skillLocations([first, second]);
    assert.deepEqual(result.map(x => x.name), ["alpha"]);
    assert.match(warnings.join("\n"), /Skill namespace conflict skills\/same/);
    assert.ok(warnings.join("\n").includes(first));
    assert.ok(warnings.join("\n").includes(second));
  } finally {
    console.error = original;
    await rm(base, { recursive: true, force: true });
  }
});
