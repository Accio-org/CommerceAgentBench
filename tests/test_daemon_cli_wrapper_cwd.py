"""Regression guards for the `daemon_cli` wrapper's cwd handling.

The wrapper that lands at `/usr/local/bin/<tool>` inside the task container
is not a checked-in Python file — `_install_runtime_mock_cli_wrappers` builds
it by joining string literals and ships it through a heredoc. Type checkers,
linters, and every other test in this repo therefore see nothing at all: a
change that breaks the wrapper is invisible until an agent hits it at run
time, where the failure mode is a bare `exit 127` with empty output.

These tests are the only thing standing between an edit to that string
literal and a silently broken CLI mock, so they recover the generated source,
extract `daemon_usable_cwd` out of it with `ast`, and exercise the real
function against real directories.
"""
from __future__ import annotations

import ast
import importlib
import os
import shutil
import tempfile
import unittest
from collections.abc import Callable
from pathlib import Path
from types import SimpleNamespace
from typing import cast
from unittest import mock

# Base for the fixture directories. NOT `tempfile.gettempdir()`: on macOS that
# is a per-user folder under /var/folders that is itself 0700, which is
# precisely the condition these tests manipulate — fixtures built there would
# be untraversable for reasons unrelated to the case under test.
_WORLD_TRAVERSABLE_BASE = "/tmp"


def _components(path: str) -> list[str]:
    parts = [os.path.abspath(path)]
    while True:
        parent = os.path.dirname(parts[-1])
        if parent == parts[-1]:
            return parts
        parts.append(parent)


def _is_world_traversable(path: str) -> bool:
    try:
        return all(os.stat(part).st_mode & 0o001 for part in _components(path))
    except OSError:
        return False


def _generated_wrapper_source(port: int = 7899) -> str:
    """Return the wrapper text `_install_runtime_mock_cli_wrappers` would ship.

    Patches `docker` inside the cli module to capture the `bash -lc` command
    instead of executing it, then unwraps the heredoc.
    """
    cli = importlib.import_module("bench_core.cli")
    mock_config = cli.RuntimeMockConfig(
        name="stripe_cli",
        source_dir=Path("/unused/source"),
        install_path="/benchmark/runtime/mock_services/stripe_cli",
        kind="cli",
        port=port,
        bin_names=("stripe",),
        bench_bin="/opt/mocksvc/bench",
        isolate=True,
        isolation_model="daemon_cli",
    )
    captured: dict[str, str] = {}

    def fake_docker(
        *cmd: str, check: bool = False, capture: bool = False
    ) -> SimpleNamespace:
        captured["command"] = cmd[-1]
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    with mock.patch.object(cli, "docker", side_effect=fake_docker):
        cli._install_runtime_mock_cli_wrappers(
            "unused-container",
            (mock_config,),
            "/benchmark/runtime/mock_services",
            "/task",
        )

    command = captured["command"]
    assert "<<'EOF'" in command, command
    return command.split("<<'EOF'\n", 1)[1].split("\nEOF\n", 1)[0]


def _load_daemon_usable_cwd() -> Callable[[], str]:
    """Extract `daemon_usable_cwd` from the generated wrapper and bind it.

    The wrapper is a script: exec'ing it whole would read stdin and fire an
    HTTP request. Parsing it and compiling only the one function definition
    gives us the real shipped code with none of the top-level side effects.
    """
    source = _generated_wrapper_source()
    tree = ast.parse(source)
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == "daemon_usable_cwd":
            module = ast.Module(body=[node], type_ignores=[])
            namespace: dict[str, object] = {"os": os}
            exec(compile(module, "<daemon_cli_wrapper>", "exec"), namespace)  # noqa: S102
            return cast(Callable[[], str], namespace["daemon_usable_cwd"])
    raise AssertionError(
        "generated daemon_cli wrapper no longer defines daemon_usable_cwd():\n"
        + source
    )


class DaemonCliWrapperCwdTests(unittest.TestCase):
    def setUp(self) -> None:
        self.daemon_usable_cwd = _load_daemon_usable_cwd()
        self._original_cwd = os.getcwd()
        self._fixture_root: str | None = None

    def tearDown(self) -> None:
        os.chdir(self._original_cwd)
        if self._fixture_root:
            # Re-open the chain before rmtree: a 0700 fixture is fine to
            # delete as the owner, but a 0000 one would not be.
            for dirpath, dirnames, _files in os.walk(self._fixture_root):
                for name in [dirpath, *(os.path.join(dirpath, d) for d in dirnames)]:
                    os.chmod(name, 0o755)
            shutil.rmtree(self._fixture_root, ignore_errors=True)

    def _fixture(self, parent_mode: int, leaf_mode: int) -> str:
        """Build `<tmp>/parent/leaf` with the given modes, return the leaf."""
        if not _is_world_traversable(_WORLD_TRAVERSABLE_BASE):
            self.skipTest(
                f"{_WORLD_TRAVERSABLE_BASE} is not world-traversable on this host"
            )
        root = tempfile.mkdtemp(dir=_WORLD_TRAVERSABLE_BASE)
        self._fixture_root = root
        os.chmod(root, 0o755)
        parent = os.path.join(root, "parent")
        leaf = os.path.join(parent, "leaf")
        os.makedirs(leaf)
        os.chmod(leaf, leaf_mode)
        os.chmod(parent, parent_mode)
        return leaf

    def test_generated_wrapper_is_valid_python(self) -> None:
        """A syntax error here ships a container binary that cannot start."""
        ast.parse(_generated_wrapper_source())

    def test_payload_sends_guarded_cwd_rather_than_raw_getcwd(self) -> None:
        """The whole point: the payload must not carry a raw os.getcwd()."""
        source = _generated_wrapper_source()
        self.assertIn("'cwd': daemon_usable_cwd()", source)
        self.assertNotIn("'cwd': os.getcwd()", source)
        self.assertIn("def daemon_usable_cwd():", source)

    def test_world_traversable_cwd_is_forwarded(self) -> None:
        leaf = self._fixture(parent_mode=0o755, leaf_mode=0o755)
        os.chdir(leaf)
        self.assertEqual(self.daemon_usable_cwd(), os.getcwd())

    def test_untraversable_leaf_is_dropped(self) -> None:
        """A 0700 cwd — the /root case — must not reach the daemon."""
        leaf = self._fixture(parent_mode=0o755, leaf_mode=0o700)
        os.chdir(leaf)
        self.assertEqual(self.daemon_usable_cwd(), "")

    def test_open_leaf_under_private_parent_is_dropped(self) -> None:
        """Why the check must be per-component.

        A 0777 leaf looks fine in isolation, but mocksvc cannot reach it
        through a 0700 parent. Checking only the final component would
        forward this cwd and reproduce the silent exit 127.
        """
        leaf = self._fixture(parent_mode=0o700, leaf_mode=0o777)
        os.chdir(leaf)
        self.assertEqual(self.daemon_usable_cwd(), "")

    def test_filesystem_root_is_forwarded(self) -> None:
        """Termination check: the walk up must stop at / and accept it."""
        os.chdir("/")
        self.assertEqual(self.daemon_usable_cwd(), "/")

    def test_unreadable_cwd_returns_empty_rather_than_raising(self) -> None:
        """A wrapper traceback would be as opaque to the agent as exit 127."""
        with mock.patch("os.getcwd", side_effect=OSError("cwd is gone")):
            self.assertEqual(self.daemon_usable_cwd(), "")


if __name__ == "__main__":
    unittest.main()
