"""Runtime council settings, editable from the UI.

Defaults come from config.py / .env. Changes made in the UI are persisted to
data/settings.json (private to the user, like conversations) and take effect
on the next question.
"""

import json
import os
import re
from typing import Any, Dict, List

from .config import CHAIRMAN_MODEL, COUNCIL_MODELS, DATA_DIR, TITLE_MODEL

SETTINGS_PATH = os.path.join(os.path.dirname(DATA_DIR), "settings.json")

MIN_MEMBERS = 2
MAX_MEMBERS = 12

# "publisher/model" with an optional "@location" suffix.
MODEL_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}/[A-Za-z0-9][A-Za-z0-9._-]{0,80}(@[a-z0-9-]{2,30})?$")

# Models known to exist on Vertex AI, grouped for the settings screen.
# Availability still depends on the project (Model Garden enablement, quota).
MODEL_CATALOG: List[Dict[str, str]] = [
    {"id": "google/gemini-4-hydrogen", "family": "Gemini"},
    {"id": "google/gemini-4-neon", "family": "Gemini"},
    {"id": "google/gemini-4-carbon", "family": "Gemini"},
    {"id": "google/gemini-4-argon", "family": "Gemini"},
    {"id": "google/gemini-3.1-pro-preview", "family": "Gemini"},
    {"id": "google/gemini-3.8-flash", "family": "Gemini"},
    {"id": "google/gemini-3.5-flash-lite", "family": "Gemini"},
    {"id": "anthropic/claude-opus-5-5", "family": "Claude"},
    {"id": "anthropic/claude-sonnet-5-5", "family": "Claude"},
    {"id": "anthropic/claude-haiku-5-5", "family": "Claude"},
    {"id": "openai/gpt-oss-120b-maas", "family": "OpenAI"},
    {"id": "deepseek-ai/deepseek-v4.1-flash-1017-maas", "family": "Open models"},
    {"id": "zai-org/glm-5.2-maas", "family": "Open models"},
]


def _defaults() -> Dict[str, Any]:
    return {
        "council_models": list(COUNCIL_MODELS),
        "chairman_model": CHAIRMAN_MODEL,
        "title_model": TITLE_MODEL,
    }


def get_settings() -> Dict[str, Any]:
    settings = _defaults()
    if os.path.exists(SETTINGS_PATH):
        try:
            with open(SETTINGS_PATH) as f:
                stored = json.load(f)
            settings.update({k: v for k, v in stored.items() if k in settings})
        except (OSError, ValueError):
            pass
    return settings


def validate_model_id(model: str) -> str:
    model = model.strip()
    if not MODEL_ID_RE.match(model):
        raise ValueError(f"Invalid model id: {model!r} (expected publisher/model[@location])")
    return model


def save_settings(council_models: List[str], chairman_model: str, title_model: str) -> Dict[str, Any]:
    members = list(dict.fromkeys(validate_model_id(m) for m in council_models))
    if not MIN_MEMBERS <= len(members) <= MAX_MEMBERS:
        raise ValueError(f"The council needs between {MIN_MEMBERS} and {MAX_MEMBERS} members")
    settings = {
        "council_models": members,
        "chairman_model": validate_model_id(chairman_model),
        "title_model": validate_model_id(title_model),
    }
    os.makedirs(os.path.dirname(SETTINGS_PATH), mode=0o700, exist_ok=True)
    fd = os.open(SETTINGS_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(settings, f, indent=2)
    return settings


def reset_settings() -> Dict[str, Any]:
    if os.path.exists(SETTINGS_PATH):
        os.remove(SETTINGS_PATH)
    return get_settings()
