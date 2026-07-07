// Cached references to frequently-used DOM elements.
//
// This lives in its own zero-dependency module (rather than inside
// ui.js, where it originally sat next to joinApp/switchTab) because
// player.js, socket.js, and queue.js all need it, and player.js/socket.js
// use it at module top-level (wiring up addEventListener calls
// immediately on load, not inside a function). If `els` were exported
// from ui.js instead, the import cycle ui.js -> socket.js -> player.js
// -> ui.js would try to read `els` before ui.js finished initializing it
// (a temporal-dead-zone error). Keeping this cache dependency-free avoids
// that entirely.
export const els = {
    setup: document.getElementById('setup-screen'), app: document.getElementById('app-screen'),
    navRoom: document.getElementById('nav-room-id'), navRole: document.getElementById('nav-role'),
    navUsername: document.getElementById('nav-username'),
    navLatency: document.getElementById('nav-latency'), playerArt: document.getElementById('player-art'),
    playerTitle: document.getElementById('player-title'), playerStatus: document.getElementById('player-status'),
    seekBar: document.getElementById('seek-bar'), timeCur: document.getElementById('time-current'),
    timeTot: document.getElementById('time-total'), btnPlay: document.getElementById('btn-playpause'),
    iconPlay: document.getElementById('icon-playpause'), btnSkip: document.getElementById('btn-skip'),
    btnMode: document.getElementById('btn-mode'), queueList: document.getElementById('queue-list'),
    syncOverlay: document.getElementById('sync-overlay'), statusDot: document.getElementById('status-dot')
};
