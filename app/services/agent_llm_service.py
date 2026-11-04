"""Agente InfraGeo: conversa com a LLM e devolve ação + texto."""

from __future__ import annotations

import json
import re

from openai import OpenAI

from app.config import get_settings

SYSTEM_PROMPT = """Você é o assistente do mapa InfraGeo AM (WebGIS do Amazonas).

Responda SEMPRE em JSON válido, sem markdown:
{"acao":"...","resposta":"...","camada":null,"lugar":null}

acao:
- responder: responder pergunta ou pedir um detalhe. NÃO afirme que já ligou camada ou enquadrou o mapa.
- confirmar_mapa: você JÁ explicou e pergunta se deve ligar a camada e/ou enquadrar. Preencha camada e/ou lugar.
- ligar_camada: o usuário pediu para LIGAR a camada agora. Preencha "camada" com um nome EXATO da lista.
- enquadrar: o usuário pediu para enquadrar/ir a um lugar agora. Preencha "lugar".
- ligar_e_enquadrar: o usuário pediu para ligar E enquadrar agora (ex.: "sim, por favor", "liga e mostra Manaus"). Preencha camada e lugar.
- listar_camadas: mostrar camadas para o usuário escolher (chamado de sugestão/reclamação).
- pular_camada: chamado sem vincular camada.
- registrar: gravar sugestão/reclamação.
- pedir_foto: pedir foto no chamado.
- vincular_camada: no chamado, nome EXATO de camada da lista.

Regras:
1. Português brasileiro, no máximo 2 frases curtas. Sem listas, sem emoji.
2. Perguntas sobre o mapa (rodovias, rios, balsas, municípios, o que passa por uma cidade): use os nomes da lista de camadas. Responda o que souber com base nos nomes. Se fizer sentido ligar/enquadrar, use acao=confirmar_mapa e pergunte. Não execute sozinho.
3. Só use ligar_camada, enquadrar ou ligar_e_enquadrar se o usuário pediu explicitamente (ligar, mostrar, enquadrar, "sim" depois da sua pergunta).
4. Nunca invente nome de camada. "camada" só com nome EXATO da lista; senão null.
5. "lugar" é cidade/local (ex.: Manaus). Não peça e-mail ou senha. Não afirme que já registrou chamado.
6. Se a etapa/tipo indicar sugestão ou reclamação, priorize o fluxo de chamado.
"""


def _parse_json(raw: str) -> dict:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.I).strip()
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", text, re.S)
    if match:
        try:
            data = json.loads(match.group(0))
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            pass
    return {"acao": "responder", "resposta": text or "Pode continuar.", "camada": None}


def responder_agente(
    mensagem: str,
    camadas_ativas: list[str] | None = None,
    catalogo: list[str] | None = None,
    etapa: str = "",
    tipo: str = "",
) -> dict:
    texto = (mensagem or "").strip()
    if not texto:
        raise ValueError("Informe a mensagem.")

    settings = get_settings()
    api_key = (settings.openai_api_key or "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY não configurada no ambiente.")

    ativas = [str(n).strip() for n in (camadas_ativas or []) if str(n).strip()]
    cat = [str(n).strip() for n in (catalogo or []) if str(n).strip()][:40]
    user = (
        f"Tipo do chamado: {tipo or 'indefinido'}\n"
        f"Etapa atual: {etapa or 'livre'}\n"
        f"Camadas ligadas no mapa:\n"
        + ("\n".join(f"- {n}" for n in ativas) if ativas else "(nenhuma)")
        + "\n\nCamadas do catálogo (nomes válidos):\n"
        + ("\n".join(f"- {n}" for n in cat) if cat else "(vazio)")
        + f"\n\nMensagem do usuário:\n{texto}"
    )

    client = OpenAI(api_key=api_key)
    completion = client.chat.completions.create(
        model=settings.openai_model,
        temperature=0.2,
        max_tokens=320,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user},
        ],
    )
    parsed = _parse_json(completion.choices[0].message.content or "")
    acao = str(parsed.get("acao") or "responder").strip().lower()
    permitidas = {
        "responder",
        "confirmar_mapa",
        "ligar_camada",
        "enquadrar",
        "ligar_e_enquadrar",
        "listar_camadas",
        "pular_camada",
        "registrar",
        "pedir_foto",
        "vincular_camada",
    }
    if acao not in permitidas:
        acao = "responder"
    resposta = str(parsed.get("resposta") or "").strip()
    if not resposta:
        resposta = "Pode continuar."
    camada = parsed.get("camada")
    if camada is not None:
        camada = str(camada).strip() or None
        nomes = set(ativas + cat)
        if camada and camada not in nomes:
            camada = None
            if acao == "vincular_camada":
                acao = "listar_camadas"
            elif acao in {"ligar_camada", "ligar_e_enquadrar"}:
                acao = "confirmar_mapa"
    lugar = parsed.get("lugar")
    if lugar is not None:
        lugar = str(lugar).strip()[:80] or None
    return {"acao": acao, "resposta": resposta, "camada": camada, "lugar": lugar}


