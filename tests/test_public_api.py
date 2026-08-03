from __future__ import annotations

import argparse
import importlib.util
import json
import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest import mock
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from real_replica_bench.harnesses.openclaw.runner import (
    _openclaw_is_relay_mode,
    inject_openclaw_models_config,
)
from real_replica_bench.llm_judge import JudgeConfig, gemini_judge, openai_judge


_REPO_ROOT = Path(__file__).resolve().parents[1]


def _load_by_path(module_name: str, relative_path: str):
    """Import a repo module by file path.

    `python -m unittest discover -s tests` (the CI invocation) puts
    `tests/` on `sys.path`, not the repo root — and `scripts/` is a plain
    directory, not a package installed by `pip install -e .` (pyproject's
    `packages.find` only picks up `real_replica_bench*`). A normal
    `from scripts.x import y` therefore raises ModuleNotFoundError under
    CI. Loading by path also sidesteps an unrelated `scripts` package
    that may shadow the repo one in a developer's site-packages.
    """
    spec = importlib.util.spec_from_file_location(
        module_name, _REPO_ROOT / relative_path
    )
    assert spec is not None and spec.loader is not None, (
        f"cannot load {module_name} from {relative_path}"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


redact_config_secrets = _load_by_path(
    "realreplicabench_batch_runner_test", "scripts/run_realreplicabench.py"
).redact_config_secrets


_SHIM_PATH = (
    _REPO_ROOT
    / "docker"
    / "openclaw"
    / "proxy"
    / "openrouter_shim.py"
)
_SHIM_SPEC = importlib.util.spec_from_file_location(
    "realreplicabench_openrouter_shim_test",
    _SHIM_PATH,
)
assert _SHIM_SPEC is not None and _SHIM_SPEC.loader is not None
_SHIM = importlib.util.module_from_spec(_SHIM_SPEC)
_SHIM_SPEC.loader.exec_module(_SHIM)


JUDGMENT = {
    "score": 0.8,
    "passed": True,
    "summary": "ok",
    "strengths": ["complete"],
    "weaknesses": [],
    "criteria": [{"id": "quality", "score": 0.8, "reason": "ok"}],
}


class _RecordingHandler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
        size = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(size).decode("utf-8"))
        self.server.requests.append(  # type: ignore[attr-defined]
            {
                "path": self.path,
                "headers": dict(self.headers.items()),
                "body": body,
            }
        )
        payload = self.server.response_payload  # type: ignore[attr-defined]
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, _format: str, *_args: object) -> None:
        return


class _FakeEndpoint:
    def __init__(self, response_payload: dict[str, object]) -> None:
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _RecordingHandler)
        self.server.requests = []  # type: ignore[attr-defined]
        self.server.response_payload = response_payload  # type: ignore[attr-defined]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self) -> "_FakeEndpoint":
        self.thread.start()
        return self

    def __exit__(self, *_args: object) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    @property
    def base_url(self) -> str:
        host, port = self.server.server_address
        return f"http://{host}:{port}"

    @property
    def requests(self) -> list[dict[str, object]]:
        return self.server.requests  # type: ignore[attr-defined,no-any-return]


