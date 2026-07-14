"""
Preferences read/write logic — including server-side validation of the
eq_settings JSON shape before it's ever persisted, since this data later
gets read back and fed directly into the client's Web Audio filter chain.
Trusting arbitrary client JSON into that path unchecked would be a real
data-integrity (and mild security) gap, not just a style concern.
"""
from datetime import datetime, timezone

from backend.auth.db import get_supabase

DEFAULT_PREFERENCES = {
    "volume": 1.0,
    "eq_settings": {
        "left": [0, 0, 0, 0, 0],
        "right": [0, 0, 0, 0, 0],
        "linked": True,
        "bypassed": False,
    },
    "theme": "dark",
    "last_room_id": None,
}

EQ_BAND_COUNT = 5  # matches audioEngine.js's eqBandsDef
EQ_GAIN_MIN = -12
EQ_GAIN_MAX = 12
MAX_THEME_LENGTH = 32
MAX_ROOM_ID_LENGTH = 50  # room IDs can be host-generated (6 chars) or freely typed when joining


class ValidationError(Exception):
    """Raised when a client-submitted preferences payload doesn't match
    the expected shape. routes.py turns this into a 400 response."""
    pass


def get_or_create_preferences(user_id: str) -> dict:
    """Preferences are created once, at first read, with defaults — not
    lazily inferred field-by-field. Means GET never has to special-case
    a missing row."""
    supabase = get_supabase()
    result = supabase.table("preferences").select("*").eq("user_id", user_id).limit(1).execute()
    if result.data:
        return result.data[0]

    row = {"user_id": user_id, **DEFAULT_PREFERENCES}
    created = supabase.table("preferences").insert(row).execute()
    return created.data[0]


def _validate_volume(value):
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValidationError("volume must be a number")
    if not (0.0 <= value <= 1.0):
        raise ValidationError("volume must be between 0.0 and 1.0")
    return float(value)


def _validate_eq_settings(value):
    if not isinstance(value, dict):
        raise ValidationError("eq_settings must be an object")

    for channel in ("left", "right"):
        if channel not in value:
            raise ValidationError(f"eq_settings.{channel} is required")
        gains = value[channel]
        if not isinstance(gains, list) or len(gains) != EQ_BAND_COUNT:
            raise ValidationError(f"eq_settings.{channel} must be an array of {EQ_BAND_COUNT} numbers")
        for gain in gains:
            if not isinstance(gain, (int, float)) or isinstance(gain, bool):
                raise ValidationError(f"eq_settings.{channel} values must be numbers")
            if not (EQ_GAIN_MIN <= gain <= EQ_GAIN_MAX):
                raise ValidationError(f"eq_settings.{channel} values must be between {EQ_GAIN_MIN} and {EQ_GAIN_MAX}")

    if "linked" in value and not isinstance(value["linked"], bool):
        raise ValidationError("eq_settings.linked must be a boolean")
    if "bypassed" in value and not isinstance(value["bypassed"], bool):
        raise ValidationError("eq_settings.bypassed must be a boolean")

    return {
        "left": [float(g) for g in value["left"]],
        "right": [float(g) for g in value["right"]],
        "linked": bool(value.get("linked", True)),
        "bypassed": bool(value.get("bypassed", False)),
    }


def _validate_theme(value):
    if not isinstance(value, str) or not value or len(value) > MAX_THEME_LENGTH:
        raise ValidationError(f"theme must be a non-empty string up to {MAX_THEME_LENGTH} characters")
    return value


def _validate_last_room_id(value):
    if value is None:
        return None
    if not isinstance(value, str) or not value or len(value) > MAX_ROOM_ID_LENGTH:
        raise ValidationError(f"last_room_id must be a non-empty string up to {MAX_ROOM_ID_LENGTH} characters")
    return value


_VALIDATORS = {
    "volume": _validate_volume,
    "eq_settings": _validate_eq_settings,
    "theme": _validate_theme,
    "last_room_id": _validate_last_room_id,
}


def update_preferences(user_id: str, updates: dict) -> dict:
    """
    Partial update — only fields present in `updates` are validated and
    written. Unknown fields are rejected outright (fail closed) rather
    than silently ignored, so a client-side typo surfaces immediately
    instead of quietly no-op'ing.
    """
    if not isinstance(updates, dict) or not updates:
        raise ValidationError("Request body must be a non-empty object")

    unknown = set(updates.keys()) - set(_VALIDATORS.keys())
    if unknown:
        raise ValidationError(f"Unknown preference field(s): {', '.join(sorted(unknown))}")

    validated = {key: _VALIDATORS[key](value) for key, value in updates.items()}
    validated["updated_at"] = datetime.now(timezone.utc).isoformat()

    get_or_create_preferences(user_id)  # ensure the row exists before updating it
    result = get_supabase().table("preferences").update(validated).eq("user_id", user_id).execute()
    return result.data[0]
