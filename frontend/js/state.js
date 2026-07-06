// Shared mutable app state. Every module that needs to read or update
// room/session state imports `state` from here instead of holding its
// own copy, so there is exactly one source of truth (same guarantee the
// original single-script version had via top-level `let`/`const`).

export const state = {
    userId: 'user_' + Math.random().toString(36).substr(2, 9),
    userName: '',
    roomId: '',
    role: 'client',
    isHost: false,
    currentSongId: null,
    queue: [],
    serverState: {}
};

// Misc runtime/session variables that used to be loose top-level `let`
// bindings. Grouped here for discoverability; behavior is unchanged.
export const runtime = {
    searchDataCache: [],
    homeDataCache: [],
    timeOffset: 0,
    pingInterval: null,
    homePage: 1,
    isLoadingHome: false,
    isSeeking: false,
    syncInterval: null
};

// `ws` is intentionally kept on `window` (not in this module) because
// generated HTML in queue.js/home.js still calls `ws.send(...)` directly
// from inline onclick attributes. See main.js for details.
