// --- Configuration ---
const DICT_URL = "https://raw.githubusercontent.com/jesstess/Scrabble/master/scrabble/sowpods.txt";
const DEF_API_URL = "https://api.dictionaryapi.dev/api/v2/entries/en/";
const GRID_SIZE = 4;
const GAME_DURATION = 180;
const GENERATION_BATCH_SIZE = 50;    
const STORAGE_KEY = "wordplay_config_v1";
const DICT_STORAGE_KEY = "wordplay_dictionary_cache";
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
    minWordLength: 3,
    maxWordsOnBoard: 999,
    timerMode: 'countdown' // 'countdown' or 'stopwatch'
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
    isDictLoaded: false,
    stopGeneration: false 
};

// --- Dictionary Loading ---

async function loadDictionary() {
    const loader = document.getElementById('grid-loader');
    const msgText = document.getElementById('loader-msg');
    const msgArea = document.getElementById('message-area');
    
    const processDictionaryText = (text) => {
        state.dictionaryArr = text.toUpperCase().split(/\r?\n/).filter(w => w.length >= 2).sort();
        state.dictionarySet = new Set(state.dictionaryArr);
        state.isDictLoaded = true;
        
        msgText.innerText = "Dictionary Ready!";
        loader.style.display = 'none';
        
        enableControls();
        initGame();
    };

    try {
        const cachedDict = localStorage.getItem(DICT_STORAGE_KEY);
        if (cachedDict) {
            msgText.innerText = "Loading from cache...";
            console.log("Dictionary loaded from local storage cache.");
            processDictionaryText(cachedDict);
            return;
        }
    } catch (e) {
        console.warn("Failed to read from local storage:", e);
    }

    try {
        msgText.innerText = "Downloading Dictionary...";
        msgArea.innerText = "Connecting...";
        const response = await fetch(DICT_URL);
        if (!response.ok) throw new Error("Network response was not ok");
        
        const text = await response.text();
        
        try {
            localStorage.setItem(DICT_STORAGE_KEY, text);
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
        initGame();
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

function initGame() {
    if (!state.isDictLoaded) return;

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
        
        // Reset Timers based on Mode
        state.timeLeft = GAME_DURATION;
        state.elapsedTime = 0;
        
        state.isPaused = false;
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
    const msg = document.getElementById('message-area');
    if (state.selectedIndices.length > 0) {
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
    if (navigator.vibrate) {
        navigator.vibrate(0);
        navigator.vibrate(50);
    }
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
    listEl.innerHTML = state.foundWordsList.map(item => 
        `<div class="word-row">
            <span>${item.word}</span>
            <span class="word-points">+${item.points}</span>
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
    if (navigator.vibrate) navigator.vibrate(20);

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

function endGame(title = "Game Over") {
    clearInterval(state.timerInterval);
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
    listContainer.innerHTML = state.allSolutions.map(item => {
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

document.getElementById('btn-options').addEventListener('click', () => {
    state.isPaused = true; 
    minLenInput.value = config.minWordLength;
    maxWordsInput.value = config.maxWordsOnBoard;
    timerModeInput.value = config.timerMode || 'countdown';
    optionsModal.classList.add('visible');
});

document.getElementById('btn-save-settings').addEventListener('click', () => {
    const newMin = parseInt(minLenInput.value);
    const newMax = parseInt(maxWordsInput.value);
    const newMode = timerModeInput.value;

    if(newMin >= 2 && newMin <= 8) config.minWordLength = newMin;
    if(newMax >= 1) config.maxWordsOnBoard = newMax;
    config.timerMode = newMode;

    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));

    optionsModal.classList.remove('visible');
    initGame(); 
});

document.getElementById('btn-cancel-settings').addEventListener('click', () => {
    optionsModal.classList.remove('visible');
    state.isPaused = false; 
});

document.getElementById('btn-test-haptic').addEventListener('click', () => {
    if (navigator.vibrate) navigator.vibrate(50);
    else alert("Your browser or device does not support vibration.");
});

document.getElementById('btn-pause').addEventListener('click', () => {
    state.isPaused = !state.isPaused;
    const btn = document.getElementById('btn-pause');
    if (state.isPaused) {
        btn.innerText = "Resume";
        document.getElementById('grid').style.opacity = 0.1;
        setMessage("Game Paused");
    } else {
        btn.innerText = "Pause";
        document.getElementById('grid').style.opacity = 1;
        setMessage("");
    }
});

document.getElementById('btn-stop-gen').addEventListener('click', () => {
    state.stopGeneration = true;
});

document.getElementById('btn-finish').addEventListener('click', () => endGame("Game Finished"));

document.getElementById('btn-rotate').addEventListener('click', () => {
    const grid = document.getElementById('grid');
    let rotation = parseInt(grid.dataset.rotation || 0) + 90;
    grid.style.transform = `rotate(${rotation}deg)`;
    grid.dataset.rotation = rotation;
    document.querySelectorAll('.tile').forEach(t => {
        t.style.transform = `rotate(${-rotation}deg)`;
    });
});

document.getElementById('btn-restart').addEventListener('click', () => {
    document.getElementById('summary-overlay').classList.remove('visible');
    initGame();
});

loadDictionary();
