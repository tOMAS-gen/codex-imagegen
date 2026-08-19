#!/usr/bin/env node
/**
 * Turns a request spec (JSON) into the exact prompt text Codex must receive.
 *
 * This module owns the mechanical half of the contract so the skill body does not
 * have to restate it in prose: `$imagegen` on line 1, a valid taxonomy slug,
 * absolute destinations, an explicit output contract, and a hard wall between
 * built-in fields and CLI-only fields.
 *
 * Usage:
 *   node scripts/build-prompt.mjs --spec spec.json [--out prompt.txt]
 *   cat spec.json | node scripts/build-prompt.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const GENERATE_USE_CASES = [
  "photorealistic-natural",
  "product-mockup",
  "ui-mockup",
  "infographic-diagram",
  "scientific-educational",
  "ads-marketing",
  "productivity-visual",
  "logo-brand",
  "illustration-story",
  "stylized-concept",
  "historical-scene"
];

export const EDIT_USE_CASES = [
  "text-localization",
  "identity-preserve",
  "precise-object-edit",
  "lighting-weather",
  "background-extraction",
  "style-transfer",
  "compositing",
  "sketch-to-render"
];

export const USE_CASES = [...GENERATE_USE_CASES, ...EDIT_USE_CASES];

/** Fields the built-in image_gen tool does not accept. They belong to the CLI route only. */
export const CLI_ONLY_FIELDS = [
  "model",
  "quality",
  "size",
  "input_fidelity",
  "background",
  "output_format",
  "output_compression",
  "moderation"
];

/** One foreground run is capped at 600s; past this many images, split the work. */
export const BATCH_SOFT_LIMIT = 4;

export const IMAGE_GEN_CLI = '"$CODEX_HOME/skills/.system/imagegen/scripts/image_gen.py"';

export class SpecError extends Error {}

function fail(message) {
  throw new SpecError(message);
}

function isAbsolutePath(value) {
  return typeof value === "string" && (path.win32.isAbsolute(value) || path.posix.isAbsolute(value));
}

function labelled(label, value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? label + ": " + text : null;
}

