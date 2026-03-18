import time
from typing import Any, Dict

from flask import request
from flask_socketio import SocketIO, emit, join_room, leave_room

from backend.services.room_service import RoomService
from backend.utils.helpers import safe_str


def register_socket_handlers(socketio: SocketIO) -> None:
    @socketio.on("room:join")
    def room_join(payload: Dict[str, Any]):
        room_id = safe_str(payload.get("roomId", ""))
        name = safe_str(payload.get("name", "Anonymous"), max_len=32)
        role = safe_str(payload.get("role", "editor"), max_len=10)
        color = safe_str(payload.get("color", "#60a5fa"), max_len=16)

        if role not in ("host", "editor", "viewer"):
            role = "editor"

        room = RoomService.ensure_room(room_id)
        sid = request.sid

        join_room(room_id)

        if not room.host_sid:
            room.host_sid = sid
            role = "host"

        room.users[sid] = {
            "sid": sid,
            "name": name,
            "role": role,
            "color": color,
            "cursor": {"lineNumber": 1, "column": 1},
            "joinedAt": time.time(),
        }

        emit(
            "room:state",
            {
                "roomId": room_id,
                "me": room.users[sid],
                "hostSid": room.host_sid,
                "code": room.code,
                "language": room.language,
                "users": list(room.users.values()),
                "chat": room.chat[-200:],
            },
        )

        emit(
            "room:user_joined",
            {"user": room.users[sid]},
            room=room_id,
            include_self=False,
        )

    @socketio.on("room:leave")
    def room_leave(payload: Dict[str, Any]):
        room_id = safe_str(payload.get("roomId", ""))
        _leave_room_internal(room_id)

    def _leave_room_internal(room_id: str):
        if not room_id:
            return
        room = RoomService.get_room(room_id)
        sid = request.sid
        leave_room(room_id)
        if not room:
            return
        user = room.users.pop(sid, None)
        if user:
            emit("room:user_left", {"sid": sid}, room=room_id)
            emit("room:toast", {"kind": "info", "message": f'{user["name"]} left'}, room=room_id)

        if room.host_sid == sid:
            # Reassign host
            remaining = list(room.users.keys())
            room.host_sid = remaining[0] if remaining else ""
            if room.host_sid:
                room.users[room.host_sid]["role"] = "host"
                emit("room:host_changed", {"hostSid": room.host_sid}, room=room_id)

        RoomService.delete_room_if_empty(room_id)

    @socketio.on("disconnect")
    def disconnected():
        # We don't know room here; client will send room:leave normally.
        # Best-effort cleanup: scan rooms (in-memory).
        sid = request.sid
        for room_id, room in list(RoomService._rooms.items()):  # pylint: disable=protected-access
            if sid in room.users:
                _leave_room_internal(room_id)

    @socketio.on("editor:code")
    def editor_code(payload: Dict[str, Any]):
        room_id = safe_str(payload.get("roomId", ""))
        code = payload.get("code", "")
        version = int(payload.get("version", 0))
        room = RoomService.get_room(room_id)
        if not room:
            return
        sid = request.sid
        user = room.users.get(sid)
        if not user or user["role"] == "viewer":
            return

        # naive last-write-wins; for production, add OT/CRDT. This keeps UI responsive.
        room.code = str(code)
        emit("editor:code", {"code": room.code, "version": version, "fromSid": sid}, room=room_id, include_self=False)

    @socketio.on("editor:cursor")
    def editor_cursor(payload: Dict[str, Any]):
        room_id = safe_str(payload.get("roomId", ""))
        cursor = payload.get("cursor") or {}
        room = RoomService.get_room(room_id)
        if not room:
            return
        sid = request.sid
        user = room.users.get(sid)
        if not user:
            return
        user["cursor"] = {
            "lineNumber": int(cursor.get("lineNumber", 1)),
            "column": int(cursor.get("column", 1)),
        }
        emit("editor:cursor", {"sid": sid, "cursor": user["cursor"]}, room=room_id, include_self=False)

    @socketio.on("room:chat")
    def room_chat(payload: Dict[str, Any]):
        room_id = safe_str(payload.get("roomId", ""))
        message = safe_str(payload.get("message", ""), max_len=500)
        room = RoomService.get_room(room_id)
        if not room or not message:
            return
        sid = request.sid
        user = room.users.get(sid)
        if not user:
            return
        entry = {
            "id": f"{int(time.time()*1000)}-{sid[:6]}",
            "sid": sid,
            "name": user["name"],
            "color": user["color"],
            "message": message,
            "ts": time.time(),
        }
        room.chat.append(entry)
        room.chat = room.chat[-500:]
        emit("room:chat", entry, room=room_id)

    @socketio.on("room:set_language")
    def set_language(payload: Dict[str, Any]):
        room_id = safe_str(payload.get("roomId", ""))
        language = safe_str(payload.get("language", "python"), max_len=20)
        room = RoomService.get_room(room_id)
        if not room:
            return
        sid = request.sid
        user = room.users.get(sid)
        if not user or user["role"] not in ("host", "editor"):
            return
        room.language = language
        emit("room:language", {"language": language}, room=room_id)
