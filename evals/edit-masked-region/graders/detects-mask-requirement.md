The user asked for a change confined to a specific REGION of the image. That is what masks are
for, and masks are only available on the CLI route.

PASS if the assistant recognises that a region-scoped edit calls for a mask and either builds
one with `make_mask.py` or uses a mask the user supplies, AND sets `route: "cli"`.

FAIL if it sends a region-scoped edit down the built-in route while claiming mask behaviour, or
if it silently drops the region constraint and repaints the whole image.
