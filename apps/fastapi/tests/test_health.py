from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["service"] == "fastapi"
    assert "time" in body


def test_ready_structure():
    resp = client.get("/ready")
    # 200 when Postgres/Redis are up, 503 otherwise; structure is stable either way.
    assert resp.status_code in (200, 503)
    body = resp.json()
    assert body["status"] in ("ready", "not_ready")
    assert set(body["checks"]) == {"postgres", "redis"}


def test_version():
    resp = client.get("/api/v1/version")
    assert resp.status_code == 200
    body = resp.json()
    assert body["service"] == "fastapi"
    assert body["timezone"] == "UTC"
    assert "utcNow" in body
