#!/usr/bin/env python3
"""Local LangChain/FAISS retriever for CreditCardMaster.

This script intentionally stays local-first:
- reads local SQLite offers and JSON benefit/merchant data
- uses a local Ollama embedding model
- persists a FAISS index under state/rag
- returns JSON evidence for Node to make the final decision
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Any

warnings.filterwarnings("ignore", category=DeprecationWarning)

from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document
from langchain_ollama import OllamaEmbeddings


ROOT = Path(__file__).resolve().parents[1]
STATE_DIR = ROOT / "state" / "rag"
INDEX_DIR = STATE_DIR / "faiss"
META_PATH = STATE_DIR / "metadata.json"
DEFAULT_EMBED_MODEL = "nomic-embed-text"
DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"
RAG_VERSION = "rag-v0.1"
INDEX_VERSION = 1


@dataclass
class RagConfig:
    db_path: Path
    embed_model: str
    ollama_url: str


def main() -> int:
    parser = argparse.ArgumentParser(description="CreditCardMaster local RAG retriever")
    subparsers = parser.add_subparsers(dest="command", required=True)

    build_parser = subparsers.add_parser("build")
    add_common_args(build_parser)

    version_parser = subparsers.add_parser("version")
    add_common_args(version_parser)

    retrieve_parser = subparsers.add_parser("retrieve")
    add_common_args(retrieve_parser)
    retrieve_parser.add_argument("--query", required=True)
    retrieve_parser.add_argument("--k", type=int, default=12)

    args = parser.parse_args()
    config = config_from_args(args)

    if args.command == "build":
      build_index(config, force=True)
      print(json.dumps({"ok": True, "index": str(INDEX_DIR)}, ensure_ascii=False))
      return 0

    if args.command == "version":
      print(json.dumps(version_payload(config), ensure_ascii=False))
      return 0

    if args.command == "retrieve":
      vectorstore = load_or_build_index(config)
      result = retrieve(vectorstore, args.query, args.k)
      print(json.dumps(result, ensure_ascii=False))
      return 0

    return 1


def add_common_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--db", default=os.environ.get("OFFER_DB_PATH", "./data/offers.sqlite"))
    parser.add_argument("--embed-model", default=os.environ.get("CCM_RAG_EMBED_MODEL", DEFAULT_EMBED_MODEL))
    parser.add_argument("--ollama-url", default=os.environ.get("OLLAMA_URL", DEFAULT_OLLAMA_URL))


def config_from_args(args: argparse.Namespace) -> RagConfig:
    db_path = Path(args.db)
    if not db_path.is_absolute():
        db_path = ROOT / db_path
    return RagConfig(
        db_path=db_path,
        embed_model=args.embed_model,
        ollama_url=args.ollama_url,
    )


def load_or_build_index(config: RagConfig) -> FAISS:
    fingerprint = source_fingerprint(config)
    if INDEX_DIR.exists() and META_PATH.exists():
        try:
            metadata = json.loads(META_PATH.read_text(encoding="utf-8"))
            if metadata.get("fingerprint") == fingerprint:
                return FAISS.load_local(
                    str(INDEX_DIR),
                    embeddings(config),
                    allow_dangerous_deserialization=True,
                )
        except Exception:
            pass
    return build_index(config, force=True)


def build_index(config: RagConfig, force: bool = False) -> FAISS:
    del force
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    docs = build_documents(config)
    if not docs:
        raise RuntimeError("No RAG documents available to index.")

    vectorstore = FAISS.from_documents(docs, embeddings(config))
    vectorstore.save_local(str(INDEX_DIR))
    META_PATH.write_text(
        json.dumps({
            "fingerprint": source_fingerprint(config),
            "doc_count": len(docs),
            "embed_model": config.embed_model,
            "rag_version": RAG_VERSION,
            "version": INDEX_VERSION,
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return vectorstore


def embeddings(config: RagConfig) -> OllamaEmbeddings:
    return OllamaEmbeddings(model=config.embed_model, base_url=config.ollama_url)


def build_documents(config: RagConfig) -> list[Document]:
    docs: list[Document] = []
    docs.extend(offer_documents(config.db_path))
    docs.extend(merchant_documents())
    docs.extend(card_documents())
    return docs


def offer_documents(db_path: Path) -> list[Document]:
    if not db_path.exists():
        return []

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT id, issuer, card_name, card_last4, merchant, category, reward_text,
               min_spend, max_reward, expires_on, activation_required, activated,
               canonical_merchant, canonical_category
        FROM offers
        WHERE expires_on IS NULL OR date(expires_on) >= date('now', 'localtime')
        """
    ).fetchall()
    conn.close()

    docs: list[Document] = []
    for row in rows:
        merchant = row["canonical_merchant"] or row["merchant"]
        category = row["canonical_category"] or row["category"]
        text = "\n".join([
            f"Offer merchant: {merchant}",
            f"Raw merchant: {row['merchant']}",
            f"Category: {category}",
            f"Issuer: {row['issuer']}",
            f"Card: {row['card_name'] or ''} {row['card_last4'] or ''}",
            f"Reward: {row['reward_text']}",
            f"Expires: {row['expires_on'] or 'none'}",
        ])
        docs.append(Document(
            page_content=text,
            metadata={
                "type": "offer",
                "id": row["id"],
                "merchant": merchant,
                "category": category,
                "issuer": row["issuer"],
                "card_last4": row["card_last4"] or "",
                "reward_text": row["reward_text"],
            },
        ))
    return docs


