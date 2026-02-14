/* =========================================
   ASCII WHISPER WEB - CORE LOGIC
   ========================================= */

// --- CONFIGURATION ---
const ASCII_CHARS = "@%#*+=-:. "; // Dark to Light
const VIDEO_WIDTH = 64;  // Resolution of ASCII art
const VIDEO_HEIGHT = 48;

// --- STATE ---
let peer = null;
let conn = null;
let localStream = null;
let isCameraOn = false;
let gameActive = false;
let gameState = {}; // Stores battleship data

// --- DOM ELEMENTS ---
const localAscii = document.getElementById('local-ascii');
const remoteAscii = document.getElementById('remote-ascii');
const chatHistory = document.getElementById('chat-history');
const chatInput = document.getElementById('chat-input');
const statusDisplay = document.getElementById('status');
const myIdDisplay = document.getElementById('my-id');
const hiddenVideo = document.getElementById('webcam');

// --- SOUND ENGINE (Web Audio API) ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playPing() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, audioCtx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
}

function playWhisper() {
    // Simple synthesis for "Whisper" effect
    const utterance = new SpeechSynthesisUtterance("Ascii... Whisper...");
    utterance.pitch = 0.5;
    utterance.rate = 0.8;
    utterance.volume = 0.5;
    window.speechSynthesis.speak(utterance);
}

// --- P2P NETWORKING (PeerJS) ---
function initPeer() {
    // Connects to the public PeerJS cloud server (free tier)
    peer = new Peer(null, {
        debug: 2
    });

    peer.on('open', (id) => {
        myIdDisplay.innerText = id;
        logSystem(`Network initialized. ID: ${id}`);
        playWhisper(); // Intro sound
    });

    peer.on('connection', (c) => {
        if (conn) { c.close(); return; } // Only one peer allowed
        conn = c;
        setupConnection();
        logSystem(`Incoming connection from ${conn.peer}`);
    });

    peer.on('error', (err) => logError(err.type));
}

function connectToPeer(remoteId) {
    if (conn) conn.close();
    conn = peer.connect(remoteId);
    setupConnection();
}

function setupConnection() {
    statusDisplay.innerText = "CONNECTED";
    statusDisplay.style.color = "#33ff00";
    
    conn.on('open', () => {
        logSystem("Connection established. Secure channel ready.");
        playPing();
    });

    conn.on('data', (data) => {
        handleIncomingData(data);
    });

    conn.on('close', () => {
        statusDisplay.innerText = "DISCONNECTED";
        statusDisplay.style.color = "red";
        logSystem("Peer disconnected.");
        conn = null;
        remoteAscii.innerText = "NO SIGNAL";
    });
}

function handleIncomingData(data) {
    if (data.type === 'chat') {
        logChat("PEER", data.msg);
    } else if (data.type === 'video') {
        remoteAscii.innerText = data.frame;
    } else if (data.type === 'game') {
        handleGamePacket(data.payload);
    } else if (data.type === 'ping') {
        playPing();
        logSystem("Peer pinged you!");
    }
}

// --- VIDEO / ASCII ENGINE ---
async function toggleCamera() {
    if (isCameraOn) {
        // Turn off
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        hiddenVideo.srcObject = null;
        localAscii.innerText = "CAMERA OFF";
        isCameraOn = false;
        return;
    }

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT } });
        hiddenVideo.srcObject = localStream;
        isCameraOn = true;
        processVideoFrame();
    } catch (err) {
        logError("Camera access denied.");
    }
}

function processVideoFrame() {
    if (!isCameraOn) return;

    // Use a temporary canvas to read pixel data
    const canvas = document.createElement('canvas');
    canvas.width = VIDEO_WIDTH;
    canvas.height = VIDEO_HEIGHT;
    const ctx = canvas.getContext('2d');

    // Draw video frame to canvas
    ctx.drawImage(hiddenVideo, 0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
    const imageData = ctx.getImageData(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
    const pixels = imageData.data;

    let asciiStr = "";
    
    for (let y = 0; y < VIDEO_HEIGHT; y += 2) { // Skip every other row to correct aspect ratio roughly
        for (let x = 0; x < VIDEO_WIDTH; x++) {
            const offset = (y * VIDEO_WIDTH + x) * 4;
            const r = pixels[offset];
            const g = pixels[offset + 1];
            const b = pixels[offset + 2];
            
            // Calculate brightness
            const brightness = (r + g + b) / 3;
            const charIndex = Math.floor((brightness / 255) * (ASCII_CHARS.length - 1));
            asciiStr += ASCII_CHARS[charIndex];
        }
        asciiStr += "\n";
    }

    localAscii.innerText = asciiStr;

    // Send to peer if connected (throttle to save bandwidth)
    if (conn && conn.open) {
        conn.send({ type: 'video', frame: asciiStr });
    }

    requestAnimationFrame(processVideoFrame);
}

// --- CHAT & COMMANDS ---
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const msg = chatInput.value;
        chatInput.value = '';
        processCommand(msg);
    }
});

