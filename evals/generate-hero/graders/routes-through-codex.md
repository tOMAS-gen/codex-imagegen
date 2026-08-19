The response must show the assistant delegating image generation to Codex rather than
attempting to produce the image itself.

PASS if the transcript shows the codex-imagegen skill being used: a preflight check, a request
spec, and an invocation of `run-imagegen.mjs` (or the companion's `task` subcommand).

FAIL if the assistant writes SVG, HTML, or CSS to approximate the image; says it cannot make
images and stops there without mentioning the Codex route; or calls an image API directly.
