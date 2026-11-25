"""FastAPI backend for GCP LLM Council."""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import List, Dict, Any
from collections import deque
import logging
import os
import time
import uuid
import json
import asyncio

logger = logging.getLogger("llm_council")

# Security limits (overridable via environment)
MAX_MESSAGE_CHARS = int(os.getenv("MAX_MESSAGE_CHARS", "20000"))
MAX_MESSAGES_PER_MINUTE = int(os.getenv("MAX_MESSAGES_PER_MINUTE", "5"))

from . import storage
from . import settings as council_settings
from .config import GCP_LOCATION, GCP_PROJECT_ID, MODEL_TIMEOUT_SECONDS
from .council import generate_conversation_title, run_council
from .pricing import pricing_table
from .stats import compute_stats
from .vertex import identity, query_model

app = FastAPI(title="GCP LLM Council API")

# Reject requests whose Host header isn't local (blocks DNS rebinding)
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["localhost", "127.0.0.1"],
)

# Enable CORS for local development (no cookies are used, so no credentials)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type"],
)

MAX_MODEL_TESTS_PER_MINUTE = int(os.getenv("MAX_MODEL_TESTS_PER_MINUTE", "20"))

# Simple global rate limits for the paid endpoints (each message = many API calls)
_message_times: deque = deque()
_test_times: deque = deque()


def _limit(times: deque, max_per_minute: int, detail: str):
    now = time.monotonic()
    while times and now - times[0] > 60:
        times.popleft()
    if len(times) >= max_per_minute:
        raise HTTPException(status_code=429, detail=detail)
    times.append(now)


def enforce_rate_limit():
    """Raise 429 if more than MAX_MESSAGES_PER_MINUTE messages were sent in the last 60s."""
    _limit(_message_times, MAX_MESSAGES_PER_MINUTE, "Too many messages, try again in a minute")


class CreateConversationRequest(BaseModel):
    """Request to create a new conversation."""
    pass


class SendMessageRequest(BaseModel):
    """Request to send a message in a conversation."""
    content: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)


class SettingsRequest(BaseModel):
    """Council composition chosen in the settings screen."""
    council_models: List[str] = Field(min_length=1, max_length=council_settings.MAX_MEMBERS)
    chairman_model: str = Field(min_length=3, max_length=130)
    title_model: str = Field(min_length=3, max_length=130)


class ModelTestRequest(BaseModel):
    """A model to probe with a tiny prompt."""
    model: str = Field(min_length=3, max_length=130)


class ConversationMetadata(BaseModel):
    """Conversation metadata for list view."""
    id: str
    created_at: str
    title: str
    message_count: int


class Conversation(BaseModel):
    """Full conversation with all messages."""
    id: str
    created_at: str
    title: str
    messages: List[Dict[str, Any]]


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "GCP LLM Council API"}


@app.get("/api/conversations", response_model=List[ConversationMetadata])
async def list_conversations():
    """List all conversations (metadata only)."""
    return storage.list_conversations()


@app.post("/api/conversations", response_model=Conversation)
async def create_conversation(request: CreateConversationRequest):
    """Create a new conversation."""
    conversation_id = str(uuid.uuid4())
    conversation = storage.create_conversation(conversation_id)
    return conversation


@app.get("/api/conversations/{conversation_id}", response_model=Conversation)
async def get_conversation(conversation_id: uuid.UUID):
    """Get a specific conversation with all its messages."""
    conversation = storage.get_conversation(str(conversation_id))
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@app.delete("/api/conversations/{conversation_id}")
async def delete_conversation(conversation_id: uuid.UUID):
    """Delete a conversation."""
    if not storage.delete_conversation(str(conversation_id)):
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"deleted": True}


@app.get("/api/config")
async def get_config():
    """Current council settings, the model catalog and the active limits."""
    return {
        **council_settings.get_settings(),
        "catalog": council_settings.MODEL_CATALOG,
        "limits": {
            "min_members": council_settings.MIN_MEMBERS,
            "max_members": council_settings.MAX_MEMBERS,
            "max_message_chars": MAX_MESSAGE_CHARS,
            "max_messages_per_minute": MAX_MESSAGES_PER_MINUTE,
            "model_timeout_seconds": MODEL_TIMEOUT_SECONDS,
        },
        "vertex": {"project_id": GCP_PROJECT_ID, "location": GCP_LOCATION, "identity": identity()},
        "pricing": pricing_table(),
    }


