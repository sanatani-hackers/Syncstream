// Application shell: initialization, sign-in modal, room create/join
// modal, profile panel, leave-room, and tab switching. The DOM element
// cache itself lives in dom.js — see that file for why.
import { state, runtime } from './state.js';
import { els } from './dom.js';
import { initAudioEngine, getAudioElement } from './audioEngine.js';
import { connectWebSocket } from './socket.js';
import { fetchHomeRecommendations } from './home.js';
import { renderQueue } from './queue.js';
import { noMusicArt } from './config.js';
import * as auth from './auth.js';

export { els };

// ---------------------------------------------------------------------
// Shell initialization — runs once on page load. Nothing here requires
// a room; Discover/Search/EQ are usable immediately regardless of
// auth state.
// ---------------------------------------------------------------------
export async function initShell() {
    initAudioEngine();
    fetchHomeRecommendations();
    resetRoomState(); // sets the initial "not in a room" empty states

    await auth.checkExistingSession();
    updateAvatarUI();
}

// ---------------------------------------------------------------------
// Avatar capsule + profile panel
// ---------------------------------------------------------------------
export function updateAvatarUI() {
    if (state.isAuthenticated && state.currentUser) {
        els.avatarSignedOut.classList.add('hidden');
        els.avatarSignedIn.classList.remove('hidden');
        els.avatarSignedIn.classList.add('flex');
        const initials = auth.getAvatarInitials(state.currentUser.email);
        const color = auth.getAvatarColor(state.currentUser.email);
        els.avatarSignedIn.innerText = initials;
        els.avatarSignedIn.style.backgroundColor = color;
    } else {
        els.avatarSignedOut.classList.remove('hidden');
        els.avatarSignedIn.classList.add('hidden');
        els.avatarSignedIn.classList.remove('flex');
    }
}

export function openProfilePanel() {
    if (!state.isAuthenticated) return; // avatar-capsule-signedin only renders when authenticated anyway
    els.profileEmail.innerText = state.currentUser.email;
    const initials = auth.getAvatarInitials(state.currentUser.email);
    const color = auth.getAvatarColor(state.currentUser.email);
    els.profileAvatar.innerText = initials;
    els.profileAvatar.style.backgroundColor = color;
    els.profilePanel.classList.remove('hidden'); // must happen BEFORE refreshProfilePanel(), which no-ops while the panel is hidden
    refreshProfilePanel();
}

export function closeProfilePanel() {
    els.profilePanel.classList.add('hidden');
}

// Re-populates the room-specific section of the profile panel. Called
// both when the panel opens and whenever room_state changes while it's
// already open (see socket.js).
export function refreshProfilePanel() {
    if (els.profilePanel.classList.contains('hidden')) return;
    if (!state.roomId) {
        els.profileRoomSection.classList.add('hidden');
        return;
    }
    els.profileRoomSection.classList.remove('hidden');
    els.profileRole.innerText = state.isHost ? 'HOST' : 'MEMBER';
    els.profileRoomId.innerText = state.roomId;
    els.profileMemberCount.innerText = state.users.length;
}

export async function copyRoomId() {
    if (!state.roomId) return;
    try {
        await navigator.clipboard.writeText(state.roomId);
        els.btnCopyRoomIdLabel.innerText = 'Copied!';
        setTimeout(() => { els.btnCopyRoomIdLabel.innerText = 'Copy Room ID'; }, 1500);
    } catch (e) { /* clipboard permission denied or unavailable — silently no-op */ }
}

export function openSettings() {
    closeProfilePanel();
    switchTab('eq');
}

export function handlePlayerInfoClick() {
    if (!state.roomId) openRoomModal();
}

export async function performLogout() {
    // Deliberately independent of room state — logging out never touches
    // state.roomId, ws, or anything room-related.
    await auth.logout();
    updateAvatarUI();
    closeProfilePanel();
}