function processCommand(input) {
    if (!input) return;

    // Is it a command?
    if (input.startsWith('/')) {
        const parts = input.split(' ');
        const cmd = parts[0].toLowerCase();
        const arg = parts[1];

        switch(cmd) {
            case '/connect':
                if (!arg) logError("Usage: /connect [PEER_ID]");
                else {
                    logSystem(`Connecting to ${arg}...`);
                    connectToPeer(arg);
                }
                break;
            case '/ping':
                playPing();
                logSystem("Ping sent.");
                if (conn) conn.send({ type: 'ping' });
                break;
            case '/togglecamera':
                toggleCamera();
                break;
            case '/battleship':
                startBattleship();
                break;
            case '/manual':
                showManual();
                break;
            case '/theme':
                document.body.style.filter = "hue-rotate(90deg)"; // Simple hack
                logSystem("Theme rotated.");
                break;
            // Battleship specific coords
            default:
                if (gameActive) {
                    processGameMove(input);
                } else {
                    logError("Unknown command. Try /manual");
                }
        }
    } else {
        // Regular chat
        if (gameActive && (input.length === 2 || input.length === 3)) {
            // Assume it's a game move if short
             processGameMove(input);
        } else {
            logChat("YOU", input);
            if (conn) conn.send({ type: 'chat', msg: input });
            else logError("Not connected to a peer.");
        }
    }
}

// --- LOGGING UTILS ---
function logChat(user, text) {
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<span class="user">[${user}]</span>: ${text}`;
    appendLog(div);
}

function logSystem(text) {
    const div = document.createElement('div');
    div.className = 'sys-msg';
    div.innerText = `> ${text}`;
    appendLog(div);
}

function logError(text) {
    const div = document.createElement('div');
    div.className = 'err-msg';
    div.innerText = `ERROR: ${text}`;
    appendLog(div);
}

function appendLog(element) {
    chatHistory.appendChild(element);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

function showManual() {
    logSystem("--- MANUAL ---");
    logSystem("/connect [ID] - Connect to friend");
    logSystem("/togglecamera - Start/Stop ASCII video");
    logSystem("/battleship - Start game");
    logSystem("/ping - Send annoying sound");
    logSystem("/theme - Cycle colors");
}

// --- BATTLESHIP GAME LOGIC (Simplified) ---
function startBattleship() {
    if (!conn) { logError("Must be connected to play."); return; }
    
    logSystem("Initializing BATTLESHIP...");
    gameActive = true;
    
    // Simple 5x5 board for quick play
    gameState = {
        board: Array(5).fill().map(() => Array(5).fill(0)), // 0=water, 1=ship
        shipsPlaced: false,
        myTurn: false
    };

    // Randomly place one ship for demo purposes
    const rx = Math.floor(Math.random() * 5);
    const ry = Math.floor(Math.random() * 5);
    gameState.board[ry][rx] = 1;
    
    logSystem(`SHIP AUTO-PLACED at ${String.fromCharCode(65+ry)}${rx+1} (Hidden)`);
    logSystem("Waiting for peer...");

    conn.send({ type: 'game', payload: { action: 'start' } });
}

function processGameMove(input) {
    // Input format: A1, B3, etc.
    const regex = /^([A-E])([1-5])$/i;
    const match = input.match(regex);
    
    if (!match) {
        logError("Invalid coordinate. Use A1-E5.");
        return;
    }

    if (!gameState.myTurn) {
        logError("Not your turn!");
        return;
    }

    const row = match[1].toUpperCase().charCodeAt(0) - 65;
    const col = parseInt(match[2]) - 1;

    logChat("GAME", `Firing at ${input.toUpperCase()}...`);
    conn.send({ type: 'game', payload: { action: 'fire', row: row, col: col } });
    gameState.myTurn = false;
}

function handleGamePacket(payload) {
    if (payload.action === 'start') {
        gameActive = true;
        // If I received 'start', I reply with 'ready' and I go first?
        // Let's keep it simple: Host goes first.
        logSystem("Peer wants to play Battleship!");
        // Auto setup board
        gameState = {
            board: Array(5).fill().map(() => Array(5).fill(0)),
            shipsPlaced: true,
            myTurn: false // Receiver waits
        };
        const rx = Math.floor(Math.random() * 5);
        const ry = Math.floor(Math.random() * 5);
        gameState.board[ry][rx] = 1;
        
        logSystem(`SHIP AUTO-PLACED at ${String.fromCharCode(65+ry)}${rx+1}`);
        
        conn.send({ type: 'game', payload: { action: 'ready' } });
    }
    
    else if (payload.action === 'ready') {
        logSystem("Game Started! You fire first.");
        gameState.myTurn = true;
    }

    else if (payload.action === 'fire') {
        // Peer fired at me
        const hit = gameState.board[payload.row][payload.col] === 1;
        const result = hit ? "HIT" : "MISS";
        logChat("GAME", `Peer fired at ${String.fromCharCode(65+payload.row)}${payload.col+1}: ${result}`);
        
        if (hit) {
            playPing(); // Sound effect for hit
            logSystem("YOU LOST! Your ship was sunk.");
            gameActive = false;
        } else {
            gameState.myTurn = true;
            logSystem("Your turn.");
        }

        conn.send({ type: 'game', payload: { action: 'result', hit: hit } });
    }

    else if (payload.action === 'result') {
        const result = payload.hit ? "HIT!" : "MISS.";
        logChat("GAME", `Result: ${result}`);
        if (payload.hit) {
            logSystem("YOU WON! Enemy ship sunk.");
            gameActive = false;
        } else {
            logSystem("Waiting for peer...");
        }
    }
}

// Start
initPeer();
