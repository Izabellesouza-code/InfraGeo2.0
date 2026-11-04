"""Base de conhecimento e LLM do agente InfraGeo."""

import json
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field, field_validator

from app.api.deps import get_current_user
from app.core.exceptions import WebGISException
from app.services.auth_service import AuthPrincipal
from app.services.agent_llm_service import reconhecer_foto, responder_agente
from app.utils.rate_limit import enforce_rate_limit, limit_request

router = APIRouter()
_log = logging.getLogger(__name__)

_KNOWLEDGE = Path(__file__).resolve().parents[2] / "data" / "agent_knowledge.json"


class AgentReplyIn(BaseModel):
    mensagem: str = Field(min_length=1, max_length=2000)
    camadas_ativas: list[str] = Field(default_factory=list, max_length=40)
    catalogo: list[str] = Field(default_factory=list, max_length=40)
    etapa: str = Field(default="", max_length=80)
    tipo: str = Field(default="", max_length=40)

    @field_validator("camadas_ativas", "catalogo")
    @classmethod
    def _trim_names(cls, value: list[str]) -> list[str]:
        out: list[str] = []
        for item in value[:40]:
            name = str(item or "").strip()[:120]
            if name:
                out.append(name)
        return out


@router.get("/knowledge")
def knowledge(
    request: Request,
    user: AuthPrincipal = Depends(get_current_user),
) -> dict:
    limit_request(request, "agent-knowledge", max_hits=60, window_sec=60, extra=str(user.id))
    if not _KNOWLEDGE.exists():
        return {"intents": []}
    return json.loads(_KNOWLEDGE.read_text(encoding="utf-8"))


@router.post("/reply")
def reply(
    body: AgentReplyIn,
    request: Request,
    user: AuthPrincipal = Depends(get_current_user),
) -> dict:
    # IA: 10/min por usuário, 20/min por IP (custo e abuso).
    limit_request(request, "agent-reply", max_hits=20, window_sec=60)
    enforce_rate_limit(f"agent-reply:user:{user.id}", max_hits=10, window_sec=60)
    try:
        return responder_agente(
            body.mensagem,
            body.camadas_ativas,
            catalogo=body.catalogo,
            etapa=body.etapa,
            tipo=body.tipo,
        )
    except ValueError:
        raise WebGISException("Pedido inválido.", status_code=400)
    except RuntimeError:
        _log.warning("LLM indisponível para o usuário %s", user.id)
        raise WebGISException(
            "Serviço temporariamente indisponível.",
            status_code=503,
        )
    except Exception:
        _log.exception("Falha na LLM do agente (usuário %s)", user.id)
        raise WebGISException(
            "Serviço temporariamente indisponível.",
            status_code=502,
        )


class AgentFotoIn(BaseModel):
    photo_url: str = Field(min_length=8, max_length=500)
    catalogo: list[str] = Field(default_factory=list, max_length=40)

    @field_validator("catalogo")
    @classmethod
    def _trim_cat(cls, value: list[str]) -> list[str]:
        out: list[str] = []
        for item in value[:40]:
            name = str(item or "").strip()[:120]
            if name:
                out.append(name)
        return out


@router.post("/ler-foto")
def ler_foto(
    body: AgentFotoIn,
    request: Request,
    user: AuthPrincipal = Depends(get_current_user),
) -> dict:
    limit_request(request, "agent-vision", max_hits=10, window_sec=60)
    enforce_rate_limit(f"agent-vision:user:{user.id}", max_hits=6, window_sec=60)
    try:
        return reconhecer_foto(body.photo_url, catalogo=body.catalogo)
    except ValueError:
        raise WebGISException("Não foi possível ler a foto.", status_code=400)
    except RuntimeError:
        _log.warning("Visão indisponível para o usuário %s", user.id)
        raise WebGISException(
            "Serviço temporariamente indisponível.",
            status_code=503,
        )
    except Exception:
        _log.exception("Falha ao reconhecer foto (usuário %s)", user.id)
        raise WebGISException(
            "Não foi possível reconhecer a foto.",
            status_code=502,
        )
