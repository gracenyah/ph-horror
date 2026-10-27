window.ASSET_PREFIX = "";
window.SCRIPT_PREFIX = "";
window.SCENE_PATH = "2625452.json";
window.CONTEXT_OPTIONS = {
    'antialias': true,
    'alpha': false,
    'preserveDrawingBuffer': false,
    'deviceTypes': [`webgl2`, `webgl1`],
    'powerPreference': "high-performance"
};
window.SCRIPTS = [ 311636338, 311683540, 311683862, 311684027, 311685957, 311686020, 311686167, 311686357, 311686360, 311719629, 311721264, 311721269, 311725049, 311731280, 311793872, 311794184, 311794819, 311795490, 311796847, 311823694, 311824065, 311857408, 311985599, 311985600, 311985706, 311989767, 311990580, 311992304, 311993234, 312137022, 312143088, 312181798, 312318938, 312318941, 312321809, 312322722, 312551539, 312709726, 312711562, 312711639, 312731275, 312776746, 312777673, 312790609, 312790610, 312796847, 312796942, 312797013, 312797197, 312797286, 312798032, 312798125, 312798206, 312798310, 312798393, 312799499, 312800484, 312800703, 312803059, 312907678, 312939793, 312941985, 312942028, 313044305, 313057569, 313070675 ];
window.CONFIG_FILENAME = "config.json";
window.INPUT_SETTINGS = {
    useKeyboard: true,
    useMouse: true,
    useGamepads: false,
    useTouch: true
};
pc.script.legacy = false;
window.PRELOAD_MODULES = [
    {'moduleName' : 'Ammo', 'glueUrl' : 'files/assets/311644257/1/ammo.wasm.js', 'wasmUrl' : 'files/assets/311644258/1/ammo.wasm.wasm', 'fallbackUrl' : 'files/assets/311644256/1/ammo.js', 'preload' : true},
];
/* LOST_CITY_CHAPTER_BOOT_RESUME */
(function () {
    try {
        var chapter = Number(window.localStorage.getItem("lostcity:release:chapter"));
        var scenes = {"1":"2625452.json","4":"2632292.json","3":"2629114.json","2":"2626953.json","5":"2633419.json"};
        if (chapter >= 2 && chapter <= 5 && scenes[chapter]) window.SCENE_PATH = scenes[chapter];
    } catch (ignored) { /* The first chapter works without browser storage. */ }
}());
