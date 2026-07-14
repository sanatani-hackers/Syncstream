// Search view: query submission and rendering results.
import { runtime, state } from './state.js';
import { switchTab, openRoomModal } from './ui.js';
import { formatTime } from './player.js';

export async function performSearch() {
    const query = document.getElementById('search-input').value.trim();
    if (!query) return;
    document.getElementById('search-loading').classList.remove('hidden');
    document.getElementById('search-results').innerHTML = '';
    try {
        const res = await fetch(`/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        document.getElementById('search-loading').classList.add('hidden');
        runtime.searchDataCache = data.results;
        document.getElementById('search-results').innerHTML = data.results.map((song, index) => `
            <div class="flex items-center glass-panel rounded-xl p-1.5 sm:p-2 pr-3 gap-2.5 sm:gap-3 hover-lift">
                <img src="${song.thumbnail}" class="w-12 h-12 rounded-lg object-cover shadow-sm flex-shrink-0">
                <div class="flex-1 min-w-0">
                    <h4 class="font-semibold text-sm truncate">${song.title}</h4>
                    ${song.duration ? `<p class="text-[11px] text-textMuted mt-0.5 font-mono">${formatTime(song.duration)}</p>` : ''}
                </div>
                <button onclick='requestSongByIndex(${index})' class="btn btn-secondary px-4 flex-shrink-0">Add</button>
            </div>
        `).join('');
    } catch (err) { }
}

export function requestSongByIndex(index) {
    if (!state.roomId) { openRoomModal(); return; }
    if (window.ws && window.ws.readyState === WebSocket.OPEN) {
        window.ws.send(JSON.stringify({ type: 'request_song', song: runtime.searchDataCache[index] }));
        switchTab('queue');
    }
}