export function validateSpec(rawSpec) {
  if (!rawSpec || typeof rawSpec !== "object" || Array.isArray(rawSpec)) {
    fail("Spec must be a JSON object.");
  }

  const mode = rawSpec.mode ?? "generate";
  if (!["generate", "edit", "batch"].includes(mode)) {
    fail('mode must be "generate", "edit" or "batch" (got ' + JSON.stringify(rawSpec.mode) + ").");
  }

  const route = rawSpec.route ?? "builtin";
  if (!["builtin", "cli"].includes(route)) {
    fail('route must be "builtin" or "cli" (got ' + JSON.stringify(rawSpec.route) + ").");
  }

  const useCase = rawSpec.use_case;
  if (!USE_CASES.includes(useCase)) {
    fail(
      "use_case " +
        JSON.stringify(useCase) +
        " is not in the imagegen taxonomy. Valid values: " +
        USE_CASES.join(", ") +
        "."
    );
  }
  const expected = mode === "edit" ? EDIT_USE_CASES : GENERATE_USE_CASES;
  if (!expected.includes(useCase)) {
    fail(
      'use_case "' +
        useCase +
        '" belongs to the ' +
        (mode === "edit" ? "generate" : "edit") +
        ' family but mode is "' +
        mode +
        '". Valid for this mode: ' +
        expected.join(", ") +
        "."
    );
  }

  const assets = rawSpec.assets;
  if (!Array.isArray(assets) || assets.length === 0) {
    fail("assets must be a non-empty array.");
  }
  if (mode === "batch" && assets.length < 2) {
    fail('mode "batch" needs at least 2 assets. Use mode "generate" for a single asset.');
  }
  if (mode !== "batch" && assets.length > 1) {
    fail('mode "' + mode + '" takes exactly 1 asset; got ' + assets.length + '. Use mode "batch" instead.');
  }

  const seen = new Set();
  assets.forEach((asset, index) => {
    const at = "assets[" + index + "]";
    if (!asset || typeof asset !== "object") fail(at + " must be an object.");
    if (!isAbsolutePath(asset.dest)) {
      fail(at + ".dest must be an absolute path (got " + JSON.stringify(asset.dest) + ").");
    }
    const key = asset.dest.replace(/\\/g, "/").toLowerCase();
    if (seen.has(key)) fail(at + ".dest duplicates an earlier destination: " + asset.dest);
    seen.add(key);

    if (typeof asset.primary_request !== "string" || !asset.primary_request.trim()) {
      fail(at + ".primary_request is required.");
    }

    const variants = asset.variants ?? 1;
    if (!Number.isInteger(variants) || variants < 1 || variants > 10) {
      fail(at + ".variants must be an integer between 1 and 10 (got " + JSON.stringify(variants) + ").");
    }

    for (const reference of asset.references ?? []) {
      if (!isAbsolutePath(reference?.path)) {
        fail(at + ".references[].path must be an absolute path (got " + JSON.stringify(reference?.path) + ").");
      }
    }

    for (const field of CLI_ONLY_FIELDS) {
      if (field in asset) {
        fail(
          at +
            "." +
            field +
            ' is a CLI-only control and must not sit on an asset. Put it in the top-level "cli" block and set route:"cli".'
        );
      }
    }
  });

  const edit = rawSpec.edit ?? null;
  if (mode === "edit") {
    if (!edit) fail('mode "edit" requires an "edit" block.');
    if (!isAbsolutePath(edit.target)) {
      fail("edit.target must be an absolute path (got " + JSON.stringify(edit?.target) + ").");
    }
    if (!edit.invariants || !String(edit.invariants).trim()) {
      fail(
        "edit.invariants is required: state what must NOT change, or the model will drift " +
          '(e.g. "change only the background; keep the product and its edges unchanged").'
      );
    }
  } else if (edit) {
    fail('an "edit" block is only valid with mode "edit" (mode is "' + mode + '").');
  }

  if (edit?.mask !== undefined) {
    if (route !== "cli") {
      fail(
        'edit.mask requires route:"cli". The built-in image_gen tool does not support masks; ' +
          "--mask exists only on the CLI fallback (image_gen.py edit)."
      );
    }
    if (!isAbsolutePath(edit.mask)) {
      fail("edit.mask must be an absolute path (got " + JSON.stringify(edit.mask) + ").");
    }
  }

  const cli = rawSpec.cli ?? null;
  if (cli && route !== "cli") {
    fail('a "cli" block requires route:"cli". Built-in runs take no execution controls.');
  }
  if (cli) {
    for (const field of Object.keys(cli)) {
      if (!CLI_ONLY_FIELDS.includes(field)) {
        fail("cli." + field + " is not a recognised CLI control. Valid: " + CLI_ONLY_FIELDS.join(", ") + ".");
      }
    }
    const model = cli.model ?? "gpt-image-2";
    if (cli.input_fidelity && mode !== "edit") {
      fail("cli.input_fidelity is edit-only.");
    }
    if (cli.input_fidelity && model === "gpt-image-2") {
      fail("cli.input_fidelity is not supported by gpt-image-2 (it always uses high fidelity).");
    }
    if (cli.background === "transparent" && model === "gpt-image-2") {
      fail(
        "CLI gpt-image-2 does not support background=transparent. Either keep gpt-image-2 and " +
          "chroma-key + remove_chroma_key.py, or set cli.model to gpt-image-1.5 — but only after " +
          "the user explicitly confirms that model switch."
      );
    }
  }

  const warnings = [];
  const totalImages = assets.reduce((sum, asset) => sum + (asset.variants ?? 1), 0);
  if (totalImages > BATCH_SOFT_LIMIT) {
    warnings.push(
      "This run asks for " +
        totalImages +
        " images. One foreground run is capped at 600s — split it into runs of " +
        BATCH_SOFT_LIMIT +
        " or fewer rather than risking a timeout."
    );
  }

  return { mode, route, useCase, assets, edit, cli, warnings, assetType: rawSpec.asset_type ?? null };
}

