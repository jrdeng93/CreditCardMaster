from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

from .util import ROOT


def retrieve_rag_context(query: str, k: int | None = None) -> dict[str, Any] | None:
    if os.environ.get("CCM_RAG_ENABLED", "0") != "1":
        return None
    python = Path(os.environ.get("CCM_RAG_PYTHON", str(ROOT / ".venv-rag" / "bin" / "python")))
    script = ROOT / "scripts" / "ccm_rag.py"
    if not python.exists() or not script.exists():
        return None
    args = [str(python), str(script), "retrieve", "--query", str(query or ""), "--k", str(k or os.environ.get("CCM_RAG_K", 12))]
    env = {
        **os.environ,
        "OFFER_DB_PATH": os.environ.get("OFFER_DB_PATH", "./data/offers.sqlite"),
        "OLLAMA_URL": os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434"),
        "CCM_RAG_EMBED_MODEL": os.environ.get("CCM_RAG_EMBED_MODEL", "nomic-embed-text"),
    }
    try:
        result = subprocess.run(
            args,
            cwd=ROOT,
            env=env,
            text=True,
            capture_output=True,
            timeout=float(os.environ.get("CCM_RAG_TIMEOUT_MS", "15000")) / 1000,
            check=False,
        )
    except Exception:
        return None
    if result.returncode != 0:
        return None
    lines = [line for line in result.stdout.splitlines() if line.strip()]
    if not lines:
        return None
    try:
        return json.loads(lines[-1])
    except json.JSONDecodeError:
        return None
