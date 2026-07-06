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
                const durationBadge = song.duration
                    ? `<span class="absolute bottom-2 right-2 bg-black/70 backdrop-blur-sm text-textMain text-[10px] font-semibold px-1.5 py-0.5 rounded-md tracking-wide">${formatTime(song.duration)}</span>`
                    : '';
                return `
                <div class="glass-panel p-3 rounded-2xl cursor-pointer flex flex-col group hover-lift" onclick="requestSongFromHome(${startIndex + idx})">
                    <div class="relative w-full aspect-square rounded-xl overflow-hidden mb-4">
                        <img src="${song.thumbnail}" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110">
                        <div class="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm">
                            <div class="w-12 h-12 rounded-full bg-textMain flex items-center justify-center shadow-glass"><i class="ph-fill ph-play text-app text-xl ml-1"></i></div>
                        </div>
                        ${durationBadge}
                    </div>
                    <h4 class="font-bold text-sm line-clamp-2 text-textMain group-hover:text-primary transition-colors">${song.title}</h4>
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