class PublicJudgeApiTests(unittest.TestCase):
    def test_gemini_native_protocol_and_versioned_base_url(self) -> None:
        response = {
            "candidates": [{"content": {"parts": [{"text": json.dumps(JUDGMENT)}]}}]
        }
        with _FakeEndpoint(response) as endpoint:
            result = gemini_judge(
                JudgeConfig(
                    provider="gemini",
                    model="gemini-3.1-pro-preview",
                    api_key="test-gemini-key",
                    base_url=f"{endpoint.base_url}/v1beta",
                ),
                "grade this",
            )

        self.assertTrue(result["passed"])
        self.assertEqual(len(endpoint.requests), 1)
        request = endpoint.requests[0]
        self.assertEqual(
            request["path"],
            "/v1beta/models/gemini-3.1-pro-preview:generateContent",
        )
        headers = {str(k).lower(): v for k, v in request["headers"].items()}  # type: ignore[union-attr]
        self.assertEqual(headers["x-goog-api-key"], "test-gemini-key")
        body = request["body"]
        self.assertEqual(body["contents"][0]["parts"][0]["text"], "grade this")  # type: ignore[index]
        self.assertEqual(
            body["generationConfig"]["responseMimeType"],  # type: ignore[index]
            "application/json",
        )

    def test_openai_responses_protocol_and_multimodal_input(self) -> None:
        with _FakeEndpoint({"output_text": json.dumps(JUDGMENT)}) as endpoint:
            result = openai_judge(
                JudgeConfig(
                    provider="openai",
                    model="test-model",
                    api_key="test-openai-key",
                    base_url=f"{endpoint.base_url}/v1",
                ),
                "grade this",
                [
                    {"text": "artifact image"},
                    {
                        "inlineData": {
                            "mimeType": "image/png",
                            "data": "aGVsbG8=",
                        }
                    },
                ],
            )

        self.assertTrue(result["passed"])
        request = endpoint.requests[0]
        self.assertEqual(request["path"], "/v1/responses")
        headers = {str(k).lower(): v for k, v in request["headers"].items()}  # type: ignore[union-attr]
        self.assertEqual(headers["authorization"], "Bearer test-openai-key")
        body = request["body"]
        user_content = body["input"][1]["content"]  # type: ignore[index]
        self.assertEqual(user_content[0], {"type": "input_text", "text": "grade this"})
        self.assertEqual(user_content[1], {"type": "input_text", "text": "artifact image"})
        self.assertEqual(
            user_content[2],
            {
                "type": "input_image",
                "image_url": "data:image/png;base64,aGVsbG8=",
            },
        )