function renderAssetBlock(asset, spec, options = {}) {
  const { numbered = false, index = 0 } = options;
  const lines = [];
  if (numbered) lines.push("--- Asset " + (index + 1) + " ---");

  const references = asset.references ?? [];
  if (references.length > 0) {
    const described = references
      .map((reference, i) => "Image " + (i + 1) + ": " + (reference.role ?? "reference image") + " (" + reference.path + ")")
      .join("; ");
    lines.push("Input images: " + described);
  }

  const fields = [
    ["Primary request", asset.primary_request],
    ["Scene/backdrop", asset.scene],
    ["Subject", asset.subject],
    ["Style/medium", asset.style],
    ["Composition/framing", asset.composition],
    ["Lighting/mood", asset.lighting],
    ["Color palette", asset.palette],
    ["Materials/textures", asset.materials]
  ];
  for (const [label, value] of fields) {
    const line = labelled(label, value);
    if (line) lines.push(line);
  }

  if (asset.text_verbatim && String(asset.text_verbatim).trim()) {
    lines.push('Text (verbatim): "' + String(asset.text_verbatim).trim() + '"');
  }
  for (const pair of [["Constraints", asset.constraints], ["Avoid", asset.avoid]]) {
    const line = labelled(pair[0], pair[1]);
    if (line) lines.push(line);
  }

  const variants = asset.variants ?? 1;
  if (variants > 1) {
    lines.push(
      "Variants: " +
        variants +
        " variants of THIS prompt" +
        (spec.route === "builtin" ? " (one built-in image_gen call per variant)" : " (CLI --n)")
    );
  }
  lines.push("Save to: " + asset.dest);
  return lines.join("\n");
}

function renderCliControls(spec) {
  const controls = [];
  for (const field of CLI_ONLY_FIELDS) {
    const value = spec.cli?.[field];
    if (value !== undefined) controls.push("  --" + field.replace(/_/g, "-") + " " + value + " \\");
  }
  return controls;
}

