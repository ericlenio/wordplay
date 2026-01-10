const VERSION = "1.0.29";
// --- Configuration ---
const DICT_URL_COMMON = "https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english.txt";
const DICT_URL_SCRABBLE = "https://raw.githubusercontent.com/jesstess/Scrabble/master/scrabble/sowpods.txt";
const DEF_API_URL = "https://api.dictionaryapi.dev/api/v2/entries/en/";
const GRID_SIZE = 4;
const GAME_DURATION = 180;
const GENERATION_BATCH_SIZE = 50;    
const STORAGE_KEY = "wordplay_config_v1";
const DICT_STORAGE_KEY_COMMON = "wordplay_dictionary_cache_common";
const DICT_STORAGE_KEY_SCRABBLE = "wordplay_dictionary_cache_scrabble";
const GAME_SAVE_KEY = "wordplay_save_v1";
const HIT_RADIUS_PERCENT = 0.4;

const DICE = [
    "AAEEGN", "ABBJOO", "ACHOPS", "AFFKPS",
    "AOOTTW", "CIMOTU", "DEILRX", "DELRVY",
    "DISTTY", "EEGHNW", "EEINSU", "EHRTVW",
    "EIOSST", "ELRTTY", "HIMNQU", "HLNNRZ"
];

const FALLBACK_DICT = new Set(["THE", "AND", "FOR", "ARE", "BUT", "NOT", "YOU", "ALL", "ANY", "CAN", "HER", "WAS", "ONE", "OUR", "OUT", "DAY", "GET", "HAS", "HIM", "HIS", "HOW", "MAN", "NEW", "NOW", "OLD", "SEE", "TWO", "WAY", "WHO", "BOY", "DID", "ITS", "LET", "PUT", "SAY", "SHE", "TOO", "USE", "DAD", "MOM", "CAT", "DOG", "RUN", "EAT", "BIG", "RED", "FOX", "LOW", "OWN", "ZOO", "WEB", "FUN", "WIN", "HOT", "SIX", "TEN", "YES", "WORD", "PLAY", "GAME"]);


// Load Config from Local Storage
let config = {
    minWordLength: 4,
    maxWordsOnBoard: 12,
    timerMode: 'stopwatch',
    hapticsEnabled: true,
    dictionary: 'common',
};

const savedConfig = localStorage.getItem(STORAGE_KEY);
if (savedConfig) {
    try {
        config = { ...config, ...JSON.parse(savedConfig) };
    } catch(e) {}
}

let state = {
    dictionaryArr: [], 
    dictionarySet: new Set(),
    grid: [],
    hotIndices: [],
    selectedIndices: [],
    foundWordsSet: new Set(),
    foundWordsList: [],       
    score: 0,
    totalPossibleWords: 0, 
    allSolutions: [], 
    timeLeft: GAME_DURATION,
    elapsedTime: 0,
    timerInterval: null,
    isPlaying: false,
    isPaused: false,
    isAutoPaused: false,
    isDictLoaded: false,
    stopGeneration: false,
    newSW: null
};

// --- Service Worker & Update Logic ---
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js')
                .then(reg => {
                    console.log('Service Worker registered.');
                    reg.addEventListener('updatefound', () => {
                        state.newSW = reg.installing;
                        state.newSW.addEventListener('statechange', () => {
                            if (state.newSW.state === 'installed') {
                                if (navigator.serviceWorker.controller) {
                                    showUpdateToast();
                                }
                            }
                        });
                    });
                })
                .catch(err => console.log('Service Worker registration failed: ', err));
        });
    }
}

function showUpdateToast() {
    let toast = document.getElementById('update-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'update-toast';
        toast.innerHTML = `
            <span>A new version is available!</span>
            <button id="btn-refresh">Reload</button>
            <button id="btn-dismiss">Later</button>
        `;
        document.body.appendChild(toast);

        document.getElementById('btn-refresh').addEventListener('click', () => {
            state.newSW.postMessage({ type: 'SKIP_WAITING' });
            toast.classList.remove('visible');
        });
        document.getElementById('btn-dismiss').addEventListener('click', () => {
            toast.classList.remove('visible');
        });
    }
    toast.classList.add('visible');
}

navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
});

// This function is called when the user clicks the version number.
// It programmatically triggers the browser's service worker update check.
// The outcome of this check is handled by the 'updatefound' event listener
// in registerServiceWorker(), which will show the update toast if a new
// version is found. This function itself does not and should not attempt
// to determine if an update is available; that's the role of the event listener.
function checkForUpdate() {
    console.log("Checking for update...");
    navigator.serviceWorker.getRegistration()
        .then(reg => {
            if (!reg) {
                console.log("No service worker registered.");
                alert("Update check failed: No service worker is controlling the page.");
                return;
            }
            
            // reg.update() returns a Promise that resolves when the update check is complete.
            // It fetches the service worker script and compares it byte-by-byte.
            reg.update().catch(err => {
                console.error("Service worker update check failed:", err);
                alert("Update check failed. See console for details.");
            });
        })
        .catch(err => {
            console.error("Failed to get service worker registration:", err);
            alert("Update check failed. See console for details.");
        });
}


// --- Dictionary Loading ---
async function loadDictionary() {
    const loader = document.getElementById('grid-loader');
    const msgText = document.getElementById('loader-msg');
    const msgArea = document.getElementById('message-area');
    
    const currentDictUrl = config.dictionary === 'common' ? DICT_URL_COMMON : DICT_URL_SCRABBLE;
    const currentDictStorageKey = config.dictionary === 'common' ? DICT_STORAGE_KEY_COMMON : DICT_STORAGE_KEY_SCRABBLE;
    
    const processDictionaryText = (text) => {
        state.dictionaryArr = text.toUpperCase().split(/\r?\n/).filter(w => w.length >= 2).sort();
        state.dictionarySet = new Set(state.dictionaryArr);
        state.isDictLoaded = true;
        
        msgText.innerText = "Dictionary Ready!";
        loader.style.display = 'none';
        
        enableControls();
        if (!restoreGame()) initGame();
    };

    try {
        const cachedDict = localStorage.getItem(currentDictStorageKey);
        if (cachedDict) {
            msgText.innerText = "Loading from cache...";
            console.warn("Dictionary loaded from local storage cache.");
            processDictionaryText(cachedDict);
            return;
        }
    } catch (e) {
        console.warn("Failed to read from local storage:", e);
    }

    try {
        msgText.innerText = "Downloading Dictionary...";
        msgArea.innerText = "Connecting...";
        const response = await fetch(currentDictUrl);
        if (!response.ok) throw new Error("Network response was not ok");
        
        const text = await response.text();
        
        try {
            localStorage.setItem(currentDictStorageKey, text);
            console.log("Dictionary cached to local storage.");
        } catch (e) {
            console.warn("Could not cache dictionary (likely quota exceeded):", e);
        }

        processDictionaryText(text);

    } catch (error) {
        console.error("Dictionary fetch failed:", error);
        msgArea.innerText = "Offline Mode (Limited)";
        
        const fallbackList = Array.from(FALLBACK_DICT).sort();
        state.dictionaryArr = fallbackList;
        state.dictionarySet = FALLBACK_DICT;
        state.isDictLoaded = true;
        loader.style.display = 'none';
        
        enableControls();
        if (!restoreGame()) initGame();
    }
}

function enableControls() {
    document.querySelectorAll('#controls button').forEach(b => b.disabled = false);
}

// --- Core Logic ---

function generateGridLetters() {
    let dice = [...DICE];
    for (let i = dice.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [dice[i], dice[j]] = [dice[j], dice[i]];
    }
    return dice.map(die => {
        const char = die[Math.floor(Math.random() * 6)];
        return char === 'Q' ? 'QU' : char;
    });
}

