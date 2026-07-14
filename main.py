"""
SyncStream backend entry point.

Run this file with: python main.py
Requires: pip install flask flask-sock yt-dlp requests supabase
"""
import logging

from flask import Flask

from backend.config import HOST, PORT
from backend.extensions import sock
from backend.room import start_room_cleanup_thread
from backend.routes import bp as main_bp
from backend import websocket  # noqa: F401  (import registers the /ws/<room_id>/<client_id> route)
from backend.auth.routes import bp as auth_bp
from backend.auth.rate_limit_service import start_rate_limit_cleanup_thread
from backend.auth.cleanup_service import start_auth_cleanup_thread
from backend.preferences.routes import bp as preferences_bp

logging.basicConfig(level=logging.INFO)


def create_app() -> Flask:
    app = Flask(__name__)
    app.register_blueprint(main_bp)
    app.register_blueprint(auth_bp)  # Phase 1: /api/auth/* — isolated, doesn't touch existing routes/WS/room logic
    app.register_blueprint(preferences_bp)  # Phase 2: /api/auth/preferences — protected by the same require_auth
    sock.init_app(app)
    start_room_cleanup_thread()  # Phase 3 (SyncStream): periodic sweep of long-empty rooms
    start_rate_limit_cleanup_thread()  # Phase 1 (auth): periodic sweep of stale rate-limit counters
    start_auth_cleanup_thread()  # Phase 2 (auth): periodic sweep of expired sessions/OTPs
    return app


app = create_app()

if __name__ == '__main__':
    app.run(host=HOST, port=PORT, threaded=True)
