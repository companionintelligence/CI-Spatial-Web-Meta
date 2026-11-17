"""The server makes no outbound connections, and it runs without torch.

A scan is private data: the server stores it on its own disk and never forwards it.
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
from pathlib import Path

CV_DIR = Path(__file__).resolve().parents[1]


def test_capture_pipeline_opens_no_outbound_connection(client, example_request, monkeypatch):
    attempts = []

    def refuse(self, address):
        attempts.append(address)
        raise OSError("outbound connections are not allowed by the local scan pipeline")

    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket.socket, "connect_ex", lambda self, address: attempts.append(address) or 1)

    response = client.post("/v1/scans", json=example_request)
    assert response.status_code == 201, response.text
    assert attempts == []


def test_server_starts_and_serves_without_torch(tmp_path):
    code = (
        "import sys\n"
        "sys.modules['torch'] = None  # simulate a machine without torch\n"
        f"sys.path.insert(0, {str(CV_DIR)!r})\n"
        "import main\n"
        "from fastapi.testclient import TestClient\n"
        "body = TestClient(main.app).get('/v1/health').json()\n"
        "print('health', body['torch'], body['local_detector'])\n"
    )
    env = {**os.environ, "CV_DATA_DIR": str(tmp_path), "CV_DETECTOR": "stub"}
    result = subprocess.run(
        [sys.executable, "-c", code], capture_output=True, text=True, env=env, timeout=180,
    )
    assert result.returncode == 0, result.stderr
    assert "health False stub" in result.stdout
