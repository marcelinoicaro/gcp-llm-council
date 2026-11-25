"""3-stage LLM Council orchestration."""

import asyncio
import time
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from .pricing import estimate_cost
from .vertex import query_model

# Optional async callback that receives progress events (dicts with a "type").
Emit = Optional[Callable[[Dict[str, Any]], Awaitable[None]]]


async def _emit(emit: Emit, event: Dict[str, Any]):
    if emit is not None:
        await emit(event)


async def _query_member(stage: str, model: str, messages: List[Dict[str, str]], emit: Emit) -> Dict[str, Any]:
    """Query one council member, timing it and reporting start/finish events."""
    await _emit(emit, {"type": "member_start", "stage": stage, "model": model})
    started = time.perf_counter()
    response = await query_model(model, messages)
    latency_ms = int((time.perf_counter() - started) * 1000)
    usage = (response or {}).get("usage")
    info = {
        "stage": stage,
        "model": model,
        "ok": response is not None,
        "latency_ms": latency_ms,
        "usage": usage,
        "cost_usd": estimate_cost(model, usage),
    }
    # The member's own output goes with its "done" event, so the UI can show
    # each answer/evaluation while slower members are still working.
    event = {"type": "member_done", **info}
    if response is not None:
        content = response.get("content", "")
        event["content"] = content
        if stage == "stage2":
            event["parsed_ranking"] = parse_ranking_from_text(content)
    await _emit(emit, event)
    return {"response": response, **info}


