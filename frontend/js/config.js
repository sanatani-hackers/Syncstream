// Static, never-mutated constants used across modules.

export const noMusicArt = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MDAiIGhlaWdodD0iNDAwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMTExMTEzIi8+PC9zdmc+";

export const eqBandsDef = [
    { name: 'Sub-Bass', freq: 60, type: 'lowshelf' },
    { name: 'Low-Mid', freq: 230, type: 'peaking' },
    { name: 'Mid', freq: 910, type: 'peaking' },
    { name: 'High-Mid', freq: 3600, type: 'peaking' },
    { name: 'Treble / Air', freq: 14000, type: 'highshelf' }
];

export const presets = {
    flat: [0, 0, 0, 0, 0],
    bassBoost: [8, 4, -1, 0, 2],
    electronic: [6, 2, -2, 3, 5],
    vocalBoost: [-2, 0, 4, 3, 1],
    acoustic: [-1, -1, 3, 4, 5]
};
