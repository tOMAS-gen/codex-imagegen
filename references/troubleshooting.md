# Troubleshooting

Start with `node scripts/preflight.mjs`. It reports every link in the chain and prints the exact
remediation command for whatever is missing.

## The bridge is not ready

| Symptom in preflight | Fix |
|---|---|
| `codex.found: false` | `npm install -g @openai/codex`, then `codex login` |
| `marketplace.known: false` | `claude plugin marketplace add openai/codex-plugin-cc` |
| `plugin.installed: false` | `claude plugin install codex@openai-codex` |
| `plugin.installed: true` but `companion.exists: false` | The install record points at a directory that is gone. Reinstall: `claude plugin uninstall codex@openai-codex && claude plugin install codex@openai-codex` |

Confirm before installing anything. No session restart is needed after installing the plugin —
this skill calls `codex-companion.mjs` by absolute path. A restart is only required if you also
want the `/codex:*` slash commands.

## Codex runs but nothing is generated

**Not authenticated.** The companion starts and the turn fails early. Run `codex login`.

**Broker busy.** The companion shares one Codex runtime; a concurrent job can bounce the request.
Retry once. If it keeps failing, check for a stuck job with the plugin's own `status` command.

**The turn timed out.** One foreground run is capped at 600 s. A batch of several assets, or
several high-quality variants, can exceed it. Split the request into runs of about four images
and re-run. `build-prompt.mjs` warns when a spec crosses that line.

## The run reports success but no file exists

`run-imagegen.mjs` checks every declared `dest` on disk and lists anything missing, plus any other
image path Codex mentioned. Two common causes:

- **Codex left it at its default location.** The built-in tool saves under
  `$CODEX_HOME/generated_images/<uuid>/exec-<uuid>.png` first. The output contract tells Codex to
  move it, but if the move failed, the path appears under `also mentioned:` — move it yourself and
  say that you did.
- **The sandbox was read-only.** `--write` is always passed, so this should not happen; if it
  does, the workspace root passed as `--cwd` probably does not contain the destination. The
  sandbox is scoped to that root.

Do not report success in either case until a `Read` of the destination confirms the file.

## `image_gen` is unavailable or the generation fails

The built-in tool has been verified to work headless through the companion. If it nonetheless
fails:

1. Report the actionable lines from stderr as they came.
2. Say that the CLI fallback exists, that it uses `gpt-image-2` through `image_gen.py`, and that
   it requires `OPENAI_API_KEY`.
3. Ask whether to use it. Proceed only on an explicit yes.

Never substitute an SVG, HTML/CSS drawing, or placeholder for a failed image, and never quietly
retry on the paid route.

## Python problems on the CLI route

`preflight.mjs` reports `python.command`, `python.executable` and `python.pillow`. Use the command
it gives you.

On Windows, bare `python` and `python3` are usually the Microsoft Store alias stubs: they exist on
PATH, print an advert and exit non-zero. The real launcher is `py -3`. This matters for
`make_mask.py`, and it matters inside Codex too — if a CLI-route run fails with a Python error,
that is the first thing to check.

`python.pillow: false` → `uv pip install pillow`, or `py -3 -m pip install pillow`. Pillow is only
needed for `make_mask.py`.

## `OPENAI_API_KEY` is missing

Only the CLI route needs it; the built-in route never does. Never ask anyone to paste a key into
the chat. Point them to <https://platform.openai.com/api-keys>, ask them to set it as an
environment variable, and offer to walk through it for their shell.

## The image is wrong

Iterate with **one** change and pass `--resume` so Codex keeps the thread and its context. Repeat
the invariants on every edit pass — drift across iterations is the normal failure, and restating
`change only X; keep Y unchanged` is what suppresses it.

If the model keeps missing a specific detail, move it from prose into its own labelled field
(`text_verbatim`, `constraints`, `avoid`) rather than making the sentence longer.
