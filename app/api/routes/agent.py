"""Base de conhecimento do agente InfraGeo."""

from pathlib import Path

from fastapi import APIRouter

router = APIRouter()

_KNOWLEDGE = Path(__file__).resolve().parents[2] / "data" / "agent_knowledge.json"


@router.get("/knowledge")
def knowledge() -> dict:
    if not _KNOWLEDGE.exists():
        return {"intents": []}
    import json

    return json.loads(_KNOWLEDGE.read_text(encoding="utf-8"))
