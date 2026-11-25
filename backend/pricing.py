"""Price table for cost *estimates* (USD per 1M tokens).

Source: Google Cloud Billing Catalog API, service "Vertex AI" (C7E2-9256-1C43),
read on 2026-11-25. Standard online prediction on the global endpoint, prompts
up to 200K tokens (no caching, batch, flex or priority discounts).

Thinking / reasoning tokens are billed as output tokens. Gemini reports them
separately (`reasoning_tokens`); Claude and the MaaS models already include
them in their output count.

These are estimates: real bills depend on region, context length tier,
caching and contract discounts. Override or extend with the env var
PRICING_OVERRIDES='{"publisher/model": [input, output]}'.
"""

import json
import os
from typing import Any, Dict, Optional

PRICING_SOURCE = "Cloud Billing Catalog (Vertex AI), global endpoint, online, ≤200K context"
PRICING_DATE = "2026-11-25"

# model id (without @location) -> (input $/1M, output $/1M)
PRICES: Dict[str, tuple] = {
    "google/gemini-4-hydrogen": (1.50, 7.50),
    "google/gemini-4-neon": (3.00, 15.00),
    "google/gemini-4-carbon": (4.00, 20.00),
    "google/gemini-4-argon": (4.00, 20.00),
    "google/gemini-3.1-pro-preview": (2.00, 12.00),
    "google/gemini-3.8-flash": (1.50, 7.50),
    "google/gemini-3.5-flash-lite": (0.30, 2.50),
    "anthropic/claude-opus-5-5": (4.00, 20.00),
    "anthropic/claude-sonnet-5-5": (2.00, 10.00),
    "openai/gpt-oss-120b-maas": (0.09, 0.36),
    "deepseek-ai/deepseek-v4.1-flash-1017-maas": (0.30, 1.20),
    "zai-org/glm-5.2-maas": (1.40, 4.40),
}

try:
    for _model, (_in, _out) in json.loads(os.getenv("PRICING_OVERRIDES", "{}")).items():
        PRICES[_model] = (float(_in), float(_out))
except (ValueError, TypeError):
    pass


def price_for(model: str) -> Optional[tuple]:
    return PRICES.get(model.split("@")[0])


def estimate_cost(model: str, usage: Optional[Dict[str, Any]]) -> Optional[float]:
    """Estimated USD for one call, or None when the price or usage is unknown."""
    price = price_for(model)
    if price is None or not usage:
        return None
    input_tokens = usage.get("input_tokens") or 0
    billed_output = (usage.get("output_tokens") or 0) + (usage.get("reasoning_tokens") or 0)
    return (input_tokens * price[0] + billed_output * price[1]) / 1_000_000


def pricing_table() -> Dict[str, Any]:
    return {
        "source": PRICING_SOURCE,
        "date": PRICING_DATE,
        "currency": "USD",
        "per_million": {m: {"input": p[0], "output": p[1]} for m, p in PRICES.items()},
    }
