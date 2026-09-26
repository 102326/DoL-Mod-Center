"""Compatibility build entry: all distributions use the 2.x Vue frontend."""
from pathlib import Path
import shutil
import subprocess


def build():
    project = Path(__file__).resolve().parents[2]
    npm = shutil.which('npm')
    if npm is None:
        raise SystemExit('npm is required. Install Node.js and run npm ci first.')
    subprocess.run([npm, 'run', 'package'], cwd=project, check=True)


if __name__ == '__main__':
    build()