@app.put("/api/config")
async def update_config(request: SettingsRequest):
    """Save the council composition (applies to the next question)."""
    try:
        council_settings.save_settings(request.council_models, request.chairman_model, request.title_model)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return await get_config()


@app.delete("/api/config")
async def reset_config():
    """Drop UI overrides and go back to the .env / config.py defaults."""
    council_settings.reset_settings()
    return await get_config()


@app.post("/api/models/test")
async def test_model(request: ModelTestRequest):
    """Probe one model with a tiny prompt and report latency."""
    try:
        model = council_settings.validate_model_id(request.model)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    _limit(_test_times, MAX_MODEL_TESTS_PER_MINUTE, "Too many model tests, try again in a minute")
    started = time.perf_counter()
    response = await query_model(model, [{"role": "user", "content": "Reply with just: ok"}], timeout=60.0)
    return {
        "model": model,
        "ok": response is not None,
        "latency_ms": int((time.perf_counter() - started) * 1000),
    }


@app.get("/api/stats")
async def get_stats():
    """Aggregated metrics across all stored council runs."""
    return compute_stats()


@app.post("/api/conversations/{conversation_id}/message")
async def send_message(conversation_id: uuid.UUID, request: SendMessageRequest):
    """
    Send a message and run the 3-stage council process.
    Returns the complete response with all stages.
    """
    conversation_id = str(conversation_id)
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    enforce_rate_limit()
    settings = council_settings.get_settings()
    is_first_message = len(conversation["messages"]) == 0
    storage.add_user_message(conversation_id, request.content)

    if is_first_message:
        title = await generate_conversation_title(request.content, settings["title_model"])
        storage.update_conversation_title(conversation_id, title)

    result = await run_council(request.content, settings)
    storage.add_assistant_message(
        conversation_id, result["stage1"], result["stage2"], result["stage3"], result["metadata"]
    )
    return result


@app.post("/api/conversations/{conversation_id}/message/stream")
async def send_message_stream(conversation_id: uuid.UUID, request: SendMessageRequest):
    """
    Send a message and stream the 3-stage council process.
    Returns Server-Sent Events for each stage and for each council member
    (member_start / member_done with latency and token usage).
    """
    conversation_id = str(conversation_id)
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    enforce_rate_limit()
    settings = council_settings.get_settings()
    is_first_message = len(conversation["messages"]) == 0

    async def event_generator():
        queue: asyncio.Queue = asyncio.Queue()
        done = object()

        async def emit(event: Dict[str, Any]):
            await queue.put(event)

        async def pipeline():
            try:
                storage.add_user_message(conversation_id, request.content)
                title_task = None
                if is_first_message:
                    title_task = asyncio.create_task(
                        generate_conversation_title(request.content, settings["title_model"])
                    )

                await emit({"type": "run_start", "council": settings["council_models"],
                            "chairman": settings["chairman_model"]})
                result = await run_council(request.content, settings, emit)

                if title_task:
                    title = await title_task
                    storage.update_conversation_title(conversation_id, title)
                    await emit({"type": "title_complete", "data": {"title": title}})

                storage.add_assistant_message(
                    conversation_id, result["stage1"], result["stage2"], result["stage3"], result["metadata"]
                )
                await emit({"type": "complete", "metadata": result["metadata"]})
            except Exception:
                # Log details server-side only; send a generic error to the client
                logger.exception("Council run failed for conversation %s", conversation_id)
                await emit({"type": "error", "message": "Internal error while running the council"})
            finally:
                await queue.put(done)

        task = asyncio.create_task(pipeline())
        try:
            while True:
                event = await queue.get()
                if event is done:
                    break
                yield f"data: {json.dumps(event)}\n\n"
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


if __name__ == "__main__":
    import uvicorn
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    uvicorn.run(app, host="127.0.0.1", port=8001)
