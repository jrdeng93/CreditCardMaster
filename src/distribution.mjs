export const PUBLIC_DISTRIBUTION = "public";
export const PRIVATE_DISTRIBUTION = "private";

export const PUBLIC_ISSUERS = ["amex"];
export const PRIVATE_ISSUERS = ["amex", "chase", "citi"];

export function getDistributionMode(env = process.env) {
  const raw = String(env.CCM_DISTRIBUTION || PRIVATE_DISTRIBUTION).trim().toLowerCase();
  return raw === PUBLIC_DISTRIBUTION ? PUBLIC_DISTRIBUTION : PRIVATE_DISTRIBUTION;
}

export function listEnabledIssuers(env = process.env) {
  return getDistributionMode(env) === PUBLIC_DISTRIBUTION
    ? [...PUBLIC_ISSUERS]
    : [...PRIVATE_ISSUERS];
}

export function isIssuerEnabled(issuer, env = process.env) {
  const normalized = normalizeIssuerName(issuer);
  return listEnabledIssuers(env).includes(normalized);
}

export function formatEnabledIssuers(env = process.env, { includeAll = false } = {}) {
  const issuers = listEnabledIssuers(env);
  return includeAll ? [...issuers, "all"].join(", ") : issuers.join(", ");
}

export function issuerChoices(env = process.env, { includeAll = false } = {}) {
  const choices = listEnabledIssuers(env).map((issuer) => ({
    name: issuerDisplayName(issuer),
    value: issuer,
  }));
  return includeAll ? [...choices, { name: "All", value: "all" }] : choices;
}

export function normalizeIssuerName(value) {
  return String(value || "").trim().toLowerCase();
}

function issuerDisplayName(issuer) {
  if (issuer === "amex") return "Amex";
  if (issuer === "chase") return "Chase";
  if (issuer === "citi") return "Citi";
  return issuer.slice(0, 1).toUpperCase() + issuer.slice(1);
}