function displayVersion() {
    let versionEl = document.getElementById('version-watermark');
    if (!versionEl) {
        versionEl = document.createElement('div');
        versionEl.id = 'version-watermark';
        versionEl.style.cssText = "position:fixed; bottom:5px; right:5px; opacity:0.5; font-size:0.7rem; cursor:pointer; z-index:100; font-family:sans-serif;";
        document.body.appendChild(versionEl);
        versionEl.addEventListener('click', checkForUpdate);
    }
    versionEl.innerText = typeof VERSION !== 'undefined' ? "v" + VERSION : "";
}

let hapticAudioCtx;
let hapticBuffer;

async function playHapticFeedback(duration) {
  if (!config.hapticsEnabled) {
    return;
  }

  if (navigator.vibrate) {
    navigator.vibrate(duration);
  }

  if (!hapticAudioCtx) {
    try {
      hapticAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const sampleRate = hapticAudioCtx.sampleRate;
      const numChannels = 1;
      const bufferDuration = 0.01;
      const bufferSize = sampleRate * bufferDuration;
      hapticBuffer = hapticAudioCtx.createBuffer(numChannels, bufferSize, sampleRate);
      const data = hapticBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = 0;
      }
    } catch (e) {
      console.warn("Could not create haptic audio context", e);
      hapticAudioCtx = null;
      return;
    }
  }
  
  try {
    const source = hapticAudioCtx.createBufferSource();
    source.buffer = hapticBuffer;
    source.connect(hapticAudioCtx.destination);
    source.start(0);
  } catch (e) {
    console.warn("Could not play haptic feedback", e);
  }
}

function initGame() {
    localStorage.removeItem(GAME_SAVE_KEY);
    if (!state.isDictLoaded) return;

    displayVersion();

    const loader = document.getElementById('grid-loader');
    const loaderText = document.getElementById('loader-msg');
    const btnStop = document.getElementById('btn-stop-gen');
    const gridEl = document.getElementById('grid');
    
    loader.style.display = 'flex';
    loaderText.innerText = "Generating Board...";
    btnStop.style.display = 'block'; 
    if(!gridEl.contains(loader)) gridEl.appendChild(loader);

    document.getElementById('summary-overlay').classList.remove('visible');
    state.stopGeneration = false; 
    
    generateValidBoard((finalGrid) => {
        state.grid = finalGrid;
        
        state.hotIndices = [];
        while(state.hotIndices.length < 3) {
            let r = Math.floor(Math.random() * 16);
            if(!state.hotIndices.includes(r)) state.hotIndices.push(r);
        }

        state.allSolutions = solveBoard(); 
        state.totalPossibleWords = state.allSolutions.length;

        state.foundWordsSet.clear();
        state.foundWordsList = [];
        state.score = 0;
        state.timeLeft = GAME_DURATION;
        state.elapsedTime = 0;
        
        state.isPaused = false;
        state.isAutoPaused = false;
        state.isPlaying = true;
        state.selectedIndices = [];

        updateUI();
        updateListUI();
        renderGrid();
        startTimer();
        
        document.getElementById('message-area').innerText = `Find words (${config.minWordLength}+ letters)!`;
        loader.style.display = 'none';
    });
}

function generateValidBoard(callback) {
    let attempts = 0;
    let bestBoard = [];
    let bestCount = 9999;
    const loaderText = document.getElementById('loader-msg');

    function attemptBatch() {
        if (state.stopGeneration) {
            console.log("Generation stopped by user.");
            callback(bestBoard.length ? bestBoard : generateGridLetters());
            return;
        }

        for (let i = 0; i < GENERATION_BATCH_SIZE; i++) {
            attempts++;
            const tempGrid = generateGridLetters();
            
            const prevGrid = state.grid;
            state.grid = tempGrid;
            const wordCount = solveBoardCountOnly(); 
            state.grid = prevGrid;

            if (wordCount > 0 && wordCount <= config.maxWordsOnBoard) {
                callback(tempGrid); 
                return; 
            }

            if (wordCount > 0 && wordCount < bestCount) {
                bestCount = wordCount;
                bestBoard = tempGrid;
            }
        }

        loaderText.innerText = `Generating... Attempt ${attempts}\nTarget: <${config.maxWordsOnBoard}\nBest Found: ${bestCount === 9999 ? '0' : bestCount}`;
        requestAnimationFrame(attemptBatch);
    }

    attemptBatch(); 
}

function renderGrid() {
    const gridEl = document.getElementById('grid');
    const loader = document.getElementById('grid-loader');
    gridEl.innerHTML = '';
    gridEl.appendChild(loader); 
    
    state.grid.forEach((letter, index) => {
        const tile = document.createElement('div');
        tile.className = 'tile';
        tile.innerText = letter === 'QU' ? 'Qu' : letter;
        tile.dataset.index = index;
        
        if (state.hotIndices.includes(index)) {
            tile.classList.add('hot');
        }

        tile.addEventListener('mousedown', (e) => startSelection(index, e));
        tile.addEventListener('mousemove', (e) => handleMove(index, e));
        gridEl.appendChild(tile);
    });
}

function isPointerInActiveZone(e, element) {
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const dist = Math.sqrt(Math.pow(clientX - centerX, 2) + Math.pow(clientY - centerY, 2));
    const maxDist = Math.min(rect.width, rect.height) * HIT_RADIUS_PERCENT;
    return dist <= maxDist;
}

let isDragging = false;

function startSelection(index, e) {
    if (!state.isPlaying || state.isPaused) return;
    e.preventDefault();
    if (!isPointerInActiveZone(e, e.target)) return;
    isDragging = true;
    state.selectedIndices = [index];
    updateVisualSelection();
}

function handleMove(index, e) {
    if (!isDragging) return;
    if (isPointerInActiveZone(e, e.target)) {
        updateSelection(index);
    }
}

function updateSelection(index) {
    if (!isDragging) return;
    const lastIndex = state.selectedIndices[state.selectedIndices.length - 1];
    
    if (state.selectedIndices.length > 1 && state.selectedIndices[state.selectedIndices.length - 2] === index) {
        state.selectedIndices.pop();
        updateVisualSelection();
        return;
    }

    if (!state.selectedIndices.includes(index) && isAdjacent(lastIndex, index)) {
        state.selectedIndices.push(index);
        updateVisualSelection();
    }
}

function endSelection() {
    if (!isDragging) return;
    isDragging = false;
    submitWord();
    state.selectedIndices = [];
    updateVisualSelection();
}

const gridEl = document.getElementById('grid');
gridEl.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    if (el && el.classList.contains('tile')) {
        if (isPointerInActiveZone(e, el)) {
            startSelection(parseInt(el.dataset.index), e);
        }
    }
}, {passive: false});

gridEl.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    if (el && el.classList.contains('tile')) {
        if (isPointerInActiveZone(e, el)) {
            updateSelection(parseInt(el.dataset.index));
        }
    }
}, {passive: false});

gridEl.addEventListener('touchend', endSelection);
window.addEventListener('mouseup', endSelection);

function isAdjacent(i1, i2) {
    const x1 = i1 % 4, y1 = Math.floor(i1 / 4);
    const x2 = i2 % 4, y2 = Math.floor(i2 / 4);
    return Math.abs(x1 - x2) <= 1 && Math.abs(y1 - y2) <= 1;
}

function getSelectedWord() {
    return state.selectedIndices.map(i => state.grid[i]).join('');
}

function updateVisualSelection() {
    document.querySelectorAll('.tile').forEach(t => {
        t.classList.remove('selected', 'valid-path', 'found-path');
    });

    const word = getSelectedWord();
    const isReal = state.dictionarySet.has(word) && word.length >= config.minWordLength;
    const isFound = state.foundWordsSet.has(word);
    
    const el = document.getElementById('current-word');
    el.innerText = word;
    el.className = ''; 

    if (isFound) el.classList.add('found');
    else if (isReal) el.classList.add('valid');

    // Live Feedback in Message Area
    if (state.selectedIndices.length > 0) {
        const msg = document.getElementById('message-area');
        if (isFound) msg.innerText = "Already Found";
        else if (isReal) msg.innerText = "Valid Word!";
        else if (word.length >= config.minWordLength) msg.innerText = "Unknown Word";
        else msg.innerText = "...";
    }

    state.selectedIndices.forEach(i => {
        const tile = document.querySelector(`.tile[data-index="${i}"]`);
        tile.classList.add('selected');
        if (isReal) {
            if (isFound) tile.classList.add('found-path');
            else tile.classList.add('valid-path');
        }
    });
}

