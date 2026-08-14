"""Analytics service entrypoint.

Scaffold baseline only — real endpoints (reporting, document processing, ML)
are added in later build phases.
"""

from fastapi import FastAPI

app = FastAPI(title="HIMS Analytics", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
