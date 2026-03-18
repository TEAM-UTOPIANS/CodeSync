import os
import platform
import shutil
import subprocess
import time

force_eventlet = os.getenv("FORCE_EVENTLET", "0") == "1"
is_linux = platform.system().lower() == "linux"

if force_eventlet or is_linux:
    # IMPORTANT: eventlet must monkey_patch before Flask/Werkzeug imports.
    import eventlet

    eventlet.monkey_patch()

from backend.app import create_app, create_socketio


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=False, capture_output=True, text=True)


def _pids_listening_on_port(port: int) -> set[int]:
    system = platform.system().lower()
    pids: set[int] = set()

    if system in ("darwin", "linux"):
        if shutil.which("lsof"):
            # -t prints only PIDs
            out = _run(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"]).stdout.strip()
            for line in out.splitlines():
                line = line.strip()
                if line.isdigit():
                    pids.add(int(line))
            return pids

    if system == "windows":
        # netstat -ano includes PID; filter LISTENING lines that contain :port
        cp = _run(["cmd", "/c", "netstat -ano -p tcp"])
        for line in cp.stdout.splitlines():
            if "LISTENING" not in line.upper():
                continue
            if f":{port} " not in line and f":{port}\r" not in line and f":{port}\n" not in line:
                continue
            parts = line.split()
            if len(parts) >= 5 and parts[-1].isdigit():
                pids.add(int(parts[-1]))
        return pids

    return pids


def _kill_pid(pid: int) -> None:
    system = platform.system().lower()
    if system == "windows":
        _run(["taskkill", "/PID", str(pid), "/T", "/F"])
        return
    try:
        os.kill(pid, 15)  # SIGTERM
    except Exception:
        return


def free_port(port: int, *, wait_s: float = 1.2) -> None:
    """
    Aggressively free the port before starting the server.
    Opt-out by setting SKIP_PORT_KILL=1.
    """
    if os.getenv("SKIP_PORT_KILL", "0") == "1":
        return

    pids = _pids_listening_on_port(port)
    if not pids:
        return

    print(f"[CodeSync] Port {port} is in use. Stopping {len(pids)} process(es): {sorted(pids)}")
    for pid in pids:
        _kill_pid(pid)

    # wait a bit for OS to release the port
    deadline = time.time() + wait_s
    while time.time() < deadline:
        if not _pids_listening_on_port(port):
            return
        time.sleep(0.1)

    # if still in use, force-kill on unix
    system = platform.system().lower()
    if system in ("darwin", "linux"):
        still = _pids_listening_on_port(port)
        if still:
            print(f"[CodeSync] Port {port} still in use. Force-killing: {sorted(still)}")
            for pid in still:
                try:
                    os.kill(pid, 9)  # SIGKILL
                except Exception:
                    pass


def main() -> None:
    app = create_app()
    socketio = create_socketio(app)

    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "5000"))

    # Free the port for both localhost + LAN (0.0.0.0 binds all interfaces).
    free_port(port)

    allow_unsafe = socketio.async_mode == "threading"
    socketio.run(app, host=host, port=port, debug=False, allow_unsafe_werkzeug=allow_unsafe)


if __name__ == "__main__":
    main()
