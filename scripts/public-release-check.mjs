import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const BLOCKED_PATHS = [
  ".env",
  "data/offers.sqlite",
  "data/offers.sqlite-shm",
  "data/offers.sqlite-wal",
  "data/offers.sqlite.backup-before-amex-cleanup",
  "data/card-benefits.json",
  "data/query-evals.json",
  "data/wallet-strategy.json",
  "state",
  "node_modules",
  "launchd",
  "src/adapters/amex-browser.mjs",
  "src/adapters/amex-parser.mjs",
  "src/adapters/base.mjs",
  "src/adapters/fixture.mjs",
  "src/browser-launch.mjs",
  "src/cdp-client.mjs",
  "src/import-amex-offers.mjs",
  "src/refresh.mjs",
  "src/offer-sync.mjs",
  "src/snapshot-store.mjs",
  "test/amex-browser.test.mjs",
];
const BLOCKED_SOURCE_FILES = [
  "src/import-chase-offers.mjs",
  "src/import-citi-offers.mjs",
  "test/evals.test.mjs",
  "test/refresh.test.mjs",
  "test/regression.test.mjs",
];
const REQUIRED_FILES = [
  "README.md",
  "README.zh-CN.md",
  "LICENSE",
  ".env.example",
  ".gitignore",
  "package.json",
  "package-lock.json",
  "data/card-benefits.public.json",
  "data/category-taxonomy.json",
  "data/merchant-aliases.json",
  "data/wallet-strategy.public.json",
  "test/public.test.mjs",
];

const failures = [];
const warnings = [];

for (const path of REQUIRED_FILES) {
  if (!existsSync(join(ROOT, path))) failures.push(`Missing required public file: ${path}`);
}

for (const path of BLOCKED_PATHS) {
  if (existsSync(join(ROOT, path))) warnings.push(`Local-only path exists and must not be committed: ${path}`);
}

for (const path of BLOCKED_SOURCE_FILES) {
  if (existsSync(join(ROOT, path))) warnings.push(`Private issuer helper should be excluded from public export: ${path}`);
}

const gitignore = readFileSync(join(ROOT, ".gitignore"), "utf8");
for (const pattern of ["node_modules/", "data/*.sqlite", "data/card-benefits.json", "state/", "launchd/", ".agents/", ".codex/", ".env"]) {
  if (!gitignore.includes(pattern)) failures.push(`.gitignore must include ${pattern}`);
}

const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
for (const scriptName of ["import:chase", "import:citi", "eval"]) {
  if (packageJson.scripts?.[scriptName]) failures.push(`Public package.json should not expose ${scriptName}`);
}
for (const scriptName of ["bank-login", "import:amex"]) {
  if (packageJson.scripts?.[scriptName]) failures.push(`Public package.json should not expose browser integration script ${scriptName}`);
}

for (const file of listPublicTextFiles(ROOT)) {
  if (file === "scripts/public-release-check.mjs") continue;
  const text = readFileSync(join(ROOT, file), "utf8");
  if (/DISCORD_BOT_TOKEN=.+/i.test(text)) failures.push(`Possible Discord token in ${file}`);
  if (/https:\/\/discord\.com\/api\/webhooks\/\d+\//i.test(text)) failures.push(`Possible Discord webhook in ${file}`);
  if (/\/Users\/[A-Za-z0-9._-]+/.test(text)) failures.push(`Possible local absolute path in ${file}`);
  if (file !== "LICENSE" && /\b(jierendeng|jrdeng|jieren)\b/i.test(text)) failures.push(`Possible personal username in ${file}`);
  if (/\b100\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(text)) failures.push(`Possible Tailscale/private IP in ${file}`);
  if (/\baccountId=\d{6,}\b/i.test(text)) failures.push(`Possible bank account id in ${file}`);
  if (/\bselectedCCIndex=[0-9a-f-]{20,}\b/i.test(text)) failures.push(`Possible bank selected card id in ${file}`);
}

if (warnings.length) {
  console.log("Public release warnings:");
  for (const warning of warnings) console.log(`- ${warning}`);
  console.log("");
}

if (failures.length) {
  console.error("Public release check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Public release check passed.");
  if (warnings.length) {
    console.log("Warnings are expected in a private working tree. Confirm ignored/local-only files are not included in the GitHub repo.");
  }
}

function listPublicTextFiles(dir) {
  const entries = [];
  walk(dir);
  return entries;

  function walk(current) {
    for (const name of readdirSync(current)) {
      if ([".git", "node_modules", "state", "launchd"].includes(name)) continue;
      const path = join(current, name);
      const rel = relative(ROOT, path);
      const stats = statSync(path);
      if (rel.startsWith("data/") && !isPublicDataFile(rel)) continue;
      if (stats.isDirectory()) {
        walk(path);
        continue;
      }
      if (isPublicDataFile(rel) || /\.(mjs|js|json|md|svg|ya?ml|example|gitignore)$/.test(name) || [".env.example", ".gitignore"].includes(rel)) {
        entries.push(rel);
      }
    }
  }
}

function isPublicDataFile(rel) {
  return [
    "data/card-benefits.public.json",
    "data/category-taxonomy.json",
    "data/merchant-aliases.json",
    "data/wallet-strategy.public.json",
  ].includes(rel);
}
