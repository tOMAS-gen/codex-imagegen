#!/usr/bin/env node
/**
 * Stand-in for the real codex-companion.mjs.
 *
 * It records the exact argv it was invoked with and the verbatim contents of the
 * --prompt-file it was handed, so tests can assert the wire contract without
 * starting Codex or spending a generation.
 *
 * Driven entirely by env vars so the production code needs no test-only branches:
 *   FAKE_COMPANION_STATE   where to write the recording (required)
 *   FAKE_COMPANION_MODE    success | no-file | fail        (default: success)
 *   FAKE_COMPANION_CREATE  comma-separated files to create (mode=success only)
 */

import fs from "node:fs";
import path from "node:path";

const statePath = process.env.FAKE_COMPANION_STATE;
const mode = process.env.FAKE_COMPANION_MODE ?? "success";
const argv = process.argv.slice(2);

function flagValue(name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

const promptFile = flagValue("--prompt-file");
const state = {
  argv,
  subcommand: argv[0] ?? null,
  write: argv.includes("--write"),
  resumeLast: argv.includes("--resume-last"),
  cwd: flagValue("--cwd"),
  promptFile,
  prompt: promptFile && fs.existsSync(promptFile) ? fs.readFileSync(promptFile, "utf8") : null
};

if (statePath) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
}

if (mode === "fail") {
  process.stderr.write("fake-companion: Codex could not be invoked.\n");
  process.exit(1);
}

const created = (process.env.FAKE_COMPANION_CREATE ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

if (mode === "success") {
  for (const file of created) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // A 1x1 PNG: enough for the header-based inspection in run-imagegen.mjs.
    fs.writeFileSync(
      file,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64"
      )
    );
  }
}

// Mirror how Codex actually reports paths: prose plus a markdown link.
const report = created.length
  ? created.map((file) => `Saved file: [${path.basename(file)}](${file.replace(/\\/g, "/")})`).join("\n")
  : "Saved file: [nothing](nowhere.png)";
process.stdout.write(`Created with the built-in image generator.\n\n${report}\n`);
