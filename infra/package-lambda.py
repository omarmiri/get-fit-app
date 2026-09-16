"""
Build the Lambda deployment zip.

## Why this is a script and not `zip -r`

Two reasons, both about file modes.

The Lambda Web Adapter starts the function by executing the file named in the
function's `Handler` — `run.sh` here — so that file has to be executable inside
the archive. This repo is developed on Windows, where there is no executable
bit to preserve, so the mode has to be set on the zip entry explicitly rather
than inherited from disk. A zip built without it produces a function that fails
at startup with a permission error and no obvious cause.

The second is that `run.sh` must have Unix line endings. Git on Windows is
configured to check files out with CRLF, and a shell script whose shebang line
ends in a carriage return fails with the famously unhelpful `bad interpreter:
/bin/sh^M`. Writing it here, at pack time, sidesteps both problems rather than
relying on `.gitattributes` being right forever.
"""

import os
import shutil
import stat
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STAGE = ROOT / ".lambda-build"
OUT = ROOT / "infra" / "function.zip"

# The server's own modules. `dist/` is deliberately absent: CloudFront serves
# the site from S3, and SERVE_STATIC=false tells server.js to expect that.
SOURCES = [
    "server.js",
    "account.js",
    "auth.js",
    "keepalive.js",
    "kv.js",
    "sessions.js",
    "package.json",
    # The lockfile travels too: `npm ci` needs it, and `npm install` from a
    # bare package.json fails outright on this project.
    "package-lock.json",
]

# What the adapter executes. `exec` so node replaces the shell and receives
# signals directly — otherwise SIGTERM on shutdown never reaches it.
RUN_SH = "#!/bin/sh\nexec node server.js\n"


def main() -> int:
    if not (ROOT / "server-lib" / "planFormat.mjs").exists():
        print("server-lib/ is missing. Run `npm run build` first.", file=sys.stderr)
        return 1

    if STAGE.exists():
        shutil.rmtree(STAGE)
    STAGE.mkdir()

    for name in SOURCES:
        shutil.copy2(ROOT / name, STAGE / name)
    shutil.copytree(ROOT / "server-lib", STAGE / "server-lib")

    # Production dependencies only, installed fresh into the staging directory
    # rather than copied from the dev tree, so nothing devDependency-shaped
    # rides along by accident. `ci` rather than `install`: it is deterministic,
    # and `npm install` from this package.json without a lockfile fails.
    print("Installing production dependencies…")
    subprocess.run(
        ["npm", "ci", "--omit=dev", "--silent", "--no-audit", "--no-fund"],
        cwd=STAGE,
        check=True,
        shell=os.name == "nt",
    )

    OUT.parent.mkdir(exist_ok=True)
    if OUT.exists():
        OUT.unlink()

    print("Packing…")
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        run = zipfile.ZipInfo("run.sh")
        # 0o755, shifted into the high half of external_attr where zip keeps
        # Unix permissions.
        run.external_attr = (stat.S_IFREG | 0o755) << 16
        z.writestr(run, RUN_SH)

        for path in sorted(STAGE.rglob("*")):
            if path.is_file():
                z.write(path, path.relative_to(STAGE).as_posix())

    shutil.rmtree(STAGE)
    print(f"{OUT.relative_to(ROOT)} — {OUT.stat().st_size / 1_048_576:.1f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
