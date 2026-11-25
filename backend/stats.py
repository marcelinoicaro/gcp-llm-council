"""Aggregate statistics across stored council runs (for the monitoring panel)."""

from collections import defaultdict
from statistics import mean, median
from typing import Any, Dict, List

from . import storage
from .pricing import estimate_cost


def _avg(values: List[float]):
    return round(mean(values), 2) if values else None


def compute_stats() -> Dict[str, Any]:
    runs = []
    for conversation in storage.iter_conversations():
        for message in conversation.get("messages", []):
            meta = message.get("metadata") if message.get("role") == "assistant" else None
            if meta and meta.get("members"):
                runs.append({"conversation_id": conversation["id"],
                             "title": conversation.get("title"),
                             "created_at": conversation.get("created_at"),
                             "meta": meta})

    per_model: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
        "runs": 0, "wins": 0, "ranks": [],
        "latency": {"stage1": [], "stage2": [], "stage3": []},
        "calls": 0, "failures": 0, "input_tokens": 0, "output_tokens": 0,
        "reasoning_tokens": 0, "cost_usd": 0.0, "unpriced_calls": 0,
        "chairman_runs": 0,
    })
    durations, total_calls, total_failures = [], 0, 0
    tokens_in = tokens_out = tokens_reasoning = 0
    total_cost, run_costs, unpriced = 0.0, [], 0
    recent = []

    for run in runs:
        meta = run["meta"]
        for model in meta.get("council", []):
            per_model[model]["runs"] += 1
        if meta.get("chairman"):
            per_model[meta["chairman"]]["chairman_runs"] += 1

        aggregate = meta.get("aggregate_rankings") or []
        for agg in aggregate:
            per_model[agg["model"]]["ranks"].append(agg["average_rank"])
        if aggregate:
            per_model[aggregate[0]["model"]]["wins"] += 1

        run_cost = 0.0
        for member in meta["members"]:
            entry = per_model[member["model"]]
            entry["calls"] += 1
            total_calls += 1
            if member.get("ok"):
                entry["latency"][member["stage"]].append(member["latency_ms"])
            else:
                entry["failures"] += 1
                total_failures += 1
            usage = member.get("usage") or {}
            entry["input_tokens"] += usage.get("input_tokens") or 0
            entry["output_tokens"] += usage.get("output_tokens") or 0
            entry["reasoning_tokens"] += usage.get("reasoning_tokens") or 0
            tokens_in += usage.get("input_tokens") or 0
            tokens_out += usage.get("output_tokens") or 0
            tokens_reasoning += usage.get("reasoning_tokens") or 0
            # Recomputed from usage so older runs (without stored cost) get estimates too.
            cost = estimate_cost(member["model"], usage) if member.get("ok") else None
            if cost is None and member.get("ok"):
                entry["unpriced_calls"] += 1
                unpriced += 1
            elif cost is not None:
                entry["cost_usd"] += cost
                run_cost += cost
        total_cost += run_cost
        run_costs.append(run_cost)

        if meta.get("duration_ms"):
            durations.append(meta["duration_ms"])
        recent.append({
            "conversation_id": run["conversation_id"],
            "title": run["title"],
            "created_at": run["created_at"],
            "duration_ms": meta.get("duration_ms"),
            "durations_ms": meta.get("durations_ms"),
            "members": len(meta.get("council", [])),
            "winner": aggregate[0]["model"] if aggregate else None,
            "failures": sum(1 for m in meta["members"] if not m.get("ok")),
            "cost_usd": run_cost,
        })

    models = []
    for model, e in per_model.items():
        models.append({
            "model": model,
            "runs": e["runs"],
            "wins": e["wins"],
            "chairman_runs": e["chairman_runs"],
            "average_rank": _avg(e["ranks"]),
            "latency_ms": {stage: (int(median(v)) if v else None) for stage, v in e["latency"].items()},
            "calls": e["calls"],
            "failures": e["failures"],
            "failure_rate": round(e["failures"] / e["calls"], 3) if e["calls"] else 0,
            "input_tokens": e["input_tokens"],
            "output_tokens": e["output_tokens"],
            "reasoning_tokens": e["reasoning_tokens"],
            "cost_usd": e["cost_usd"],
            "unpriced_calls": e["unpriced_calls"],
        })
    models.sort(key=lambda m: (m["average_rank"] is None, m["average_rank"] or 0))
    recent.sort(key=lambda r: r["created_at"] or "", reverse=True)

    return {
        "totals": {
            "runs": len(runs),
            "calls": total_calls,
            "failures": total_failures,
            "median_duration_ms": int(median(durations)) if durations else None,
            "input_tokens": tokens_in,
            "output_tokens": tokens_out,
            "reasoning_tokens": tokens_reasoning,
            "cost_usd": total_cost,
            "median_cost_usd": median(run_costs) if run_costs else None,
            "unpriced_calls": unpriced,
        },
        "models": models,
        "recent_runs": recent[:20],
    }
