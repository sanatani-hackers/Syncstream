// Composition root.
//
// The markup in index.html still calls a number of functions directly
// via inline onclick/onchange attributes (e.g. onclick="joinApp('host')",
// onclick="ws.send(...)"). ES module scope is NOT global scope, so those
// attributes can't see module-internal names on their own. Rather than
// rewrite the markup in this pass (that's Phase 4 — UX/DOM cleanup,
// where inline handlers get replaced with addEventListener), we expose
// exactly the functions/values the HTML references onto `window` here.
// This keeps behavior byte-for-byte identical to the original single
// <script> version, where every top-level function was implicitly global.
import { buildEQUI, applyPreset, toggleEQLink, updateEQ, setEQBypass } from './audioEngine.js';
import { joinApp, switchTab } from './ui.js';
import { forcePlay } from './player.js';
import { vote } from './queue.js';
import { performSearch, requestSongByIndex } from './search.js';
import { requestSongFromHome } from './home.js';
import './socket.js'; // no direct calls from HTML; imported for its side effects (nothing at module scope)

window.joinApp = joinApp;
window.switchTab = switchTab;
window.applyPreset = applyPreset;
window.toggleEQLink = toggleEQLink;
window.updateEQ = updateEQ;
window.setEQBypass = setEQBypass;
window.forcePlay = forcePlay;
window.vote = vote;
window.performSearch = performSearch;
window.requestSongByIndex = requestSongByIndex;
window.requestSongFromHome = requestSongFromHome;
// window.ws is set directly by socket.js's connectWebSocket() when the
// user joins a room; left undefined until then, exactly as before.

// Build the EQ slider UI immediately, same as the original inline
// `buildEQUI();` call that ran right after the function definitions.
buildEQUI();