function triggerFeedback() {
    const grid = document.getElementById('grid');
    grid.classList.add('success-flash');
    setTimeout(() => grid.classList.remove('success-flash'), 300);
    playHapticFeedback(50);
}

function submitWord() {
    const word = getSelectedWord();
    const el = document.getElementById('current-word');
    el.className = '';
    
    if (word.length < config.minWordLength) {
        setMessage("Too short!");
        return;
    }
    if (state.foundWordsSet.has(word)) {
        setMessage("Already found!");
        return;
    }

    if (state.dictionarySet.has(word)) {
        state.foundWordsSet.add(word);
        const points = getWordPoints(word, state.selectedIndices);
        state.score += points;
        state.foundWordsList.unshift({ word: word, points: points });
        setMessage("Found: " + word);
        saveGameState();
        
        triggerFeedback();
        updateListUI();

        if (state.foundWordsSet.size === state.totalPossibleWords) {
            endGame("Congratulations! All words found!");
        }

    } else {
        setMessage("Unknown word");
    }
    updateUI();
}

function getWordPoints(word, indices) {
    let points = 0;
    const len = word.length;
    if (len === 3) points = 1;
    else if (len === 4) points = 1;
    else if (len === 5) points = 2;
    else if (len === 6) points = 3;
    else if (len === 7) points = 5;
    else points = 11;

    let multiplier = 1;
    if (indices) {
        indices.forEach(idx => {
            if (state.hotIndices.includes(idx)) multiplier *= 2;
        });
    }
    return points * multiplier;
}

function setMessage(msg) {
    document.getElementById('message-area').innerText = msg;
}

function updateUI() {
    document.getElementById('score').innerText = state.score;
    
    const remaining = state.totalPossibleWords - state.foundWordsSet.size;
    document.getElementById('word-remaining').innerText = remaining;
    
    let timeDisplay = "";
    if (config.timerMode === 'countdown') {
        const m = Math.floor(state.timeLeft / 60);
        const s = state.timeLeft % 60;
        timeDisplay = `${m}:${s.toString().padStart(2, '0')}`;
    } else {
        const m = Math.floor(state.elapsedTime / 60);
        const s = state.elapsedTime % 60;
        timeDisplay = `${m}:${s.toString().padStart(2, '0')}`;
    }
    document.getElementById('timer').innerText = timeDisplay;
}

function updateListUI() {
    const listEl = document.getElementById('found-words-list');
    // Sort words alphabetically (A-Z)
    const sortedList = [...state.foundWordsList].sort((a, b) => a.word.localeCompare(b.word));
    listEl.innerHTML = sortedList.map(item => 
        `<div class="word-row">
            <span>${item.word}</span>
            <span class="word-points">${item.points}</span>
        </div>`
    ).join('');
}

function startTimer() {
    if (state.timerInterval) clearInterval(state.timerInterval);
    state.timerInterval = setInterval(() => {
        if (!state.isPaused) {
            if (config.timerMode === 'countdown') {
                state.timeLeft--;
                if (state.timeLeft <= 0) endGame("Time's Up!");
            } else {
                state.elapsedTime++;
            }
            updateUI();
        }
    }, 1000);
}

function getNeighbors(idx) {
    const neighbors = [];
    const x = idx % 4;
    const y = Math.floor(idx / 4);
    
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < 4 && ny >= 0 && ny < 4) {
                neighbors.push(ny * 4 + nx);
            }
        }
    }
    return neighbors;
}

