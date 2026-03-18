import base64
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

import requests


LANGUAGE_IDS = {
    "cpp": 54,  # C++ (GCC 9.2.0)
    "python": 71,  # Python (3.8.1)
    "java": 62,  # Java (OpenJDK 13.0.1)
}


@dataclass
class Judge0Config:
    base_url: str
    rapidapi_key: str = ""
    rapidapi_host: str = ""
    timeout_s: int = 12
    poll_timeout_s: int = 18
    poll_interval_s: float = 0.8


class Judge0Service:
    def __init__(self, cfg: Judge0Config):
        self.cfg = cfg

    @staticmethod
    def from_flask_config(app_cfg: Dict[str, Any]) -> "Judge0Service":
        return Judge0Service(
            Judge0Config(
                base_url=app_cfg["JUDGE0_BASE_URL"].rstrip("/"),
                rapidapi_key=app_cfg.get("JUDGE0_RAPIDAPI_KEY", ""),
                rapidapi_host=app_cfg.get("JUDGE0_RAPIDAPI_HOST", ""),
            )
        )

    def _headers(self) -> Dict[str, str]:
        h = {"Content-Type": "application/json"}
        if self.cfg.rapidapi_key:
            h["X-RapidAPI-Key"] = self.cfg.rapidapi_key
        if self.cfg.rapidapi_host:
            h["X-RapidAPI-Host"] = self.cfg.rapidapi_host
        return h

    @staticmethod
    def _b64(s: str) -> str:
        return base64.b64encode(s.encode("utf-8")).decode("ascii")

    def execute(self, language: str, source_code: str, stdin: str = "") -> Dict[str, Any]:
        lang_id = LANGUAGE_IDS.get(language)
        if not lang_id:
            raise ValueError("Unsupported language for Judge0.")

        submit_url = f"{self.cfg.base_url}/submissions?base64_encoded=true&wait=false"
        body = {
            "language_id": lang_id,
            "source_code": self._b64(source_code),
            "stdin": self._b64(stdin or ""),
            "cpu_time_limit": 2,
            "wall_time_limit": 4,
            "memory_limit": 256000,
        }

        r = requests.post(submit_url, json=body, headers=self._headers(), timeout=self.cfg.timeout_s)
        r.raise_for_status()
        token = r.json().get("token")
        if not token:
            return {"stdout": "", "stderr": "Judge0: no token returned", "status": "ERROR"}

        return self._poll(token)

    def _poll(self, token: str) -> Dict[str, Any]:
        url = f"{self.cfg.base_url}/submissions/{token}?base64_encoded=true"
        start = time.time()
        last: Optional[Dict[str, Any]] = None
        while time.time() - start < self.cfg.poll_timeout_s:
            r = requests.get(url, headers=self._headers(), timeout=self.cfg.timeout_s)
            r.raise_for_status()
            data = r.json()
            last = data
            status = (data.get("status") or {}).get("id", 0)
            # 1 = In Queue, 2 = Processing, else terminal
            if status not in (1, 2):
                return self._normalize(data)
            time.sleep(self.cfg.poll_interval_s)
        return self._normalize(last or {"stderr": "Judge0 polling timed out", "status": {"description": "TIMEOUT"}})

    @staticmethod
    def _deb64(s: Optional[str]) -> str:
        if not s:
            return ""
        try:
            return base64.b64decode(s).decode("utf-8", errors="replace")
        except Exception:
            return s

    def _normalize(self, data: Dict[str, Any]) -> Dict[str, Any]:
        status = (data.get("status") or {}).get("description", "UNKNOWN")
        return {
            "stdout": self._deb64(data.get("stdout")),
            "stderr": self._deb64(data.get("stderr")) or self._deb64(data.get("compile_output")),
            "status": status,
            "time": data.get("time"),
            "memory": data.get("memory"),
        }
