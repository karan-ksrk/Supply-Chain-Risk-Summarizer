"""
providers/llm.py
----------------
Unified LLM interface supporting Claude, OpenAI, and Ollama.
Swap providers by changing LLM_PROVIDER in your .env file.
"""

import os
import json
from dotenv import load_dotenv

load_dotenv()

PROVIDER = os.getenv("LLM_PROVIDER", "claude").lower()


def call_llm(prompt: str, system: str = "", expect_json: bool = False) -> str:
    """
    Single entry point for all LLM calls.
    Routes to the correct provider based on LLM_PROVIDER env var.
    """
    if PROVIDER == "claude":
        return _call_claude(prompt, system)
    elif PROVIDER == "openai":
        return _call_openai(prompt, system)
    elif PROVIDER == "ollama":
        return _call_ollama(prompt, system)
    else:
        raise ValueError(f"Unknown LLM_PROVIDER: {PROVIDER}. Choose claude | openai | ollama")


# ── Claude (Anthropic) ──────────────────────────────────────

def _call_claude(prompt: str, system: str) -> str:
    import anthropic
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

    messages = [{"role": "user", "content": prompt}]
    kwargs = {"model": "claude-opus-4-6", "max_tokens": 1024, "messages": messages}
    if system:
        kwargs["system"] = system

    response = client.messages.create(**kwargs)
    return response.content[0].text


# ── OpenAI ──────────────────────────────────────────────────

def _call_openai(prompt: str, system: str) -> str:
    from openai import OpenAI
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        max_tokens=1024,
    )
    return response.choices[0].message.content


# ── Ollama (local) ───────────────────────────────────────────

def _call_ollama(prompt: str, system: str) -> str:
    import requests

    base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    model = os.getenv("OLLAMA_MODEL", "llama3")

    full_prompt = f"{system}\n\n{prompt}" if system else prompt

    response = requests.post(
        f"{base_url}/api/generate",
        json={"model": model, "prompt": full_prompt, "stream": False},
        timeout=60,
    )
    response.raise_for_status()
    return response.json()["response"]


# ── Helper: safely parse JSON from LLM response ─────────────

def parse_json_response(raw: str) -> dict:
    """Strips markdown code fences and parses JSON from LLM output."""
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1]       # remove opening fence
        cleaned = cleaned.rsplit("```", 1)[0]       # remove closing fence
    try:
        return json.loads(cleaned.strip())
    except json.JSONDecodeError as e:
        raise ValueError(f"LLM did not return valid JSON.\nRaw output:\n{raw}\nError: {e}")
