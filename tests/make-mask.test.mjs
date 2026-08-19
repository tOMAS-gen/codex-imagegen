import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test, { after } from "node:test";

import { detectPython } from "../scripts/preflight.mjs";
import { REPO_ROOT, cleanupScratch, scratch } from "./helpers.mjs";

after(cleanupScratch);

const python = detectPython();
const MAKE_MASK = path.join(REPO_ROOT, "scripts", "make_mask.py");

// Pillow drives both the script and its verification, so skip cleanly when it is absent
// rather than failing a machine that simply has no Python toolchain.
const skip = !python.found
  ? "no Python interpreter found"
  : !python.pillow
    ? "Pillow is not installed (uv pip install pillow)"
    : false;

function py(args) {
  return spawnSync(`${python.command} ${args}`, { encoding: "utf8", shell: true, cwd: REPO_ROOT });
}

function makeMask(args) {
  return py(`"${MAKE_MASK}" ${args}`);
}

/** Runs a Python snippet from a temp file: no shell quoting, no one-liner contortions. */
function runPython(snippet) {
  const file = path.join(scratch("pysnip-"), "snippet.py");
  fs.writeFileSync(file, snippet, "utf8");
  return py(`"${file}"`);
}

/** Reads the mask's alpha at fractional coordinates so assertions stay resolution-independent. */
function probe(maskPath, sourcePath, points) {
  const coords = points.map(([fx, fy]) => `(${fx}, ${fy})`).join(", ");
  const result = runPython(
    [
      "import json",
      "from PIL import Image",
      `mask = Image.open(r"${maskPath}")`,
      `source = Image.open(r"${sourcePath}")`,
      "alpha = mask.split()[-1]",
      "w, h = mask.size",
      `points = [${coords}]`,
      "samples = [alpha.getpixel((min(int(w * fx), w - 1), min(int(h * fy), h - 1))) for fx, fy in points]",
      "print(json.dumps({",
      '    "size_match": mask.size == source.size,',
      '    "mode": mask.mode,',
      '    "size": list(mask.size),',
      '    "alpha": samples,',
      "}))"
    ].join("\n")
  );
  assert.equal(result.status, 0, `probe failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function sourceImage(dir, name = "source.png", size = [400, 300]) {
  const file = path.join(dir, name);
  const result = runPython(
    ["from PIL import Image", `Image.new("RGB", (${size[0]}, ${size[1]}), (12, 34, 56)).save(r"${file}")`].join("\n")
  );
  assert.equal(result.status, 0, `could not create source image: ${result.stderr}`);
  return file;
}

test("a rect mask matches the source size and clears alpha only inside the rect", { skip }, () => {
  const dir = scratch("mask-");
  const source = sourceImage(dir);
  const mask = path.join(dir, "mask.png");

  const result = makeMask(`--image "${source}" --out "${mask}" --rect 0,60%,100%,100%`);
  assert.equal(result.status, 0, result.stderr);

  const report = JSON.parse(result.stdout);
  assert.equal(report.size.width, 400);
  assert.equal(report.size.height, 300);
  assert.ok(Math.abs(report.editable_fraction - 0.4) < 0.02, `got ${report.editable_fraction}`);

  const probed = probe(mask, source, [[0.5, 0.1], [0.5, 0.8]]);
  assert.equal(probed.size_match, true);
  assert.equal(probed.mode, "RGBA");
  assert.equal(probed.alpha[0], 255, "the preserved top must stay opaque");
  assert.equal(probed.alpha[1], 0, "the editable bottom must have alpha 0");
});

test("--invert flips which side is editable", { skip }, () => {
  const dir = scratch("mask-");
  const source = sourceImage(dir);
  const mask = path.join(dir, "mask.png");

  const result = makeMask(`--image "${source}" --out "${mask}" --rect 0,60%,100%,100% --invert`);
  assert.equal(result.status, 0, result.stderr);

  const probed = probe(mask, source, [[0.5, 0.1], [0.5, 0.8]]);
  assert.equal(probed.alpha[0], 0, "with --invert the top becomes editable");
  assert.equal(probed.alpha[1], 255, "with --invert the bottom is preserved");
});

test("an ellipse covers the area geometry predicts", { skip }, () => {
  const dir = scratch("mask-");
  const source = sourceImage(dir, "source.png", [400, 400]);
  const mask = path.join(dir, "mask.png");

  const result = makeMask(`--image "${source}" --out "${mask}" --ellipse 50%,50%,25%,25%`);
  assert.equal(result.status, 0, result.stderr);

  // pi * 0.25^2 = 0.1963 of the frame.
  const report = JSON.parse(result.stdout);
  assert.ok(Math.abs(report.editable_fraction - 0.1963) < 0.01, `got ${report.editable_fraction}`);

  const probed = probe(mask, source, [[0.5, 0.5], [0.05, 0.05]]);
  assert.equal(probed.alpha[0], 0, "the ellipse centre is editable");
  assert.equal(probed.alpha[1], 255, "the corner is outside the ellipse");
});

test("regions are additive across repeated flags", { skip }, () => {
  const dir = scratch("mask-");
  const source = sourceImage(dir, "source.png", [400, 400]);
  const mask = path.join(dir, "mask.png");

  const result = makeMask(
    `--image "${source}" --out "${mask}" --rect 0,0,25%,25% --rect 75%,75%,100%,100%`
  );
  assert.equal(result.status, 0, result.stderr);

  const report = JSON.parse(result.stdout);
  assert.ok(Math.abs(report.editable_fraction - 0.125) < 0.01, `got ${report.editable_fraction}`);

  const probed = probe(mask, source, [[0.1, 0.1], [0.9, 0.9], [0.5, 0.5]]);
  assert.deepEqual(probed.alpha, [0, 0, 255]);
});

test("refuses to guess when no region is given", { skip }, () => {
  const dir = scratch("mask-");
  const source = sourceImage(dir);
  const result = makeMask(`--image "${source}" --out "${path.join(dir, "mask.png")}"`);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no region given/);
});

test("refuses a non-png output, which would drop the alpha channel", { skip }, () => {
  const dir = scratch("mask-");
  const source = sourceImage(dir);
  const result = makeMask(`--image "${source}" --out "${path.join(dir, "mask.jpg")}" --rect 0,0,10,10`);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be a \.png/);
});

test("refuses to overwrite an existing mask without --force", { skip }, () => {
  const dir = scratch("mask-");
  const source = sourceImage(dir);
  const mask = path.join(dir, "mask.png");

  assert.equal(makeMask(`--image "${source}" --out "${mask}" --rect 0,0,10,10`).status, 0);

  const second = makeMask(`--image "${source}" --out "${mask}" --rect 0,0,10,10`);
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /already exists/);

  assert.equal(makeMask(`--image "${source}" --out "${mask}" --rect 0,0,10,10 --force`).status, 0);
});

test("reports a missing source image instead of writing a bogus mask", { skip }, () => {
  const dir = scratch("mask-");
  const result = makeMask(`--image "${path.join(dir, "nope.png")}" --out "${path.join(dir, "m.png")}" --rect 0,0,1,1`);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source image not found/);
});
