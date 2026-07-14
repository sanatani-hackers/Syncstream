// Queue view: rendering the voted queue list and sending votes.
import { els } from './dom.js';
import { state } from './state.js';
import { formatTime } from './player.js';

export function renderQueue() {
    if (!state.roomId) {
        els.queueList.innerHTML = `
            <div class="flex flex-col items-center justify-center text-center py-16 sm:py-20 px-6">
                <div class="w-16 h-16 rounded-2xl bg-secondarySurface border border-border flex items-center justify-center mb-4">
                    <i class="ph ph-door-open text-3xl text-textMuted"></i>
                </div>
                <h3 class="font-bold text-textMain text-sm mb-1">Not in a room</h3>
                <p class="text-textMuted text-xs max-w-[220px] mb-4">Join or create a room to start a shared queue.</p>
                <button onclick="openRoomModal()" class="btn btn-primary px-6 !h-auto py-2.5 rounded-xl text-sm">Create or Join</button>
            </div>`;
        return;
    }
    if (state.queue.length === 0) {
        els.queueList.innerHTML = `
            <div class="flex flex-col items-center justify-center text-center py-16 sm:py-20 px-6">
                <div class="w-16 h-16 rounded-2xl bg-secondarySurface border border-border flex items-center justify-center mb-4">
                    <i class="ph ph-ghost text-3xl text-textMuted"></i>
                </div>
                <h3 class="font-bold text-textMain text-sm mb-1">Queue is empty</h3>
                <p class="text-textMuted text-xs max-w-[220px]">Add songs from Search or Discover to get the party started.</p>
            </div>`;
        return;
    }
    els.queueList.innerHTML = state.queue.map((item, index) => {
        const hasVoted = item.voters.includes(state.userId);
        const isPlaying = state.currentSongId === item.song.id;

        const rankOrEq = isPlaying
            ? `<div class="eq-bars w-6 justify-center"><div class="eq-bar"></div><div class="eq-bar"></div><div class="eq-bar"></div></div>`
            : `<span class="text-textMuted font-medium w-6 text-center text-sm">${index + 1}</span>`;
        const hostControls = state.isHost
            ? `<button onclick="ws.send(JSON.stringify({type: 'force_play', song_id: '${item.song.id}'}))" class="w-11 h-11 flex items-center justify-center text-textMuted hover:text-textMain active:scale-90 transition-all"><i class="ph-fill ph-play-circle text-xl"></i></button>`
            : '';
        const duration = item.song.duration ? `<p class="text-xs text-textMuted mt-0.5 font-mono">${formatTime(item.song.duration)}</p>` : '';

        return `
        <div class="flex items-center glass-panel rounded-2xl p-2 pr-3 sm:pr-4 gap-3 sm:gap-4 hover-lift group ${isPlaying ? 'border-primary/30 bg-primarySurface' : ''}">
            ${rankOrEq}
            <img src="${item.song.thumbnail}" class="w-12 h-12 rounded-xl object-cover shadow-sm flex-shrink-0">
            <div class="flex-1 min-w-0">
                <h4 class="font-bold text-sm truncate ${isPlaying ? 'text-primary' : 'text-textMain'}">${item.song.title}</h4>
                ${duration}
            </div>
            <div class="flex items-center gap-1 sm:gap-2">
                ${hostControls}
                <button onclick="vote('${item.song.id}', ${hasVoted ? -1 : 1})" class="min-w-[44px] min-h-[44px] flex flex-col items-center justify-center p-2 rounded-xl active:scale-90 transition-all ${hasVoted ? 'bg-primarySurface text-primary' : 'hover:bg-secondarySurface text-textMuted'}">
                    <i class="ph-fill ph-caret-up text-lg leading-none"></i>
                    <span class="font-bold text-xs mt-1 leading-none">${item.votes}</span>
                </button>
            </div>
        </div>`
    }).join('');
}

export function vote(songId, direction) {
    if (window.ws && window.ws.readyState === WebSocket.OPEN) {
        window.ws.send(JSON.stringify({ type: 'vote', song_id: songId, direction: direction }));
    }
}

// NOTE: the "Import" button in the Queue view calls `importPlaylist()`,
// but that function was never defined in the original index3.html either
// (pre-existing bug, not introduced by this refactor). Clicking it will
// still throw a ReferenceError today. Left untouched intentionally — see
// Phase 10 (Bug Fixes) in the project plan. The backend /playlist route
// this would call already works correctly.