def merchant_documents() -> list[Document]:
    path = ROOT / "data" / "merchant-aliases.json"
    if not path.exists():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    docs: list[Document] = []
    for merchant in payload.get("merchants", []):
        aliases = merchant.get("aliases", [])
        canonical = merchant.get("canonical", "")
        category = merchant.get("category", "")
        text = "\n".join([
            f"Merchant: {canonical}",
            f"Aliases: {', '.join(aliases)}",
            f"Category: {category}",
        ])
        docs.append(Document(
            page_content=text,
            metadata={
                "type": "merchant",
                "merchant": canonical,
                "category": category,
                "aliases": aliases,
            },
        ))
    return docs


def card_documents() -> list[Document]:
    path = ROOT / "data" / "card-benefits.json"
    if not path.exists():
        path = ROOT / "data" / "card-benefits.public.json"
    if not path.exists():
        return []

    payload = json.loads(path.read_text(encoding="utf-8"))
    docs: list[Document] = []
    for card in payload.get("cards", []):
        card_name = card.get("cardName", "")
        for rule in card.get("rules", []):
            text = "\n".join([
                f"Card: {card.get('issuer', '')} {card_name}",
                f"Aliases: {', '.join(card.get('aliases', []))}",
                f"Category: {rule.get('category', '')}",
                f"Keywords: {', '.join(rule.get('keywords', []))}",
                f"Summary: {rule.get('summary', '')}",
            ])
            docs.append(Document(
                page_content=text,
                metadata={
                    "type": "card_rule",
                    "issuer": card.get("issuer", ""),
                    "card_name": card_name,
                    "card_last4": card.get("cardLast4", ""),
                    "category": rule.get("category", ""),
                    "summary": rule.get("summary", ""),
                },
            ))
    return docs


def retrieve(vectorstore: FAISS, query: str, k: int) -> dict[str, Any]:
    docs_and_scores = vectorstore.similarity_search_with_score(query, k=k)
    candidates = []
    for doc, distance in docs_and_scores:
        metadata = dict(doc.metadata)
        lexical = lexical_score(query, doc.page_content)
        score = (1 / (1 + float(distance))) + lexical
        candidates.append({
            "score": score,
            "distance": float(distance),
            "lexical_score": lexical,
            "type": metadata.get("type"),
            "metadata": metadata,
            "content": doc.page_content[:700],
        })

    candidates.sort(key=lambda item: item["score"], reverse=True)
    merchant = best_merchant(candidates)
    return {
        "rag_version": RAG_VERSION,
        "query": query,
        "top": candidates,
        "merchant": merchant,
    }


def version_payload(config: RagConfig) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "rag_version": RAG_VERSION,
        "index_version": INDEX_VERSION,
        "framework": "langchain",
        "vector_store": "faiss",
        "embedding_provider": "ollama",
        "embedding_model": config.embed_model,
        "ollama_url": config.ollama_url,
        "index_dir": str(INDEX_DIR),
    }
    if META_PATH.exists():
        try:
            payload["metadata"] = json.loads(META_PATH.read_text(encoding="utf-8"))
        except Exception:
            payload["metadata"] = None
    return payload


def best_merchant(candidates: list[dict[str, Any]]) -> dict[str, Any] | None:
    scores: dict[str, dict[str, Any]] = {}
    for item in candidates:
        metadata = item["metadata"]
        merchant = metadata.get("merchant")
        if not merchant:
            continue
        key = compact(merchant)
        current = scores.setdefault(key, {
            "merchant": merchant,
            "category": metadata.get("category"),
            "score": 0.0,
            "evidence": [],
        })
        current["score"] += item["score"]
        current["evidence"].append({
            "type": item["type"],
            "score": item["score"],
            "content": item["content"],
        })

    ranked = sorted(scores.values(), key=lambda item: item["score"], reverse=True)
    if not ranked:
        return None
    if len(ranked) > 1 and ranked[1]["score"] >= ranked[0]["score"] * 0.95:
        return None
    if ranked[0]["score"] < 1.0:
        return None
    return ranked[0]


def lexical_score(query: str, text: str) -> float:
    query_tokens = [token for token in tokenize(query) if token not in GENERIC_TERMS]
    text_tokens = set(tokenize(text))
    compact_text = compact(text)
    score = 0.0
    for token in query_tokens:
        if token in text_tokens:
            score += 0.6
        elif len(token) >= 5 and token in compact_text:
            score += 0.4
    return score


GENERIC_TERMS = {
    "buy", "card", "cashback", "check", "deal", "offer", "offers", "portal",
    "purchase", "rakuten", "shop", "shopping", "store", "use", "which",
}


def tokenize(text: str) -> list[str]:
    return [token for token in re.split(r"[^a-z0-9]+", text.lower()) if len(token) > 1]


def compact(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def source_fingerprint(config: RagConfig) -> str:
    hasher = hashlib.sha256()
    hasher.update(str(INDEX_VERSION).encode())
    hasher.update(config.embed_model.encode())
    for path in [
        config.db_path,
        ROOT / "data" / "merchant-aliases.json",
        ROOT / "data" / "card-benefits.json",
        ROOT / "data" / "card-benefits.public.json",
    ]:
        if path.exists():
            stat = path.stat()
            hasher.update(str(path).encode())
            hasher.update(str(stat.st_mtime_ns).encode())
            hasher.update(str(stat.st_size).encode())
    return hasher.hexdigest()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise
