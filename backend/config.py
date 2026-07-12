"""
Central configuration for the SyncStream backend.

All magic numbers / static option dicts that used to live inline in
main.py are collected here so they're easy to find and tune.
"""

# --- Server ---
HOST = "0.0.0.0"
PORT = 8000

# --- yt-dlp options ---
YDL_SOCKET_TIMEOUT_SECONDS = 15  # Phase 3: don't let a stalled extractor hang a request forever

YDL_OPTS_SEARCH = {
    'format': 'bestaudio/best',
    'default_search': 'ytsearch15',
    'extract_flat': True,
    'quiet': True,
    'no_warnings': True,
    'cookiefile': "cookies.txt",
    'socket_timeout': YDL_SOCKET_TIMEOUT_SECONDS
}

YDL_OPTS_STREAM = {
    'format': 'bestaudio[ext=m4a]/bestaudio/best',
    'quiet': True,
    'no_warnings': True,
    'noplaylist': True,
    'extractor_args': {'youtube': {'player_client': ['android', 'web']}},
    'cookiefile': "cookies.txt",
    'socket_timeout': YDL_SOCKET_TIMEOUT_SECONDS
}

# --- Search / playlist result limits ---
SEARCH_RESULT_COUNT = 15
PLAYLIST_IMPORT_MAX_ITEMS = 50
AUTOPLAY_CANDIDATE_POOL = 4

# --- Caches (Phase 3: Memory Optimization) ---
# Search results go stale as "trending" queries shift; stream URLs are
# YouTube-signed and expire on their own after a few hours regardless of
# what we do, so we refresh proactively rather than serve a dead link.
SEARCH_CACHE_TTL_SECONDS = 30 * 60          # 30 minutes
SEARCH_CACHE_MAX_ENTRIES = 200
STREAM_CACHE_TTL_SECONDS = 4 * 60 * 60      # 4 hours
STREAM_CACHE_MAX_ENTRIES = 500

# --- Rooms (Phase 3: Memory Optimization) ---
# A room isn't deleted the instant it empties out, so a host who
# refreshes their page doesn't lose the queue/state. It's only purged
# after sitting empty for this long.
EMPTY_ROOM_GRACE_SECONDS = 5 * 60           # 5 minutes
ROOM_CLEANUP_INTERVAL_SECONDS = 60

# --- Queue defaults ---
INITIAL_VOTE_COUNT = 1

# --- Streaming proxy ---
STREAM_PROXY_CHUNK_SIZE = 8192
STREAM_PROXY_TIMEOUT_SECONDS = 15

# --- Dynamic Queries for Infinite Scroll Home Feed ---
HOME_QUERIES = [
    "latest trending hindi songs 2024", "top bollywood hits audio",
    "viral punjabi songs audio", "lofi bollywood chill mashup",
    "best arijit singh songs", "global pop hits 2024",
    "trending reels songs audio", "romantic hindi songs top",
    "party anthem hits audio", "classic bollywood 90s hits"
]