// ---------------------------------------------------------------------
// Sign-in modal (email -> OTP)
// ---------------------------------------------------------------------
export function openSigninModal() {
    els.signinStepEmail.classList.remove('hidden');
    els.signinStepCode.classList.add('hidden');
    els.signinStepSuccess.classList.add('hidden');
    els.signinStepSuccess.classList.remove('flex');
    els.signinEmailError.classList.add('hidden');
    els.signinCodeError.classList.add('hidden');
    els.signinModal.classList.remove('hidden');
}

export function closeSigninModal() {
    els.signinModal.classList.add('hidden');
}

export function backToSigninEmail() {
    els.signinStepCode.classList.add('hidden');
    els.signinStepEmail.classList.remove('hidden');
}

function showFieldError(el, message) {
    el.innerText = message;
    el.classList.remove('hidden');
}

function setButtonLoading(btn, isLoading, loadingLabel) {
    if (isLoading) {
        btn.dataset.originalLabel = btn.innerHTML;
        btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> ${loadingLabel}`;
        btn.disabled = true;
        btn.classList.add('opacity-70', 'cursor-not-allowed');
    } else {
        btn.innerHTML = btn.dataset.originalLabel || btn.innerHTML;
        btn.disabled = false;
        btn.classList.remove('opacity-70', 'cursor-not-allowed');
    }
}

export async function submitSigninEmail() {
    const email = els.signinEmail.value.trim();
    els.signinEmailError.classList.add('hidden');
    if (!email || !email.includes('@')) {
        showFieldError(els.signinEmailError, 'Enter a valid email address.');
        return;
    }
    setButtonLoading(els.btnSigninSend, true, 'Sending...');
    const ok = await auth.sendOtp(email);
    setButtonLoading(els.btnSigninSend, false);
    if (!ok) {
        showFieldError(els.signinEmailError, 'Something went wrong. Please try again.');
        return;
    }
    els.signinEmailDisplay.innerText = email;
    els.signinStepEmail.classList.add('hidden');
    els.signinStepCode.classList.remove('hidden');
    els.signinCode.value = '';
    els.signinCode.focus();
}

export async function submitSigninCode() {
    const email = els.signinEmailDisplay.innerText;
    const code = els.signinCode.value.trim();
    els.signinCodeError.classList.add('hidden');
    if (!code) {
        showFieldError(els.signinCodeError, 'Enter the code from your email.');
        return;
    }
    setButtonLoading(els.btnSigninVerify, true, 'Verifying...');
    const result = await auth.verifyOtp(email, code);
    setButtonLoading(els.btnSigninVerify, false);
    if (!result.success) {
        showFieldError(els.signinCodeError, result.error);
        return;
    }

    // Explicit, visible success confirmation before closing — an instant
    // close here would jump straight from "code entry" to "gone," which
    // reads as confusing (or like nothing happened) even though it worked.
    els.signinStepCode.classList.add('hidden');
    els.signinStepSuccess.classList.remove('hidden');
    els.signinStepSuccess.classList.add('flex');
    updateAvatarUI();
    await new Promise(resolve => setTimeout(resolve, 700));
    els.signinStepSuccess.classList.add('hidden');
    els.signinStepSuccess.classList.remove('flex');
    closeSigninModal();
}

// ---------------------------------------------------------------------
// Room create/join modal
// ---------------------------------------------------------------------
export function openRoomModal() {
    // Frontend-side gate (point 3): the backend enforces this independently
    // at the WebSocket connection layer regardless of what happens here —
    // this is a UX nudge, not the security boundary.
    if (!state.isAuthenticated) {
        openSigninModal();
        return;
    }
    els.roomName.value = '';
    els.roomIdInput.value = '';
    els.roomModal.classList.remove('hidden');
}

export function closeRoomModal() {
    els.roomModal.classList.add('hidden');
}

export function submitRoomJoin(requestedRole) {
    if (!state.isAuthenticated) { // defense in depth, in case this is ever reachable without openRoomModal's check
        closeRoomModal();
        openSigninModal();
        return;
    }

    let rId = els.roomIdInput.value.trim();
    if (requestedRole === 'client' && !rId) { alert("Please enter a Room ID to join an existing room!"); return; }
    if (!rId) rId = Math.random().toString(36).substr(2, 6).toUpperCase();

    state.userName = els.roomName.value.trim() || 'Anonymous';
    state.roomId = rId;
    state.role = requestedRole;

    closeRoomModal();
    connectWebSocket();
}

// ---------------------------------------------------------------------
// Leave Room — explicitly independent of Logout (point 5). Closing the
// WebSocket rides the backend's existing disconnect-handling path
// (client removed, host reassigned if needed) with zero new backend
// code required for this direction — see docs/AUTH_ARCHITECTURE.md §4a.
// ---------------------------------------------------------------------
export function leaveRoom() {
    if (window.ws) {
        // Detach handlers before closing so socket.js's onclose retry
        // logic doesn't fire for an intentional, user-initiated close.
        window.ws.onclose = null;
        window.ws.onmessage = null;
        window.ws.onerror = null;
        try { window.ws.close(); } catch (e) { /* already closed */ }
        window.ws = null;
    }
    resetRoomState();
    closeProfilePanel();
}

// Shared by leaveRoom() (explicit) and socket.js's onclose handler
// (server-rejected join) — resets frontend room state and shows the
// "not in a room" empty states, without assuming anything about why.
export function resetRoomState() {
    if (runtime.pingInterval) { clearInterval(runtime.pingInterval); runtime.pingInterval = null; }
    if (runtime.syncInterval) { clearInterval(runtime.syncInterval); runtime.syncInterval = null; }

    state.roomId = ''; state.role = 'client'; state.isHost = false;
    state.currentSongId = null; state.queue = []; state.serverState = {}; state.users = [];

    const audio = getAudioElement();
    audio.pause();
    audio.removeAttribute('src');
    els.playerArt.src = noMusicArt;
    els.playerArt.classList.add('paused');
    els.playerTitle.innerText = "Not in a room";
    els.playerStatus.innerHTML = "Join or create a room to start listening";
    els.iconPlay.className = "ph-fill ph-play text-2xl ml-1";
    els.btnPlay.disabled = true; els.btnSkip.disabled = true; els.seekBar.disabled = true; els.btnMode.disabled = true;
    els.syncOverlay.classList.add('hidden');

    renderQueue(); // re-renders with the "not in a room" empty state (see queue.js)
    refreshProfilePanel(); // hides the room section if the panel happens to be open
}

// ---------------------------------------------------------------------
// Tab switching — unchanged from before
// ---------------------------------------------------------------------
export function switchTab(tab) {
    ['home', 'queue', 'search', 'eq'].forEach(t => {
        document.getElementById(`view-${t}`).classList.add('hidden');
        // Desktop pills
        if (document.getElementById(`tab-${t}`)) document.getElementById(`tab-${t}`).className = "px-6 py-2 rounded-full text-sm font-medium transition-all text-textSec hover:text-textMain";
        // Mobile icons — 48x48 touch target (Phase 4A), inactive state
        if (document.getElementById(`tab-${t}-mob`)) document.getElementById(`tab-${t}-mob`).className = "w-12 h-12 flex items-center justify-center rounded-xl text-textSec hover:text-textMain active:scale-90 transition-all";
    });

    document.getElementById(`view-${tab}`).classList.remove('hidden');
    if (document.getElementById(`tab-${tab}`)) document.getElementById(`tab-${tab}`).className = "px-6 py-2 rounded-full text-sm font-medium transition-all bg-white/10 shadow-sm text-textMain";
    // Mobile icons — 48x48 touch target (Phase 4A), active state
    if (document.getElementById(`tab-${tab}-mob`)) document.getElementById(`tab-${tab}-mob`).className = "w-12 h-12 flex items-center justify-center rounded-xl text-textMain bg-white/10 shadow-sm active:scale-90 transition-all";
}
