"""יומן השימוש במודלים, לפירוט העלות בפאנל "עלויות" (docs/platform-costs.md).

העותק הפייתוני של `supabase/functions/_shared/ai-usage.ts`, למנועים שרצים
ב-Actions (הלידים והמבזקים). שורה ל-`ai_usage_log` לכל קריאה למודל.

**לעולם לא מפיל את המנוע:** הניתוח כבר שולם והצליח, וזה רק פירוט - כשל נבלע
ונרשם ללוג.
"""
from __future__ import annotations

import logging
from typing import Any

import requests

log = logging.getLogger(__name__)


def _n(value: Any) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def usage_row(feature: str, model: str, usage: Any) -> dict:
    """שורה מ-usage של Anthropic (אובייקט ה-SDK). מטמון של שעה בנפרד."""
    write = _n(getattr(usage, "cache_creation_input_tokens", 0))
    detail = getattr(usage, "cache_creation", None)
    write_1h = min(write, _n(getattr(detail, "ephemeral_1h_input_tokens", 0)))
    return {
        "feature": feature,
        "provider": "anthropic",
        "model": str(model or ""),
        "uncached_input_tokens": _n(getattr(usage, "input_tokens", 0)),
        "cache_read_tokens": _n(getattr(usage, "cache_read_input_tokens", 0)),
        "cache_write_tokens": write - write_1h,
        "cache_write_1h_tokens": write_1h,
        "output_tokens": _n(getattr(usage, "output_tokens", 0)),
    }


def log_ai_usage(supabase_url: str, service_key: str, feature: str, response: Any) -> None:
    """כותב שורה ליומן מתשובה של Claude. לא זורק."""
    usage = getattr(response, "usage", None)
    model = getattr(response, "model", "")
    if usage is None or not model or not supabase_url or not service_key:
        return
    try:
        res = requests.post(
            f"{supabase_url.rstrip('/')}/rest/v1/ai_usage_log",
            json=usage_row(feature, model, usage),
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Prefer": "return=minimal",
            },
            timeout=5,
        )
        if res.status_code >= 300:
            log.warning("ai usage log failed %s: %s", res.status_code, res.text[:200])
    except requests.RequestException as err:
        log.warning("ai usage log failed: %s", err)
