"""Exposure and privacy: who may reach the API, what it sends out, and what it keeps.

- The server makes no outbound connections, and it runs without torch.
- Every /v1 route needs the bearer token; /healthz reveals nothing.
- Cross-origin browser access is off unless explicitly listed; the glTF store and the scans
  live on the data volume; the launcher listens on localhost by default.
- Camera frames (keyframes) are kept only with the user's camera consent (contract 1.2).
"""

from __future__ import annotations

import copy
import os
import socket
import stat
import subprocess
import sys
from pathlib import Path

import pytest

CV_DIR = Path(__file__).resolve().parents[1]
# conftest sets this for the test process before any test runs.
TEST_TOKEN = os.environ["CV_API_TOKEN"]


# ── Outbound: the pipeline makes no connections ──────────────────────────────


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
        "import os, sys\n"
        "sys.modules['torch'] = None  # simulate a machine without torch\n"
        f"sys.path.insert(0, {str(CV_DIR)!r})\n"
        "import main\n"
        "from fastapi.testclient import TestClient\n"
        "headers = {'Authorization': 'Bearer ' + os.environ['CV_API_TOKEN']}\n"
        "body = TestClient(main.app, headers=headers).get('/v1/health').json()\n"
        "print('health', body['torch'], body['local_detector'])\n"
    )
    env = {**os.environ, "CV_DATA_DIR": str(tmp_path), "CV_DETECTOR": "stub"}
    result = subprocess.run(
        [sys.executable, "-c", code], capture_output=True, text=True, env=env, timeout=180,
    )
    assert result.returncode == 0, result.stderr
    assert "health False stub" in result.stdout


# ── Access: the bearer token guards every /v1 route ──────────────────────────


PROTECTED_ROUTES = [
    ("GET", "/v1/health", None),
    ("GET", "/v1/models", None),
    ("GET", "/v1/scans", None),
    ("POST", "/v1/scans", {}),
    ("GET", "/v1/scans/scan_" + "a" * 32, None),
    ("POST", "/v1/gltf", "upload"),
    ("GET", "/v1/gltf", None),
    ("GET", "/v1/gltf/export.glb", None),
    ("POST", "/v1/detect", {"image": "AAAA"}),
]


@pytest.mark.parametrize("method,path,body", PROTECTED_ROUTES)
def test_every_v1_route_refuses_a_request_without_the_token(anon_client, method, path, body):
    kwargs = {}
    if body == "upload":
        kwargs["files"] = {"file": ("export.glb", b"glTF", "model/gltf-binary")}
    elif body is not None:
        kwargs["json"] = body
    response = anon_client.request(method, path, **kwargs)
    assert response.status_code == 401, (method, path, response.text)
    assert response.headers.get("www-authenticate") == "Bearer"


@pytest.mark.parametrize("header", [
    "Bearer wrong-token-value-that-is-long-enough",
    "Basic dXNlcjpwYXNz",
    "Bearer ",
    TEST_TOKEN,                       # the token without the scheme
])
def test_a_wrong_or_malformed_credential_is_refused(anon_client, header):
    response = anon_client.get("/v1/scans", headers={"Authorization": header})
    assert response.status_code == 401


def test_the_token_admits_the_api_and_healthz_stays_public(anon_client, client):
    assert client.get("/v1/health").status_code == 200
    public = anon_client.get("/healthz")
    assert public.status_code == 200
    assert public.json() == {"status": "ok"}


def test_the_token_comes_from_the_environment_or_a_private_file(tmp_path):
    from localscan.security import TokenError, load_or_create_token

    assert load_or_create_token({"CV_API_TOKEN": "x" * 24}, tmp_path) == "x" * 24
    assert not (tmp_path / "api-token").exists()

    with pytest.raises(TokenError, match="at least 24"):
        load_or_create_token({"CV_API_TOKEN": "short"}, tmp_path)

    made = load_or_create_token({}, tmp_path)
    assert len(made) >= 24
    assert load_or_create_token({}, tmp_path) == made, "the same file gives the same token"
    if os.name == "posix":
        assert stat.S_IMODE((tmp_path / "api-token").stat().st_mode) == 0o600


