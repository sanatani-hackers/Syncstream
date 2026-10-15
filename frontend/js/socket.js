1| // WebSocket lifecycle: connect/reconnect, ping/latency measurement, and
2| // dispatching incoming messages (room_state, sync, pong) to the rest of
3| // the app.
4| import { noMusicArt } from './config.js';
5| import { state, runtime } from './state.js';
6| import { els } from './dom.js';
7| import { getAudioElement } from './audioEngine.js';
8| import { setEQAllowedByHost, getEQAllowedByHost } from './audioEngine.js';
9| import { loadAndPlaySong } from './player.js';
10| import { renderQueue } from './queue.js';
11| 
12| const audio = getAudioElement();
13| 
14| // Per-device sync override keys and helpers
15| const SYNC_MANUAL_KEY = 'sync_manual_offset_ms';
16| const SYNC_THRESHOLD_KEY = 'sync_threshold_ms';
17| const MAX_MANUAL_OFFSET_MS = 2000; // cap to avoid huge offsets
18| 
19| function loadManualOffsetMs() {
20|     const v = Number(localStorage.getItem(SYNC_MANUAL_KEY) || 0);
21|     if (isNaN(v)) return 0;
22|     return Math.max(0, Math.min(v, MAX_MANUAL_OFFSET_MS));
23| }
24| 
25| function loadThresholdMs() {
26|     const v = Number(localStorage.getItem(SYNC_THRESHOLD_KEY) || 100);
27|     if (isNaN(v)) return 100;
28|     return Math.max(0, Math.min(v, 5000));
29| }
30| 
31| function computeEffectiveRTTSeconds(measuredRttSeconds) {
32|     const measuredMs = Math.round(measuredRttSeconds * 1000);
33|     const manualMs = loadManualOffsetMs();
34|     const thresholdMs = loadThresholdMs();
35|     if (measuredMs >= thresholdMs && manualMs > 0) {
36|         return measuredRttSeconds + (manualMs / 1000);
37|     }
38|     return measuredRttSeconds;
39| }
40| 
41| export function connectWebSocket() {
42|     const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
43|     window.ws = new WebSocket(`${protocol}//${window.location.host}/ws/${state.roomId}/${state.userId}`);
44| 
45|     window.ws.onopen = () => {
46|         window.ws.send(JSON.stringify({ type: 'join', name: state.userName, role: state.role }));
47|         runtime.pingInterval = setInterval(() => {
48|             if (window.ws.readyState === WebSocket.OPEN) window.ws.send(JSON.stringify({ type: 'ping', client_time: Date.now() / 1000 }));
49|         }, 2000);
50|     };
51| 
52|     window.ws.onmessage = (event) => {
53|         const data = JSON.parse(event.data);
54|         if (data.type === 'room_state') handleRoomStateUpdate(data);
55|         else if (data.type === 'sync') handleClientSync(data);
56|         else if (data.type === 'pong') {
57|             const now = Date.now() / 1000, rtt = now - data.client_time;
58|             // apply manual offset if configured and measured rtt >= threshold
59|             const measuredMs = Math.round(rtt * 1000);
60|             const manualMs = loadManualOffsetMs();
61|             const thresholdMs = loadThresholdMs();
62|             const effectiveRtt = computeEffectiveRTTSeconds(rtt);
63|             runtime.timeOffset = (data.server_time + (effectiveRtt / 2)) - now;
64|             // display measured RTT and, when applied, the manual offset
65|             if (effectiveRtt !== rtt) {
66|                 els.navLatency.innerText = measuredMs + 'ms (+' + manualMs + 'ms)';
67|             } else {
68|                 els.navLatency.innerText = Math.round(rtt * 1000) + 'ms';
69|             }
70|             els.statusDot.className = `w-2 h-2 rounded-full ${rtt < 0.1 ? 'bg-success' : rtt < 0.3 ? 'bg-warning' : 'bg-danger'} animate-pulse`;
71|         }
72|     };
73|     window.ws.onclose = () => {
74|         els.statusDot.className = "w-2 h-2 rounded-full bg-textMuted";
75|         if (runtime.pingInterval) clearInterval(runtime.pingInterval);
76|         setTimeout(connectWebSocket, 3000);
77|     };
78| }
79| 
80| function handleRoomStateUpdate(data) {
81|     state.serverState = data.state; state.queue = data.queue;
82|     const me = data.users.find(u => u.id === state.userId);
83|     if (me) { state.isHost = (me.role === 'host'); els.navRole.innerText = state.isHost ? 'HOST' : 'CLIENT'; }
84| 
85|     if (data.state.eq_allowed !== undefined) {
86|         setEQAllowedByHost(data.state.eq_allowed);
87|         const hostToggle = document.getElementById('host-eq-toggle-container'), statusMsg = document.getElementById('eq-disabled-msg'), hostEqCheckbox = document.getElementById('host-eq-checkbox')[...]
87|         if (hostToggle) hostToggle.style.display = state.isHost ? 'flex' : 'none';
88|         if (hostEqCheckbox && state.isHost) hostEqCheckbox.checked = getEQAllowedByHost();
89|         if (!getEQAllowedByHost() && !state.isHost) statusMsg.classList.remove('hidden'); else statusMsg.classList.add('hidden');
90|     }
91| 
92|     renderQueue();
93|     const mode = state.serverState.play_mode || 'straight';
94|     els.btnMode.innerHTML = mode === 'shuffle' ? `<i class="ph ph-shuffle text-xl text-primary"></i>` : `<i class="ph ph-arrow-right text-xl"></i>`;
95| 
96|     if (state.isHost) {
97|         els.btnPlay.disabled = false; els.btnSkip.disabled = false; els.seekBar.disabled = false; els.btnMode.disabled = false;
98|         els.syncOverlay.classList.add('hidden'); audio.playbackRate = 1.0;
99|         if (!runtime.syncInterval) runtime.syncInterval = setInterval(() => {
100|             if (state.serverState.current_song && !audio.paused && audio.readyState >= 2 && !runtime.isSeeking) {
101|                 window.ws.send(JSON.stringify({ type: 'sync', time: audio.currentTime, playing: !audio.paused }));
102|             }
103|         }, 500);
104|     } else {
105|         els.btnPlay.disabled = true; els.btnSkip.disabled = true; els.seekBar.disabled = true; els.btnMode.disabled = true;
106|         if (runtime.syncInterval) { clearInterval(runtime.syncInterval); runtime.syncInterval = null; }
107|     }
108| 
109|     if (state.serverState.status === "finding_next") { els.playerStatus.innerHTML = `<span class="text-primary animate-pulse">Curating next track...</span>`; return; }
110| 
111|     const newSong = data.state.current_song;
112|     if (newSong && newSong.id !== state.currentSongId) {
113|         state.currentSongId = newSong.id; loadAndPlaySong(newSong.id);
114|         els.playerArt.src = newSong.thumbnail; els.playerTitle.innerText = newSong.title;
115|     } else if (!newSong) {
116|         state.currentSongId = null; audio.pause(); audio.removeAttribute('src'); els.playerArt.classList.add('paused');
117|         els.playerArt.src = noMusicArt; els.playerTitle.innerText = "Queue is empty"; els.playerStatus.innerHTML = "Discover new music";
118|         els.iconPlay.className = "ph-fill ph-play text-2xl ml-1";
119|     }
120| }
121| 
122| function handleClientSync(data) {
123|     if (state.isHost) return;
124|     if (data.playing && audio.paused) { audio.play().then(() => els.playerArt.classList.remove('paused')).catch(e => els.syncOverlay.classList.remove('hidden')); }
125|     if (!data.playing && !audio.paused) { audio.pause(); audio.currentTime = data.time; audio.playbackRate = 1.0; els.playerArt.classList.add('paused'); }
126| 
127|     if (!data.playing || audio.readyState < 3) return;
128|     const diff = (data.time + ((Date.now() / 1000) + runtime.timeOffset - data.timestamp)) - audio.currentTime;
129|     if (Math.abs(diff) > 1.5) { audio.currentTime += diff; audio.playbackRate = 1.0; }
130|     else if (diff > 0.03) audio.playbackRate = Math.min(1.1, 1.0 + (diff * 0.5));
131|     else if (diff < -0.03) audio.playbackRate = Math.max(0.9, 1.0 + (diff * 0.5));
132|     else audio.playbackRate = 1.0;
133| }
134| 
135| // Initialize sync settings UI inputs (if present in DOM)
136| document.addEventListener('DOMContentLoaded', () => {
137|     const manualEl = document.getElementById('manual-offset-input');
138|     const threshEl = document.getElementById('offset-threshold-input');
139|     if (!manualEl || !threshEl) return;
140| 
141|     manualEl.value = String(loadManualOffsetMs());
142|     threshEl.value = String(loadThresholdMs());
143| 
144|     manualEl.addEventListener('change', () => {
145|         let v = Number(manualEl.value) || 0;
146|         v = Math.max(0, Math.min(v, MAX_MANUAL_OFFSET_MS));
147|         localStorage.setItem(SYNC_MANUAL_KEY, String(v));
148|         manualEl.value = String(v);
149|     });
150| 
151|     threshEl.addEventListener('change', () => {
152|         let v = Number(threshEl.value) || 100;
153|         v = Math.max(0, Math.min(v, 5000));
154|         localStorage.setItem(SYNC_THRESHOLD_KEY, String(v));
155|         threshEl.value = String(v);
156|     });
157| });
