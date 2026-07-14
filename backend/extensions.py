"""
Shared extension instances.

Kept in their own module (rather than created in main.py) so that both
main.py (which calls sock.init_app(app)) and websocket.py (which uses
@sock.route(...)) can import the same instance without importing each
other and creating a circular import.
"""
from flask_sock import Sock

sock = Sock()
