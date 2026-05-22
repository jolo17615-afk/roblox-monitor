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
// TELEMETRY STATE & DE-DUPLICATION
// ==========================================
const db_known_universes = new Set();
const discovery_queue = [];

// Initialize baseline boundary high enough to ignore legacy IDs
let latest_discovered_universe_id = 6000000000; 

// Track recent deployments from active modding networks (Pipeline A targets)
const TARGET_GROUPS = [32451225, 12007609, 33119041, 16402302];

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15'
];

function getRotatedHeader() {
    return { 'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)] };
}

// ==========================================
// VALIDATION & FILTERING WORKER
// ==========================================
async function processValidationQueue() {
    if (discovery_queue.length === 0) return;

    const batch = discovery_queue.splice(0, 20);
    const uniqueIds = [...new Set(batch)].filter(id => !db_known_universes.has(id));

    if (uniqueIds.length === 0) return;

    try {
        const idString = uniqueIds.join(',');
        // This endpoint verifies multi-instance operational details
        const url = `https://games.roproxy.com/v1/games?universeIds=${idString}`;
        const response = await axios.get(url, { headers: getRotatedHeader() });
        
        if (response.data && response.data.data) {
            response.data.data.forEach(game => {
                
                // CRUCIAL FILTER: Ignore older legacy IDs entirely.
                // Modern Roblox Universe IDs created recently are well above 5,000,000,000.
                if (game.universeId > 5000000000 && !db_known_universes.has(game.universeId)) {
                    
                    db_known_universes.add(game.universeId);
                    if (game.universeId > latest_discovered_universe_id) {
                        latest_discovered_universe_id = game.universeId;
                    }

                    const timestamp = new Date().toLocaleTimeString();
                    
                    // Emit to Live Stream
                    io.emit('new-game-created', {
                        placeId: game.rootPlaceId,
                        name: game.name || "Live Asset",
                        builder: game.creator.name || "Roblox Dev",
                        time: `Fresh Drop • ${timestamp}`
                    });

                    // Active Ban Check
                    if (game.reasonProhibited && game.reasonProhibited !== "None") {
                        io.emit('status-update', {
                            placeId: game.rootPlaceId,
                            name: game.name,
                            type: 'deleted',
                            time: `Banned Live • ${timestamp}`
                        });
                    }
                }
            });
        }
    } catch (err) {
        // Silent backoff on rate limit gates
    }
}

// ==========================================
// PIPELINE A — Active Group Monitor (Recent Sort)
// ==========================================
async function runPipelineA() {
    for (const groupId of TARGET_GROUPS) {
        try {
            // Explicitly requesting games ordered Descending (Newest creations first)
            const url = `https://games.roproxy.com/v2/groups/${groupId}/games?accessFilter=All&sortOrder=Desc&limit=10`;
            const response = await axios.get(url, { headers: getRotatedHeader() });
            
            if (response.data && response.data.data) {
                response.data.data.forEach(game => {
                    if (game.universeId > 5000000000) {
                        discovery_queue.push(game.universeId);
                    }
                });
            }
        } catch (e) {}
        await new Promise(r => setTimeout(r, 1000));
    }
}

// ==========================================
// PIPELINE B — Time-Filtered Discovery Diffing
// ==========================================
async function runPipelineB() {
    try {
        // We drop the broken keyword searches and target Roblox's Live Activity sort directly.
        // sortFilter=1 maps to "Popular", but combined with game parameters it shifts to moving trend metrics.
        const url = 'https://games.roproxy.com/v1/games/list?sortFilter=1&maxRows=40';
        const response = await axios.get(url, { headers: getRotatedHeader() });

        if (response.data && response.data.data) {
            response.data.data.forEach(game => {
                if (game.universeId && game.universeId > 5000000000) {
                    discovery_queue.push(game.universeId);
                }
            });
        }
    } catch (e) {}
}

// ==========================================
// PIPELINE C — High-Velocity Cluster Probing
// ==========================================
async function runPipelineC() {
    // Because we locked our ID baseline to 2026 ranges, probing forward guarantees 
    // we hit brand new server slots that were initialized today.
    const startRange = latest_discovered_universe_id + 1;
    const endRange = startRange + 30;

    for (let targetId = startRange; targetId < endRange; targetId++) {
        discovery_queue.push(targetId);
    }
}

// ==========================================
// WORKER MATRIX COORDINATOR
// ==========================================
setInterval(processValidationQueue, 2000); // Process validation every 2 seconds

setInterval(runPipelineB, 15000); // Diff the live activity indexes every 15 seconds
setInterval(runPipelineC, 25000); // Cluster probe forward every 25 seconds
setInterval(runPipelineA, 60000); // Audit group infrastructure loops every 60 seconds

// Boot Routines
setTimeout(() => {
    runPipelineB();
}, 2000);

server.listen(3000, () => {
    console.log('2026 Chronological Filtering Engine Live.');
});
