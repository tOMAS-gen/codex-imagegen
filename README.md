# codex-imagegen

[![skills.sh](https://www.skills.sh/b/tOMAS-gen/codex-imagegen)](https://www.skills.sh/tOMAS-gen/codex-imagegen)

A Claude Code skill that teaches Claude to generate and edit AI images — by delegating to Codex.

```bash
npx skills add tOMAS-gen/codex-imagegen --skill codex-imagegen
```

Claude Code has no image generation of its own. Codex does: a built-in `image_gen` tool, wrapped
in its own `imagegen` system skill. OpenAI's [`codex-plugin-cc`][plugin] already provides a pipe
between the two. What was missing is the knowledge of how to use it. That is this skill.

[plugin]: https://github.com/openai/codex-plugin-cc

## How it works

```
Claude Code
  └─ skill: codex-imagegen
       ├─ preflight.mjs        resolves the bridge, or says exactly what to install
       ├─ build-prompt.mjs     spec JSON ──▶ prompt text ($imagegen + labelled spec + contract)
       └─ run-imagegen.mjs     node <companion> task --write --cwd <root> --prompt-file <abs>
                                    │
                                    ▼
                            codex-companion.mjs  (openai/codex-plugin-cc)
                                    │
                                    ▼
                            Codex, headless ──▶ $imagegen ──▶ image_gen
                                    │
                                    ▼
                            PNG at the path you asked for
```

Two details make the chain work:

- **`$imagegen` on line 1** is Codex's explicit skill invocation. It routes the request
  deterministically, even to a skill that is not auto-loaded into context.
- **`--prompt-file`** is an undocumented but supported flag on the companion's `task` subcommand.
  The file is read verbatim, so a multi-line prompt with quotes and accents survives a Windows
  shell intact. `--write` is equally load-bearing: without it Codex runs read-only and cannot
  place the file in your repo.

## Install

```bash
npx skills add tOMAS-gen/codex-imagegen --skill codex-imagegen
```

Add `-g` to install for your user instead of the current project. This installs into
`.agents/skills/` and symlinks it where Claude Code looks, so no restart is needed.

<details>
<summary>Manual install, for working on the skill itself</summary>

Link rather than copy, so editing the clone edits the installed skill.

```powershell
# Windows — a junction needs no elevation
git clone https://github.com/tOMAS-gen/codex-imagegen.git
New-Item -ItemType Junction -Path "$env:USERPROFILE\.claude\skills\codex-imagegen" `
         -Target "$PWD\codex-imagegen"
```

```bash
# macOS / Linux
git clone https://github.com/tOMAS-gen/codex-imagegen.git
ln -s "$PWD/codex-imagegen" ~/.claude/skills/codex-imagegen
```

</details>

This is a plain skill, not a plugin: a folder with a `SKILL.md`, no manifest, nothing registered
with `claude plugin`. Claude Code picks it up from the skills directory on its own. Then check
the bridge:

```bash
node scripts/preflight.mjs
```

Anything missing comes back with the exact command to fix it — typically:

```bash
npm install -g @openai/codex && codex login
claude plugin marketplace add openai/codex-plugin-cc
claude plugin install codex@openai-codex
```

No session restart is needed: the companion is called by absolute path.

## Using it

Just ask. "Generate a hero image of a ceramic mug for the landing page", "replace the background
in this photo", "make me three icons for the empty states" — the skill's description covers those
triggers and Claude picks it up.

Driving the scripts directly:

```bash
node scripts/run-imagegen.mjs --spec spec.json --cwd /path/to/project
node scripts/run-imagegen.mjs --spec spec.json --cwd /path/to/project --dry-run   # build only
node scripts/run-imagegen.mjs --spec spec.json --cwd /path/to/project --resume    # iterate
```

The spec format lives in [references/prompt-schema.md](references/prompt-schema.md). Minimal case:

```json
{
  "use_case": "product-mockup",
  "assets": [{
    "dest": "/abs/path/assets/hero.png",
    "primary_request": "a minimal hero image of a ceramic coffee mug"
  }]
}
```

### Masks

Region-scoped edits need a mask, and masks exist only on Codex's CLI route (the built-in tool has
no mask parameter). `make_mask.py` builds one — same size as the source, alpha 0 over the region
you want repainted:

```bash
py -3 scripts/make_mask.py --image hero.png --out hero-mask.png --rect 0,60%,100%,100%
```

Then set `route: "cli"` and `edit.mask` in the spec. That route calls the paid Images API and
needs `OPENAI_API_KEY`. See [references/cli-mode.md](references/cli-mode.md).

## Testing

```bash
npm test        # 48 tests, no network, no API key, no image generation
```

Three layers:

| Layer | What it covers | Cost |
|---|---|---|
| **Unit** (`tests/`) | Bridge resolution, the prompt contract, the companion argv, mask geometry | free |
| **Behaviour** (`evals/`) | Does the skill fire, route, and refuse correctly | needs `plugin eval` |
| **Smoke** (manual) | Real generation end to end | one generation each |

The unit layer leans on `tests/fixtures/fake-companion.mjs`, a stand-in that records the exact
argv and the verbatim prompt file it was handed. That is what lets the wire contract be asserted
without starting Codex — including that `--write` is never dropped and that accents and quotes
survive the round trip.

`evals/` holds behaviour cases as `prompt.md` + `graders/*.md`. **`claude plugin eval` is
currently early access**, so they have never been run; see [evals/README.md](evals/README.md).

## Layout

```
SKILL.md                      entrypoint: when to use it, the workflow, the hard rules
references/prompt-schema.md   spec shape, use-case taxonomy, how to write the request
references/cli-mode.md        masks, quality, sizes, models, transparency, batch
references/troubleshooting.md every failure mode and its fix
scripts/preflight.mjs         detect and resolve the bridge (never installs)
scripts/build-prompt.mjs      spec ──▶ prompt, with validation
scripts/run-imagegen.mjs      preflight + build + invoke + verify
scripts/make_mask.py          region ──▶ alpha mask (Pillow)
tests/                        node:test suites
evals/                        behaviour cases
```

## Requirements

- Node 20+
- Codex CLI, authenticated (`codex login`)
- The `codex@openai-codex` plugin
- Python with Pillow — only for `make_mask.py`. On Windows use `py -3`; bare `python` is usually
  the Microsoft Store alias stub.
- `OPENAI_API_KEY` — only for the CLI route (masks and explicit execution controls)

## License

MIT — see [LICENSE](LICENSE).
