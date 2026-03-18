import os
import platform

from dotenv import load_dotenv
from flask import Flask, send_from_directory
from flask_socketio import SocketIO

from backend.config import Config
from backend.routes.execution_routes import execution_bp
from backend.routes.room_routes import room_bp
from backend.sockets.socket_handlers import register_socket_handlers


def create_app() -> Flask:
    load_dotenv()
    app = Flask(
        __name__,
        static_folder=os.path.join(os.path.dirname(__file__), "..", "frontend"),
        static_url_path="/static",
    )
    app.config.from_object(Config)

    app.register_blueprint(execution_bp, url_prefix="/api")
    app.register_blueprint(room_bp, url_prefix="/api")

    @app.get("/")
    def index():
        return send_from_directory(app.static_folder, "index.html")

    @app.get("/room/<room_id>")
    def room(room_id: str):
        # Frontend reads ?room= or /room/<id>
        return send_from_directory(app.static_folder, "ide.html")

    @app.get("/compiler")
    def compiler():
        return send_from_directory(app.static_folder, "compiler.html")

    return app


def create_socketio(app: Flask) -> SocketIO:
    message_queue = app.config["REDIS_URL"] if app.config["USE_REDIS"] else None
    force_eventlet = os.getenv("FORCE_EVENTLET", "0") == "1"
    is_linux = platform.system().lower() == "linux"
    async_mode = "eventlet" if (force_eventlet or is_linux) else "threading"
    socketio = SocketIO(
        app,
        cors_allowed_origins="*",
        async_mode=async_mode,
        message_queue=message_queue,
        ping_interval=25,
        ping_timeout=60,
    )
    register_socket_handlers(socketio)
    return socketio
