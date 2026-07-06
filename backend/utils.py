"""
General-purpose helpers shared across backend modules.
"""
import urllib.parse


def normalize_playlist_url(url: str) -> str:
    """
    Given an arbitrary YouTube URL, return a canonical playlist URL if a
    `list` query parameter is present, otherwise return the URL unchanged.

    Extracted verbatim (logic-for-logic) from the old fetch_playlist_results.
    """
    try:
        parsed_url = urllib.parse.urlparse(url)
        query_params = urllib.parse.parse_qs(parsed_url.query)
        if 'list' in query_params:
            return f"https://www.youtube.com/playlist?list={query_params['list'][0]}"
        return url
    except Exception:
        return url
