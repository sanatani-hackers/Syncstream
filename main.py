"""
SyncStream backend entry point.

Run this file with: python main.py
Requires: pip install flask flask-sock yt-dlp requests
"""
import logging

from flask import Flask

from backend.config import HOST, PORT
from backend.extensions import sock
from backend.room import start_room_cleanup_thread
from backend.routes import bp as main_bp
from backend import websocket  # noqa: F401  (import registers the /ws/<room_id>/<client_id> route)

logging.basicConfig(level=logging.INFO)


def create_app() -> Flask:
    app = Flask(__name__)
    app.register_blueprint(main_bp)
    sock.init_app(app)
    start_room_cleanup_thread()  # Phase 3: periodic sweep of long-empty rooms
    return app


app = create_app()

if __name__ == '__main__':
    app.run(host=HOST, port=PORT, threaded=True)
