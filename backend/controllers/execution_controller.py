from typing import Any, Dict, Tuple

from flask import Request, current_app

from backend.services.judge0_service import Judge0Service
from backend.compiler.minilang.interpreter import run_minilang
from backend.utils.security import RateLimiter, validate_execute_payload


_limiter = RateLimiter()


def execute_code(payload: Dict[str, Any], req: Request) -> Tuple[Dict[str, Any], int]:
    ok, error = validate_execute_payload(payload)
    if not ok:
        return {"ok": False, "error": error}, 400

    ip = (req.headers.get("X-Forwarded-For") or req.remote_addr or "unknown").split(",")[0].strip()
    rps = float(current_app.config["EXECUTE_RPS_PER_IP"])
    burst = float(current_app.config["EXECUTE_BURST_PER_IP"])
    if not _limiter.allow(f"exec:{ip}", rps=rps, burst=burst):
        return {"ok": False, "error": "Rate limit exceeded. Please wait a moment."}, 429

    language = payload["language"]
    code = payload["code"]
    stdin = payload.get("stdin", "")

    if language == "minilang":
        try:
            out = run_minilang(code)
            return {"ok": True, "mode": "minilang", "stdout": out, "stderr": "", "status": "OK"}, 200
        except Exception as e:  # surface interpreter errors cleanly
            return {"ok": False, "mode": "minilang", "stdout": "", "stderr": str(e), "status": "ERROR"}, 200

    svc = Judge0Service.from_flask_config(current_app.config)
    result = svc.execute(language=language, source_code=code, stdin=stdin)
    return {"ok": True, "mode": "judge0", **result}, 200
