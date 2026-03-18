import secrets
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional


@dataclass
class RoomState:
    room_id: str
    created_at: float
    host_sid: str
    # collaborative state
    code: str
    language: str
    users: Dict[str, Dict[str, Any]]  # sid -> {name, role, color, cursor}
    chat: list  # persisted in-memory for demo; can move to Redis/db


class RoomService:
    # In-process store; for scaling, replace with Redis store.
    _rooms: Dict[str, RoomState] = {}

    @staticmethod
    def _new_room_id() -> str:
        # URL-safe, short-ish
        return secrets.token_urlsafe(6).replace("-", "").replace("_", "")[:10]

    @classmethod
    def create_room(cls) -> Dict[str, Any]:
        room_id = cls._new_room_id()
        cls._rooms[room_id] = RoomState(
            room_id=room_id,
            created_at=time.time(),
            host_sid="",
            code="",
            language="python",
            users={},
            chat=[],
        )
        return {"roomId": room_id}

    @classmethod
    def get_room(cls, room_id: str) -> Optional[RoomState]:
        return cls._rooms.get(room_id)

    @classmethod
    def ensure_room(cls, room_id: str) -> RoomState:
        room = cls.get_room(room_id)
        if room is None:
            cls._rooms[room_id] = RoomState(
                room_id=room_id,
                created_at=time.time(),
                host_sid="",
                code="",
                language="python",
                users={},
                chat=[],
            )
            return cls._rooms[room_id]
        return room

    @classmethod
    def delete_room_if_empty(cls, room_id: str) -> None:
        room = cls._rooms.get(room_id)
        if not room:
            return
        if len(room.users) == 0:
            cls._rooms.pop(room_id, None)
