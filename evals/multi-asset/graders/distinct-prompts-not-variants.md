Three different subjects are three DISTINCT assets, not three variants of one prompt.

PASS if the spec uses `mode: "batch"` with three assets, each with its own `primary_request`
and its own destination.

FAIL if it uses `variants: 3` (or the CLI `--n 3`) on a single prompt. That produces near
duplicates of one idea instead of a compass, an anchor and a lighthouse, and is exactly the
substitution the skill forbids.
