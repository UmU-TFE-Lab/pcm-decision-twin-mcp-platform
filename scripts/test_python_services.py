import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run(test_path: str, python_path: str) -> None:
    env = {
        **os.environ,
        "PYTHONPATH": os.pathsep.join([str(ROOT / python_path), str(ROOT)]),
    }
    subprocess.run(
        [sys.executable, "-m", "pytest", "-q", test_path],
        cwd=ROOT,
        env=env,
        check=True,
    )


run("backend/tests", "backend")
run("model_service/tests", "model_service")
