// Search view: query submission and rendering results.
import { runtime } from './state.js';
import { switchTab } from './ui.js';
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
            <div class="flex items-center glass-panel rounded-2xl p-2 pr-3 sm:pr-4 gap-3 sm:gap-4 hover-lift">
                <img src="${song.thumbnail}" class="w-14 h-14 rounded-xl object-cover shadow-sm flex-shrink-0">
                <div class="flex-1 min-w-0">
                    <h4 class="font-bold text-sm truncate">${song.title}</h4>
                    ${song.duration ? `<p class="text-xs text-textMuted mt-0.5 font-mono">${formatTime(song.duration)}</p>` : ''}
                </div>
                <button onclick='requestSongByIndex(${index})' class="btn btn-secondary px-4 flex-shrink-0">Add</button>
            </div>
        `).join('');
    } catch (err) { }
}

export function requestSongByIndex(index) {
    if (window.ws && window.ws.readyState === WebSocket.OPEN) {
        window.ws.send(JSON.stringify({ type: 'request_song', song: runtime.searchDataCache[index] }));
        switchTab('queue');
    }
}
