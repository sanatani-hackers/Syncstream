// Owns the <audio> element's playback lifecycle: loading a track,
// responding to local transport controls (play/pause/seek/skip), and
// reporting local playback state to the host's sync broadcast.
import { getAudioElement, resumeIfSuspended } from './audioEngine.js';
import { els } from './dom.js';
import { state } from './state.js';
import { runtime } from './state.js';

const audio = getAudioElement();

export function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return "0:00";
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec.toString().padStart(2, '0')}`;
}

export function loadAndPlaySong(videoId) {
    audio.onloadedmetadata = null; audio.onerror = null; audio.src = `/stream/${videoId}`; audio.playbackRate = 1.0;
    els.playerStatus.innerHTML = "Tuning in..."; els.playerArt.classList.add('paused');

    audio.onloadedmetadata = () => {
        if (state.serverState.time > 0) audio.currentTime = state.serverState.time;
        els.playerStatus.innerHTML = `<span class="text-success"><i class="ph-fill ph-broadcast"></i> Live</span>`;
        if (state.serverState.playing) {
            els.playerArt.classList.remove('paused');
            audio.play().catch(e => { if (!state.isHost) els.syncOverlay.classList.remove('hidden'); els.playerArt.classList.add('paused'); });
        }
    };
    audio.load();
}

export function forcePlay() {
    resumeIfSuspended();
    els.syncOverlay.classList.add('hidden');
    audio.play().then(() => els.playerArt.classList.remove('paused')).catch(e => console.log(e));
}

export function triggerSyncUpdate() {
    if (window.ws && window.ws.readyState === WebSocket.OPEN) {
        window.ws.send(JSON.stringify({ type: 'sync', time: audio.currentTime, playing: !audio.paused }));
    }
}

let isSeeking = false;

audio.addEventListener('ended', () => { if (state.isHost) window.ws.send(JSON.stringify({ type: 'next', auto: true })); });

['mousedown', 'touchstart'].forEach(evt => els.seekBar.addEventListener(evt, () => { isSeeking = true; runtime.isSeeking = true; }, { passive: true }));
['mouseup', 'touchend'].forEach(evt => els.seekBar.addEventListener(evt, () => { isSeeking = false; runtime.isSeeking = false; }, { passive: true }));
els.seekBar.addEventListener('change', (e) => {
    if (state.isHost && audio.duration) { audio.currentTime = (e.target.value / 100) * audio.duration; triggerSyncUpdate(); }
    isSeeking = false; runtime.isSeeking = false;
});
els.btnPlay.addEventListener('click', () => {
    resumeIfSuspended();
    if (audio.paused) audio.play(); else if (state.isHost) audio.pause();
});
els.btnSkip.addEventListener('click', () => { if (!state.isHost) return; window.ws.send(JSON.stringify({ type: 'next', auto: false })); });

audio.addEventListener('timeupdate', () => {
    if (audio.duration && !isSeeking) els.seekBar.value = (audio.currentTime / audio.duration) * 100;
    if (audio.duration) { els.timeCur.innerText = formatTime(audio.currentTime); els.timeTot.innerText = formatTime(audio.duration); }
});

audio.addEventListener('play', () => { els.iconPlay.className = "ph-fill ph-pause text-2xl"; els.playerArt.classList.remove('paused'); if (state.isHost) triggerSyncUpdate(); });
audio.addEventListener('pause', () => { els.iconPlay.className = "ph-fill ph-play text-2xl ml-1"; els.playerArt.classList.add('paused'); if (state.isHost) triggerSyncUpdate(); });
