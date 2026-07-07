// DOM element cache + top-level navigation (setup screen -> app screen,
// tab switching). The DOM element cache itself lives in dom.js — see
// that file for why it was pulled out into its own zero-dependency module.
import { state } from './state.js';
import { els } from './dom.js';
import { initAudioEngine } from './audioEngine.js';
import { connectWebSocket } from './socket.js';
import { fetchHomeRecommendations } from './home.js';

export { els };

export function joinApp(requestedRole) {
    let rId = document.getElementById('setup-room').value.trim();
    if (requestedRole === 'client' && !rId) { alert("Please enter a Room ID to join an existing room!"); return; }

    initAudioEngine();
    state.userName = document.getElementById('setup-name').value.trim() || 'Anonymous';
    if (!rId) rId = Math.random().toString(36).substr(2, 6).toUpperCase();
    state.roomId = rId; state.role = requestedRole;
    els.navRoom.innerText = state.roomId;
    els.navUsername.innerText = state.userName;

    els.setup.classList.add('hidden'); els.app.classList.remove('hidden'); els.app.classList.add('flex');
    connectWebSocket(); fetchHomeRecommendations();
}

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