async def stage1_collect_responses(
    user_query: str, models: List[str], emit: Emit = None
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Stage 1: Collect individual responses from all council models.

    Returns:
        (results for the members that answered, per-member stats for all members)
    """
    messages = [{"role": "user", "content": user_query}]
    runs = await asyncio.gather(*(_query_member("stage1", m, messages, emit) for m in models))

    results = [
        {
            "model": run["model"],
            "response": run["response"].get("content", ""),
            "latency_ms": run["latency_ms"],
            "usage": run["usage"],
            "cost_usd": run["cost_usd"],
        }
        for run in runs
        if run["ok"]
    ]
    stats = [{k: run[k] for k in ("stage", "model", "ok", "latency_ms", "usage", "cost_usd")} for run in runs]
    return results, stats


def build_ranking_prompt(user_query: str, stage1_results: List[Dict[str, Any]]) -> Tuple[str, Dict[str, str]]:
    """Anonymize Stage 1 responses and build the Stage 2 ranking prompt."""
    labels = [chr(65 + i) for i in range(len(stage1_results))]  # A, B, C, ...
    label_to_model = {
        f"Response {label}": result['model']
        for label, result in zip(labels, stage1_results)
    }
    responses_text = "\n\n".join([
        f"Response {label}:\n{result['response']}"
        for label, result in zip(labels, stage1_results)
    ])

    ranking_prompt = f"""You are evaluating different responses to the following question:

Question: {user_query}

Here are the responses from different models (anonymized):

{responses_text}

Your task:
1. First, evaluate each response individually. For each response, explain what it does well and what it does poorly.
2. Then, at the very end of your response, provide a final ranking.

IMPORTANT: Your final ranking MUST be formatted EXACTLY as follows:
- Start with the line "FINAL RANKING:" (all caps, with colon)
- Then list the responses from best to worst as a numbered list
- Each line should be: number, period, space, then ONLY the response label (e.g., "1. Response A")
- Do not add any other text or explanations in the ranking section

Example of the correct format for your ENTIRE response:

Response A provides good detail on X but misses Y...
Response B is accurate but lacks depth on Z...
Response C offers the most comprehensive answer...

FINAL RANKING:
1. Response C
2. Response A
3. Response B

Now provide your evaluation and ranking:"""
    return ranking_prompt, label_to_model


async def stage2_collect_rankings(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    models: List[str],
    emit: Emit = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, str], List[Dict[str, Any]]]:
    """
    Stage 2: Each council member ranks the anonymized responses.

    Returns:
        (rankings, label_to_model mapping, per-member stats)
    """
    ranking_prompt, label_to_model = build_ranking_prompt(user_query, stage1_results)
    # Lets the UI de-anonymize evaluations as they arrive.
    await _emit(emit, {"type": "stage2_labels", "label_to_model": label_to_model})
    messages = [{"role": "user", "content": ranking_prompt}]
    runs = await asyncio.gather(*(_query_member("stage2", m, messages, emit) for m in models))

    results = []
    for run in runs:
        if run["ok"]:
            full_text = run["response"].get("content", "")
            results.append({
                "model": run["model"],
                "ranking": full_text,
                "parsed_ranking": parse_ranking_from_text(full_text),
                "latency_ms": run["latency_ms"],
                "usage": run["usage"],
                "cost_usd": run["cost_usd"],
            })
    stats = [{k: run[k] for k in ("stage", "model", "ok", "latency_ms", "usage", "cost_usd")} for run in runs]
    return results, label_to_model, stats


async def stage3_synthesize_final(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    stage2_results: List[Dict[str, Any]],
    chairman_model: str,
    emit: Emit = None,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """
    Stage 3: Chairman synthesizes final response.

    Returns:
        (result dict with 'model' and 'response', chairman stats)
    """
    stage1_text = "\n\n".join([
        f"Model: {result['model']}\nResponse: {result['response']}"
        for result in stage1_results
    ])

    stage2_text = "\n\n".join([
        f"Model: {result['model']}\nRanking: {result['ranking']}"
        for result in stage2_results
    ])

    chairman_prompt = f"""You are the Chairman of an LLM Council. Multiple AI models have provided responses to a user's question, and then ranked each other's responses.

Original Question: {user_query}

STAGE 1 - Individual Responses:
{stage1_text}

STAGE 2 - Peer Rankings:
{stage2_text}

Your task as Chairman is to synthesize all of this information into a single, comprehensive, accurate answer to the user's original question. Consider:
- The individual responses and their insights
- The peer rankings and what they reveal about response quality
- Any patterns of agreement or disagreement

Provide a clear, well-reasoned final answer that represents the council's collective wisdom:"""

    messages = [{"role": "user", "content": chairman_prompt}]
    run = await _query_member("stage3", chairman_model, messages, emit)
    stats = {k: run[k] for k in ("stage", "model", "ok", "latency_ms", "usage", "cost_usd")}

    if not run["ok"]:
        return {
            "model": chairman_model,
            "response": "Error: Unable to generate final synthesis.",
            "latency_ms": run["latency_ms"],
        }, stats

    return {
        "model": chairman_model,
        "response": run["response"].get("content", ""),
        "latency_ms": run["latency_ms"],
        "usage": run["usage"],
        "cost_usd": run["cost_usd"],
    }, stats


def parse_ranking_from_text(ranking_text: str) -> List[str]:
    """
    Parse the FINAL RANKING section from the model's response.

    Args:
        ranking_text: The full text response from the model

    Returns:
        List of response labels in ranked order
    """
    import re

    # Look for "FINAL RANKING:" section
    if "FINAL RANKING:" in ranking_text:
        # Extract everything after "FINAL RANKING:"
        parts = ranking_text.split("FINAL RANKING:")
        if len(parts) >= 2:
            ranking_section = parts[1]
            # Try to extract numbered list format (e.g., "1. Response A")
            # This pattern looks for: number, period, optional space, "Response X"
            numbered_matches = re.findall(r'\d+\.\s*Response [A-Z]', ranking_section)
            if numbered_matches:
                # Extract just the "Response X" part
                return [re.search(r'Response [A-Z]', m).group() for m in numbered_matches]

            # Fallback: Extract all "Response X" patterns in order
            matches = re.findall(r'Response [A-Z]', ranking_section)
            return matches

    # Fallback: try to find any "Response X" patterns in order
    matches = re.findall(r'Response [A-Z]', ranking_text)
    return matches


def calculate_aggregate_rankings(
    stage2_results: List[Dict[str, Any]],
    label_to_model: Dict[str, str]
) -> List[Dict[str, Any]]:
    """
    Calculate aggregate rankings across all models.

    Args:
        stage2_results: Rankings from each model
        label_to_model: Mapping from anonymous labels to model names

    Returns:
        List of dicts with model name and average rank, sorted best to worst
    """
    from collections import defaultdict

    # Track positions for each model
    model_positions = defaultdict(list)

    for ranking in stage2_results:
        ranking_text = ranking['ranking']

        # Parse the ranking from the structured format
        parsed_ranking = parse_ranking_from_text(ranking_text)

        for position, label in enumerate(parsed_ranking, start=1):
            if label in label_to_model:
                model_name = label_to_model[label]
                model_positions[model_name].append(position)

    # Calculate average position for each model
    aggregate = []
    for model, positions in model_positions.items():
        if positions:
            avg_rank = sum(positions) / len(positions)
            aggregate.append({
                "model": model,
                "average_rank": round(avg_rank, 2),
                "rankings_count": len(positions)
            })

    # Sort by average rank (lower is better)
    aggregate.sort(key=lambda x: x['average_rank'])

    return aggregate


async def generate_conversation_title(user_query: str, title_model: str) -> str:
    """
    Generate a short title for a conversation based on the first user message.

    Args:
        user_query: The first user message

    Returns:
        A short title (3-5 words)
    """
    title_prompt = f"""Generate a very short title (3-5 words maximum) that summarizes the following question.
The title should be concise and descriptive. Do not use quotes or punctuation in the title.

Question: {user_query}

Title:"""

    messages = [{"role": "user", "content": title_prompt}]

    # Use a small, fast model for title generation
    response = await query_model(title_model, messages, timeout=30.0)

    if response is None:
        # Fallback to a generic title
        return "New Conversation"

    title = response.get('content', 'New Conversation').strip()

    # Clean up the title - remove quotes, limit length
    title = title.strip('"\'')

    # Truncate if too long
    if len(title) > 50:
        title = title[:47] + "..."

    return title


def summarize_cost(members: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Estimated USD per stage and in total; `complete` is False when a call had no price."""
    by_stage: Dict[str, float] = {"stage1": 0.0, "stage2": 0.0, "stage3": 0.0}
    complete = True
    for m in members:
        if not m.get("ok"):
            continue
        if m.get("cost_usd") is None:
            complete = False
            continue
        by_stage[m["stage"]] += m["cost_usd"]
    return {"total_usd": sum(by_stage.values()), "by_stage_usd": by_stage, "complete": complete}


async def run_council(user_query: str, settings: Dict[str, Any], emit: Emit = None) -> Dict[str, Any]:
    """
    Run the complete 3-stage council process, reporting progress through `emit`.

    Returns:
        {"stage1", "stage2", "stage3", "metadata"}; metadata is persisted with the message.
    """
    members = settings["council_models"]
    chairman = settings["chairman_model"]
    started = time.perf_counter()
    durations: Dict[str, int] = {}

    def lap(stage: str, since: float) -> float:
        now = time.perf_counter()
        durations[stage] = int((now - since) * 1000)
        return now

    await _emit(emit, {"type": "stage1_start", "models": members})
    t = time.perf_counter()
    stage1, stage1_stats = await stage1_collect_responses(user_query, members, emit)
    t = lap("stage1", t)
    await _emit(emit, {"type": "stage1_complete", "data": stage1})

    metadata: Dict[str, Any] = {
        "council": members,
        "chairman": chairman,
        "label_to_model": {},
        "aggregate_rankings": [],
        "members": stage1_stats,
    }

    if not stage1:
        stage3 = {"model": "error", "response": "All models failed to respond. Please try again."}
        metadata.update(durations_ms=durations, duration_ms=int((time.perf_counter() - started) * 1000))
        return {"stage1": [], "stage2": [], "stage3": stage3, "metadata": metadata}

    await _emit(emit, {"type": "stage2_start", "models": members})
    stage2, label_to_model, stage2_stats = await stage2_collect_rankings(user_query, stage1, members, emit)
    t = lap("stage2", t)
    aggregate = calculate_aggregate_rankings(stage2, label_to_model)
    metadata.update(label_to_model=label_to_model, aggregate_rankings=aggregate)
    metadata["members"] += stage2_stats
    await _emit(emit, {
        "type": "stage2_complete",
        "data": stage2,
        "metadata": {"label_to_model": label_to_model, "aggregate_rankings": aggregate},
    })

    await _emit(emit, {"type": "stage3_start", "models": [chairman]})
    stage3, stage3_stats = await stage3_synthesize_final(user_query, stage1, stage2, chairman, emit)
    lap("stage3", t)
    metadata["members"].append(stage3_stats)
    metadata.update(durations_ms=durations, duration_ms=int((time.perf_counter() - started) * 1000))
    metadata["cost"] = summarize_cost(metadata["members"])
    await _emit(emit, {"type": "stage3_complete", "data": stage3})

    return {"stage1": stage1, "stage2": stage2, "stage3": stage3, "metadata": metadata}
