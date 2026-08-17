#!/usr/bin/env python3
"""Portable launcher for environments where Node.js is not on PATH."""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import sys


def find_node() -> str | None:
    for command in ("node", "nodejs"):
        executable = shutil.which(command)
        if executable:
            return executable

    # Codex Desktop supplies an isolated Node runtime even when the host does
    # not. Keep this as a fallback so the simulator works in the same workspace
    # in which it was generated, without baking a version number into the path.
    runtime_root = Path.home() / ".cache" / "codex-runtimes"
    candidates = sorted(
        runtime_root.glob("*/dependencies/node/bin/node"),
        key=lambda item: item.stat().st_mtime,
        reverse=True,
    )
    return str(candidates[0]) if candidates else None


def main() -> int:
    node = find_node()
    if not node:
        print(
            "Legends Arena's headless simulator needs Node.js 18 or newer. "
            "Install Node.js or run headless/simulate.js with an available Node executable.",
            file=sys.stderr,
        )
        return 1

    script = Path(__file__).with_name("simulate.js")
    os.execv(node, [node, str(script), *sys.argv[1:]])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

