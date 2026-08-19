#!/usr/bin/env node
/**
 * Runs one image request end to end: preflight -> build prompt -> invoke the Codex companion.
 *
 * The companion call is always the same shape, and that shape matters:
 *   node <companion> task --write --cwd <projectRoot> --prompt-file <abs> [--resume-last]
 *
 * --write is mandatory. Without it Codex runs in a read-only sandbox and physically cannot
 * leave the image in the repo. --prompt-file is what lets a multi-line prompt with quotes and
 * accents survive a Windows shell: the companion reads the file verbatim.
 *
 * Usage:
 *   node scripts/run-imagegen.mjs --spec spec.json [--cwd <projectRoot>] [--dry-run] [--resume]
 *   node scripts/run-imagegen.mjs --prompt-file prompt.txt --cwd <projectRoot>
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { preflight } from "./preflight.mjs";
import { buildPrompt, SpecError } from "./build-prompt.mjs";

export const DEFAULT_TIMEOUT_MS = 600_000;

/** Test hook: point at a fake companion instead of resolving the installed plugin. */
export const COMPANION_ENV = "CODEX_IMAGEGEN_COMPANION";

class RunError extends Error {}

export function buildCompanionArgs({ companion, projectRoot, promptFile, resume = false }) {
  const args = [companion, "task", "--write", "--cwd", projectRoot, "--prompt-file", promptFile];
  if (resume) args.push("--resume-last");
  return args;
}

/** Minimal PNG header read, so verification can report real dimensions without a dependency. */
function inspectImage(file) {
  try {
    const stats = fs.statSync(file);
    if (!stats.isFile()) return null;
    const info = { path: file, bytes: stats.size, width: null, height: null };
    const handle = fs.openSync(file, "r");
    try {
      const header = Buffer.alloc(24);
      fs.readSync(handle, header, 0, 24, 0);
      if (header.slice(1, 4).toString("latin1") === "PNG") {
        info.width = header.readUInt32BE(16);
        info.height = header.readUInt32BE(20);
      }
    } finally {
      fs.closeSync(handle);
    }
    return info;
  } catch {
    return null;
  }
}

/**
 * Codex reports paths in prose and as markdown links, e.g.
 *   Final path: [E:\repo\a.png](E:/repo/a.png)
 * so scrape both shapes rather than trusting one.
 */
export function scrapeImagePaths(stdout) {
  const found = new Set();
  const patterns = [
    /\]\(([^)\s]+\.(?:png|jpe?g|webp))\)/gi,
    /(?:^|[\s"'`([])((?:[A-Za-z]:[\\/]|\/)[^\s"'`)\]]+\.(?:png|jpe?g|webp))/gi
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(stdout)) !== null) {
      found.add(match[1].replace(/\\\\/g, "\\"));
    }
  }
  return [...found];
}

function normalise(candidate) {
  return path.resolve(candidate).replace(/\\/g, "/").toLowerCase();
}

export function resolveCompanion(env = process.env) {
  const override = env[COMPANION_ENV];
  if (override) {
    if (!fs.existsSync(override)) {
      throw new RunError(`${COMPANION_ENV} points at a missing file: ${override}`);
    }
    return { path: override, source: "env", report: null };
  }

  const report = preflight({ env });
  if (!report.ok || !report.companion.exists) {
    const steps = report.remediation.map((item) => `  - ${item.why}\n      ${item.run}`).join("\n");
    throw new RunError(
      "The Claude Code -> Codex bridge is not ready.\n" +
        (steps || "  - codex-companion.mjs could not be located.") +
        "\nRun `node scripts/preflight.mjs` for the full report."
    );
  }
  return { path: report.companion.path, source: report.companion.source, report };
}