function hasPrefix(prefix, dictArr) {
    let low = 0;
    let high = dictArr.length - 1;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const word = dictArr[mid];
        if (word.startsWith(prefix)) return true;
        if (word < prefix) low = mid + 1;
        else high = mid - 1;
    }
    return false;
}

function solveBoardCountOnly() {
    let count = 0;
    const found = new Set();
    const visited = new Array(16).fill(false);

    function dfs(index, currentWord) {
        if (!hasPrefix(currentWord, state.dictionaryArr)) return;

        if (currentWord.length >= config.minWordLength && state.dictionarySet.has(currentWord)) {
            if (!found.has(currentWord)) {
                found.add(currentWord);
                count++;
            }
        }

        visited[index] = true;
        const neighbors = getNeighbors(index);
        for (let nIdx of neighbors) {
            if (!visited[nIdx]) {
                dfs(nIdx, currentWord + state.grid[nIdx]);
            }
        }
        visited[index] = false; 
    }

    for (let i = 0; i < 16; i++) {
        dfs(i, state.grid[i]);
    }
    return count;
}

function solveBoard() {
    const allWords = new Set();
    const results = [];
    const visited = new Array(16).fill(false);

    function dfs(index, currentWord, pathIndices) {
        if (!hasPrefix(currentWord, state.dictionaryArr)) return;

        if (currentWord.length >= config.minWordLength && state.dictionarySet.has(currentWord)) {
            if (!allWords.has(currentWord)) {
                allWords.add(currentWord);
                results.push({
                    word: currentWord,
                    points: getWordPoints(currentWord, pathIndices),
                    indices: pathIndices
                });
            }
        }

        visited[index] = true;
        const neighbors = getNeighbors(index);
        for (let nIdx of neighbors) {
            if (!visited[nIdx]) {
                dfs(nIdx, currentWord + state.grid[nIdx], [...pathIndices, nIdx]);
            }
        }
        visited[index] = false; 
    }

    for (let i = 0; i < 16; i++) {
        dfs(i, state.grid[i], [i]);
    }

    return results.sort((a, b) => b.word.length - a.word.length || a.word.localeCompare(b.word));
}

function renderSummaryGrid() {
    const sumGrid = document.getElementById('summary-grid');
    sumGrid.innerHTML = '';
    
    state.grid.forEach((letter, index) => {
        const tile = document.createElement('div');
        tile.className = 'sum-tile';
        tile.id = `sum-tile-${index}`; 
        tile.innerText = letter === 'QU' ? 'Qu' : letter;
        if (state.hotIndices.includes(index)) {
            tile.classList.add('hot');
        }
        sumGrid.appendChild(tile);
    });
}

window.previewWord = function(indicesJson) {
    playHapticFeedback(20);

    let indices;
    if (typeof indicesJson === 'string') {
        try {
           indices = JSON.parse(indicesJson);
        } catch (e) {
           console.error("Failed to parse indices", e);
           return;
        }
    } else {
        indices = indicesJson;
    }
    
    document.querySelectorAll('.sum-tile').forEach(t => t.classList.remove('preview-path'));
    
    indices.forEach(idx => {
        const tile = document.getElementById(`sum-tile-${idx}`);
        if(tile) tile.classList.add('preview-path');
    });
};

