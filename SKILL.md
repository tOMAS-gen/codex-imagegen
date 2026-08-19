---
name: codex-imagegen
description: >-
  Use when the user wants a raster image created or changed by AI — a photo, illustration,
  hero image, banner, texture, sprite, game asset, product or UI mockup, infographic, logo
  exploration, or transparent cutout — or wants a region of an existing image repainted, a
  background swapped or removed, an object erased or replaced, in-image text changed, or
  several assets or variants produced at once. Also use when a project references an image
  that does not exist yet and has no editable source. Not for SVG or vector icon systems,
  diagrams or wireframes better built in HTML/CSS/canvas, or edits to a file that already
  exists in an editable native format.
---

# Codex Image Generation

Claude Code cannot generate images. Codex can, through its built-in `image_gen` tool, and the
`codex` plugin gives us a channel to reach it. This skill drives that channel.

**Core principle: an image request is finished when a file exists at a path you chose and you
have looked at it.** Not when Codex says it worked.

The scripts own the mechanics — the `$imagegen` marker, taxonomy validation, absolute paths, the
output contract, the wall between built-in and CLI-only fields. What is left to you is judgement.
Paths below are relative to this skill's directory.

## 1. Preflight — once per session

```bash
node scripts/preflight.mjs
```

If `ok` is false, run the commands in `remediation` **in order**, confirming each with the user
first, then re-run. If it still fails, stop and report. See `references/troubleshooting.md`.

## 2. Write the spec

A JSON file describing the request. Decide: the mode (`generate` / `edit` / `batch`), the use-case
slug, the **absolute destination** for every asset, and — for edits — what must not change.

Full shape, taxonomy, and prompt-writing guidance: `references/prompt-schema.md`.

Set `route: "cli"` only when the request needs a control the built-in tool lacks — above all a
**mask**, which is CLI-only. `scripts/make_mask.py` builds one. See `references/cli-mode.md`.

## 3. Run it

```bash
node scripts/run-imagegen.mjs --spec spec.json --cwd <project root>
```

Use a Bash `timeout` of `600000`. Add `--dry-run` first for anything large or paid; add `--resume`
to iterate on a previous run.

## 4. Verify, then report

`Read` every saved path — Read renders PNGs, so look at the image. Check it against what was
asked: subject, style, exact text, invariants. Then report the absolute paths, the route used,
and anything that came out differently.

If the run reports `MISSING`, the file is not there. Move it from the path Codex mentioned, or
re-run.

## Hard rules

- **Never substitute** an SVG, HTML/CSS drawing, or placeholder for an image that failed.
- **Never claim success** without a `Read` of the destination.
- **Never use the CLI route as a silent retry.** It spends `OPENAI_API_KEY`. Explain and ask.
- **Never overwrite** an existing asset unless asked; take the `-v2` sibling.
- **Never use `variants` for distinct assets.** Different deliverables need different prompts.
- **Never switch image model** without the user agreeing.

## Rationalization table

| Thought | Reality |
|---|---|
| "Codex said it saved it, that's good enough" | Codex has reported success with no file on disk. `Read` it. |
| "An SVG placeholder unblocks them for now" | They asked for a photo. A placeholder is a silent failure that ships. |
| "The key is set, I'll just retry on the CLI" | That is a paid call they did not authorise. Ask. |
| "It's close enough, I'll fix everything next pass" | One change per pass. Bundled fixes make it impossible to tell what worked. |
| "Three icons — I'll use variants: 3" | Variants are takes on one prompt. You will get three near-duplicates. |
| "I'll drop the invariants, it already knows" | Drift is the default. Restate them every single pass. |
| "A relative path is fine, I'm in the repo" | Codex runs in its own cwd. Relative paths land somewhere else. |

## Red flags — stop

- About to describe an image you have not opened.
- About to write `<svg>` because a generation failed.
- About to run the CLI route without an explicit yes.
- About to say "generated successfully" with no path in your message.

## Reference map

- `references/prompt-schema.md` — spec shape, use-case taxonomy, how to write the request
- `references/cli-mode.md` — masks, quality, sizes, models, transparency, batch
- `references/troubleshooting.md` — every failure mode and its fix
