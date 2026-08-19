# CLI route (`route: "cli"`)

Codex has two ways to make an image. The built-in `image_gen` tool is the default: no API key,
no dependencies, and it is what handles almost everything. The CLI (`image_gen.py`, bundled with
Codex's own imagegen skill) exists for the controls the built-in tool does not expose.

**The CLI costs money.** It calls the Images API directly and needs `OPENAI_API_KEY`. Route to it
when the request genuinely requires it, or when the user asks — never as a silent retry.

## When the CLI is required

| Need | Why the built-in cannot do it |
|---|---|
| **A mask** | `--mask` is edit-only and CLI-only. The built-in tool has no mask parameter at all. |
| An exact output size | The built-in picks its own dimensions |
| `quality` low/medium/high/auto | CLI-only execution control |
| `input_fidelity` | CLI-only, edit-only |
| A specific model | The built-in tool does not take a model argument |
| Native transparency via `gpt-image-1.5` | Requires `background=transparent` |
| `generate-batch` over a JSONL of many prompts | CLI subcommand |

Everything else — including ordinary transparent-background requests, multi-asset runs, and
quality iteration — stays on the built-in route. Ask the built-in tool for a transparent
background and preserve the alpha it returns.

## Masks

A mask tells the model *where* it may paint. The Images edit endpoint reads the mask's **alpha
channel**: alpha 0 marks the editable region, opaque pixels are held.

`scripts/make_mask.py` builds one that satisfies the API's constraints:

```bash
py -3 scripts/make_mask.py --image hero.png --out hero-mask.png --rect 0,60%,100%,100%
py -3 scripts/make_mask.py --image hero.png --out hero-mask.png --ellipse 50%,50%,25%,25%
py -3 scripts/make_mask.py --image hero.png --out hero-mask.png --polygon 10,10 200,10 200,180
py -3 scripts/make_mask.py --image hero.png --out hero-mask.png --rect 25%,25%,75%,75% --invert
```

Coordinates take pixels or percentages of their axis. Regions are repeatable and additive.
`--invert` edits everything *except* the named regions. Use the interpreter `preflight.mjs`
reports as `python.command` — on Windows that is usually `py -3`, because bare `python` is
often the Microsoft Store alias stub.

Rules the API enforces:

- Image and mask must be the same size and format, each under 50 MB.
- The mask must have an alpha channel — so PNG.
- The CLI accepts exactly one `--mask`. With several `--image` flags it applies to the first.
- Masking is **prompt-guided**. It steers the edit; it does not guarantee pixel-exact borders.
  Say so rather than promising a clean cut, and still state the invariants in the prompt.

If the user supplies their own mask, use theirs.

## Execution controls

Put them in the top-level `cli` block. `build-prompt.mjs` rejects combinations the API refuses,
so a bad pairing fails locally instead of after a paid call.

- `quality`: `low` | `medium` | `high` | `auto`. `low` for drafts and thumbnails; `medium`/`high`
  for final assets, dense text, diagrams, and identity-sensitive edits.
- `input_fidelity`: `low` | `high`. **Edit-only**, and **not supported by `gpt-image-2`**, which
  always uses high fidelity for image inputs. High fidelity materially raises input token usage
  on models that do support it.
- `size`: `auto`, or `WIDTHxHEIGHT` for `gpt-image-2` when every constraint holds — max edge
  ≤ 3840 px, both edges multiples of 16, long:short ratio ≤ 3:1, total pixels between 655,360 and
  8,294,400. Common: `1024x1024`, `1536x1024`, `1024x1536`, `2048x2048`, `2048x1152`,
  `3840x2160`, `2160x3840`. Squares are fastest.
- `model`: defaults to `gpt-image-2`. Never switch models silently.
- `output_format`: `png` (default), `jpeg`, `webp`. `output_compression` applies to jpeg/webp.

## Transparency

`gpt-image-2` does **not** support `background=transparent`. Two honest options, both requiring a
decision from the user:

1. Stay on `gpt-image-2`, generate against a flat chroma-key background, and extract the alpha
   locally with Codex's `remove_chroma_key.py`.
2. Switch to `gpt-image-1.5` with `background=transparent` and a transparent-capable
   `output_format` (`png` or `webp`).

Explain the trade-off and ask before switching models — unless the user already asked for
`gpt-image-1.5` explicitly. For most transparency requests the built-in route is simpler: ask it
for a transparent background directly.

## Many prompts at once

`generate-batch` reads a JSONL file, one job per line, and **requires `--out-dir`**. Per-job `out`
is a filename under that directory. `--concurrency` defaults to 5.

`--n` is variants of a single prompt. `generate-batch` is many different prompts. Do not
substitute one for the other.

## Guardrails inherited from Codex's imagegen skill

- Never modify `image_gen.py`. If something is missing, ask first.
- Never write a one-off SDK runner as a substitute for the bundled CLI.
- Use `tmp/imagegen/` for intermediate files and delete them when done; final artefacts belong at
  the `dest` you chose.
- `--dry-run` prints the payload and computed paths without calling the API or needing a key —
  use it to check a CLI invocation before spending anything.