function endGame(title = "Game Finished") {
    clearInterval(state.timerInterval);
    localStorage.removeItem(GAME_SAVE_KEY);
    state.isPlaying = false;
    document.getElementById('summary-overlay').classList.add('visible');
    document.querySelector('#summary-overlay h2').innerText = title;
    
    if (!state.allSolutions || state.allSolutions.length === 0) {
        state.allSolutions = solveBoard();
    }
    
    renderSummaryGrid();

    let totalPossibleScore = 0;
    state.allSolutions.forEach(w => totalPossibleScore += w.points);

    if(document.getElementById('final-score')) 
        document.getElementById('final-score').innerText = state.score;
    
    if(document.getElementById('final-total-score')) 
        document.getElementById('final-total-score').innerText = totalPossibleScore;
        
    if(document.getElementById('final-found-count')) 
        document.getElementById('final-found-count').innerText = state.foundWordsSet.size;
        
    if(document.getElementById('final-total-count')) 
        document.getElementById('final-total-count').innerText = state.totalPossibleWords;

    const listContainer = document.getElementById('final-word-list');
    // Sort allSolutions alphabetically for display on the finish screen
    const alphabeticallySortedSolutions = [...state.allSolutions].sort((a, b) => a.word.localeCompare(b.word));

    listContainer.innerHTML = alphabeticallySortedSolutions.map(item => {
        const isFound = state.foundWordsSet.has(item.word);
        const cssClass = isFound ? 'res-row found' : 'res-row missed';
        const icon = isFound ? '✓' : '';
        
        const indicesStr = JSON.stringify(item.indices).replace(/"/g, "&quot;");
        
        return `<div class="${cssClass}" onclick="previewWord('${indicesStr}')">
            <span>${item.word} ${icon}</span>
            <div style="display:flex; align-items:center;">
                <span class="pts">${item.points}</span>
                <button class="def-btn" onclick="event.stopPropagation(); showDefinition('${item.word}')">📖</button>
            </div>
        </div>`;
    }).join('');
}

window.showDefinition = async function(word) {
    const modal = document.getElementById('def-overlay');
    const title = document.getElementById('def-title');
    const content = document.getElementById('def-content');
    
    modal.classList.add('visible');
    title.innerText = word;
    content.innerHTML = "Loading definition...";
    
    try {
        const res = await fetch(DEF_API_URL + word);
        if (!res.ok) throw new Error("Not found");
        const data = await res.json();
        
        let html = "";
        if (Array.isArray(data) && data.length > 0) {
            data[0].meanings.forEach(meaning => {
                html += `<div class="def-part">${meaning.partOfSpeech}</div>`;
                meaning.definitions.slice(0, 2).forEach(d => {
                    html += `<div class="def-text">• ${d.definition}</div>`;
                });
            });
        } else {
            html = "Definition not found.";
        }
        content.innerHTML = html;
    } catch (e) {
        content.innerHTML = "Definition not available for this word.";
    }
};

const optionsModal = document.getElementById('settings-overlay');
const minLenInput = document.getElementById('setting-min-len');
const maxWordsInput = document.getElementById('setting-max-words');
const timerModeInput = document.getElementById('setting-timer-mode');
const hapticsInput = document.getElementById('setting-haptics');
const dictionaryInput = document.getElementById('setting-dictionary');

document.getElementById('btn-options').addEventListener('click', () => {
    state.isPaused = true; 
    minLenInput.value = config.minWordLength;
    maxWordsInput.value = config.maxWordsOnBoard;
    timerModeInput.value = config.timerMode || 'countdown';
    hapticsInput.checked = config.hapticsEnabled;
    dictionaryInput.value = config.dictionary || 'common';
    optionsModal.classList.add('visible');
});

document.getElementById('btn-save-settings').addEventListener('click', () => {
    const newMin = parseInt(minLenInput.value);
    const newMax = parseInt(maxWordsInput.value);
    const newMode = timerModeInput.value;
    const newHaptics = hapticsInput.checked;
    const newDictionary = dictionaryInput.value;

    if(newMin >= 2 && newMin <= 8) config.minWordLength = newMin;
    if(newMax >= 1) config.maxWordsOnBoard = newMax;
    config.timerMode = newMode;
    config.hapticsEnabled = newHaptics;
    config.dictionary = newDictionary;

    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));

    optionsModal.classList.remove('visible');
    loadDictionary(); 
});

document.getElementById('btn-cancel-settings').addEventListener('click', () => {
    optionsModal.classList.remove('visible');
    state.isPaused = false; 
});

document.getElementById('btn-test-haptic').addEventListener('click', () => {
    if (config.hapticsEnabled) {
        if (navigator.vibrate) navigator.vibrate(50);
    }
    else {
        console.warn("Haptics are disabled in settings.");
    }
});

