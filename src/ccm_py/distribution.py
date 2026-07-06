from __future__ import annotations

import os


PUBLIC_DISTRIBUTION = "public"
PRIVATE_DISTRIBUTION = "private"
PUBLIC_ISSUERS = {"amex"}
PRIVATE_ISSUERS = {"amex", "chase", "citi"}


def get_distribution_mode() -> str:
    raw = os.environ.get("CCM_DISTRIBUTION", PRIVATE_DISTRIBUTION).strip().lower()
    return PUBLIC_DISTRIBUTION if raw == PUBLIC_DISTRIBUTION else PRIVATE_DISTRIBUTION


def enabled_issuers() -> set[str]:
    return PUBLIC_ISSUERS if get_distribution_mode() == PUBLIC_DISTRIBUTION else PRIVATE_ISSUERS


def is_issuer_enabled(issuer: str | None) -> bool:
    return str(issuer or "").strip().lower() in enabled_issuers()
