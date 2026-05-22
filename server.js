const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));
app.use(express.static('public'));

const seenGames = new Set();

// A list of general search keywords that modded games/clones constantly use in their titles
const SEARCH_KEYWORDS = ['mm2', 'murder', 'modded', 'free', 'test', 'hangout'];
let keywordIndex = 0;

async function scanNewCreations() {
    // Cycle through keywords to keep the feed fresh and dynamic
    const query = SEARCH_KEYWORDS[keywordIndex];
    keywordIndex = (keywordIndex + 1) % SEARCH_KEYWORDS.length;

    try {
        // We look up the global catalog search using games.roproxy.com search parameters.
        // This endpoint bypasses the personalized landing sorts and fetches actual experience cards matching strings.
        const url = `https://games.roproxy.com/v1/games/list?keyword=${query}&maxRows=20`;
        const response = await axios.get(url);
        
        if (response.data && response.data.data) {
            const currentGames = response.data.data;

            currentGames.forEach(game => {
                if (!seenGames.has(game.placeId)) {
                    seenGames.add(game.placeId);

                    // Cap local memory barrier
                    if (seenGames.size > 500) {
                        const firstKey = seenGames.values().next().value;
                        seenGames.delete(firstKey);
                    }

                    const timestamp = new Date().toLocaleTimeString();
                    const payload = {
                        placeId: game.placeId,
                        name: game.name || "Active Experience",
                        builder: game.creatorName || "Roblox Developer",
                        time: `Pulled at ${timestamp}`
                    };

                    // Broadcast down to the dashboard streaming left-hand panel
                    io.emit('new-game-created', payload);
                }
            });
        }
    } catch (error) {
        console.log(`[SYSTEM] Retrying directory query for keyword "${query}"...`);
    }
}

// Check if any games from our live discovery cache hit a deletion / restricted condition
async function scanActiveListForBans() {
    if (seenGames.size === 0) return;

    // Pull the 15 most recently captured game IDs
    const idsToTest = Array.from(seenGames).slice(-15);
    const idString = idsToTest.join(',');
    
    // Instead of using games/multiget-place-details (which requires auth headers),
    // we use games/v1/games?universeIds to match universe conditions or verify access.
    const url = `https://games.roproxy.com/v1/games?universeIds=${idString}`;

    try {
        const response = await axios.get(url);
        const operationalIds = new Set();
        
        if (response.data && response.data.data) {
            response.data.data.forEach(game => {
                // Keep track of games that successfully return as operational and free of restriction
                if (game.allowedPlayerIds === null || game.price === 0) {
                    operationalIds.add(game.rootPlaceId);
                }
            });
        }

        // If a game was pulled live 30 seconds ago, but completely vanished from the operational arrays,
        // it signals a verified moderation or deletion update!
        idsToTest.forEach(id => {
            if (!operationalIds.has(id)) {
                const timestamp = new Date().toLocaleTimeString();
                
                io.emit('status-update', {
                    placeId: id,
                    name: "Experience Restricted",
                    type: 'deleted',
                    time: `Moderated at ${timestamp}`
                });
                
                // Drop from cache index so it doesn't log duplicate loops
                seenGames.delete(id);
            }
        });

    } catch (error) {
        // Suppress temporary rate-limiting spikes
    }
}

// Intervals built to safely interact with open proxy connections
setInterval(scanNewCreations, 6000);       // Scan keyword directories every 6 seconds
setInterval(scanActiveListForBans, 15000);  // Track active state adjustments every 15 seconds

server.listen(3000, () => {
    console.log('Keyword Extraction Monitor Online.');
});
