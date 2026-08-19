import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { after } from "node:test";

import {
  COMPANION_ENV,
  buildCompanionArgs,
  run,
  scrapeImagePaths
} from "../scripts/run-imagegen.mjs";
import { FAKE_COMPANION, cleanupScratch, scratch } from "./helpers.mjs";

after(cleanupScratch);

function specFor(dest, overrides = {}) {
  return {
    mode: "generate",
    use_case: "product-mockup",
    assets: [{ dest, primary_request: "a minimal hero image of a ceramic coffee mug" }],
    ...overrides
  };
}

/** Runs against the fake companion and returns both our result and what the fake recorded. */
function runWithFake(spec, { mode = "success", create = [], projectRoot, ...options } = {}) {
  const workspace = projectRoot ?? scratch("codex-imagegen-ws-");
  const statePath = path.join(scratch("codex-imagegen-state-"), "state.json");

  const result = run({
    spec,
    projectRoot: workspace,
    promptDir: scratch("codex-imagegen-prompt-"),
    env: {
      ...process.env,
      [COMPANION_ENV]: FAKE_COMPANION,
      FAKE_COMPANION_STATE: statePath,
      FAKE_COMPANION_MODE: mode,
      FAKE_COMPANION_CREATE: create.join(",")
    },
    ...options
  });

  const recorded = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : null;
  return { result, recorded, workspace };
}

test("the companion is always called as: task --write --cwd <root> --prompt-file <abs>", () => {
  const args = buildCompanionArgs({
    companion: "C:/plugins/codex/scripts/codex-companion.mjs",
    projectRoot: "E:/proyecto",
    promptFile: "C:/tmp/prompt.txt"
  });

  assert.deepEqual(args, [
    "C:/plugins/codex/scripts/codex-companion.mjs",
    "task",
    "--write",
    "--cwd",
    "E:/proyecto",
    "--prompt-file",
    "C:/tmp/prompt.txt"
  ]);
});

test("--resume appends --resume-last so iteration reuses the Codex thread", () => {
  const args = buildCompanionArgs({
    companion: "c.mjs",
    projectRoot: "E:/p",
    promptFile: "p.txt",
    resume: true
  });
  assert.equal(args.at(-1), "--resume-last");
});

test("--write is never omitted -- without it Codex is read-only and cannot save into the repo", () => {
  const workspace = scratch("codex-imagegen-ws-");
  const dest = path.join(workspace, "hero.png");
  const { recorded } = runWithFake(specFor(dest), { create: [dest], projectRoot: workspace });

  assert.equal(recorded.subcommand, "task");
  assert.equal(recorded.write, true);
  assert.equal(recorded.resumeLast, false);
  assert.equal(path.resolve(recorded.cwd), path.resolve(workspace));
});

test("the prompt arrives verbatim: accents, quotes and newlines all survive the shell", () => {
  const workspace = scratch("codex-imagegen-ws-");
  const dest = path.join(workspace, "hero.png");
  const spec = specFor(dest);
  spec.assets[0].primary_request = 'un "jardín" de otoño; señalización & símbolos — 100% nítido';
  spec.assets[0].text_verbatim = 'Bienvenido "a casa"';

  const { result, recorded } = runWithFake(spec, { create: [dest], projectRoot: workspace });

  assert.equal(recorded.prompt, fs.readFileSync(result.promptFile, "utf8"));
  assert.ok(recorded.prompt.includes('un "jardín" de otoño; señalización & símbolos — 100% nítido'));
  assert.ok(recorded.prompt.includes('Text (verbatim): "Bienvenido "a casa""'));
  assert.equal(recorded.prompt.split("\n")[0], "$imagegen");
});

test("a saved image is reported with its real dimensions", () => {
  const workspace = scratch("codex-imagegen-ws-");
  const dest = path.join(workspace, "assets", "hero.png");
  const { result } = runWithFake(specFor(dest), { create: [dest], projectRoot: workspace });

  assert.equal(result.exitCode, 0);
  assert.equal(result.missing.length, 0);
  assert.equal(result.saved.length, 1);
  assert.equal(result.saved[0].width, 1);
  assert.equal(result.saved[0].height, 1);
});

test("a confident report with no file on disk is caught as missing", () => {
  const workspace = scratch("codex-imagegen-ws-");
  const dest = path.join(workspace, "hero.png");
  // mode "no-file": the companion claims success but writes nothing.
  const { result } = runWithFake(specFor(dest), { mode: "no-file", projectRoot: workspace });

  assert.equal(result.saved.length, 0);
  assert.deepEqual(result.missing, [dest]);
});

test("a file saved somewhere other than the destination is surfaced, not swallowed", () => {
  const workspace = scratch("codex-imagegen-ws-");
  const dest = path.join(workspace, "hero.png");
  const elsewhere = path.join(scratch("codex-home-"), "generated_images", "exec-1.png");
  const { result } = runWithFake(specFor(dest), { create: [elsewhere], projectRoot: workspace });

  assert.deepEqual(result.missing, [dest]);
  assert.equal(result.mentioned.length, 1);
  assert.match(result.mentioned[0], /exec-1\.png$/);
});

test("--dry-run builds everything and invokes nothing", () => {
  const workspace = scratch("codex-imagegen-ws-");
  const dest = path.join(workspace, "hero.png");
  const { result, recorded } = runWithFake(specFor(dest), { dryRun: true, projectRoot: workspace });

  assert.equal(recorded, null, "the companion must not have run at all");
  assert.equal(result.exitCode, null);
  assert.equal(result.dryRun, true);
  assert.ok(fs.existsSync(result.promptFile), "the prompt is still written so it can be reviewed");
  assert.ok(result.argv.includes("--write"));
});

test("a failing companion surfaces its exit code instead of being reported as success", () => {
  const workspace = scratch("codex-imagegen-ws-");
  const dest = path.join(workspace, "hero.png");
  const { result } = runWithFake(specFor(dest), { mode: "fail", projectRoot: workspace });

  assert.equal(result.exitCode, 1);
  assert.equal(result.saved.length, 0);
  assert.deepEqual(result.missing, [dest]);
});

test("an invalid spec fails before the companion is ever launched", () => {
  const workspace = scratch("codex-imagegen-ws-");
  assert.throws(
    () => runWithFake(specFor("relative/path.png"), { projectRoot: workspace }),
    /must be an absolute path/
  );
});

test("a missing companion override is reported rather than silently skipped", () => {
  assert.throws(
    () =>
      run({
        spec: specFor("E:/p/hero.png"),
        projectRoot: scratch("codex-imagegen-ws-"),
        promptDir: scratch("codex-imagegen-prompt-"),
        dryRun: true,
        env: { ...process.env, [COMPANION_ENV]: "E:/definitely/not/here.mjs" }
      }),
    /points at a missing file/
  );
});

test("scrapeImagePaths reads both markdown links and bare paths", () => {
  const stdout = [
    "Saved file: [hero.png](E:/proyecto/assets/hero.png)",
    "Also wrote C:/Users/x/.codex/generated_images/abc/exec-1.png for reference.",
    "Unix style: /home/u/out/pic.jpeg",
    "Not an image: E:/proyecto/notes.txt"
  ].join("\n");

  const found = scrapeImagePaths(stdout);

  assert.ok(found.includes("E:/proyecto/assets/hero.png"));
  assert.ok(found.includes("C:/Users/x/.codex/generated_images/abc/exec-1.png"));
  assert.ok(found.includes("/home/u/out/pic.jpeg"));
  assert.ok(!found.some((entry) => entry.endsWith(".txt")));
});
