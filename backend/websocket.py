"""
WebSocket endpoint for room synchronization.

Phase 2 (Backend Cleanup): the message-type if/elif chain from Phase 1
is replaced with one handler function per message type, dispatched via
a lookup table. Each handler receives a small WSContext (ws, room_id,
room, client_id) instead of every branch re-deriving the same values,
which is what let the original chain sprawl.

Phase 3 (Memory Optimization / robustness): each incoming message is now
handled inside its own try/except, so a single malformed or unexpected
message logs an error and gets skipped instead of taking down the whole
connection (previously, any exception anywhere in the loop propagated to
the outer bare `except: pass`, silently ending that client's connection).
Rooms are also marked active/empty for the Phase 3 cleanup sweep, and the
autoplay background thread is now a daemon thread.

Auth integration: room join/create now requires a valid session, checked
ONCE at connection time, before any room is created or any message is
processed. This is a deliberate, narrowly-scoped exception to this
project's long-standing "room/WebSocket logic never depends on auth"
boundary — see docs/AUTH_ARCHITECTURE.md §7 for the full rationale. The
gate decides only whether a connection is admitted; nothing about
in-room identity, message handling, or host/queue logic below changes at
all. client_id remains the same ephemeral, per-tab, account-independent
identifier it always was.
"""
import json
import logging
import random
import threading
import time

from flask import request

from .auth.config import SESSION_COOKIE_NAME
from .auth.session_service import validate_session
from .config import AUTOPLAY_CANDIDATE_POOL, INITIAL_VOTE_COUNT
from .extensions import sock
from .room import (
    broadcast_room_state,
    get_or_create_room,
    mark_room_active,
    mark_room_empty,
    sort_queue,
)
from .youtube import fetch_search_results

# Application-defined WebSocket close code for "connection refused: not
# authenticated" (RFC 6455 reserves 4000-4999 for private/application
# use). The frontend must special-case this code to show a sign-in
# prompt instead of silently auto-retrying — see socket.js.
WS_CLOSE_UNAUTHORIZED = 4001


class WSContext:
    """Bundles the four values every handler needs so they don't have to
    be threaded through individually or re-looked-up from `rooms`."""
    __slots__ = ("ws", "room_id", "room", "client_id")

    def __init__(self, ws, room_id, room, client_id):
        self.ws = ws
        self.room_id = room_id
        self.room = room
        self.client_id = client_id

    @property
    def is_host(self) -> bool:
        return self.client_id == self.room["host_id"]


# --- Shared helpers used by multiple handlers ---

def _set_current_song(room: dict, song: dict, set_status_idle: bool = True):
    room["state"]["current_song"] = song
    room["state"]["time"], room["state"]["playing"] = 0.0, True
    room["state"]["updated_at"] = time.time()
    if set_status_idle:
        # NOTE: preserved from the original code — the bulk_request path
        # never set status back to "idle" here either. Left unchanged
        # (behavior-preserving refactor); worth a look in Phase 10.
        room["state"]["status"] = "idle"


def _play_next_from_queue(room: dict):
    if room["state"].get("play_mode") == "shuffle":
        idx = random.randint(0, len(room["queue"]) - 1)
        next_song = room["queue"].pop(idx)["song"]
    else:
        next_song = room["queue"].pop(0)["song"]
    _set_current_song(room, next_song)


def _start_autoplay_fetch(room_id: str, room: dict):
    room["is_fetching_autoplay"] = True
    room["state"]["status"] = "finding_next"
    broadcast_room_state(room_id)

    def fetch_and_play():
        try:
            curr_title = room["state"]["current_song"]["title"] if room["state"]["current_song"] else "trending hits"
            results = fetch_search_results(f"{curr_title} song")
            if results:
                _set_current_song(room, random.choice(results[:AUTOPLAY_CANDIDATE_POOL]))
            else:
                room["state"]["current_song"], room["state"]["playing"] = None, False
        except Exception as e:
            logging.error(f"Autoplay error in room {room_id}: {e}")
            room["state"]["current_song"], room["state"]["playing"] = None, False
        finally:
            room["state"]["status"] = "idle"
            room["is_fetching_autoplay"] = False
            broadcast_room_state(room_id)

    threading.Thread(target=fetch_and_play, daemon=True, name=f"autoplay-{room_id}").start()


# --- One handler per message type (Phase 2) ---

def _handle_join(ctx: WSContext, msg: dict):
    room = ctx.room
    user_name = msg.get("name", "User")
    no_host_yet = room["host_id"] is None
    requesting_host_role = msg.get("role") == "host" and not any(c["id"] == room["host_id"] for c in room["clients"])
    if no_host_yet or requesting_host_role:
        room["host_id"] = ctx.client_id
    room["clients"].append({"ws": ctx.ws, "id": ctx.client_id, "name": user_name})
    broadcast_room_state(ctx.room_id)


def _handle_sync(ctx: WSContext, msg: dict):
    if not ctx.is_host:
        return
    room = ctx.room
    room["state"]["playing"] = msg.get("playing", False)
    room["state"]["time"] = msg.get("time", 0.0)
    room["state"]["updated_at"] = time.time()

    sync_msg = json.dumps({
        "type": "sync", "playing": room["state"]["playing"],
        "time": room["state"]["time"], "timestamp": room["state"]["updated_at"]
    })
    for client in room["clients"]:
        if client["id"] != ctx.client_id:
            try:
                client["ws"].send(sync_msg)
            except Exception as e:
                logging.debug(f"Failed to relay sync to client {client.get('id')}: {e}")


