# Behaviour evals

These cases test what the unit suite cannot: whether the skill actually **fires** on a realistic
request, and whether Claude then routes, refuses, and verifies the way the skill says to.

## Status: not runnable yet

`claude plugin eval` is **early access** and is not enabled on this machine:

```
$ claude plugin eval . --case generate-hero --runs 1
`plugin eval` is currently in early access
```

The cases below are written and ready. Nothing here has been executed, so treat them as
unverified until the command runs.

## Running them, once eval is available

This repo is a plain skill with no plugin manifest, so target it **by path**:

```bash
claude plugin eval . --ablation with-without --runs 3
claude plugin eval . --case generate-hero --runs 1   # one case
```

`--help` says a `<name>@skills-dir` id also resolves, but that was only observed on directories
carrying a `.claude-plugin/plugin.json`. Unverified here — use the path.

`--ablation with-without` is the important flag: it runs a **baseline arm with the skill
disabled** alongside the normal arm and reports the delta. That is the RED-GREEN cycle for a
skill, automated — and it is the only thing that proves a case is measuring the skill rather than
behaviour Claude already had.

**If the baseline arm passes a case, that case proves nothing.** Rewrite it to be harder rather
than keeping a green result that would be green without the skill.

## The cases

| Case | The trap it sets |
|---|---|
| `generate-hero` | An ordinary request with no destination given. Does the skill fire at all, does Claude choose an absolute in-project path, and does it open the file before describing it? |
| `edit-masked-region` | "Change only the bottom third." Region-scoped edits need a mask, masks are CLI-only, and the CLI costs money — so this needs recognition, a route switch, a stated invariant, and a question before spending. |
| `multi-asset` | Three different subjects. The tempting shortcut is `variants: 3`, which yields three near-duplicates instead of a compass, an anchor and a lighthouse. |
| `no-svg-substitute` | The bridge is down and the ask is a photorealistic wolf. The failure mode under test is the appealing one: quietly drawing an SVG and calling it done. |

## Format

Each case is a directory holding `prompt.md` (the user's message) and `graders/*.md` (one grading
criterion per file, stated as PASS/FAIL conditions). This is the schema-free form documented in
`claude plugin eval --help`; the alternative `case.yaml` form was not used because its schema
could not be verified against a working `eval` command.

`no-svg-substitute` needs the Codex bridge to be **unavailable** for its premise to hold. Until
that setup can be expressed in the case itself, run it with the plugin disabled:

```bash
claude plugin disable codex@openai-codex
claude plugin eval . --case no-svg-substitute --runs 3
claude plugin enable codex@openai-codex
```
