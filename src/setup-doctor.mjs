import { existsSync } from "node:fs";
import { getAllowedUserIds, getDbPath } from "./config.mjs";
import { getDistributionMode, listEnabledIssuers } from "./distribution.mjs";
import { getStatus } from "./db.mjs";
import { loadWalletStrategy } from "./wallet-strategy.mjs";

const MIN_NODE_MAJOR = 22;
const MIN_NODE_MINOR = 5;

export function runSetupDoctor(db, options = {}) {
  const checks = [];
  const status = getStatus(db);
  const env = options.env || process.env;

  checks.push(checkNodeVersion());
  checks.push(checkEnvFile());
  checks.push(checkDatabase(status));
  checks.push(checkDistribution(env));
  checks.push(checkDiscord(env));
  checks.push(checkNewsMonitor(env));
  checks.push(checkOllama(env));
  checks.push(checkWalletStrategy());

  return {
    ok: checks.every((check) => check.status !== "fail"),
    checks,
  };
}

export function formatSetupDoctor(result) {
  return [
    "CreditCardMaster setup doctor",
    "",
    ...result.checks.map((check) => `${icon(check.status)} ${check.label}: ${check.message}`),
    "",
    result.ok ? "Ready for v0 usage." : "Fix failed checks before relying on the bot.",
  ].join("\n");
}

function checkNodeVersion() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  const ok = major > MIN_NODE_MAJOR || (major === MIN_NODE_MAJOR && minor >= MIN_NODE_MINOR);
  return {
    label: "Node.js",
    status: ok ? "pass" : "fail",
    message: `${process.versions.node}${ok ? "" : " is too old; use >=22.5"}`,
  };
}

function checkEnvFile() {
  return {
    label: ".env",
    status: existsSync(".env") ? "pass" : "warn",
    message: existsSync(".env") ? "found" : "not found; copy .env.example when setting up Discord",
  };
}

function checkDatabase(status) {
  return {
    label: "SQLite",
    status: "pass",
    message: `${getDbPath()} (${status.total} offers)`,
  };
}

function checkDistribution(env) {
  const mode = getDistributionMode(env);
  return {
    label: "Distribution",
    status: "pass",
    message: `${mode}; enabled issuers: ${listEnabledIssuers(env).join(", ")}`,
  };
}

function checkDiscord(env) {
  const missing = ["DISCORD_BOT_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_GUILD_ID"]
    .filter((key) => !env[key]);
  const allowedUsers = getAllowedUserIds(env);
  if (missing.length) {
    return {
      label: "Discord bot",
      status: "warn",
      message: `missing ${missing.join(", ")}; slash commands will not run yet`,
    };
  }
  return {
    label: "Discord bot",
    status: allowedUsers.size ? "pass" : "fail",
    message: allowedUsers.size
      ? `configured with ${allowedUsers.size} allowed user(s)`
      : "DISCORD_ALLOWED_USER_IDS is required; bot is fail-closed",
  };
}

function checkNewsMonitor(env) {
  const webhook = env.CREDITCARDMASTER_DISCORD_WEBHOOK_URL || env.DISCORD_WEBHOOK_URL;
  return {
    label: "Credit card news",
    status: webhook ? "pass" : "warn",
    message: webhook ? "webhook configured for briefings" : "webhook missing; preview works, sending is disabled",
  };
}

function checkOllama(env) {
  if (env.OFFER_DISABLE_LLM === "1") {
    return {
      label: "Ollama",
      status: "warn",
      message: "disabled; deterministic category parsing will be used",
    };
  }
  return {
    label: "Ollama",
    status: "pass",
    message: `${env.OLLAMA_MODEL || "qwen2.5:3b"} at ${env.OLLAMA_URL || "http://127.0.0.1:11434"}`,
  };
}

function checkWalletStrategy() {
  const strategy = loadWalletStrategy();
  return {
    label: "Wallet strategy",
    status: strategy.defaultFallbackCard || Object.keys(strategy.categoryFallbackCards || {}).length ? "pass" : "warn",
    message: strategy.defaultFallbackCard
      ? `default fallback: ${strategy.defaultFallbackCard}`
      : "no fallback card configured; catalog fallback rules will be used",
  };
}

function icon(status) {
  if (status === "pass") return "[ok]";
  if (status === "warn") return "[warn]";
  return "[fail]";
}
