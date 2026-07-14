// Composition root.
//
// The markup in index.html still calls a number of functions directly
// via inline onclick/onchange attributes. ES module scope is NOT global
// scope, so those attributes can't see module-internal names on their
// own — we expose exactly the functions/values the HTML references onto
// `window` here, same pattern established since Phase 1.
import { buildEQUI, applyPreset, toggleEQLink, updateEQ, setEQBypass } from './audioEngine.js';
import {
    initShell, switchTab,
    openSigninModal, closeSigninModal, submitSigninEmail, submitSigninCode, backToSigninEmail,
    openRoomModal, closeRoomModal, submitRoomJoin,
    openProfilePanel, closeProfilePanel, refreshProfilePanel, copyRoomId, openSettings, performLogout,
    leaveRoom, resetRoomState, handlePlayerInfoClick,
} from './ui.js';
import { forcePlay } from './player.js';
import { vote } from './queue.js';
import { performSearch, requestSongByIndex } from './search.js';
import { requestSongFromHome } from './home.js';
import './socket.js'; // no direct calls from HTML; imported for its side effects (nothing at module scope)

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

// Sign-in modal
window.openSigninModal = openSigninModal;
window.closeSigninModal = closeSigninModal;
window.submitSigninEmail = submitSigninEmail;
window.submitSigninCode = submitSigninCode;
window.backToSigninEmail = backToSigninEmail;

// Room create/join modal
window.openRoomModal = openRoomModal;
window.closeRoomModal = closeRoomModal;
window.submitRoomJoin = submitRoomJoin;
window.handlePlayerInfoClick = handlePlayerInfoClick;

// Avatar / profile panel
window.openProfilePanel = openProfilePanel;
window.closeProfilePanel = closeProfilePanel;
window.refreshProfilePanel = refreshProfilePanel; // called from socket.js on room_state updates
window.copyRoomId = copyRoomId;
window.openSettings = openSettings;
window.performLogout = performLogout;

// Leave Room — deliberately a separate export from performLogout (point 5)
window.leaveRoom = leaveRoom;
window.resetRoomState = resetRoomState; // called from socket.js's onclose on a server-rejected join

// window.ws is set directly by socket.js's connectWebSocket() when the
// user joins a room; left undefined until then, exactly as before.

// Build the EQ slider UI immediately — EQ is usable without a room now,
// so this always runs, same as before.
buildEQUI();

// Shell initialization: Discover/Search/EQ become usable immediately;
// no room is created or joined here. Runs after buildEQUI so the EQ
// panel already has its sliders before initShell's initAudioEngine()
// call routes audio through them.
initShell();