class PublicHarnessContractTests(unittest.TestCase):
    def test_public_native_provider_configs_pin_api_versions(self) -> None:
        config_root = Path(__file__).resolve().parents[1] / "configs"
        for name in (
            "realreplicabench_native_google_direct_models.json",
            "realreplicabench_native_google_models.json",
        ):
            payload = json.loads((config_root / name).read_text(encoding="utf-8"))
            self.assertEqual(
                payload["providers"]["google"]["baseUrl"],
                "https://generativelanguage.googleapis.com/v1beta",
            )
        qwen = json.loads(
            (config_root / "realreplicabench_qwen37plus_native_models.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(
            qwen["providers"]["qwen"]["baseUrl"],
            "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        )

    def test_byo_endpoint_preset_configs_pin_wire_formats(self) -> None:
        # Each BYO-endpoint preset is a starter template for a distinct
        # wire format the OpenClaw runtime speaks natively. A future edit
        # that breaks any of these contracts (wrong `api` enum, wrong
        # default baseUrl, dropped anthropic-version header) should trip
        # this test rather than silently ship a broken preset.
        config_root = Path(__file__).resolve().parents[1] / "configs"

        openai_chat = json.loads(
            (config_root / "realreplicabench_openai_chat_models.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(openai_chat["providers"]["openai"]["api"], "openai-completions")
        self.assertEqual(
            openai_chat["providers"]["openai"]["baseUrl"],
            "https://api.openai.com/v1",
        )

        openai_responses = json.loads(
            (config_root / "realreplicabench_openai_responses_models.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(
            openai_responses["providers"]["openai"]["api"], "openai-responses"
        )
        self.assertEqual(
            openai_responses["providers"]["openai"]["baseUrl"],
            "https://api.openai.com/v1",
        )

        anthropic = json.loads(
            (
                config_root / "realreplicabench_anthropic_messages_models.json"
            ).read_text(encoding="utf-8")
        )
        self.assertEqual(
            anthropic["providers"]["anthropic"]["api"], "anthropic-messages"
        )
        self.assertEqual(
            anthropic["providers"]["anthropic"]["baseUrl"],
            "https://api.anthropic.com/v1",
        )
        # Anthropic REQUIRES the version header on every request; dropping
        # it in a copy-paste edit is a common mistake this pins against.
        self.assertEqual(
            anthropic["providers"]["anthropic"]["headers"]["anthropic-version"],
            "2023-06-01",
        )

        custom_gemini = json.loads(
            (config_root / "realreplicabench_custom_gemini_models.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(
            custom_gemini["providers"]["custom"]["api"], "google-generative-ai"
        )

        # OpenClaw's config schema requires a non-empty `name` on every
        # model entry: omitting it, or setting it to "" or null, aborts the
        # run at injection time with `models.<i>.name: Invalid input`.
        # Verified directly against the pinned runtime image
        # (`openclaw config validate`) on 2026-07-30. There is NO character
        # restriction — labels containing `/` or parentheses (e.g.
        # `"Gemini 3.5 Flash (public Google API)"`, as shipped in the Google
        # presets) validate fine — so this pins presence, not a charset.
        # Applies to EVERY shipped preset, not just the BYO four.
        config_dir = config_root
        preset_paths = sorted(config_dir.glob("*_models.json"))
        self.assertTrue(preset_paths, "no provider preset JSONs found")
        for path in preset_paths:
            preset = json.loads(path.read_text(encoding="utf-8"))
            for provider_key, provider_entry in preset["providers"].items():
                for model in provider_entry["models"]:
                    name = model.get("name")
                    self.assertIsInstance(
                        name,
                        str,
                        msg=(
                            f"{path.name}: provider {provider_key!r} model "
                            f"{model.get('id')!r} is missing a string `name`; "
                            "OpenClaw rejects the config with "
                            "`models.0.name: Invalid input`."
                        ),
                    )
                    self.assertTrue(
                        str(name).strip(),
                        msg=(
                            f"{path.name}: provider {provider_key!r} model "
                            f"{model.get('id')!r} has an empty `name`; "
                            "OpenClaw rejects empty and null names."
                        ),
                    )

    def test_openrouter_shim_uses_configured_upstream_and_host(self) -> None:
        original_base = _SHIM.UPSTREAM_BASE
        original_host = _SHIM.UPSTREAM_HOST
        original_effort = _SHIM.THINKING_EFFORT
        try:
            with _FakeEndpoint({"choices": []}) as endpoint:
                _SHIM.UPSTREAM_BASE = f"{endpoint.base_url}/compatible/v1"
                _SHIM.UPSTREAM_HOST = urlsplit(endpoint.base_url).netloc
                _SHIM.THINKING_EFFORT = "high"
                server = _SHIM.ThreadedHTTPServer(
                    ("127.0.0.1", 0),
                    _SHIM.ShimHandler,
                )
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    host, port = server.server_address
                    request = Request(
                        f"http://{host}:{port}/v1/chat/completions?stream=true",
                        data=json.dumps({"model": "vendor/model", "messages": []}).encode(),
                        headers={
                            "Authorization": "Bearer test-openrouter-key",
                            "Content-Type": "application/json",
                        },
                        method="POST",
                    )
                    with urlopen(request, timeout=5) as response:
                        self.assertEqual(response.status, 200)
                finally:
                    server.shutdown()
                    server.server_close()
                    thread.join(timeout=5)

            upstream_request = endpoint.requests[0]
            self.assertEqual(
                upstream_request["path"],
                "/compatible/v1/chat/completions?stream=true",
            )
            headers = {
                str(k).lower(): v
                for k, v in upstream_request["headers"].items()  # type: ignore[union-attr]
            }
            self.assertEqual(headers["host"], urlsplit(endpoint.base_url).netloc)
            self.assertEqual(headers["authorization"], "Bearer test-openrouter-key")
            self.assertEqual(
                upstream_request["body"]["reasoning_effort"],  # type: ignore[index]
                "high",
            )
        finally:
            _SHIM.UPSTREAM_BASE = original_base
            _SHIM.UPSTREAM_HOST = original_host
            _SHIM.THINKING_EFFORT = original_effort

    def test_public_digest_uses_may_managed_attach_mode(self) -> None:
        public_digest = (
            "acciolyk/accio_bench@"
            "sha256:1e9cf5c72a56794175b7d06ece036b92e296e6b7e9e9a7fa244026f6acea3859"
        )
        self.assertFalse(_openclaw_is_relay_mode(argparse.Namespace(image=public_digest)))
        self.assertFalse(
            _openclaw_is_relay_mode(
                argparse.Namespace(image="realreplicabench/openclaw:v1.3.1")
            )
        )
        self.assertTrue(
            _openclaw_is_relay_mode(
                argparse.Namespace(image="commercecraftbench/openclaw:ccb-v1.3")
            )
        )

    def test_missing_provider_environment_variable_fails_before_docker(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "models.json"
            path.write_text(
                json.dumps(
                    {
                        "providers": {
                            "google": {
                                "apiKey": "${MISSING_PUBLIC_TEST_KEY}",
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )
            args = SimpleNamespace(
                openclaw_models_config=str(path), openclaw_api=None
            )
            with mock.patch.dict(os.environ, {}, clear=True):
                with self.assertRaisesRegex(
                    SystemExit,
                    "MISSING_PUBLIC_TEST_KEY",
                ):
                    inject_openclaw_models_config("unused-container", args)

    def test_batch_config_redacts_credentials(self) -> None:
        redacted = redact_config_secrets(
            {
                "judge": {"api_key": "judge-secret"},
                "openclaw": {"api_key": "agent-secret"},
                "runtime": {
                    "env": [
                        "GEMINI_API_KEY=google-secret",
                        "SAFE_SETTING=visible",
                    ]
                },
            }
        )
        self.assertEqual(redacted["judge"]["api_key"], "<redacted>")
        self.assertEqual(redacted["openclaw"]["api_key"], "<redacted>")
        self.assertEqual(
            redacted["runtime"]["env"],
            ["GEMINI_API_KEY=<redacted>", "SAFE_SETTING=visible"],
        )

    def test_batch_config_redacts_provider_header_credentials(self) -> None:
        """`provider_headers` entries are `Key:Value`, not `Key=Value`.

        The BYO-endpoint docs tell users to put a shared proxy auth token in
        a `--openclaw-provider-header`, so an unredacted value would ship a
        live credential into run.yaml — which the README advertises as
        shareable benchmark evidence. Benign headers must stay readable.
        """
        redacted = redact_config_secrets(
            {
                "openclaw": {
                    "provider_headers": [
                        "anthropic-version:2023-06-01",
                        "Authorization:Bearer sk-live-secret",
                        "x-api-key:proxy-shared-secret",
                        "X-Trace-Id:abc123",
                    ],
                    "headers": {"Authorization": "Bearer sk-dict-secret"},
                }
            }
        )
        self.assertEqual(
            redacted["openclaw"]["provider_headers"],
            [
                "anthropic-version:2023-06-01",
                "Authorization:<redacted>",
                "x-api-key:<redacted>",
                "X-Trace-Id:abc123",
            ],
        )
        self.assertEqual(
            redacted["openclaw"]["headers"]["Authorization"], "<redacted>"
        )


class SynthesizedModelsConfigTests(unittest.TestCase):
    """Cover the --openclaw-api CLI shortcut path in
    ``inject_openclaw_models_config``. Each test constructs a minimal
    ``argparse.Namespace``, patches ``docker`` inside the runner module to
    capture the temp JSON path the runner would have shipped into the
    container, reads the JSON, and asserts the shape."""

    def _run_synth(
        self, args_kwargs: dict[str, object], env: dict[str, str]
    ) -> dict[str, object]:
        # Defaults for optional fields; caller kwargs win via a merge
        # rather than `**args_kwargs` after the defaults, so the caller
        # can override any of them without a "multiple values" TypeError.
        merged: dict[str, object] = {
            "openclaw_models_config": None,
            "openclaw_thinking": None,
            "openclaw_provider_key": None,
            "openclaw_provider_api_key_env": None,
            # SINGULAR — this is argparse's dest for the repeatable
            # `--openclaw-provider-header` flag. Building the namespace with a
            # plural key here would test an attribute the real CLI never sets.
            "openclaw_provider_header": [],
        }
        merged.update(args_kwargs)
        namespace = SimpleNamespace(**merged)
        captured: dict[str, dict[str, object]] = {}

        def fake_docker(
            *cmd: str, check: bool = False, capture: bool = False
        ) -> SimpleNamespace:
            if cmd and cmd[0] == "cp":
                # runner: docker("cp", str(tmp_path), f"{container}:{remote}", check=True)
                # Read WHILE the temp file still exists — the runner unlinks
                # it in its finally clause before returning to the caller.
                captured["payload"] = json.loads(
                    Path(cmd[1]).read_text(encoding="utf-8")
                )
            return SimpleNamespace(returncode=0, stdout="", stderr="")

        module = importlib.import_module(
            "real_replica_bench.harnesses.openclaw.runner"
        )
        with mock.patch.object(module, "docker", side_effect=fake_docker):
            with mock.patch.dict(os.environ, env, clear=True):
                inject_openclaw_models_config("unused-container", namespace)

        self.assertIn("payload", captured)
        payload = captured["payload"]
        assert isinstance(payload, dict)
        return payload

    def test_openai_completions_shortcut_shape(self) -> None:
        payload = self._run_synth(
            {
                "openclaw_api": "openai-completions",
                "openclaw_provider_base_url": "https://api.openai.com/v1",
                "openclaw_model": "openai/gpt-4o",
                "openclaw_provider_api_key_env": "TEST_OPENAI_KEY",
            },
            {"TEST_OPENAI_KEY": "sk-test-oai"},
        )
        entry = payload["providers"]["openai"]  # type: ignore[index]
        self.assertEqual(entry["api"], "openai-completions")
        self.assertEqual(entry["baseUrl"], "https://api.openai.com/v1")
        self.assertEqual(entry["apiKey"], "sk-test-oai")
        self.assertEqual(entry["models"][0]["id"], "gpt-4o")
        # OpenClaw's config schema requires `name` on each model entry —
        # a bare synth call without a display name must still be legal, so
        # runner defaults it to the model id. Regression guard against the
        # old shape that shipped `id` + `reasoning` only (rejected by
        # `openclaw config validate` with `models.0.name: Invalid input`).
        self.assertEqual(entry["models"][0]["name"], "gpt-4o")
        self.assertEqual(entry["timeoutSeconds"], 600)

    def test_openai_responses_shortcut_shape(self) -> None:
        payload = self._run_synth(
            {
                "openclaw_api": "openai-responses",
                "openclaw_provider_base_url": "https://api.openai.com/v1",
                "openclaw_model": "openai/gpt-5.5",
                "openclaw_provider_api_key_env": "TEST_OPENAI_KEY",
            },
            {"TEST_OPENAI_KEY": "sk-test-oai"},
        )
        self.assertEqual(payload["providers"]["openai"]["api"], "openai-responses")  # type: ignore[index]

    def test_anthropic_messages_shortcut_with_headers(self) -> None:
        payload = self._run_synth(
            {
                "openclaw_api": "anthropic-messages",
                "openclaw_provider_base_url": "https://api.anthropic.com/v1",
                "openclaw_model": "anthropic/claude-sonnet-4.6",
                "openclaw_provider_api_key_env": "TEST_ANTHROPIC_KEY",
                "openclaw_provider_header": [
                    "anthropic-version:2023-06-01",
                    "x-custom:hello:world",  # ensure only the FIRST colon splits
                ],
            },
            {"TEST_ANTHROPIC_KEY": "sk-ant-test"},
        )
        entry = payload["providers"]["anthropic"]  # type: ignore[index]
        self.assertEqual(entry["api"], "anthropic-messages")
        self.assertEqual(entry["headers"]["anthropic-version"], "2023-06-01")
        # Values with embedded colons must round-trip verbatim.
        self.assertEqual(entry["headers"]["x-custom"], "hello:world")

    def test_google_generative_ai_shortcut_shape(self) -> None:
        payload = self._run_synth(
            {
                "openclaw_api": "google-generative-ai",
                "openclaw_provider_base_url": "http://host.docker.internal:8080/v1beta",
                "openclaw_model": "custom/gemini-3.5-flash",
                "openclaw_provider_api_key_env": "TEST_CUSTOM_GEMINI_KEY",
            },
            {"TEST_CUSTOM_GEMINI_KEY": "cg-test"},
        )
        entry = payload["providers"]["custom"]  # type: ignore[index]
        self.assertEqual(entry["api"], "google-generative-ai")
        self.assertEqual(entry["baseUrl"], "http://host.docker.internal:8080/v1beta")

    def test_thinking_flag_sets_reasoning_true_on_model_entry(self) -> None:
        payload = self._run_synth(
            {
                "openclaw_api": "openai-responses",
                "openclaw_provider_base_url": "https://api.openai.com/v1",
                "openclaw_model": "openai/gpt-5.5",
                "openclaw_provider_api_key_env": "TEST_OPENAI_KEY",
                "openclaw_thinking": "medium",
            },
            {"TEST_OPENAI_KEY": "sk-test-oai"},
        )
        self.assertIs(
            payload["providers"]["openai"]["models"][0]["reasoning"],  # type: ignore[index]
            True,
        )

    def test_missing_api_key_env_errors_before_docker(self) -> None:
        args = SimpleNamespace(
            openclaw_models_config=None,
            openclaw_thinking=None,
            openclaw_api="anthropic-messages",
            openclaw_provider_base_url="https://api.anthropic.com/v1",
            openclaw_model="anthropic/claude-sonnet-4.6",
            openclaw_provider_key=None,
            openclaw_provider_api_key_env="TEST_EMPTY_KEY",
            openclaw_provider_header=[],
        )
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(SystemExit, "TEST_EMPTY_KEY"):
                inject_openclaw_models_config("unused-container", args)

    def test_missing_base_url_errors(self) -> None:
        args = SimpleNamespace(
            openclaw_models_config=None,
            openclaw_thinking=None,
            openclaw_api="openai-completions",
            openclaw_provider_base_url=None,
            openclaw_model="openai/gpt-4o",
            openclaw_provider_key=None,
            openclaw_provider_api_key_env="TEST_OPENAI_KEY",
            openclaw_provider_header=[],
        )
        with mock.patch.dict(os.environ, {"TEST_OPENAI_KEY": "sk"}, clear=True):
            with self.assertRaisesRegex(
                SystemExit, "openclaw-provider-base-url"
            ):
                inject_openclaw_models_config("unused-container", args)

    def test_openrouter_provider_key_rejected(self) -> None:
        args = SimpleNamespace(
            openclaw_models_config=None,
            openclaw_thinking=None,
            openclaw_api="openai-completions",
            openclaw_provider_base_url="https://openrouter.ai/api/v1",
            openclaw_model="openrouter/gpt-4o",
            openclaw_provider_key=None,
            openclaw_provider_api_key_env="TEST_KEY",
            openclaw_provider_header=[],
        )
        with mock.patch.dict(os.environ, {"TEST_KEY": "sk"}, clear=True):
            with self.assertRaisesRegex(SystemExit, "openrouter"):
                inject_openclaw_models_config("unused-container", args)

    def test_synth_and_file_are_mutually_exclusive(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "models.json"
            path.write_text(
                json.dumps({"providers": {"x": {}}}), encoding="utf-8"
            )
            args = SimpleNamespace(
                openclaw_models_config=str(path),
                openclaw_thinking=None,
                openclaw_api="openai-completions",
                openclaw_provider_base_url="https://api.openai.com/v1",
                openclaw_model="openai/gpt-4o",
                openclaw_provider_key=None,
                openclaw_provider_api_key_env="TEST_OPENAI_KEY",
                openclaw_provider_header=[],
            )
            with mock.patch.dict(
                os.environ, {"TEST_OPENAI_KEY": "sk"}, clear=True
            ):
                with self.assertRaisesRegex(SystemExit, "mutually exclusive"):
                    inject_openclaw_models_config("unused-container", args)


if __name__ == "__main__":
    unittest.main()
