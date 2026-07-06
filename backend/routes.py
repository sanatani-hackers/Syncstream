"""
REST endpoints (search, playlist import, recommendations, audio stream
proxy) plus serving of the frontend/ static files.

Extracted from main.py. Behavior is unchanged except the streaming
proxy below, which now has a request timeout, logs upstream failures
instead of letting an unhandled exception surface mid-stream (Phase 3),
and — critically — actually implements HTTP Range requests (see the
docstring on get_stream for why that matters).
"""
import logging
import os

import requests
from flask import Blueprint, Response, jsonify, request, send_from_directory

from .config import HOME_QUERIES, STREAM_PROXY_CHUNK_SIZE, STREAM_PROXY_TIMEOUT_SECONDS
from .youtube import fetch_playlist_results, fetch_search_results, fetch_stream_url

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BACKEND_DIR)
FRONTEND_DIR = os.path.join(PROJECT_ROOT, "frontend")

bp = Blueprint("main", __name__)


# --- Frontend static serving ---
@bp.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@bp.route("/css/<path:filename>")
def css_files(filename):
    return send_from_directory(os.path.join(FRONTEND_DIR, "css"), filename)


@bp.route("/js/<path:filename>")
def js_files(filename):
    return send_from_directory(os.path.join(FRONTEND_DIR, "js"), filename)


# --- REST API ---
@bp.route("/search")
def search():
    q = request.args.get("q", "")
    results = fetch_search_results(q)
    return jsonify({"results": results})


@bp.route("/playlist")
def import_playlist():
    url = request.args.get("url", "")
    results = fetch_playlist_results(url)
    return jsonify({"results": results})


@bp.route("/recommendations")
def get_recommendations():
    page = int(request.args.get("page", 1))
    query = HOME_QUERIES[(page - 1) % len(HOME_QUERIES)]
    results = fetch_search_results(query)
    return jsonify({"results": results})


# IMPORTANT: CORS Streaming Proxy for Web Audio API using Requests
@bp.route("/stream/<video_id>")
def get_stream(video_id):
    """
    Proxy the resolved YouTube audio stream, honoring HTTP Range requests.

    ROOT-CAUSE FIX: this endpoint used to advertise "Accept-Ranges: bytes"
    but never actually read/forwarded the incoming Range header — it
    always re-fetched the whole file from byte 0 and always answered
    "200 OK". Seeking in the <audio> element requests exactly this kind
    of unbuffered range (e.g. "Range: bytes=915000-"); the browser,
    having asked for a specific offset and gotten back a fresh stream
    starting at byte 0 with 200 OK instead of the expected 206 Partial
    Content, has no choice but to treat that as the start of playback —
    which is why seeking snapped back to 0:00. Forwarding the Range
    header upstream and mirroring whatever status/Content-Range the
    upstream CDN actually returns fixes this at the source.
    """
    url = fetch_stream_url(video_id)
    if not url:
        return jsonify({"error": "Stream not found"}), 404

    upstream_headers = {}
    range_header = request.headers.get('Range')
    if range_header:
        upstream_headers['Range'] = range_header

    try:
        upstream = requests.get(url, headers=upstream_headers, stream=True, timeout=STREAM_PROXY_TIMEOUT_SECONDS)
        upstream.raise_for_status()
    except requests.RequestException as e:
        logging.error(f"Stream proxy error for {video_id}: {e}")
        return jsonify({"error": "Stream unavailable"}), 502

    def generate(resp):
        try:
            for chunk in resp.iter_content(chunk_size=STREAM_PROXY_CHUNK_SIZE):
                if chunk:
                    yield chunk
        except requests.RequestException as e:
            logging.error(f"Stream proxy error while reading upstream for {video_id}: {e}")
        except GeneratorExit:
            # Client disconnected/seeked-away mid-stream; propagate so the
            # `finally` below still closes the upstream connection.
            raise
        finally:
            resp.close()

    # Mirror the upstream's actual status (206 for an honored Range
    # request, 200 for a full fetch) and range headers instead of always
    # claiming 200 — this is what lets the browser trust that its seek
    # actually landed at the requested offset.
    headers = {
        "Access-Control-Allow-Origin": "*",
        "Accept-Ranges": upstream.headers.get("Accept-Ranges", "bytes"),
        "Content-Type": upstream.headers.get("Content-Type", "audio/mp4"),
    }
    if "Content-Length" in upstream.headers:
        headers["Content-Length"] = upstream.headers["Content-Length"]
    if "Content-Range" in upstream.headers:
        headers["Content-Range"] = upstream.headers["Content-Range"]

    return Response(generate(upstream), status=upstream.status_code, headers=headers)