function renderCliCommands(spec) {
  const controls = renderCliControls(spec);

  if (spec.mode === "edit") {
    const asset = spec.assets[0];
    const lines = [
      "Run this exact command (do not hand-roll an SDK script, do not modify image_gen.py):",
      "",
      "```bash",
      "python " + IMAGE_GEN_CLI + " edit \\",
      '  --image "' + spec.edit.target + '" \\'
    ];
    if (spec.edit.mask) lines.push('  --mask "' + spec.edit.mask + '" \\');
    lines.push(...controls);
    lines.push('  --prompt "' + asset.primary_request.replace(/"/g, "'") + '" \\');
    lines.push('  --out "' + asset.dest + '"');
    lines.push("```");
    return lines.join("\n");
  }

  if (spec.mode === "batch") {
    return [
      "Use the CLI `generate-batch` subcommand: write one JSONL job per asset above (each with its",
      "own `prompt` and `out` filename), then run:",
      "",
      "```bash",
      "python " + IMAGE_GEN_CLI + " generate-batch \\",
      "  --input tmp/imagegen/prompts.jsonl \\",
      '  --out-dir "' + path.dirname(spec.assets[0].dest) + '" \\',
      "  --concurrency 5",
      "```",
      "",
      "`--out-dir` is required. Per-job `out` is treated as a filename under it. Delete the JSONL",
      "when the run finishes."
    ].join("\n");
  }

  const asset = spec.assets[0];
  const lines = [
    "Run this exact command (do not hand-roll an SDK script, do not modify image_gen.py):",
    "",
    "```bash",
    "python " + IMAGE_GEN_CLI + " generate \\"
  ];
  lines.push(...controls);
  lines.push('  --prompt "' + asset.primary_request.replace(/"/g, "'") + '" \\');
  lines.push('  --out "' + asset.dest + '"');
  lines.push("```");
  return lines.join("\n");
}

export function buildPrompt(rawSpec) {
  const spec = validateSpec(rawSpec);
  const sections = [];

  // Line 1 is the explicit Codex skill invocation. Everything else is negotiable; this is not.
  sections.push("$imagegen");

  const header = ["Use case: " + spec.useCase];
  if (spec.assetType) header.push("Asset type: " + spec.assetType);
  sections.push(header.join("\n"));

  if (spec.mode === "edit") {
    const editLines = ["Edit target: " + spec.edit.target];
    if (spec.edit.mask) editLines.push("Mask: " + spec.edit.mask);
    editLines.push("Invariants: " + spec.edit.invariants);
    if (spec.route === "builtin") {
      editLines.push(
        "The edit target is a local file: load it with the built-in view_image tool first so it is",
        "in conversation context, then run the built-in edit flow."
      );
    }
    sections.push(editLines.join("\n"));
  }

  if (spec.mode === "batch") {
    const batchNote = [
      "Produce " + spec.assets.length + " DISTINCT assets. Each has its own prompt and its own destination.",
      "Do not use `n` as a substitute for distinct prompts — `n` is only for variants of one prompt."
    ];
    if (spec.route === "builtin") batchNote.push("Issue one built-in image_gen call per asset.");
    sections.push(batchNote.join("\n"));
    sections.push(
      spec.assets
        .map((asset, index) => renderAssetBlock(asset, spec, { numbered: true, index }))
        .join("\n\n")
    );
  } else {
    sections.push(renderAssetBlock(spec.assets[0], spec));
  }

  const contract = ["Output contract:"];
  for (const asset of spec.assets) {
    contract.push("- Save the final image to: " + asset.dest);
  }
  contract.push("- Create parent directories if needed.");
  contract.push("- Do not overwrite an existing file; write a versioned sibling such as name-v2.png instead.");
  if (spec.route === "builtin") {
    contract.push("- Use the built-in image_gen tool. Do not use the CLI fallback.");
  } else {
    contract.push(
      "- Use the CLI fallback (scripts/image_gen.py). It requires OPENAI_API_KEY; the user has already approved this route." +
        (spec.edit?.mask ? " A mask is required here, and the built-in tool does not support masks." : "")
    );
  }
  contract.push("- Report the final absolute path of every saved file.");
  sections.push(contract.join("\n"));

  if (spec.route === "cli") {
    sections.push(renderCliCommands(spec));
  }

  return { text: sections.join("\n\n") + "\n", warnings: spec.warnings, spec };
}

function parseCliArgs(argv) {
  const options = { spec: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--spec") options.spec = argv[++i];
    else if (argv[i] === "--out") options.out = argv[++i];
    else if (argv[i].startsWith("--")) throw new SpecError("Unknown flag: " + argv[i]);
  }
  return options;
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const source = options.spec ? fs.readFileSync(options.spec, "utf8") : readStdin();
    if (!source.trim()) throw new SpecError("No spec provided. Use --spec <file> or pipe JSON on stdin.");
    const built = buildPrompt(JSON.parse(source));
    for (const warning of built.warnings) process.stderr.write("[warn] " + warning + "\n");
    if (options.out) {
      fs.mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
      fs.writeFileSync(options.out, built.text, "utf8");
      process.stderr.write("[ok] wrote " + path.resolve(options.out) + "\n");
    } else {
      process.stdout.write(built.text);
    }
  } catch (error) {
    process.stderr.write((error instanceof SpecError ? "Invalid spec" : "Error") + ": " + error.message + "\n");
    process.exitCode = 1;
  }
}
