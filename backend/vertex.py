"""Google Cloud Vertex AI client for making LLM requests.

Two routes, chosen by the model's publisher prefix:
- "anthropic/<model>": Claude through the official Anthropic SDK (AsyncAnthropicVertex).
- everything else: Vertex AI's OpenAI-compatible Chat Completions endpoint
  (Gemini and Model Garden MaaS models such as openai/gpt-oss-120b-maas).

Auth is Application Default Credentials, with the quota project pinned to
GCP_PROJECT_ID so a quota_project_id left in local ADC from another project
is never used.
"""

import asyncio
import logging
from typing import Any, Dict, List, Optional, Tuple

import anthropic
import google.auth
import google.auth.transport.requests
from google.auth import impersonated_credentials
import httpx

from .config import GCP_IMPERSONATE_SERVICE_ACCOUNT, GCP_LOCATION, GCP_PROJECT_ID, MODEL_TIMEOUT_SECONDS

logger = logging.getLogger("llm_council")

_SCOPES = ["https://www.googleapis.com/auth/cloud-platform"]

_credentials = None
_credentials_lock = asyncio.Lock()
_anthropic_clients: Dict[str, anthropic.AsyncAnthropicVertex] = {}


def _get_credentials():
    """ADC, or short-lived tokens of GCP_IMPERSONATE_SERVICE_ACCOUNT minted from ADC."""
    global _credentials
    if _credentials is None:
        source, _ = google.auth.default(scopes=_SCOPES, quota_project_id=GCP_PROJECT_ID)
        if GCP_IMPERSONATE_SERVICE_ACCOUNT:
            _credentials = impersonated_credentials.Credentials(
                source_credentials=source,
                target_principal=GCP_IMPERSONATE_SERVICE_ACCOUNT,
                target_scopes=_SCOPES,
                lifetime=3600,
            ).with_quota_project(GCP_PROJECT_ID)
            logger.info("Calling Vertex AI as service account %s", GCP_IMPERSONATE_SERVICE_ACCOUNT)
        else:
            _credentials = source
            logger.info("Calling Vertex AI with Application Default Credentials")
    return _credentials


def identity() -> str:
    """Who the app calls Vertex AI as (for the settings screen)."""
    return GCP_IMPERSONATE_SERVICE_ACCOUNT or "Application Default Credentials (sua conta)"


async def _access_token() -> str:
    """Return a valid OAuth access token, refreshing it off the event loop when needed."""
    async with _credentials_lock:
        creds = _get_credentials()
        if not creds.valid:
            await asyncio.to_thread(creds.refresh, google.auth.transport.requests.Request())
        return creds.token


def _split_model(model: str) -> Tuple[str, str, str]:
    """'publisher/name@location' -> (publisher, name, location)."""
    spec, _, location = model.partition("@")
    publisher, _, name = spec.partition("/")
    return publisher, name, location or GCP_LOCATION


def _host(location: str) -> str:
    return "aiplatform.googleapis.com" if location == "global" else f"{location}-aiplatform.googleapis.com"


async def _query_openai_compatible(
    publisher: str, name: str, location: str, messages: List[Dict[str, str]], timeout: float
) -> Optional[Dict[str, Any]]:
    url = (
        f"https://{_host(location)}/v1/projects/{GCP_PROJECT_ID}/locations/{location}"
        "/endpoints/openapi/chat/completions"
    )
    headers = {
        "Authorization": f"Bearer {await _access_token()}",
        "x-goog-user-project": GCP_PROJECT_ID,
        "Content-Type": "application/json",
    }
    payload = {"model": f"{publisher}/{name}", "messages": messages}

    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()

    if isinstance(data, list):  # Vertex sometimes wraps the body in a list
        data = data[0]
    message = data["choices"][0]["message"]
    usage = data.get("usage") or {}
    details = usage.get("completion_tokens_details") or {}
    return {
        "content": message.get("content") or "",
        "reasoning_details": message.get("reasoning_content"),
        "usage": {
            "input_tokens": usage.get("prompt_tokens"),
            "output_tokens": usage.get("completion_tokens"),
            # Gemini reports thinking separately (not inside completion_tokens);
            # MaaS models fold it into completion_tokens and send no detail.
            "reasoning_tokens": details.get("reasoning_tokens"),
        },
    }


def _anthropic_client(location: str) -> anthropic.AsyncAnthropicVertex:
    if location not in _anthropic_clients:
        _anthropic_clients[location] = anthropic.AsyncAnthropicVertex(
            project_id=GCP_PROJECT_ID,
            region=location,
            credentials=_get_credentials(),
        )
    return _anthropic_clients[location]


async def _query_claude(
    name: str, location: str, messages: List[Dict[str, str]], timeout: float
) -> Optional[Dict[str, Any]]:
    client = _anthropic_client(location)
    response = await client.with_options(timeout=timeout).messages.create(
        model=name,
        max_tokens=16000,
        messages=messages,
    )

    if response.stop_reason == "refusal":
        category = response.stop_details.category if response.stop_details else None
        logger.warning("Claude %s declined the request (category: %s)", name, category)
        return None

    text = "".join(block.text for block in response.content if block.type == "text")
    return {
        "content": text,
        "reasoning_details": None,
        "usage": {
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
        },
    }


async def query_model(
    model: str,
    messages: List[Dict[str, str]],
    timeout: float = MODEL_TIMEOUT_SECONDS,
) -> Optional[Dict[str, Any]]:
    """
    Query a single model on Vertex AI.

    Args:
        model: "<publisher>/<model>[@location]", e.g. "anthropic/claude-opus-5-5"
        messages: List of message dicts with 'role' and 'content'
        timeout: Request timeout in seconds

    Returns:
        Response dict with 'content' and optional 'reasoning_details', or None if failed
    """
    if not GCP_PROJECT_ID:
        logger.error("GCP_PROJECT_ID is not set; skipping %s", model)
        return None

    publisher, name, location = _split_model(model)

    try:
        if publisher == "anthropic":
            return await _query_claude(name, location, messages, timeout)
        return await _query_openai_compatible(publisher, name, location, messages, timeout)

    except anthropic.APIStatusError as e:
        logger.warning("Error querying model %s: %s (HTTP %s)", model, type(e).__name__, e.status_code)
    except anthropic.APIConnectionError as e:
        logger.warning("Error querying model %s: %s", model, type(e).__name__)
    except httpx.HTTPStatusError as e:
        logger.warning("Error querying model %s: HTTP %s", model, e.response.status_code)
    except Exception as e:
        logger.warning("Error querying model %s: %s", model, type(e).__name__)
    return None


async def query_models_parallel(
    models: List[str],
    messages: List[Dict[str, str]]
) -> Dict[str, Optional[Dict[str, Any]]]:
    """
    Query multiple models in parallel.

    Args:
        models: List of Vertex AI model identifiers
        messages: List of message dicts to send to each model

    Returns:
        Dict mapping model identifier to response dict (or None if failed)
    """
    responses = await asyncio.gather(*(query_model(model, messages) for model in models))
    return dict(zip(models, responses))
