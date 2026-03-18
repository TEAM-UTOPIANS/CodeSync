import os


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")
    USE_REDIS = os.getenv("USE_REDIS", "0") == "1"
    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

    # Judge0
    JUDGE0_BASE_URL = os.getenv("JUDGE0_BASE_URL", "https://judge0-ce.p.rapidapi.com")
    JUDGE0_RAPIDAPI_KEY = os.getenv("JUDGE0_RAPIDAPI_KEY", "")
    JUDGE0_RAPIDAPI_HOST = os.getenv("JUDGE0_RAPIDAPI_HOST", "")

    # Simple IP rate limit defaults for /api/execute
    EXECUTE_RPS_PER_IP = float(os.getenv("EXECUTE_RPS_PER_IP", "0.25"))
    EXECUTE_BURST_PER_IP = float(os.getenv("EXECUTE_BURST_PER_IP", "2"))
