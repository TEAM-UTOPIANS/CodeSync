import time
from typing import Any, Dict

from flask import request
from flask_socketio import SocketIO, emit, join_room, leave_room

from backend.services.room_service import RoomService
from backend.utils.helpers import safe_str


def _apply_ops(text: str, ops: list[dict]) -> str:
    # ops are applied in order; positions refer to current text at time of application
    for op in ops:
        pos = int(op.get("pos", 0))
        delete = int(op.get("del", 0))
        ins = str(op.get("ins", ""))
        pos = max(0, min(len(text), pos))
        if delete:
            delete = max(0, min(len(text) - pos, delete))
            text = text[:pos] + text[pos + delete :]
        if ins:
            text = text[:pos] + ins + text[pos:]
    return text


def _transform(a: dict, b: dict) -> dict:
    """
    Transform op a against op b (b happened before a).
    op: {pos, del, ins}
    This is a simple text OT transform sufficient for single-line edits / Monaco change events.
    """
    a_pos, a_del, a_ins = int(a["pos"]), int(a.get("del", 0)), str(a.get("ins", ""))
    b_pos, b_del, b_ins = int(b["pos"]), int(b.get("del", 0)), str(b.get("ins", ""))

    # If b inserts before a, shift a right
    if b_ins:
        if b_pos < a_pos or (b_pos == a_pos and not a_ins):
            a_pos += len(b_ins)

    # If b deletes before a, shift a left; handle overlap
    if b_del:
        b_end = b_pos + b_del
        if b_end <= a_pos:
            a_pos -= b_del
        elif b_pos < a_pos < b_end:
            # a starts inside deleted range; clamp to deletion start
            a_pos = b_pos
        # If a deletes overlapping b's deletion, shrink a's delete
        if a_del:
            a_end = a_pos + a_del
            # compute overlap in original coordinate space (approx)
            overlap_start = max(a_pos, b_pos)
            overlap_end = min(a_end, b_end)
            if overlap_end > overlap_start:
                a_del = max(0, a_del - (overlap_end - overlap_start))

    return {"pos": a_pos, "del": a_del, "ins": a_ins}


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
                "language": room.language,
                "files": list(room.files.values()),
                # Back-compat for older clients expecting a single document
                "code": (room.files.get("main") or {"content": ""}).get("content", ""),
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

    @socketio.on("file:create")
    def file_create(payload: Dict[str, Any]):
        room_id = safe_str(payload.get("roomId", ""))
        path = safe_str(payload.get("path", ""), max_len=128)
        room = RoomService.get_room(room_id)
        if not room or not path:
            return
        sid = request.sid
        user = room.users.get(sid)
        if not user or user["role"] == "viewer":
            return
        if path in room.files:
            return
        room.files[path] = {"path": path, "content": "", "rev": 0, "ops": []}
        emit("file:created", {"file": room.files[path]}, room=room_id)

    @socketio.on("editor:op")
    def editor_op(payload: Dict[str, Any]):
        room_id = safe_str(payload.get("roomId", ""))
        path = safe_str(payload.get("path", "main"), max_len=128) or "main"
        base_rev = int(payload.get("baseRev", 0))
        ops = payload.get("ops") or []
        room = RoomService.get_room(room_id)
        if not room:
            return
        sid = request.sid
        user = room.users.get(sid)
        if not user or user["role"] == "viewer":
            return
        file = room.files.get(path)
        if not file:
            room.files[path] = {"path": path, "content": "", "rev": 0, "ops": []}
            file = room.files[path]

        # transform incoming ops against history since base_rev
        history = file["ops"]
        current_rev = int(file["rev"])
        if base_rev < 0:
            base_rev = 0
        if base_rev > current_rev:
            base_rev = current_rev

        transformed_ops: list[dict] = []
        for op in ops:
            t = {"pos": int(op.get("pos", 0)), "del": int(op.get("del", 0)), "ins": str(op.get("ins", ""))}
            for h in history[base_rev:]:
                t = _transform(t, h)
            transformed_ops.append(t)
            # update history as we go so subsequent ops transform correctly
            history.append(t)
            current_rev += 1

        # apply to authoritative content
        file["content"] = _apply_ops(file["content"], transformed_ops)
        file["rev"] = current_rev
        # bound ops history to last N ops; adjust rev window by trimming from front
        max_ops = 2000
        if len(history) > max_ops:
            trim = len(history) - max_ops
            del history[:trim]
            # we also need to clamp rev base expectations; clients will resync via full file if too old
        emit(
            "editor:op",
            {"path": path, "baseRev": base_rev, "ops": transformed_ops, "rev": file["rev"], "fromSid": sid},
            room=room_id,
            include_self=False,
        )
        # Ack sender so client can clear local pending ops
        emit(
            "editor:ack",
            {"path": path, "acceptedOps": len(ops), "rev": file["rev"]},
            to=sid,
        )

    @socketio.on("editor:code")
    def editor_code_backcompat(payload: Dict[str, Any]):
        """
        Back-compat: accept whole-document updates from older clients, but apply them via OT
        as a single replace op to avoid last-write-wins overwrites.
        """
        room_id = safe_str(payload.get("roomId", ""))
        code = str(payload.get("code", ""))
        room = RoomService.get_room(room_id)
        if not room:
            return
        sid = request.sid
        user = room.users.get(sid)
        if not user or user["role"] == "viewer":
            return

        path = "main"
        file = room.files.get(path)
        if not file:
            room.files[path] = {"path": path, "content": "", "rev": 0, "ops": []}
            file = room.files[path]

        # Replace entire document as an OT op (delete all + insert new)
        base_rev = int(file["rev"])
        ops = [{"pos": 0, "del": len(file["content"]), "ins": code}]
        # Reuse OT pipeline by calling editor_op logic inline
        payload2 = {"roomId": room_id, "path": path, "baseRev": base_rev, "ops": ops}
        editor_op(payload2)  # type: ignore[misc]

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

    @socketio.on("room:set_role")
    def set_role(payload: Dict[str, Any]):
        room_id = safe_str(payload.get("roomId", ""))
        target_sid = safe_str(payload.get("targetSid", ""), max_len=128)
        role = safe_str(payload.get("role", ""), max_len=10)
        if role not in ("editor", "viewer"):
            return
        room = RoomService.get_room(room_id)
        if not room or not target_sid:
            return
        sid = request.sid
        actor = room.users.get(sid)
        if not actor or actor.get("role") != "host":
            return
        target = room.users.get(target_sid)
        if not target:
            return
        # Host role cannot be downgraded here.
        if target_sid == room.host_sid:
            return
        target["role"] = role
        emit("room:role_updated", {"sid": target_sid, "role": role}, room=room_id)
