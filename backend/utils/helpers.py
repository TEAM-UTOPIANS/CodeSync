import re
from typing import Any


_SAFE_TEXT = re.compile(r"[\x09\x0a\x0d\x20-\x7e\u00a0-\u024f]+")


def safe_str(value: Any, default: str = "", max_len: int = 128) -> str:
    if value is None:
        return default
    s = str(value)
    s = s.strip()
    if not s:
        return default
    m = _SAFE_TEXT.findall(s)
    s = "".join(m) if m else default
    return s[:max_len]
