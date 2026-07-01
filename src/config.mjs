import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadEnv(path = ".env") {
  if (!existsSync(path)) return;

  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const index = trimmed.indexOf("=");
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    const rawValue = trimmed.slice(index + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

export function getDbPath() {
  return resolve(process.env.OFFER_DB_PATH || "./data/offers.sqlite");
}

export function getAllowedUserIds(env = process.env) {
  return new Set(
    (env.DISCORD_ALLOWED_USER_IDS || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

export function getOllamaConfig() {
  return {
    url: process.env.OLLAMA_URL || "http://127.0.0.1:11434",
    model: process.env.OLLAMA_MODEL || "qwen2.5:3b",
    timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS || 10000),
  };
}
