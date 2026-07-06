import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 15000;

export function retrieveRagContext(query, options = {}) {
  const env = options.env || process.env;
  if (String(env.CCM_RAG_ENABLED || "0") !== "1") return null;

  const python = env.CCM_RAG_PYTHON || defaultPythonPath();
  const script = join(process.cwd(), "scripts", "ccm_rag.py");
  if (!existsSync(python) || !existsSync(script)) return null;

  const args = [
    script,
    "retrieve",
    "--query",
    String(query || ""),
    "--k",
    String(options.k ?? env.CCM_RAG_K ?? 12),
  ];

  const result = spawnSync(python, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: Number(env.CCM_RAG_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    env: {
      ...env,
      OFFER_DB_PATH: env.OFFER_DB_PATH || "./data/offers.sqlite",
      OLLAMA_URL: env.OLLAMA_URL || "http://127.0.0.1:11434",
      CCM_RAG_EMBED_MODEL: env.CCM_RAG_EMBED_MODEL || "nomic-embed-text",
    },
  });

  if (result.error || result.status !== 0) {
    if (env.CCM_RAG_DEBUG === "1") {
      console.warn(`RAG retrieve failed: ${result.error?.message || result.stderr || `exit ${result.status}`}`);
    }
    return null;
  }

  try {
    const lines = String(result.stdout || "").trim().split(/\r?\n/).filter(Boolean);
    return JSON.parse(lines.at(-1) || "{}");
  } catch (error) {
    if (env.CCM_RAG_DEBUG === "1") console.warn(`RAG JSON parse failed: ${error.message}`);
    return null;
  }
}

function defaultPythonPath() {
  return join(process.cwd(), ".venv-rag", "bin", "python");
}
