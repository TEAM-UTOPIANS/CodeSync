from flask import Blueprint, jsonify

from backend.controllers.room_controller import create_room


room_bp = Blueprint("rooms", __name__)


@room_bp.post("/rooms")
def create():
    room = create_room()
    return jsonify(room), 201
