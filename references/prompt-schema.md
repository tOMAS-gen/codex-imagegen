# Request spec reference

You write a spec (JSON); `scripts/build-prompt.mjs` turns it into the prompt Codex receives.
Everything mechanical — the `$imagegen` marker, the output contract, absolute paths, the wall
between built-in and CLI fields — is enforced by that script. What is left to you is judgement:
which use case, what to ask for, where it goes, and what must not change.

## Shape

```jsonc
{
  "mode": "generate",           // generate | edit | batch          (default: generate)
  "route": "builtin",           // builtin | cli                    (default: builtin)
  "use_case": "product-mockup", // required, from the taxonomy below
  "asset_type": "landing page hero",   // optional: where the asset will be used

  "assets": [                   // 1 for generate/edit, 2+ for batch
    {
      "dest": "E:/proyecto/assets/hero.png",   // REQUIRED, absolute
      "primary_request": "a minimal hero image of a ceramic coffee mug",  // REQUIRED
      "scene": "…", "subject": "…", "style": "…", "composition": "…",
      "lighting": "…", "palette": "…", "materials": "…",
      "text_verbatim": "Exact words to render",
      "constraints": "must keep …", "avoid": "no logos, no watermark",
      "variants": 1,                            // 1..10 variants OF THIS prompt
      "references": [{ "path": "E:/refs/mood.png", "role": "style reference" }]
    }
  ],

  "edit": {                     // required when mode = edit
    "target": "E:/proyecto/assets/hero.png",    // absolute, the image being changed
    "mask": "E:/tmp/hero-mask.png",             // optional; FORCES route:"cli"
    "invariants": "change only the background; keep the mug and its edges unchanged"
  },

  "cli": { "quality": "high" }  // only with route:"cli" — see cli-mode.md
}
```

Every optional field you leave out simply does not appear in the prompt. Do not pass empty
strings to "fill in the shape".

## Choosing the mode

| The user wants | mode | Notes |
|---|---|---|
| a new image, with or without reference images | `generate` | Reference images guide style; they are not edit targets |
| an existing image changed, preserving parts of it | `edit` | `invariants` is mandatory |
| several different assets in one go | `batch` | One prompt and one `dest` per asset |
| several takes on the same idea | `generate` + `variants: N` | Not the same as `batch` |

**`variants` and `batch` are different axes.** `variants` produces alternatives of one prompt so
you can pick. `batch` produces distinct deliverables that all get kept. Never use `variants` to
stand in for N distinct assets — the model will produce near-duplicates.

## Use-case taxonomy

The slug must match the mode family, and `build-prompt.mjs` rejects a mismatch.

**Generate**

| Slug | For |
|---|---|
| `photorealistic-natural` | candid/editorial scenes, real texture, natural light |
| `product-mockup` | product and packaging shots, catalog imagery, merch |
| `ui-mockup` | app/web interface mockups and wireframes — state the fidelity |
| `infographic-diagram` | diagrams and infographics with structured layout and text |
| `scientific-educational` | explainers and learning visuals with required labels |
| `ads-marketing` | campaign creative — give audience, scene, exact tagline |
| `productivity-visual` | slides, charts, workflow and business visuals |
| `logo-brand` | logo and mark exploration |
| `illustration-story` | comics, children's book art, narrative scenes |
| `stylized-concept` | style-driven concept art, 3D/stylised renders |
| `historical-scene` | period-accurate scenes |

**Edit**

| Slug | For |
|---|---|
| `text-localization` | translate or replace in-image text, keep the layout |
| `identity-preserve` | try-on, person-in-scene — lock face, body, pose |
| `precise-object-edit` | remove or replace one specific element |
| `lighting-weather` | time of day, season, atmosphere only |
| `background-extraction` | transparent background / clean cutout |
| `style-transfer` | apply a reference style while changing subject or scene |
| `compositing` | multi-image insert/merge with matched light and perspective |
| `sketch-to-render` | line art to photoreal render |

## Writing the request

**Match augmentation to the prompt you were given.**

- Already specific and detailed → normalise it into the labelled fields. Do not add creative
  requirements the user never asked for.
- Generic → add only detail that materially improves the result: composition or framing hints,
  polish level, intended use, practical layout guidance, reasonable scene concreteness.

**Never invent** extra characters or objects, brand names, slogans, palettes, or narrative beats
that the request does not imply. Do not place things on a particular side unless the layout
supports it.

Order the description scene → subject → details → constraints. Use camera and composition
language for photorealism. Quote exact text verbatim and say where it goes; for tricky words,
spell them letter by letter and require verbatim rendering. Reference images by index and say
how each should be used.

**For edits, repeat the invariants every iteration.** Drift is the default failure mode:
`change only X; keep Y unchanged` belongs in `invariants` on every pass, not just the first.

## Iterating

Change **one** thing per round and re-check. Pass `--resume` to `run-imagegen.mjs` so Codex
keeps the thread and its context instead of starting cold.

## Where the file goes

`dest` must be absolute, and you choose it. If the user named a location, use it. Otherwise pick
the conventional spot for the project (`assets/`, `public/images/`, `static/img/`…) and say out
loud where you put it. Never leave a project-bound asset only at Codex's default
`$CODEX_HOME/generated_images/…` path.

Existing files are never overwritten: the contract asks Codex for a versioned sibling
(`hero-v2.png`) unless the user explicitly asked for a replacement.