_VISION_PROMPT = """Você analisa uma foto enviada no agente do mapa InfraGeo AM.
Responda SEMPRE em JSON válido, sem markdown:
{"tipo":"correcao","descricao":"...","camada":null}

tipo: correcao (erro, dano, dado errado, buraco, placa, trecho) ou sugestao (ideia, melhoria) ou indefinido.
descricao: 1 ou 2 frases em português do que aparece na foto, objetivo, sem emoji.
camada: nome EXATO da lista abaixo se a foto for claramente dessa camada; senão null.
Não invente placa, coordenada ou nome que não esteja nítido na imagem.
"""


def _mime_from_path(path: Path) -> str:
    ext = path.suffix.lower()
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }.get(ext, "image/jpeg")


def _feedback_photo_file(photo_url: str) -> Path:
    name = Path(str(photo_url or "").replace("\\", "/")).name
    if not name or name.startswith("."):
        raise ValueError("Foto inválida.")
    folder = (Path(get_settings().upload_dir) / "feedback").resolve()
    dest = (folder / name).resolve()
    if dest.parent != folder or not dest.is_file():
        raise ValueError("Foto inválida.")
    return dest


def reconhecer_foto(photo_url: str, catalogo: list[str] | None = None) -> dict:
    """Lê a imagem gravada em uploads/feedback e descreve o conteúdo."""
    path = _feedback_photo_file(photo_url)
    settings = get_settings()
    api_key = (settings.openai_api_key or "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY não configurada no ambiente.")

    raw = path.read_bytes()
    if len(raw) > 8 * 1024 * 1024:
        raise ValueError("A foto é grande demais.")
    import base64

    b64 = base64.standard_b64encode(raw).decode("ascii")
    mime = _mime_from_path(path)
    cat = [str(n).strip() for n in (catalogo or []) if str(n).strip()][:40]
    lista = "\n".join(f"- {n}" for n in cat) if cat else "(vazio)"

    client = OpenAI(api_key=api_key)
    completion = client.chat.completions.create(
        model=settings.openai_model,
        temperature=0.1,
        max_tokens=280,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": _VISION_PROMPT},
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "Camadas do catálogo (nomes válidos):\n" + lista,
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime};base64,{b64}"},
                    },
                ],
            },
        ],
    )
    parsed = _parse_json(completion.choices[0].message.content or "")
    tipo = str(parsed.get("tipo") or "indefinido").strip().lower()
    if tipo not in {"correcao", "sugestao", "indefinido"}:
        tipo = "indefinido"
    descricao = str(parsed.get("descricao") or "").strip()[:500]
    if not descricao:
        descricao = "Não foi possível identificar o conteúdo da foto."
    camada = parsed.get("camada")
    if camada is not None:
        camada = str(camada).strip() or None
        if camada and camada not in set(cat):
            camada = None
    return {"tipo": tipo, "descricao": descricao, "camada": camada}
