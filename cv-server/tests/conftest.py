"""Shared setup for the cv-server tests.

Nothing here needs torch, a GPU, or a headset: the stub detector is the default,
and the GroundingDINO backend is only ever constructed, never run.
"""

from __future__ import annotations

import atexit
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

import pytest

CV_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = CV_DIR.parent
if str(CV_DIR) not in sys.path:
    sys.path.insert(0, str(CV_DIR))

# main.py builds its store from the environment when it is imported, so the data
# folder and the detector are set before the first import, for the whole run.
_DATA_DIR = tempfile.mkdtemp(prefix="cv-scan-tests-")
atexit.register(shutil.rmtree, _DATA_DIR, ignore_errors=True)
os.environ["CV_DATA_DIR"] = _DATA_DIR
os.environ["CV_DETECTOR"] = "stub"
os.environ.pop("CV_LABELS", None)
# The API token the suite uses. Only ever set for the test process.
TEST_TOKEN = "test-token-0123456789abcdefghij"
os.environ["CV_API_TOKEN"] = TEST_TOKEN
os.environ.pop("CORS_ALLOW_ORIGINS", None)


@pytest.fixture(scope="session")
def app_module():
    import main  # noqa: WPS433 — imported here so the env above is in force

    return main


@pytest.fixture()
def client(app_module):
    """A client that presents the API token, as the headset's app does."""
    from fastapi.testclient import TestClient

    headers = {"Authorization": f"Bearer {TEST_TOKEN}"}
    with TestClient(app_module.app, headers=headers) as test_client:
        yield test_client


@pytest.fixture()
def anon_client(app_module):
    """A client that presents no token, to check what is refused."""
    from fastapi.testclient import TestClient

    with TestClient(app_module.app) as test_client:
        yield test_client


@pytest.fixture()
def data_root() -> Path:
    return Path(_DATA_DIR)


@pytest.fixture(scope="session")
def example_request() -> dict:
    return json.loads((REPO_DIR / "contracts" / "examples" / "capture-request.v1.json").read_text())


@pytest.fixture(scope="session")
def example_result() -> dict:
    return json.loads((REPO_DIR / "contracts" / "examples" / "capture-result.v1.json").read_text())