document.getElementById('btn-reset-storage').addEventListener('click', () => {
    if (confirm("Are you sure you want to reset ALL game data? This is irreversible and will reload the page.")) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(DICT_STORAGE_KEY_COMMON);
        localStorage.removeItem(DICT_STORAGE_KEY_SCRABBLE);
        localStorage.removeItem(GAME_SAVE_KEY);
        location.reload();
    }
});

// --- Standard Buttons ---

document.getElementById('btn-pause').addEventListener('click', () => {
    if (state.isPaused) {
        state.isPaused = false;
        startTimer(); // Restart loop
        document.getElementById('btn-pause').innerText = "Pause";
        document.getElementById('grid').style.opacity = 1;
        setMessage("");
    } else {
        state.isPaused = true;
        clearInterval(state.timerInterval); // Stop loop
        document.getElementById('btn-pause').innerText = "Resume";
        document.getElementById('grid').style.opacity = 0.1;
        setMessage("Game Paused");
    }
    saveGameState();
});

document.getElementById('btn-stop-gen').addEventListener('click', () => {
    state.stopGeneration = true;
});

document.getElementById('btn-finish').addEventListener('click', () => {
    if (confirm("Are you sure you want to finish the game?")) {
        endGame("Game Finished");
    }
});



document.getElementById('btn-restart').addEventListener('click', () => {
    document.getElementById('summary-overlay').classList.remove('visible');
    initGame();
});

// Handle tab switching / minimizing
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        if (state.isPlaying && !state.isPaused) {
            state.isPaused = true;
            state.isAutoPaused = true;
            clearInterval(state.timerInterval); // Hard stop
            
            document.getElementById('btn-pause').innerText = "Resume";
            document.getElementById('grid').style.opacity = 0.1;
            setMessage("Game Paused");
        }
    } else {
        if (state.isAutoPaused) {
            state.isPaused = false;
            state.isAutoPaused = false;
            startTimer(); // Restart
            
            document.getElementById('btn-pause').innerText = "Pause";
            document.getElementById('grid').style.opacity = 1;
            setMessage("");
        }
    }
});

// Start loading
registerServiceWorker();
loadDictionary();
// --- Save/Restore Logic ---

window.addEventListener("pagehide", saveGameState);

function saveGameState() {
    if (!state.isPlaying && state.foundWordsList.length === 0) return;
    
    const data = {
        grid: state.grid,
        hotIndices: state.hotIndices,
        foundWords: state.foundWordsList,
        score: state.score,
        timeLeft: state.timeLeft,
        elapsedTime: state.elapsedTime,
        config: config
    };
    localStorage.setItem(GAME_SAVE_KEY, JSON.stringify(data));
}

function restoreGame() {
    const json = localStorage.getItem(GAME_SAVE_KEY);
    if (!json) return false;

    try {
        let data = JSON.parse(json);
        
        if (data.config) {
            config = { ...config, ...data.config };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
        }

        state.grid = data.grid;
        state.hotIndices = data.hotIndices;
        state.score = data.score;
        state.timeLeft = data.timeLeft || GAME_DURATION;
        state.elapsedTime = data.elapsedTime || 0;
        state.foundWordsList = data.foundWords || [];
        state.foundWordsSet = new Set(state.foundWordsList.map(item => item.word));
        
        state.isPlaying = true;
        state.isPaused = false; 
        state.selectedIndices = [];
        state.allSolutions = solveBoard();
        state.totalPossibleWords = state.allSolutions.length;

        // Use requestAnimationFrame to ensure UI updates happen after browser layout settles
        requestAnimationFrame(() => {
            document.getElementById('summary-overlay').classList.remove('visible');
            updateUI();
            updateListUI();
            renderGrid();
            startTimer();
            displayVersion();
            
            document.getElementById('btn-pause').innerText = "Pause";
            document.getElementById('grid').style.opacity = "1";
            setMessage("Game Restored");
        });
        
        return true;
    } catch (e) { return false; }
}
// --- END OF FILE ---
