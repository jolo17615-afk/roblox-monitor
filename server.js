const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname)));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'), (err) => {
        if (err) res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
});

// ==========================================
// CENTRAL STATE STORAGE (Database & Deduplication)
// ==========================================
const db_known_universes = new Set();
const discovery_queue = [];
let latest_discovered_universe_id = 1400000000; 

// A list of high-profile/frequent modded and clone deployment Group IDs to track (Pipeline A)
const TARGET_GROUPS = [32451225, 12007609, 5459955, 16402302, 33119041];
const TARGET_KEYWORDS = ['mm2', 'murder', 'modded', 'knife', 'trade'];
let keywordIndex = 0;

// User-Agent Pool for Rotation (Rate Limit Handling)
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
];
function getRotatedHeader() {
    return {
        'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
        'Accept': 'application/json'
    };
}

// ==========================================
// CENTRAL PIPELINE PROCESSING WORKER (Validation)
// ==========================================
async function processValidationQueue() {
    if (discovery_queue.length === 0) return;

    // Process tasks in micro-batches to respect proxy limits
    const batch = discovery_queue.splice(0, 15);
    const uniqueIds = [...new Set(batch)].filter(id => !db_known_universes.has(id));

    if (uniqueIds.length === 0) return;

    try {
        const idString = uniqueIds.join(',');
        const url = `https://games.roproxy.com/v1/games?universeIds=${idString}`;
        
        const response = await axios.get(url, { headers: getRotatedHeader() });
        
        if (response.data && response.data.data) {
            response.data.data.forEach(game => {
                if (!db_known_universes.has(game.universeId)) {
                    
                    // Commit to local DB state
                    db_known_universes.add(game.universeId);
                    if (game.universeId > latest_discovered_universe_id) {
                        latest_discovered_universe_id = game.universeId;
                    }

                    const timestamp = new Date().toLocaleTimeString();
                    
                    // WebSocket Event Delivery
                    io.emit('new-game-created', {
                        placeId: game.rootPlaceId,
                        name: game.name || "Discovered Experience",
                        builder: game.creator.name || "Developer",
                        time: `Discovered [Pipeline Delta] • ${timestamp}`
                    });

                    // Live Check if it gets instantly auto-moderated
                    if (game.reasonProhibited && game.reasonProhibited !== "None") {
                        io.emit('status-update', {
                            placeId: game.rootPlaceId,
                            name: game.name,
                            type: 'deleted',
                            time: `Banned instantly • ${timestamp}`
                        });
                    }
                }
            });
        }
    } catch (err) {
        // Backoff simulation: if rate-limited, push back into queue tail
        console.log("[WORKER] Rate gateway hit. Re-queuing IDs for backoff execution.");
        uniqueIds.forEach(id => discovery_queue.push(id));
    }
}

// ==========================================
// PIPELINE A — Creator / Group Tracking Worker
// ==========================================
async function runPipelineA() {
    console.log("[PIPELINE A] Inspecting group networks...");
    for (const groupId of TARGET_GROUPS) {
        try {
            const url = `https://games.roproxy.com/v2/groups/${groupId}/games?accessFilter=All&sortOrder=Desc&limit=15`;
            const response = await axios.get(url, { headers: getRotatedHeader() });
            
            if (response.data && response.data.data) {
                response.data.data.forEach(game => {
                    if (!db_known_universes.has(game.universeId)) {
                        discovery_queue.push(game.universeId);
                    }
                });
            }
        } catch (e) {}
        await new Promise(r => setTimeout(r, 1000)); // Internal throttling pause
    }
}

// ==========================================
// PIPELINE B — Discovery Feed Diffing Worker
// ==========================================
async function runPipelineB() {
    const keyword = TARGET_KEYWORDS[keywordIndex];
    keywordIndex = (keywordIndex + 1) % TARGET_KEYWORDS.length;
    console.log(`[PIPELINE B] Calculating feed diffs for keyword: ${keyword}`);

    try {
        const url = `https://games.roproxy.com/v1/games/list?keyword=${keyword}&maxRows=25`;
        const response = await axios.get(url, { headers: getRotatedHeader() });

        if (response.data && response.data.data) {
            response.data.data.forEach(game => {
                // If your multiget returns placeIds, map them directly into checking pipelines
                if (game.universeId && !db_known_universes.has(game.universeId)) {
                    discovery_queue.push(game.universeId);
                }
            });
        }
    } catch (e) {}
}

// ==========================================
// PIPELINE C — Universe ID Probing Worker
// ==========================================
async function runPipelineC() {
    console.log(`[PIPELINE C] Probing numeric clusters near: ${latest_discovered_universe_id}`);
    
    // Generate an asynchronous offset scan block right ahead of our highest verified boundary
    const startRange = latest_discovered_universe_id + 1;
    const endRange = startRange + 40;

    for (let targetId = startRange; targetId < endRange; targetId++) {
        if (!db_known_universes.has(targetId)) {
            discovery_queue.push(targetId);
        }
    }
}

// ==========================================
// CRON SCHEDULER MATRIX
// ==========================================
// Central Validation Worker processes the queue at hyper-speed intervals
setInterval(processValidationQueue, 2500);

// Independent ingestion loops to keep queues full of delta indicators
setInterval(runPipelineA, 45000); // Poll targets every 45 seconds
setInterval(runPipelineB, 20000); // Diff search terms every 20 seconds
setInterval(runPipelineC, 30000); // Probe ranges every 30 seconds

// Boot setup
setTimeout(() => {
    runPipelineA();
    runPipelineB();
}, 2000);

server.listen(3000, () => {
    console.log('--- ENTERPRISE DISCOVERY CORE RUNNING ---');
});
