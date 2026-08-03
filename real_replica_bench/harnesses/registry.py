"""Registered agent harness backends.

Release fork: OpenClaw-only. The Accio harness is listed for compatibility
with the run-config schema (`runtime.harness: accio`) but the runner code
itself is not shipped here — only OpenClaw is supported end-to-end.
"""

DEFAULT_HARNESS = "openclaw"
SUPPORTED_HARNESSES = ("openclaw",)

HARNESS_DESCRIPTIONS = {
    "openclaw": "container-side OpenClaw browser-capable harness",
}