# ── Browsers and the network: no cross-origin access unless listed ──────────


def test_no_browser_origin_gets_cross_origin_access_by_default(anon_client, client):
    evil = {"Origin": "https://evil.example"}
    preflight = anon_client.options("/v1/scans", headers={
        **evil,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
    })
    assert "access-control-allow-origin" not in preflight.headers

    allowed_by_token = client.get("/v1/health", headers=evil)
    assert allowed_by_token.status_code == 200
    assert "access-control-allow-origin" not in allowed_by_token.headers


def test_cors_origins_are_explicit_and_a_star_is_refused():
    from localscan.security import cors_origins_from_env

    assert cors_origins_from_env({}) == []
    assert cors_origins_from_env({"CORS_ALLOW_ORIGINS": "https://quest.example.com"}) == ["https://quest.example.com"]
    assert cors_origins_from_env({"CORS_ALLOW_ORIGINS": "https://a.example, http://b.example:8081"}) == [
        "https://a.example", "http://b.example:8081",
    ]
    for refused in ("*", "https://a.example/path", "ftp://a.example", "https://a.example?x=1"):
        with pytest.raises(ValueError):
            cors_origins_from_env({"CORS_ALLOW_ORIGINS": refused})


def test_the_glTF_store_and_the_scans_live_on_the_data_volume(app_module):
    data_dir = Path(os.environ["CV_DATA_DIR"])
    assert app_module.DATA_DIR == data_dir
    assert app_module.GLTF_STORE == data_dir / "gltf"


def test_the_launcher_listens_on_localhost_unless_told_otherwise():
    sys.path.insert(0, str(CV_DIR))
    import serve

    assert serve.parse_args([], env={}).host == "127.0.0.1"
    assert serve.parse_args([], env={}).port == 8000
    assert serve.parse_args([], env={"CV_HOST": "192.168.1.50"}).host == "192.168.1.50"
    assert serve.parse_args(["--host", "0.0.0.0"], env={}).host == "0.0.0.0"


# ── Camera consent: keyframes are kept only with the opt-in (contract 1.2) ───


def test_keyframes_are_not_kept_without_camera_consent(client, example_request, data_root):
    scans = Path(data_root) / "scans"
    before = set(p.name for p in scans.iterdir()) if scans.exists() else set()

    without = copy.deepcopy(example_request)
    del without["consent"]
    assert client.post("/v1/scans", json=without).status_code == 403

    refused = copy.deepcopy(example_request)
    refused["consent"] = {"camera": False}
    assert client.post("/v1/scans", json=refused).status_code == 403

    after = set(p.name for p in scans.iterdir()) if scans.exists() else set()
    assert after == before, "a refused capture must not leave a scan folder behind"


def test_a_planes_only_scan_needs_no_camera_consent(client, example_request):
    planes_only = copy.deepcopy(example_request)
    planes_only["keyframes"] = []
    del planes_only["consent"]
    response = client.post("/v1/scans", json=planes_only)
    assert response.status_code == 201, response.text
    assert response.json()["keyframes"] == []


def test_consent_is_kept_with_the_scan_and_checked_on_every_append(client, example_request):
    created = client.post("/v1/scans", json=example_request)
    assert created.status_code == 201, created.text
    scan_id = created.json()["scan_id"]

    stored = client.get(f"/v1/scans/{scan_id}").json()
    assert stored["consent"]["camera"] is True
    assert stored["consent"]["granted_at"] == example_request["consent"]["granted_at"]
    assert stored["consent"]["recorded_at"], "the server records when it accepted the consent"

    extra = copy.deepcopy(example_request["keyframes"][0])
    no_consent = client.post(f"/v1/scans/{scan_id}/keyframes", json={"keyframes": [extra]})
    assert no_consent.status_code == 403
    assert len(client.get(f"/v1/scans/{scan_id}").json()["keyframes"]) == 1
