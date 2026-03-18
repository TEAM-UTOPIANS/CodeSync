from flask import Blueprint, jsonify, request

from backend.controllers.execution_controller import execute_code


execution_bp = Blueprint("execution", __name__)


@execution_bp.post("/execute")
def execute():
    payload = request.get_json(silent=True) or {}
    result, status = execute_code(payload, request)
    return jsonify(result), status
