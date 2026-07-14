"""
In-memory room state for the synchronized listening rooms.

Phase 1: `rooms` dict + broadcast_room_state/sort_queue, extracted from
main.py, plus get_or_create_room() to replace the inline "create if
missing" block that used to live inside the websocket handler.

Phase 3 (Memory Optimization): rooms that empty out (last client leaves)
are no longer kept forever. They're flagged with a timestamp and swept
up by a periodic background thread after sitting empty for
EMPTY_ROOM_GRACE_SECONDS — long enough that a host's page refresh or a
brief connection drop doesn't wipe out the queue/state, short enough
that abandoned rooms don't accumulate in memory indefinitely.
"""
import json
import logging
import threading
import time

from .config import EMPTY_ROOM_GRACE_SECONDS, ROOM_CLEANUP_INTERVAL_SECONDS

rooms = {}


def _new_room_state():
    return {
        "host_id": None,
        "state": {
            "playing": False,
            "time": 0.0,
            "current_song": None,
            "updated_at": time.time(),
            "play_mode": "straight",
            "status": "idle",
            "eq_allowed": True
        },
        "queue": [],
        "clients": [],
        "is_fetching_autoplay": False,
        "empty_since": None
    }


def get_or_create_room(room_id: str) -> dict:
    if room_id not in rooms:
        rooms[room_id] = _new_room_state()
    return rooms[room_id]


def mark_room_active(room: dict):
    """Cancel any pending cleanup — someone is connected to this room."""
    room["empty_since"] = None


def mark_room_empty(room: dict):
    """Start the grace-period countdown toward eventual cleanup."""
    room["empty_since"] = time.time()


def broadcast_room_state(room_id: str):
    if room_id not in rooms:
        return
    room = rooms[room_id]
    state_msg = {
        "type": "room_state",
        "state": room["state"],
        "queue": room["queue"],
        "users": [
            {"id": c["id"], "name": c["name"], "role": "host" if c["id"] == room["host_id"] else "client"}
            for c in room["clients"]
        ]
    }
    msg_str = json.dumps(state_msg)
    dead_clients = []

    for client in room["clients"]:
        try:
            client["ws"].send(msg_str)
        except Exception as e:
            logging.debug(f"Dropping unreachable client {client.get('id')} in room {room_id}: {e}")
            dead_clients.append(client)

    for c in dead_clients:
        if c in room["clients"]:
            room["clients"].remove(c)


def sort_queue(room_id: str):
    if room_id in rooms:
        rooms[room_id]["queue"] = sorted(rooms[room_id]["queue"], key=lambda x: x["votes"], reverse=True)


def cleanup_stale_rooms():
    """Remove rooms that have been empty for longer than the grace period."""
    now = time.time()
    stale_ids = [
        room_id for room_id, room in list(rooms.items())
        if not room["clients"] and room.get("empty_since") and (now - room["empty_since"]) > EMPTY_ROOM_GRACE_SECONDS
    ]
    for room_id in stale_ids:
        del rooms[room_id]
        logging.info(f"Cleaned up empty room: {room_id}")


def start_room_cleanup_thread() -> threading.Thread:
    """Start the background sweep. Safe to call once at app startup."""
    def _loop():
        while True:
            time.sleep(ROOM_CLEANUP_INTERVAL_SECONDS)
            try:
                cleanup_stale_rooms()
            except Exception as e:
                logging.error(f"Room cleanup error: {e}")

    thread = threading.Thread(target=_loop, daemon=True, name="room-cleanup")
    thread.start()
    return thread
