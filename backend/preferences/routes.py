"""
Preferences blueprint: GET/PUT /api/auth/preferences

Both require a valid session — there's no "anonymous preferences"
concept, so this uses require_auth (not optional_auth).
"""
from flask import Blueprint, g, jsonify, request

from backend.auth.dependencies import require_auth

from . import preferences_service

bp = Blueprint("preferences", __name__, url_prefix="/api/auth")


@bp.route("/preferences", methods=["GET"])
@require_auth
def get_preferences():
    prefs = preferences_service.get_or_create_preferences(g.session["user_id"])
    return jsonify({"preferences": prefs}), 200


@bp.route("/preferences", methods=["PUT"])
@require_auth
def put_preferences():
    updates = request.get_json(silent=True) or {}
    try:
        prefs = preferences_service.update_preferences(g.session["user_id"], updates)
    except preferences_service.ValidationError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify({"preferences": prefs}), 200
