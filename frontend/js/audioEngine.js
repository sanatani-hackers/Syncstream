// Web Audio API graph: media source -> channel splitter -> 5-band L/R
// biquad filter chains -> merger -> compressor -> destination.
// Also owns the EQ UI (sliders/presets) since it's tightly coupled to
// the filter nodes it renders controls for.
import { eqBandsDef, presets } from './config.js';

const audio = document.getElementById('core-audio');

let audioCtx, leftFilters = [], rightFilters = [];
let eqLinked = true, sourceNode, splitter, compressor;
let isEQBypassedLocal = false, isEQAllowedByHost = true;

export function getAudioElement() {
    return audio;
}

// Browsers suspend AudioContext until a user gesture resumes it. Exposed
// so player.js can resume it from the play button / sync-overlay tap
// without needing direct access to the module-private `audioCtx`.
export function resumeIfSuspended() {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

export function initAudioEngine() {
    if (audioCtx) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();

    sourceNode = audioCtx.createMediaElementSource(audio);
    splitter = audioCtx.createChannelSplitter(2);
    const merger = audioCtx.createChannelMerger(2);

    compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -3; compressor.knee.value = 10;
    compressor.ratio.value = 20; compressor.attack.value = 0.005; compressor.release.value = 0.1;

    for (let i = 0; i < eqBandsDef.length; i++) {
        const bLeft = audioCtx.createBiquadFilter();
        bLeft.type = eqBandsDef[i].type; bLeft.frequency.value = eqBandsDef[i].freq; bLeft.gain.value = 0;
        leftFilters.push(bLeft);

        const bRight = audioCtx.createBiquadFilter();
        bRight.type = eqBandsDef[i].type; bRight.frequency.value = eqBandsDef[i].freq; bRight.gain.value = 0;
        rightFilters.push(bRight);
    }

    splitter.connect(leftFilters[0], 0);
    for (let i = 0; i < 4; i++) leftFilters[i].connect(leftFilters[i + 1]);
    leftFilters[4].connect(merger, 0, 0);

    splitter.connect(rightFilters[0], 1);
    for (let i = 0; i < 4; i++) rightFilters[i].connect(rightFilters[i + 1]);
    rightFilters[4].connect(merger, 0, 1);

    merger.connect(compressor);
    compressor.connect(audioCtx.destination);

    applyAudioRouting();
}

export function applyAudioRouting() {
    if (!audioCtx || !sourceNode) return;
    sourceNode.disconnect();

    const eqContainer = document.getElementById('eq-sliders-container');
    const eqPresetChips = document.querySelectorAll('.preset-chip');
    const eqLinkToggle = document.getElementById('eq-link-toggle').parentElement;

    if (isEQAllowedByHost && !isEQBypassedLocal) {
        sourceNode.connect(splitter);
        eqContainer.classList.remove('opacity-50', 'pointer-events-none');
        eqPresetChips.forEach(c => c.classList.remove('pointer-events-none', 'opacity-50'));
        eqLinkToggle.classList.remove('opacity-50', 'pointer-events-none');
    } else {
        sourceNode.connect(compressor);
        eqContainer.classList.add('opacity-50', 'pointer-events-none');
        eqPresetChips.forEach(c => c.classList.add('pointer-events-none', 'opacity-50'));
        eqLinkToggle.classList.add('opacity-50', 'pointer-events-none');
    }
}

// Called when the user toggles their own local "Bypass EQ" checkbox.
// (Replaces the old inline `isEQBypassedLocal = this.checked; applyAudioRouting();`
// handler — see main.js for why this became a named function.)
export function setEQBypass(checked) {
    isEQBypassedLocal = checked;
    applyAudioRouting();
}

// Called by socket.js when room_state reports the host's eq_allowed flag.
export function setEQAllowedByHost(allowed) {
    if (isEQAllowedByHost !== allowed) {
        isEQAllowedByHost = allowed;
        applyAudioRouting();
    }
}

export function getEQAllowedByHost() {
    return isEQAllowedByHost;
}

export function buildEQUI() {
    document.getElementById('eq-sliders-container').innerHTML = eqBandsDef.map((band, idx) => `
        <div class="flex flex-col gap-3">
            <div class="flex justify-between items-end px-1">
                <div>
                    <span class="text-sm font-bold text-textMain">${band.freq}Hz</span>
                    <span class="text-textMuted text-xs ml-2">${band.name}</span>
                </div>
                <div class="text-xs font-mono text-textMuted tracking-wider">
                    <span id="val-l-${idx}">0</span>dB <span class="right-val-display hidden text-primaryHover">| <span id="val-r-${idx}">0</span>dB</span>
                </div>
            </div>
            <div class="flex flex-col gap-4">
                <div class="flex items-center gap-4">
                    <span class="text-[10px] font-bold text-textMuted w-4">L</span>
                    <input type="range" class="premium-slider eq-slider flex-1" min="-12" max="12" step="0.5" value="0" data-idx="${idx}" data-side="left" oninput="updateEQ(this)">
                </div>
                <div class="flex items-center gap-4 right-channel-row hidden">
                    <span class="text-[10px] font-bold text-primary w-4">R</span>
                    <input type="range" class="premium-slider eq-slider right-channel flex-1" min="-12" max="12" step="0.5" value="0" data-idx="${idx}" data-side="right" oninput="updateEQ(this)">
                </div>
            </div>
        </div>
    `).join('');
}

export function toggleEQLink(isLinked) {
    eqLinked = isLinked;
    const rightRows = document.querySelectorAll('.right-channel-row');
    const rightValsDisplays = document.querySelectorAll('.right-val-display');
    const leftLabels = document.querySelectorAll('.text-textMuted.w-4');

    rightRows.forEach(row => isLinked ? row.classList.add('hidden') : row.classList.remove('hidden'));
    rightValsDisplays.forEach(d => isLinked ? d.classList.add('hidden') : d.classList.remove('hidden'));
    leftLabels.forEach(l => l.innerText = isLinked ? '' : 'L');

    if (isLinked && audioCtx) {
        const leftSliders = document.querySelectorAll('input[data-side="left"]');
        const rightSliders = document.querySelectorAll('input[data-side="right"]');
        leftSliders.forEach((ls, i) => {
            const val = parseFloat(ls.value);
            rightSliders[i].value = val;
            rightFilters[i].gain.setTargetAtTime(val, audioCtx.currentTime, 0.1);
            document.getElementById(`val-r-${i}`).innerText = (val > 0 ? '+' : '') + val;
        });
    }
}

export function updateEQ(el) {
    if (!audioCtx) return;
    const idx = parseInt(el.getAttribute('data-idx')), side = el.getAttribute('data-side');
    const val = parseFloat(el.value), time = audioCtx.currentTime;

    if (side === 'left') {
        leftFilters[idx].gain.setTargetAtTime(val, time, 0.1);
        document.getElementById(`val-l-${idx}`).innerText = (val > 0 ? '+' : '') + val;
        if (eqLinked) {
            document.querySelector(`input[data-side="right"][data-idx="${idx}"]`).value = val;
            rightFilters[idx].gain.setTargetAtTime(val, time, 0.1);
            document.getElementById(`val-r-${idx}`).innerText = (val > 0 ? '+' : '') + val;
        }
    } else if (side === 'right' && !eqLinked) {
        rightFilters[idx].gain.setTargetAtTime(val, time, 0.1);
        document.getElementById(`val-r-${idx}`).innerText = (val > 0 ? '+' : '') + val;
    }
}

export function applyPreset(presetName, btnElement) {
    const preset = presets[presetName];
    if (!preset || !audioCtx) return;

    // UI Update
    document.querySelectorAll('.preset-chip').forEach(c => {
        c.className = "preset-chip px-5 py-2 rounded-full bg-transparent text-textSec hover:text-textMain hover:bg-white/5 text-sm font-medium transition-all whitespace-nowrap border border-transparent";
    });
    btnElement.className = "preset-chip px-5 py-2 rounded-full bg-white/10 text-textMain text-sm font-medium transition-all whitespace-nowrap shadow-sm border border-border";

    const leftSliders = document.querySelectorAll('input[data-side="left"]');
    const rightSliders = document.querySelectorAll('input[data-side="right"]');
    const time = audioCtx.currentTime;

    preset.forEach((val, idx) => {
        leftFilters[idx].gain.setTargetAtTime(val, time, 0.1);
        leftSliders[idx].value = val;
        document.getElementById(`val-l-${idx}`).innerText = (val > 0 ? '+' : '') + val;
        if (eqLinked) {
            rightFilters[idx].gain.setTargetAtTime(val, time, 0.1);
            rightSliders[idx].value = val;
            document.getElementById(`val-r-${idx}`).innerText = (val > 0 ? '+' : '') + val;
        }
    });
}
