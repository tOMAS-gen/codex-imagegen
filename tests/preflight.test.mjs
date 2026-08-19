import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { after } from "node:test";

import { preflight, resolveCompanion, resolveConfigDir, PLUGIN_ID } from "../scripts/preflight.mjs";
import { cleanupScratch, fakeConfigDir } from "./helpers.mjs";

after(cleanupScratch);

test("resolveConfigDir honours CLAUDE_CONFIG_DIR", () => {
  assert.equal(resolveConfigDir({ CLAUDE_CONFIG_DIR: "D:/custom/.claude" }), "D:/custom/.claude");
  assert.match(resolveConfigDir({}), /[\\/]\.claude$/);
});

test("prefers the installPath recorded in installed_plugins.json", () => {
  const { configDir, installPath } = fakeConfigDir({ where: ["installed", "cache", "marketplace"] });
  const resolved = resolveCompanion(configDir);

  assert.equal(resolved.exists, true);
  assert.equal(resolved.source, "installed_plugins.json");
  assert.equal(resolved.path, path.join(installPath, "scripts", "codex-companion.mjs"));
});

test("falls through to the plugin cache when the recorded installPath is gone", () => {
  const { configDir, cacheBase } = fakeConfigDir({
    where: ["installed-record-only", "cache", "marketplace"],
    versions: ["1.0.6"],
    installPathVersion: "9.9.9"
  });
  const resolved = resolveCompanion(configDir);

  assert.equal(resolved.source, "cache");
  assert.equal(resolved.path, path.join(cacheBase, "1.0.6", "scripts", "codex-companion.mjs"));
  // The dead installPath was tried first and recorded as a miss.
  assert.equal(resolved.attempts[0].source, "installed_plugins.json");
  assert.equal(resolved.attempts[0].exists, false);
});

test("picks the highest cached version, not lexical order", () => {
  const { configDir, cacheBase } = fakeConfigDir({
    where: ["cache"],
    versions: ["1.0.9", "1.0.10", "0.9.0"]
  });
  const resolved = resolveCompanion(configDir);

  assert.equal(resolved.path, path.join(cacheBase, "1.0.10", "scripts", "codex-companion.mjs"));
});

test("falls back to the marketplace checkout as a last resort", () => {
  const { configDir, marketplaceBase } = fakeConfigDir({ where: ["marketplace"] });
  const resolved = resolveCompanion(configDir);

  assert.equal(resolved.source, "marketplace");
  assert.equal(resolved.path, path.join(marketplaceBase, "scripts", "codex-companion.mjs"));
});

test("reports not-found instead of guessing when nothing is on disk", () => {
  const { configDir } = fakeConfigDir({ where: [] });
  const resolved = resolveCompanion(configDir);

  assert.equal(resolved.exists, false);
  assert.equal(resolved.path, null);
  assert.equal(resolved.attempts.at(-1).source, "marketplace");
});

test("emits the install command when the plugin is absent", () => {
  const { configDir } = fakeConfigDir({ where: [] });
  const report = preflight({ configDir });

  assert.equal(report.ok, false);
  assert.equal(report.plugin.installed, false);
  assert.equal(report.marketplace.known, true);

  const commands = report.remediation.map((item) => item.run);
  assert.ok(
    commands.includes(`claude plugin install ${PLUGIN_ID}`),
    `expected an install command, got ${JSON.stringify(commands)}`
  );
  // The marketplace is registered in the fixture, so do not tell the user to add it again.
  assert.ok(!commands.some((command) => command.includes("marketplace add")));
});

test("emits the marketplace command when the marketplace is unknown", () => {
  const { configDir, pluginsDir } = fakeConfigDir({ where: [] });
  // Drop the marketplace registry entirely.
  fs.rmSync(path.join(pluginsDir, "known_marketplaces.json"));

  const report = preflight({ configDir });
  const commands = report.remediation.map((item) => item.run);

  assert.equal(report.marketplace.known, false);
  assert.ok(commands.some((command) => command.includes("marketplace add openai/codex-plugin-cc")));
});

test("reports a reinstall when the plugin registers but the file vanished", () => {
  const { configDir } = fakeConfigDir({ where: ["installed-record-only"] });
  const report = preflight({ configDir });

  assert.equal(report.plugin.installed, true);
  assert.equal(report.companion.exists, false);
  assert.equal(report.ok, false);
  assert.match(report.remediation.at(-1).run, /uninstall .* && .*install/);
});
