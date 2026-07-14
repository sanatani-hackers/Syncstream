// WebSocket lifecycle: connect/reconnect, ping/latency measurement, and
// dispatching incoming messages (room_state, sync, pong, error) to the
// rest of the app.
import { noMusicArt } from './config.js';
import { state, runtime } from './state.js';
import { els } from './dom.js';
import { getAudioElement } from './audioEngine.js';
import { setEQAllowedByHost, getEQAllowedByHost } from './audioEngine.js';
import { loadAndPlaySong } from './player.js';
import { renderQueue } from './queue.js';

const audio = getAudioElement();

// Application-defined WebSocket close code the backend uses to reject an
// unauthenticated room-join attempt (see backend/websocket.py). Must be
// handled distinctly from a generic disconnect — retrying a rejected
// connection every 3 seconds would just get rejected again, forever,
// with no visible explanation to the user.
const WS_CLOSE_UNAUTHORIZED = 4001;

export function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    window.ws = new WebSocket(`${protocol}//${window.location.host}/ws/${state.roomId}/${state.userId}`);

    window.ws.onopen = () => {
        window.ws.send(JSON.stringify({ type: 'join', name: state.userName, role: state.role }));
        runtime.pingInterval = setInterval(() => {
            if (window.ws.readyState === WebSocket.OPEN) window.ws.send(JSON.stringify({ type: 'ping', client_time: Date.now() / 1000 }));
        }, 2000);
    };

    window.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'room_state') handleRoomStateUpdate(data);
        else if (data.type === 'sync') handleClientSync(data);
        else if (data.type === 'error') {
            // Currently only the "unauthorized" rejection uses this, but
            // handled generically in case the backend ever sends other
            // pre-close error types.
            console.warn('WebSocket error from server:', data.message || data.code);
        }
        else if (data.type === 'pong') {
            const now = Date.now() / 1000, rtt = now - data.client_time;
            runtime.timeOffset = (data.server_time + (rtt / 2)) - now;
            els.navLatency.innerText = Math.round(rtt * 1000) + 'ms';
            els.statusDot.className = `w-2 h-2 rounded-full ${rtt < 0.1 ? 'bg-success' : rtt < 0.3 ? 'bg-warning' : 'bg-danger'} animate-pulse`;
        }
    };

    window.ws.onclose = (event) => {
        els.statusDot.className = "w-2 h-2 rounded-full bg-textMuted";
        if (runtime.pingInterval) clearInterval(runtime.pingInterval);

        if (event && event.code === WS_CLOSE_UNAUTHORIZED) {
            // Rejected, not disconnected — do NOT auto-retry. The socket is
            // already closed at this point (that's why we're in onclose),
            // so this only needs to reset frontend room state, not close
            // anything. window.resetRoomState / window.openSigninModal are
            // exposed by main.js from ui.js.
            if (window.resetRoomState) window.resetRoomState();
            if (window.openSigninModal) window.openSigninModal();
            return;
        }

        setTimeout(connectWebSocket, 3000);
    };
}

function handleRoomStateUpdate(data) {
    state.serverState = data.state; state.queue = data.queue; state.users = data.users || [];
    const me = data.users.find(u => u.id === state.userId);
    if (me) { state.isHost = (me.role === 'host'); }

    // Keep the profile panel's room section in sync if it's currently open.
    if (window.refreshProfilePanel) window.refreshProfilePanel();

    if (data.state.eq_allowed !== undefined) {
        setEQAllowedByHost(data.state.eq_allowed);
        const hostToggle = document.getElementById('host-eq-toggle-container'), statusMsg = document.getElementById('eq-disabled-msg'), hostEqCheckbox = document.getElementById('host-eq-checkbox');
        if (hostToggle) hostToggle.style.display = state.isHost ? 'flex' : 'none';
        if (hostEqCheckbox && state.isHost) hostEqCheckbox.checked = getEQAllowedByHost();
        if (!getEQAllowedByHost() && !state.isHost) statusMsg.classList.remove('hidden'); else statusMsg.classList.add('hidden');
    }

    renderQueue();
    const mode = state.serverState.play_mode || 'straight';
    els.btnMode.innerHTML = mode === 'shuffle' ? `<i class="ph ph-shuffle text-xl text-primary"></i>` : `<i class="ph ph-arrow-right text-xl"></i>`;

    if (state.isHost) {
        els.btnPlay.disabled = false; els.btnSkip.disabled = false; els.seekBar.disabled = false; els.btnMode.disabled = false;
        els.syncOverlay.classList.add('hidden'); audio.playbackRate = 1.0;
        if (!runtime.syncInterval) runtime.syncInterval = setInterval(() => {
            if (state.serverState.current_song && !audio.paused && audio.readyState >= 2 && !runtime.isSeeking) {
                window.ws.send(JSON.stringify({ type: 'sync', time: audio.currentTime, playing: !audio.paused }));
            }
        }, 500);
    } else {
        els.btnPlay.disabled = true; els.btnSkip.disabled = true; els.seekBar.disabled = true; els.btnMode.disabled = true;
        if (runtime.syncInterval) { clearInterval(runtime.syncInterval); runtime.syncInterval = null; }
    }

    if (state.serverState.status === "finding_next") { els.playerStatus.innerHTML = `<span class="text-primary animate-pulse">Curating next track...</span>`; return; }

    const newSong = data.state.current_song;
    if (newSong && newSong.id !== state.currentSongId) {
        state.currentSongId = newSong.id; loadAndPlaySong(newSong.id);
        els.playerArt.src = newSong.thumbnail; els.playerTitle.innerText = newSong.title;
    } else if (!newSong) {
        state.currentSongId = null; audio.pause(); audio.removeAttribute('src'); els.playerArt.classList.add('paused');
        els.playerArt.src = noMusicArt; els.playerTitle.innerText = "Queue is empty"; els.playerStatus.innerHTML = "Discover new music";
        els.iconPlay.className = "ph-fill ph-play text-2xl ml-1";
    }
}

function handleClientSync(data) {
    if (state.isHost) return;
    if (data.playing && audio.paused) { audio.play().then(() => els.playerArt.classList.remove('paused')).catch(e => els.syncOverlay.classList.remove('hidden')); }
    if (!data.playing && !audio.paused) { audio.pause(); audio.currentTime = data.time; audio.playbackRate = 1.0; els.playerArt.classList.add('paused'); }

    if (!data.playing || audio.readyState < 3) return;
    const diff = (data.time + ((Date.now() / 1000) + runtime.timeOffset - data.timestamp)) - audio.currentTime;
    if (Math.abs(diff) > 1.5) { audio.currentTime += diff; audio.playbackRate = 1.0; }
    else if (diff > 0.03) audio.playbackRate = Math.min(1.1, 1.0 + (diff * 0.5));
    else if (diff < -0.03) audio.playbackRate = Math.max(0.9, 1.0 + (diff * 0.5));
    else audio.playbackRate = 1.0;
}
