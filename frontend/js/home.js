// Discover tab: infinite-scroll home feed of recommendations.
import { runtime } from './state.js';
import { switchTab } from './ui.js';
import { formatTime } from './player.js';

export async function fetchHomeRecommendations() {
    if (runtime.isLoadingHome) return;
    runtime.isLoadingHome = true;
    try {
        const res = await fetch(`/recommendations?page=${runtime.homePage}`);
        const data = await res.json();
        document.getElementById('home-loading').classList.add('hidden');
        document.getElementById('home-grid').classList.remove('hidden');
        if (data.results) {
            const startIndex = runtime.homeDataCache.length;
            runtime.homeDataCache = runtime.homeDataCache.concat(data.results);
            const html = data.results.map((song, idx) => {
                const durationLabel = song.duration
                    ? `<span class="text-[11px] text-textMuted font-mono flex-shrink-0">${formatTime(song.duration)}</span>`
                    : '';
                return `
                <div class="flex items-center glass-panel rounded-xl p-1.5 sm:p-2 gap-3 hover-lift cursor-pointer group" onclick="requestSongFromHome(${startIndex + idx})">
                    <img src="${song.thumbnail}" class="w-11 h-11 sm:w-12 sm:h-12 rounded-lg object-cover shadow-sm flex-shrink-0">
                    <div class="flex-1 min-w-0">
                        <h4 class="font-semibold text-sm truncate text-textMain group-hover:text-primary transition-colors">${song.title}</h4>
                    </div>
                    ${durationLabel}
                    <div class="w-8 h-8 rounded-full flex items-center justify-center text-textMuted group-hover:text-primary group-hover:bg-primarySurface transition-all flex-shrink-0">
                        <i class="ph-fill ph-play text-sm"></i>
                    </div>
                </div>
            `;
            }).join('');
            document.getElementById('home-grid').insertAdjacentHTML('beforeend', html);
            runtime.homePage++;
        }
    } catch (err) { } finally { runtime.isLoadingHome = false; }
}

export function requestSongFromHome(index) {
    if (window.ws && window.ws.readyState === WebSocket.OPEN) {
        window.ws.send(JSON.stringify({ type: 'request_song', song: runtime.homeDataCache[index] }));
        switchTab('queue');
    }
}

document.getElementById('view-home').addEventListener('scroll', (e) => {
    if (e.target.scrollTop + e.target.clientHeight >= e.target.scrollHeight - 300) {
        if (!runtime.isLoadingHome) fetchHomeRecommendations();
    }
});