def _handle_toggle_mode(ctx: WSContext, msg: dict):
    if not ctx.is_host:
        return
    ctx.room["state"]["play_mode"] = msg.get("mode", "straight")
    broadcast_room_state(ctx.room_id)


def _handle_toggle_room_eq(ctx: WSContext, msg: dict):
    if not ctx.is_host:
        return
    ctx.room["state"]["eq_allowed"] = msg.get("allowed", True)
    broadcast_room_state(ctx.room_id)


def _handle_force_play(ctx: WSContext, msg: dict):
    if not ctx.is_host:
        return
    room = ctx.room
    song_id = msg.get("song_id")
    for i, q_item in enumerate(room["queue"]):
        if q_item["song"]["id"] == song_id:
            _set_current_song(room, room["queue"].pop(i)["song"])
            break
    broadcast_room_state(ctx.room_id)


def _handle_request_song(ctx: WSContext, msg: dict):
    room = ctx.room
    song = msg.get("song")
    if any(q["song"]["id"] == song["id"] for q in room["queue"]):
        return
    if room["state"]["current_song"] is None:
        _set_current_song(room, song)
    else:
        room["queue"].append({"song": song, "votes": INITIAL_VOTE_COUNT, "voters": [ctx.client_id]})
        sort_queue(ctx.room_id)
    broadcast_room_state(ctx.room_id)


def _handle_bulk_request(ctx: WSContext, msg: dict):
    room = ctx.room
    songs = msg.get("songs", [])
    added = False
    for song in songs:
        already_queued = any(q["song"]["id"] == song["id"] for q in room["queue"])
        is_current = room["state"]["current_song"] is not None and room["state"]["current_song"]["id"] == song["id"]
        if already_queued or is_current:
            continue
        if room["state"]["current_song"] is None:
            # Preserved from the original: bulk_request's "start playing
            # immediately" path does not set status="idle", unlike every
            # other path that sets a current song.
            _set_current_song(room, song, set_status_idle=False)
        else:
            room["queue"].append({"song": song, "votes": INITIAL_VOTE_COUNT, "voters": [ctx.client_id]})
        added = True
    if added:
        sort_queue(ctx.room_id)
        broadcast_room_state(ctx.room_id)


def _handle_vote(ctx: WSContext, msg: dict):
    room = ctx.room
    song_id, direction = msg.get("song_id"), msg.get("direction", 1)
    for q_item in room["queue"]:
        if q_item["song"]["id"] == song_id:
            voters = q_item["voters"]
            if direction == 1 and ctx.client_id not in voters:
                q_item["votes"] += 1
                voters.append(ctx.client_id)
            elif direction == -1 and ctx.client_id in voters:
                q_item["votes"] -= 1
                voters.remove(ctx.client_id)
            break
    sort_queue(ctx.room_id)
    broadcast_room_state(ctx.room_id)


def _handle_next(ctx: WSContext, msg: dict):
    room = ctx.room
    if not (ctx.is_host or msg.get("auto") is True):
        return
    if room.get("is_fetching_autoplay"):
        return

    if len(room["queue"]) > 0:
        _play_next_from_queue(room)
        broadcast_room_state(ctx.room_id)
    else:
        _start_autoplay_fetch(ctx.room_id, room)


def _handle_ping(ctx: WSContext, msg: dict):
    try:
        ctx.ws.send(json.dumps({"type": "pong", "client_time": msg.get("client_time"), "server_time": time.time()}))
    except Exception as e:
        logging.debug(f"Failed to send pong to client {ctx.client_id}: {e}")


_HANDLERS = {
    "join": _handle_join,
    "sync": _handle_sync,
    "toggle_mode": _handle_toggle_mode,
    "toggle_room_eq": _handle_toggle_room_eq,
    "force_play": _handle_force_play,
    "request_song": _handle_request_song,
    "bulk_request": _handle_bulk_request,
    "vote": _handle_vote,
    "next": _handle_next,
    "ping": _handle_ping,
}


@sock.route('/ws/<room_id>/<client_id>')
def websocket_endpoint(ws, room_id, client_id):
    token = request.cookies.get(SESSION_COOKIE_NAME)
    session = validate_session(token)
    if not session:
        try:
            ws.send(json.dumps({
                "type": "error",
                "code": "unauthorized",
                "message": "Sign in to join a room."
            }))
        except Exception:
            pass
        try:
            ws.close(reason=WS_CLOSE_UNAUTHORIZED, message="unauthorized")
        except Exception:
            pass
        return  # never reaches get_or_create_room — no room is touched at all

    room = get_or_create_room(room_id)
    mark_room_active(room)  # cancel any pending empty-room cleanup for this room

    try:
        while True:
            data = ws.receive()
            if data is None:
                break

            try:
                msg = json.loads(data)
            except (TypeError, ValueError) as e:
                logging.warning(f"Malformed WebSocket message in room {room_id}: {e}")
                continue

            handler = _HANDLERS.get(msg.get("type"))
            if handler is None:
                continue

            ctx = WSContext(ws, room_id, room, client_id)
            try:
                handler(ctx, msg)
            except Exception as e:
                logging.error(f"Error handling '{msg.get('type')}' message in room {room_id}: {e}")

    except Exception as e:
        logging.debug(f"WebSocket loop ended for client {client_id} in room {room_id}: {e}")
    finally:
        room["clients"] = [c for c in room["clients"] if c["id"] != client_id]
        if room["host_id"] == client_id:
            room["host_id"] = room["clients"][0]["id"] if len(room["clients"]) > 0 else None
        if not room["clients"]:
            mark_room_empty(room)
        broadcast_room_state(room_id)
