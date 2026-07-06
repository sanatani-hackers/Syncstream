"""
All yt-dlp interactions: searching, playlist import, and stream URL
resolution. Extracted from main.py with identical logic.
"""
import logging

import yt_dlp

from .cache import get_cached_search, set_cached_search, get_cached_stream, set_cached_stream
from .config import PLAYLIST_IMPORT_MAX_ITEMS, SEARCH_RESULT_COUNT, YDL_OPTS_SEARCH, YDL_OPTS_STREAM
from .utils import normalize_playlist_url


def fetch_search_results(query: str):
    cached = get_cached_search(query)
    if cached is not None:
        return cached

    with yt_dlp.YoutubeDL(YDL_OPTS_SEARCH) as ydl:
        try:
            info = ydl.extract_info(f"ytsearch{SEARCH_RESULT_COUNT}:{query}", download=False)
            results = [
                {
                    "id": e.get('id'),
                    "title": e.get('title'),
                    "duration": e.get('duration'),
                    "thumbnail": f"https://i.ytimg.com/vi/{e.get('id')}/hqdefault.jpg"
                }
                for e in info.get('entries', []) if e
            ]
            set_cached_search(query, results)
            return results
        except Exception as e:
            logging.error(f"Search error: {e}")
            return []


def fetch_playlist_results(url: str):
    clean_url = normalize_playlist_url(url)

    opts = YDL_OPTS_SEARCH.copy()
    opts['extract_flat'] = True
    opts['ignoreerrors'] = True

    with yt_dlp.YoutubeDL(opts) as ydl:
        try:
            info = ydl.extract_info(clean_url, download=False)
            entries = info.get('entries', [info]) if 'entries' in info else [info]
            results = [
                {
                    "id": e.get('id'),
                    "title": e.get('title'),
                    "duration": e.get('duration'),
                    "thumbnail": f"https://i.ytimg.com/vi/{e.get('id')}/hqdefault.jpg"
                }
                for e in entries if e and e.get('id')
            ]
            return results[:PLAYLIST_IMPORT_MAX_ITEMS]
        except Exception as e:
            logging.error(f"Playlist error: {e}")
            return []


def fetch_stream_url(video_id: str):
    cached = get_cached_stream(video_id)
    if cached is not None:
        return cached

    with yt_dlp.YoutubeDL(YDL_OPTS_STREAM) as ydl:
        try:
            info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
            url = info.get('url')
            set_cached_stream(video_id, url)
            return url
        except Exception as e:
            logging.error(f"Stream error: {e}")
            return None
