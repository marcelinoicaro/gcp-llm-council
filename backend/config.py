"""Configuration for the LLM Council."""

import os
from dotenv import load_dotenv

load_dotenv()


def _csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


# Google Cloud project and default Vertex AI location.
# Auth uses Application Default Credentials (`gcloud auth application-default login`
# locally, or the attached service account when deployed). No API keys.
GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID")
GCP_LOCATION = os.getenv("GCP_LOCATION", "global")

# Optional: call Vertex AI as this service account (least privilege). Your ADC
# only mints short-lived tokens for it; needs roles/iam.serviceAccountTokenCreator
# on the account (infra/terraform grants it to `impersonators`).
GCP_IMPERSONATE_SERVICE_ACCOUNT = os.getenv("GCP_IMPERSONATE_SERVICE_ACCOUNT") or None

# Council members - Vertex AI model identifiers in "<publisher>/<model>" form.
#   google/...     Gemini, via Vertex's OpenAI-compatible endpoint
#   anthropic/...  Claude, via the Anthropic SDK (AnthropicVertex)
#   anything else  Model Garden MaaS models (e.g. openai/gpt-oss-120b-maas)
# Append "@<location>" to override the location for one model,
# e.g. "openai/gpt-oss-120b-maas@us-central1".
# Partner models (Claude, most open models) must be enabled once in the
# Vertex AI Model Garden console before they can be called.
COUNCIL_MODELS = _csv(os.getenv(
    "COUNCIL_MODELS",
    "anthropic/claude-opus-5-5,"
    "openai/gpt-oss-120b-maas,"
    "deepseek-ai/deepseek-v4.1-flash-1017-maas,"
    "zai-org/glm-5.2-maas,"
    "google/gemini-4-argon,"
    "google/gemini-4-carbon,"
    "google/gemini-4-hydrogen,"
    "google/gemini-4-neon,"
    "google/gemini-3.8-flash,"
    "google/gemini-3.5-flash-lite",
))

# Chairman model - synthesizes final response
CHAIRMAN_MODEL = os.getenv("CHAIRMAN_MODEL", "google/gemini-4-hydrogen")

# Small, fast model used to title conversations
TITLE_MODEL = os.getenv("TITLE_MODEL", "google/gemini-3.8-flash")

# Per-request timeout (seconds) for council and chairman calls. Stage 2 is the
# slowest: every member reads all the other responses before ranking them.
MODEL_TIMEOUT_SECONDS = float(os.getenv("MODEL_TIMEOUT_SECONDS", "600"))

# Data directory for conversation storage
DATA_DIR = "data/conversations"
