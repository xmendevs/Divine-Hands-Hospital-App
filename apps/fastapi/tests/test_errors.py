from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_not_found_envelope():
    resp = client.get("/api/v1/does-not-exist")
    assert resp.status_code == 404
    body = resp.json()
    assert body["error"]["code"] == "not_found"
    assert "requestId" in body["error"]


def test_request_id_echo():
    resp = client.get("/health", headers={"X-Request-ID": "req-abc"})
    assert resp.headers["x-request-id"] == "req-abc"


def test_request_id_generated():
    resp = client.get("/health")
    assert resp.headers["x-request-id"]
