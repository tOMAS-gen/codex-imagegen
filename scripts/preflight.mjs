#!/usr/bin/env node
/**
 * Detects the Claude Code -> Codex bridge and resolves the companion script path.
 *
 * Detection only: this script never installs anything. Remediation commands are
 * emitted so the caller can run them where the user can see and approve them.
 *
 * Usage:  node scripts/preflight.mjs [--json]
 * Output: JSON on stdout. Exit code is always 0 -- read `ok`, not the status.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const MARKETPLACE = "openai-codex";
export const MARKETPLACE_REPO = "openai/codex-plugin-cc";
export const PLUGIN_ID = `codex@${MARKETPLACE}`;
export const COMPANION_RELATIVE = path.join("scripts", "codex-companion.mjs");

export function resolveConfigDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** Newest-first semver-ish sort. Non-numeric segments sort after numeric ones. */
function compareVersionsDesc(a, b) {
  const partsA = a.split(/[.-]/);
  const partsB = b.split(/[.-]/);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i += 1) {
    const rawA = partsA[i];
    const rawB = partsB[i];
    if (rawA === undefined) return 1;
    if (rawB === undefined) return -1;
    const numA = Number.parseInt(rawA, 10);
    const numB = Number.parseInt(rawB, 10);
    const bothNumeric = Number.isFinite(numA) && Number.isFinite(numB);
    if (bothNumeric && numA !== numB) return numB - numA;
    if (!bothNumeric && rawA !== rawB) return rawA < rawB ? 1 : -1;
  }
  return 0;
}

export function detectCodex(env = process.env) {
  // Single command string + shell:true. Passing an args array alongside shell:true
  // triggers DEP0190, and on Windows `codex` is a .cmd that cannot spawn without a shell.
  const result = spawnSync("codex --version", { encoding: "utf8", shell: true, env });
  const found = result.status === 0;
  return {
    found,
    version: found ? String(result.stdout ?? "").trim() || null : null
  };
}

/**
 * Finds a usable Python interpreter for the CLI route (masks and other CLI-only controls).
 *
 * On Windows, bare `python`/`python3` are usually the Microsoft Store alias stubs: they
 * exist on PATH, print an install advert and exit non-zero. Probing with real code and
 * requiring both exit 0 and non-empty output filters those out; `py` is the real launcher.
 */
export function detectPython(env = process.env) {
  const candidates =
    process.platform === "win32" ? ["py -3", "python", "python3"] : ["python3", "python"];
  for (const command of candidates) {
    const probe = spawnSync(`${command} -c "import sys; print(sys.executable)"`, {
      encoding: "utf8",
      shell: true,
      env
    });
    const executable = String(probe.stdout ?? "").trim();
    if (probe.status !== 0 || !executable) continue;

    const pillow = spawnSync(`${command} -c "import PIL; print(PIL.__version__)"`, {
      encoding: "utf8",
      shell: true,
      env
    });
    return {
      found: true,
      command,
      executable,
      pillow: pillow.status === 0 ? String(pillow.stdout ?? "").trim() || true : false
    };
  }
  return { found: false, command: null, executable: null, pillow: false };
}

/**
 * Resolution order, most authoritative first:
 *   1. installPath recorded in installed_plugins.json
 *   2. plugins/cache/<marketplace>/codex/<version>/  (highest version)
 *   3. the marketplace checkout itself
 */
export function resolveCompanion(configDir) {
  const attempts = [];
  const pluginsDir = path.join(configDir, "plugins");

  const installed = readJson(path.join(pluginsDir, "installed_plugins.json"));
  const entries = installed?.plugins?.[PLUGIN_ID] ?? [];
  for (const entry of entries) {
    if (!entry?.installPath) continue;
    const candidate = path.join(entry.installPath, COMPANION_RELATIVE);
    attempts.push({ source: "installed_plugins.json", path: candidate, exists: isFile(candidate) });
    if (isFile(candidate)) {
      return { path: candidate, exists: true, source: "installed_plugins.json", attempts };
    }
  }

  const cacheDir = path.join(pluginsDir, "cache", MARKETPLACE, "codex");
  let versions = [];
  try {
    versions = fs
      .readdirSync(cacheDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(compareVersionsDesc);
  } catch {
    versions = [];
  }
  for (const version of versions) {
    const candidate = path.join(cacheDir, version, COMPANION_RELATIVE);
    attempts.push({ source: "cache", path: candidate, exists: isFile(candidate) });
    if (isFile(candidate)) {
      return { path: candidate, exists: true, source: "cache", attempts };
    }
  }

  const marketplaceCandidate = path.join(
    pluginsDir,
    "marketplaces",
    MARKETPLACE,
    "plugins",
    "codex",
    COMPANION_RELATIVE
  );
  attempts.push({
    source: "marketplace",
    path: marketplaceCandidate,
    exists: isFile(marketplaceCandidate)
  });
  if (isFile(marketplaceCandidate)) {
    return { path: marketplaceCandidate, exists: true, source: "marketplace", attempts };
  }

  return { path: null, exists: false, source: null, attempts };
}

export function preflight({ configDir = resolveConfigDir(), env = process.env } = {}) {
  const pluginsDir = path.join(configDir, "plugins");

  const codex = detectCodex(env);
  const python = detectPython(env);

  const known = readJson(path.join(pluginsDir, "known_marketplaces.json")) ?? {};
  const marketplace = { known: Object.hasOwn(known, MARKETPLACE) };

  const installed = readJson(path.join(pluginsDir, "installed_plugins.json"));
  const pluginEntries = installed?.plugins?.[PLUGIN_ID] ?? [];
  const plugin = {
    id: PLUGIN_ID,
    installed: pluginEntries.length > 0,
    version: pluginEntries[0]?.version ?? null
  };

  const companion = resolveCompanion(configDir);

  const remediation = [];
  if (!codex.found) {
    remediation.push({
      why: "The Codex CLI is not on PATH.",
      run: "npm install -g @openai/codex",
      then: "codex login"
    });
  }
  if (!marketplace.known) {
    remediation.push({
      why: `The ${MARKETPLACE} marketplace is not registered.`,
      run: `claude plugin marketplace add ${MARKETPLACE_REPO}`
    });
  }
  if (!plugin.installed) {
    remediation.push({
      why: `The ${PLUGIN_ID} plugin is not installed.`,
      run: `claude plugin install ${PLUGIN_ID}`
    });
  }
  if (plugin.installed && !companion.exists) {
    remediation.push({
      why: "The plugin registers as installed but codex-companion.mjs was not found on disk.",
      run: `claude plugin uninstall ${PLUGIN_ID} && claude plugin install ${PLUGIN_ID}`
    });
  }

  return {
    ok: codex.found && companion.exists,
    configDir,
    codex,
    python,
    marketplace,
    plugin,
    companion,
    remediation
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(preflight(), null, 2));
}
