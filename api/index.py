import os
import platform

# Monkey patch eventlet if needed (must happen before Flask imports)
force_eventlet = os.getenv("FORCE_EVENTLET", "0") == "1"
is_linux = platform.system().lower() == "linux"

if force_eventlet or is_linux:
    import eventlet
    eventlet.monkey_patch()

from backend.app import create_app, create_socketio

# Create Flask app for Vercel
app = create_app()
socketio = create_socketio(app)
