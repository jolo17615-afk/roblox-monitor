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

// Cache map to track live game states and catch transitions without duplicates
const activePlatformCache = new Map();

// ==========================================
// REAL DATA PIPELINE: ROLIMONS PLATFORM STREAM
// ==========================================
async function fetchRealPlatformData() {
    try {
        console.log("[INJECTOR] Requesting live platform data from tracking matrix...");
        
        // This endpoint acts as a wide-open global discovery cache of thousands of active platform games,
        // updating their user counts and status variations continuously.
        const response = await axios.get('https://api.rolimons.com/games/v1/gamelist', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            timeout: 6000
        });

        if (response.data && response.data.success && response.data.games) {
            const currentGamesMap = response.data.games; // Key: placeId, Value: [Name, Players, ...]
            const placeIds = Object.keys(currentGamesMap);
            
            // Look at a rotating slice of active platform entities
            placeIds.slice(-40).forEach(id => {
                const gameInfo = currentGamesMap[id];
                const gameName = gameInfo[0] || `Place #${id}`;
                const activeCount = gameInfo[1] || 0;

                const numericId = parseInt(id);

                // State logic: If this is the first time our server sees the game during this lifecycle
                if (!activePlatformCache.has(numericId)) {
                    // Log it to our state storage
                    activePlatformCache.set(numericId, { name: gameName, status: 'active' });

                    const timestamp = new Date().toLocaleTimeString();

                    // Emit to the Left Panel (Live Creations/Discoveries)
                    io.emit('new-game-created', {
                        placeId: numericId,
                        name: gameName,
                        builder: `Active Players: ${activeCount.toLocaleString()}`,
                        time: `Live Stream • ${timestamp}`
                    });
                }
            });

            // Clean up cache matrix if it expands too large for Render's free RAM limits
            if (activePlatformCache.size > 1000) {
                const keysArray = Array.from(activePlatformCache.keys());
                for (let i = 0; i < 200; i++) {
                    activePlatformCache.delete(keysArray[i]);
                }
            }
        }
    } catch (error) {
        console.log(`[PIPELINE ERROR] Stream timed out or proxy network busy: ${error.message}`);
    }
}

// ==========================================
// REAL DATA PIPELINE: ACTIVE DELETION MONITOR
// ==========================================
async function checkCacheForModerationDeltas() {
    if (activePlatformCache.size === 0) return;

    // Pull the 15 most recent active items from our tracking stream to scan for live drops
    const trackedKeys = Array.from(activePlatformCache.keys()).slice(-15);
    
    for (const placeId of trackedKeys) {
        const cachedData = activePlatformCache.get(placeId);
        if (cachedData.status === 'deleted') continue; // Skip if already flagged

        try {
            // We use an unauthenticated raw asset thumbnail endpoint to verify the game's life cycle.
            // If Roblox completely removes or bans a game, this endpoint changes its state token.
            const url = `https://thumbnails.roproxy.com/v1/games/icons?placeIds=${placeId}&returnPolicy=PlaceHolder&size=50x50&format=Png&isCircular=false`;
            const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 4000 });
            
            if (res.data && res.data.data && res.data.data[0]) {
                const statusMeta = res.data.data[0];
                
                // "Blocked" or "Error" codes confirm that the place asset has been taken down by Roblox moderation
                if (statusMeta.state === "Blocked" || statusMeta.state === "Error") {
                    const timestamp = new Date().toLocaleTimeString();
                    
                    // Update internal status state so we don't duplicate logs
                    cachedData.status = 'deleted';
                    activePlatformCache.set(placeId, cachedData);

                    // Emit to the Right Panel (Live Deletions)
                    io.emit('status-update', {
                        placeId: placeId,
                        name: cachedData.name,
                        type: 'deleted',
                        time: `Detected Wave • ${timestamp}`
                    });
                }
            }
        } catch (err) {
            // Drop execution gracefully during temporary network rate limit spikes
        }
        
        // Minor 1-second delay between validation packets to avoid throttling
        await new Promise(r => setTimeout(r, 1000));
    }
}

// Set up clean execution intervals targeting real platform data structures
setInterval(fetchRealPlatformData, 10000);       // Fetch active streams every 10 seconds
setInterval(checkCacheForModerationDeltas, 20000); // Verify moderation state changes every 20 seconds

// Boot routine
setTimeout(() => {
    fetchRealPlatformData();
}, 2000);

server.listen(3000, () => {
    console.log('--- REWRITTEN REAL-TIME PRODUCTION STREAM ENGINE ONLINE ---');
});