export function run(options) {
  const {
    spec = null,
    promptText = null,
    projectRoot = process.cwd(),
    dryRun = false,
    resume = false,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    env = process.env,
    promptDir = null
  } = options;

  if (!spec && !promptText) throw new RunError("Provide either a spec or prompt text.");

  const built = spec ? buildPrompt(spec) : { text: promptText, warnings: [], spec: null };
  const expected = built.spec ? built.spec.assets.map((asset) => asset.dest) : [];

  const outDir = promptDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "codex-imagegen-"));
  fs.mkdirSync(outDir, { recursive: true });
  const promptFile = path.join(outDir, "prompt.txt");
  fs.writeFileSync(promptFile, built.text, "utf8");

  const companion = resolveCompanion(env);
  const args = buildCompanionArgs({
    companion: companion.path,
    projectRoot: path.resolve(projectRoot),
    promptFile,
    resume
  });

  const result = {
    dryRun,
    companion: companion.path,
    companionSource: companion.source,
    promptFile,
    argv: [process.execPath, ...args],
    warnings: built.warnings,
    expected,
    exitCode: null,
    stdout: null,
    saved: [],
    missing: [],
    mentioned: []
  };

  if (dryRun) return result;

  const child = spawnSync(process.execPath, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    timeout: timeoutMs,
    env
  });

  result.exitCode = child.status;
  result.stdout = child.stdout ?? "";

  if (child.error) {
    throw new RunError(`Failed to invoke the companion: ${child.error.message}`);
  }

  const mentioned = scrapeImagePaths(result.stdout);
  const expectedKeys = new Set(expected.map(normalise));
  result.saved = expected.map(inspectImage).filter(Boolean);
  result.missing = expected.filter((dest) => !inspectImage(dest));
  result.mentioned = mentioned.filter((candidate) => !expectedKeys.has(normalise(candidate)));

  return result;
}

function parseArgs(argv) {
  const options = {
    spec: null,
    promptFile: null,
    cwd: process.cwd(),
    dryRun: false,
    resume: false,
    json: false,
    promptDir: null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--spec") options.spec = argv[++i];
    else if (token === "--prompt-file") options.promptFile = argv[++i];
    else if (token === "--cwd" || token === "-C") options.cwd = argv[++i];
    else if (token === "--prompt-dir") options.promptDir = argv[++i];
    else if (token === "--dry-run") options.dryRun = true;
    else if (token === "--resume") options.resume = true;
    else if (token === "--json") options.json = true;
    else throw new RunError(`Unknown flag: ${token}`);
  }
  return options;
}

function renderReport(result) {
  const lines = [];
  for (const warning of result.warnings) lines.push(`[warn] ${warning}`);
  lines.push(`companion: ${result.companion} (${result.companionSource})`);
  lines.push(`prompt file: ${result.promptFile}`);
  if (result.dryRun) {
    lines.push("dry run: nothing was invoked. Command that would run:");
    lines.push(`  ${result.argv.map((token) => (/\s/.test(token) ? `"${token}"` : token)).join(" ")}`);
    return lines.join("\n");
  }
  lines.push(`exit code: ${result.exitCode}`);
  for (const image of result.saved) {
    const dims = image.width ? `${image.width}x${image.height}` : "unknown size";
    lines.push(`saved: ${image.path} (${dims}, ${image.bytes} bytes)`);
  }
  for (const missing of result.missing) {
    lines.push(`MISSING: ${missing} — Codex did not leave a file at the requested destination.`);
  }
  for (const other of result.mentioned) {
    lines.push(`also mentioned: ${other}`);
  }
  if (result.missing.length > 0) {
    lines.push(
      "Do not report success. Move the file from the path Codex reported, or re-run — but never",
      "substitute an SVG/HTML placeholder for a missing image."
    );
  }
  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options.spec && !options.promptFile) {
      throw new RunError("Provide --spec <file> or --prompt-file <file>.");
    }
    const result = run({
      spec: options.spec ? JSON.parse(fs.readFileSync(options.spec, "utf8")) : null,
      promptText: options.promptFile ? fs.readFileSync(options.promptFile, "utf8") : null,
      projectRoot: options.cwd,
      dryRun: options.dryRun,
      resume: options.resume,
      promptDir: options.promptDir
    });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (result.stdout) process.stdout.write(result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`);
      console.log(renderReport(result));
    }
    if (result.exitCode !== null && result.exitCode !== 0) process.exitCode = result.exitCode;
    else if (result.missing.length > 0) process.exitCode = 3;
  } catch (error) {
    const label = error instanceof SpecError ? "Invalid spec" : error instanceof RunError ? "Cannot run" : "Error";
    process.stderr.write(`${label}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
