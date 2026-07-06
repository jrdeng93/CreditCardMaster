# Local RAG Retrieval

CreditCardMaster has an optional local RAG layer for query understanding and evidence retrieval. It is disabled by default in public configuration and enabled only when `CCM_RAG_ENABLED=1`.

## Current Version

Internal version: `rag-v0.1`.

Runtime stack:

| Layer | Current choice |
| --- | --- |
| Framework | Python LangChain |
| Vector store | FAISS local index |
| Embeddings | Ollama `nomic-embed-text` |
| Node bridge | `src/rag-client.mjs` spawning `scripts/ccm_rag.py` |
| Index cache | `state/rag/faiss` with source fingerprint metadata |

Pinned Python dependencies are listed in `requirements-rag.txt`:

```text
langchain==1.3.11
langchain-community==0.4.2
langchain-ollama==1.1.0
faiss-cpu==1.14.3
```

## Indexed Sources

The retriever indexes local, non-secret data only:

| Source | Purpose |
| --- | --- |
| `data/offers.sqlite` | Active local offers, filtered to non-expired rows |
| `data/merchant-aliases.json` | Canonical merchant names, aliases, typos, and categories |
| `data/card-benefits.json` | Local private card benefit rules when present |
| `data/card-benefits.public.json` | Public fallback card benefit rules |

It does not read bank pages, browser sessions, cookies, passwords, MFA state, Discord secrets, or portal accounts.

## Supported Behavior

- Semantic and fuzzy merchant retrieval, including typo-prone queries such as `lululemom`.
- Merchant inference for short ambiguous checkout queries such as `visible`.
- Retrieval evidence from active offers, merchant aliases, and card benefit rules.
- FAISS index rebuild when source files or embedding model change.
- Safe fallback: if Python, Ollama, FAISS, or JSON parsing fails, Node continues with deterministic parsing and normal offer search.
- Integration with `/askccm`, CLI `ask`, and the existing recommendation flow through `searchWithRecommendations`.

## Commands

Build or rebuild the local index:

```bash
npm run rag:build
```

Retrieve evidence for a query:

```bash
npm run rag:query -- --query visible --k 5
```

Show the local RAG version/configuration:

```bash
npm run rag:version
```

Run the full assistant path with RAG enabled:

```bash
CCM_RAG_ENABLED=1 npm run ask -- "visible"
```

## Configuration

```text
CCM_RAG_ENABLED=0
CCM_RAG_PYTHON=.venv-rag/bin/python
CCM_RAG_EMBED_MODEL=nomic-embed-text
CCM_RAG_K=12
CCM_RAG_TIMEOUT_MS=15000
OLLAMA_URL=http://127.0.0.1:11434
```

`qwen3:4b` can still be used as the local chat/parser model through `OLLAMA_MODEL`, but it is not the embedding model. The RAG embedding model is `nomic-embed-text`.

## Current Limitations

- It is a subprocess bridge, not a persistent retrieval service. This is correct for fast local iteration but too slow for a polished Discord path if every query pays Python startup, FAISS load, and Ollama embedding latency.
- There is no learned reranker yet. Scores combine FAISS distance with a small lexical boost.
- There is no portal cash-back-rate API or Rakuten scraping. Portal output remains an entry/check link.
- RAG currently enriches intent and evidence; final answer composition still uses the existing deterministic recommendation formatter.
- There is no formal query evaluation harness for recent real Discord questions yet.

## Next Engineering Step

The next consolidation should split RAG into a long-running local retrieval service or cache-heavy worker, then add an evaluation file of real queries with expected merchant/category/card/offer outcomes. That will address both latency and regression control.
