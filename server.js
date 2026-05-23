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

const db_known_universes = new Set();
const discovery_queue = [];

// STRICT 2026 BOUNDARY: Modern Roblox creation tokens generated right now are all above 5.7 Billion.
// Hardcoding this instantly drops historical junk entries on the floor.
const STRICT_MINIMUM_UNIVERSE_ID = 5700000000;
let latest_discovered_universe_id = STRICT_MINIMUM_UNIVERSE_ID;

// High-frequency automated proxy fallback engine (Using RoTunnel to avoid RoProxy captcha limits)
const PROXY_DOMAINS = ['games.rotunnel.com', 'games.roproxy.com'];
let currentProxyIndex = 0;

function getProxyHost() {
    return PROXY_DOMAINS[currentProxyIndex];
}
function rotateProxy() {
    currentProxyIndex = (currentProxyIndex + 1) % PROXY_DOMAINS.length;
}

// ==========================================
// ASYNCHRONOUS PACKET PROCESSING WORKER
// ==========================================
async function processValidationQueue() {
    if (discovery_queue.length === 0) return;

    // Pull micro-batches out of the ingestion layer
    const batch = discovery_queue.splice(0, 12);
    const uniqueIds = [...new Set(batch)].filter(id => id > STRICT_MINIMUM_UNIVERSE_ID && !db_known_universes.has(id));

    if (uniqueIds.length === 0) return;

    try {
        const idString = uniqueIds.join(',');
        const url = `https://${getProxyHost()}/v1/games?universeIds=${idString}`;
        
        const response = await axios.get(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            timeout: 4000
        });
        
        if (response.data && response.data.data) {
            response.data.data.forEach(game => {
                if (game.universeId > STRICT_MINIMUM_UNIVERSE_ID && !db_known_universes.has(game.universeId)) {
                    
                    db_known_universes.add(game.universeId);
                    if (game.universeId > latest_discovered_universe_id) {
                        latest_discovered_universe_id = game.universeId;
                    }

                    const timestamp = new Date().toLocaleTimeString();
                    
                    // Push live discovery data straight down the WebSocket pipeline
                    io.emit('new-game-created', {
                        placeId: game.rootPlaceId,
                        name: game.name || "Live Experience Slot",
                        builder: game.creator.name || "Developer",
                        time: `Dropped Live • ${timestamp}`
                    });

                    // Immediate Ban-Wave Detection
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
        // If an endpoint chokes or triggers a challenge captcha, auto-rotate proxy networks instantly
        rotateProxy();
    }
}

// ==========================================
// UNBLOCKABLE PIPELINE: LIVE VOTING TELEMETRY STREAM
// ==========================================
async function runVotingTelemetrySniffer() {
    try {
        // This endpoint reads real-time vote metrics from highly active or freshly volatile experiences.
        // It completely bypasses historical catalog listings and forces real-time activity filters.
        const url = `https://badges.rotunnel.com/v1/badges/universes/voted-up?page=1&limit=50`;
        const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        
        if (response.data && response.data.data) {
            response.data.data.forEach(item => {
                if (item.id && item.id > STRICT_MINIMUM_UNIVERSE_ID) {
                    discovery_queue.push(item.id);
                }
            });
        }
    } catch (e) {
        // Fail silently to stay operational
    }
}

// ==========================================
// HIGH-VELOCITY FRONTIER CLUSTER PROBER
// ==========================================
async function runFrontierProber() {
    // Probes consecutive ranges starting EXACTLY from the highest confirmed 2026 ID found so far.
    const startRange = latest_discovered_universe_id + 1;
    const endRange = startRange + 30;

    for (let targetId = startRange; targetId < endRange; targetId++) {
        discovery_queue.push(targetId);
    }
}

// Independent Execution Loops
setInterval(processValidationQueue, 2000); // Process validation queue every 2 seconds
setInterval(runVotingTelemetrySniffer, 12000); // Fetch voting telemetry spikes every 12 seconds
setInterval(runFrontierProber, 18000); // Probe fresh chronological ID boundaries every 18 seconds

// Run immediately on container boot
setTimeout(() => {
    runVotingTelemetrySniffer();
    runFrontierProber();
}, 1000);

server.listen(3000, () => {
    console.log('--- 2026 ABSOLUTE HARD-LOCKED SCOPE ENGINE ONLINE ---');
});
