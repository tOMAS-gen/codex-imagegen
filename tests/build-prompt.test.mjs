import assert from "node:assert/strict";
import test from "node:test";

import { BATCH_SOFT_LIMIT, SpecError, buildPrompt, validateSpec } from "../scripts/build-prompt.mjs";

const GEN = {
  mode: "generate",
  use_case: "product-mockup",
  asset_type: "landing page hero",
  assets: [
    {
      dest: "E:/proyecto/assets/hero.png",
      primary_request: "a minimal hero image of a ceramic coffee mug",
      style: "clean product photography",
      constraints: "no logos, no text"
    }
  ]
};

const EDIT = {
  mode: "edit",
  use_case: "precise-object-edit",
  assets: [{ dest: "E:/proyecto/assets/hero-v2.png", primary_request: "replace the background" }],
  edit: { target: "E:/proyecto/assets/hero.png", invariants: "keep the mug and its edges unchanged" }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function rejects(spec, pattern) {
  assert.throws(() => buildPrompt(spec), (error) => {
    assert.ok(error instanceof SpecError, `expected SpecError, got ${error.constructor.name}`);
    assert.match(error.message, pattern);
    return true;
  });
}

test("$imagegen is the first line -- this is what routes the request to the Codex skill", () => {
  const { text } = buildPrompt(GEN);
  assert.equal(text.split("\n")[0], "$imagegen");
});

test("the built-in route states the destination and pins the built-in tool", () => {
  const { text } = buildPrompt(GEN);
  assert.match(text, /Use case: product-mockup/);
  assert.match(text, /Save to: E:\/proyecto\/assets\/hero\.png/);
  assert.match(text, /- Save the final image to: E:\/proyecto\/assets\/hero\.png/);
  assert.match(text, /Use the built-in image_gen tool\. Do not use the CLI fallback\./);
  assert.match(text, /Report the final absolute path of every saved file\./);
});

test("omitted optional fields leave no empty labels behind", () => {
  const { text } = buildPrompt(GEN);
  const optionalLabels = [
    "Subject",
    "Scene/backdrop",
    "Lighting/mood",
    "Color palette",
    "Materials/textures",
    "Text (verbatim)",
    "Avoid",
    "Input images"
  ];
  for (const label of optionalLabels) {
    assert.ok(!text.includes(`${label}:`), `${label} was not supplied and must not appear at all`);
  }
  // Supplied fields do appear, so the absence above is meaningful rather than vacuous.
  assert.match(text, /Style\/medium: clean product photography/);
});

test("a use_case outside the taxonomy is rejected", () => {
  rejects({ ...clone(GEN), use_case: "beautiful-picture" }, /not in the imagegen taxonomy/);
});

test("a use_case from the wrong family is rejected", () => {
  // precise-object-edit is an edit slug; the mode here is generate.
  rejects({ ...clone(GEN), use_case: "precise-object-edit" }, /belongs to the edit family/);
});

test("relative destinations are rejected -- Codex runs in its own cwd", () => {
  const spec = clone(GEN);
  spec.assets[0].dest = "assets/hero.png";
  rejects(spec, /must be an absolute path/);
});

test("edit mode requires a target and explicit invariants", () => {
  const missingTarget = clone(EDIT);
  delete missingTarget.edit.target;
  rejects(missingTarget, /edit\.target must be an absolute path/);

  const missingInvariants = clone(EDIT);
  delete missingInvariants.edit.invariants;
  rejects(missingInvariants, /edit\.invariants is required/);
});

test("a built-in edit is told to load the local file with view_image first", () => {
  const { text } = buildPrompt(EDIT);
  assert.match(text, /view_image/);
  assert.match(text, /Invariants: keep the mug and its edges unchanged/);
});

test("a mask without route:cli is rejected, because built-in image_gen has no masks", () => {
  const spec = clone(EDIT);
  spec.edit.mask = "E:/tmp/mask.png";
  rejects(spec, /edit\.mask requires route:"cli"/);
});

test("a mask on the CLI route emits an image_gen.py edit command carrying --mask", () => {
  const spec = clone(EDIT);
  spec.route = "cli";
  spec.edit.mask = "E:/tmp/mask.png";
  const { text } = buildPrompt(spec);

  assert.match(text, /Mask: E:\/tmp\/mask\.png/);
  assert.match(text, /image_gen\.py" edit/);
  assert.match(text, /--mask "E:\/tmp\/mask\.png"/);
  assert.match(text, /--image "E:\/proyecto\/assets\/hero\.png"/);
  assert.match(text, /--out "E:\/proyecto\/assets\/hero-v2\.png"/);
  assert.ok(!text.includes("Do not use the CLI fallback"), "the CLI route must not forbid itself");
});

test("CLI-only controls cannot leak into a built-in prompt", () => {
  const onAsset = clone(GEN);
  onAsset.assets[0].quality = "high";
  rejects(onAsset, /CLI-only control and must not sit on an asset/);

  const asBlock = clone(GEN);
  asBlock.cli = { quality: "high" };
  rejects(asBlock, /requires route:"cli"/);
});

test("model-specific CLI combinations that the API rejects are caught before the call", () => {
  const fidelityOnGptImage2 = clone(EDIT);
  fidelityOnGptImage2.route = "cli";
  fidelityOnGptImage2.cli = { input_fidelity: "high" };
  rejects(fidelityOnGptImage2, /not supported by gpt-image-2/);

  const transparentOnGptImage2 = clone(GEN);
  transparentOnGptImage2.route = "cli";
  transparentOnGptImage2.cli = { background: "transparent" };
  rejects(transparentOnGptImage2, /does not support background=transparent/);

  const fidelityOnGenerate = clone(GEN);
  fidelityOnGenerate.route = "cli";
  fidelityOnGenerate.cli = { model: "gpt-image-1.5", input_fidelity: "high" };
  rejects(fidelityOnGenerate, /edit-only/);
});

test("batch emits one destination per asset and forbids n as a stand-in", () => {
  const spec = {
    mode: "batch",
    use_case: "logo-brand",
    assets: [
      { dest: "E:/p/icon-a.png", primary_request: "a compass icon" },
      { dest: "E:/p/icon-b.png", primary_request: "an anchor icon" },
      { dest: "E:/p/icon-c.png", primary_request: "a lighthouse icon" }
    ]
  };
  const { text } = buildPrompt(spec);

  assert.match(text, /Produce 3 DISTINCT assets/);
  assert.match(text, /Do not use `n` as a substitute for distinct prompts/);
  assert.match(text, /Issue one built-in image_gen call per asset/);
  for (const name of ["icon-a", "icon-b", "icon-c"]) {
    assert.match(text, new RegExp(`- Save the final image to: E:/p/${name}\\.png`));
  }
  assert.equal(text.match(/--- Asset \d+ ---/g).length, 3);
});

test("variants are a different axis from distinct assets", () => {
  const spec = clone(GEN);
  spec.assets[0].variants = 3;
  const { text } = buildPrompt(spec);

  assert.match(text, /Variants: 3 variants of THIS prompt \(one built-in image_gen call per variant\)/);
  assert.ok(!text.includes("DISTINCT assets"), "one asset with variants is not a batch");
});

test("duplicate destinations are rejected before a run silently overwrites one", () => {
  rejects(
    {
      mode: "batch",
      use_case: "logo-brand",
      assets: [
        { dest: "E:/p/icon.png", primary_request: "a compass icon" },
        { dest: "E:/p/ICON.PNG", primary_request: "an anchor icon" }
      ]
    },
    /duplicates an earlier destination/
  );
});

test("mode and asset count must agree", () => {
  rejects({ ...clone(GEN), mode: "batch" }, /needs at least 2 assets/);
  rejects(
    {
      mode: "generate",
      use_case: "logo-brand",
      assets: [
        { dest: "E:/p/a.png", primary_request: "a" },
        { dest: "E:/p/b.png", primary_request: "b" }
      ]
    },
    /takes exactly 1 asset/
  );
});

test("oversized runs warn about the 600s foreground cap instead of failing silently", () => {
  const spec = clone(GEN);
  spec.assets[0].variants = BATCH_SOFT_LIMIT + 2;
  const { warnings } = buildPrompt(spec);

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /capped at 600s/);
});

test("reference images are labelled by index and role", () => {
  const spec = clone(GEN);
  spec.assets[0].references = [
    { path: "E:/refs/mood.png", role: "style reference" },
    { path: "E:/refs/layout.png", role: "composition reference" }
  ];
  const { text } = buildPrompt(spec);

  assert.match(text, /Image 1: style reference \(E:\/refs\/mood\.png\)/);
  assert.match(text, /Image 2: composition reference \(E:\/refs\/layout\.png\)/);
});

test("validateSpec defaults mode to generate and route to builtin", () => {
  const spec = clone(GEN);
  delete spec.mode;
  delete spec.route;
  const parsed = validateSpec(spec);

  assert.equal(parsed.mode, "generate");
  assert.equal(parsed.route, "builtin");
});
