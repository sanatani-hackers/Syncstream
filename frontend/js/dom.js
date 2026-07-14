// Cached references to frequently-used DOM elements.
//
// This lives in its own zero-dependency module (rather than inside
// ui.js, where element refs originally sat next to switchTab) because
// player.js, socket.js, and queue.js all need it, and player.js/socket.js
// use it at module top-level (wiring up addEventListener calls
// immediately on load, not inside a function). If `els` were exported
// from ui.js instead, the import cycle ui.js -> socket.js -> player.js
// -> ui.js would try to read `els` before ui.js finished initializing it
// (a temporal-dead-zone error). Keeping this cache dependency-free avoids
// that entirely.
export const els = {
    app: document.getElementById('app-screen'),
    navLatency: document.getElementById('nav-latency'), playerArt: document.getElementById('player-art'),
    playerTitle: document.getElementById('player-title'), playerStatus: document.getElementById('player-status'),
    seekBar: document.getElementById('seek-bar'), timeCur: document.getElementById('time-current'),
    timeTot: document.getElementById('time-total'), btnPlay: document.getElementById('btn-playpause'),
    iconPlay: document.getElementById('icon-playpause'), btnSkip: document.getElementById('btn-skip'),
    btnMode: document.getElementById('btn-mode'), queueList: document.getElementById('queue-list'),
    syncOverlay: document.getElementById('sync-overlay'), statusDot: document.getElementById('status-dot'),

    // Sign-in modal
    signinModal: document.getElementById('signin-modal'),
    signinStepEmail: document.getElementById('signin-step-email'),
    signinStepCode: document.getElementById('signin-step-code'),
    signinStepSuccess: document.getElementById('signin-step-success'),
    signinEmail: document.getElementById('signin-email'),
    signinEmailError: document.getElementById('signin-email-error'),
    signinEmailDisplay: document.getElementById('signin-email-display'),
    signinCode: document.getElementById('signin-code'),
    signinCodeError: document.getElementById('signin-code-error'),
    btnSigninSend: document.getElementById('btn-signin-send'),
    btnSigninVerify: document.getElementById('btn-signin-verify'),

    // Room modal
    roomModal: document.getElementById('room-modal'),
    roomName: document.getElementById('room-name'),
    roomIdInput: document.getElementById('room-id-input'),

    // Avatar capsule + profile panel
    avatarSignedOut: document.getElementById('avatar-capsule-signedout'),
    avatarSignedIn: document.getElementById('avatar-capsule-signedin'),
    profilePanel: document.getElementById('profile-panel'),
    profileAvatar: document.getElementById('profile-avatar'),
    profileEmail: document.getElementById('profile-email'),
    profileRoomSection: document.getElementById('profile-room-section'),
    profileRole: document.getElementById('profile-role'),
    profileRoomId: document.getElementById('profile-room-id'),
    profileMemberCount: document.getElementById('profile-member-count'),
    btnCopyRoomIdLabel: document.getElementById('btn-copy-room-id-label'),
};
