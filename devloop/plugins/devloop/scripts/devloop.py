"""devloop CLI entry point: python devloop.py <command> ..."""

import os
import sys

_LIB = os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, "lib")
# Replace the script directory so this file cannot shadow the package.
sys.path[0] = os.path.normpath(_LIB)

if sys.version_info < (3, 11):
    print(f"devloop requires Python 3.11+ (running {sys.version.split()[0]}); set DEVLOOP_PYTHON", file=sys.stderr)
    sys.exit(9)  # the launcher tries the next interpreter on 9

if sys.argv[1:2] == ["hook"] and len(sys.argv) == 3:
    # Hooks run before every tool call: import only what they need.
    from devloop.hooks import run

    text, code = run(sys.argv[2], sys.stdin.read())
    if text:
        print(text)
    sys.exit(code)

from devloop.cli import main  # noqa: E402

sys.exit(main())
