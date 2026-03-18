import time
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple


def validate_execute_payload(payload: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
    language = payload.get("language")
    code = payload.get("code")
    stdin = payload.get("stdin", "")

    if language not in ("cpp", "python", "java", "minilang"):
        return False, "Unsupported language."
    if not isinstance(code, str) or len(code.strip()) == 0:
        return False, "Code is required."
    if len(code) > 200_000:
        return False, "Code too large."
    if not isinstance(stdin, str):
        return False, "stdin must be a string."
    if len(stdin) > 50_000:
        return False, "stdin too large."
    return True, None


@dataclass
class _Bucket:
    tokens: float
    last_ts: float


class RateLimiter:
    """
    Lightweight in-memory token bucket.
    For multi-instance production, replace with Redis-based limiter.
    """

    def __init__(self) -> None:
        self._buckets: Dict[str, _Bucket] = {}

    def allow(self, key: str, rps: float, burst: float) -> bool:
        now = time.time()
        b = self._buckets.get(key)
        if b is None:
            b = _Bucket(tokens=burst, last_ts=now)
            self._buckets[key] = b
        # refill
        elapsed = max(0.0, now - b.last_ts)
        b.tokens = min(burst, b.tokens + elapsed * rps)
        b.last_ts = now
        if b.tokens >= 1.0:
            b.tokens -= 1.0
            return True
        return False
