import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(TESTS_DIR, "..");
export const FAKE_COMPANION = path.join(TESTS_DIR, "fixtures", "fake-companion.mjs");

const scratchDirs = [];

export function scratch(prefix = "codex-imagegen-test-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

export function cleanupScratch() {
  for (const dir of scratchDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function writeFile(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, "utf8");
  return file;
}

export function writeJson(file, value) {
  return writeFile(file, JSON.stringify(value, null, 2));
}

/**
 * Builds a fake ~/.claude tree. `where` picks which of the three resolution sources
 * actually holds a companion file, so tests can walk the fallback chain.
 */
export function fakeConfigDir({ where = [], versions = ["1.0.6"], installPathVersion = "1.0.6" } = {}) {
  const configDir = scratch("codex-imagegen-cfg-");
  const pluginsDir = path.join(configDir, "plugins");
  fs.mkdirSync(pluginsDir, { recursive: true });

  const cacheBase = path.join(pluginsDir, "cache", "openai-codex", "codex");
  const installPath = path.join(cacheBase, installPathVersion);
  const marketplaceBase = path.join(pluginsDir, "marketplaces", "openai-codex", "plugins", "codex");

  writeJson(path.join(pluginsDir, "known_marketplaces.json"), {
    "openai-codex": { source: { source: "github", repo: "openai/codex-plugin-cc" } }
  });

  if (where.includes("installed")) {
    writeJson(path.join(pluginsDir, "installed_plugins.json"), {
      version: 2,
      plugins: {
        "codex@openai-codex": [{ scope: "user", installPath, version: installPathVersion }]
      }
    });
    writeFile(path.join(installPath, "scripts", "codex-companion.mjs"), "// installed\n");
  } else if (where.includes("installed-record-only")) {
    // Recorded as installed, but the file is gone: exercises the fall-through.
    writeJson(path.join(pluginsDir, "installed_plugins.json"), {
      version: 2,
      plugins: {
        "codex@openai-codex": [{ scope: "user", installPath, version: installPathVersion }]
      }
    });
  }

  if (where.includes("cache")) {
    for (const version of versions) {
      writeFile(path.join(cacheBase, version, "scripts", "codex-companion.mjs"), `// cache ${version}\n`);
    }
  }

  if (where.includes("marketplace")) {
    writeFile(path.join(marketplaceBase, "scripts", "codex-companion.mjs"), "// marketplace\n");
  }

  return { configDir, pluginsDir, cacheBase, installPath, marketplaceBase };
}
