const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));
app.use(express.static('public'));

// Global Tracking pointers
let highestPlaceId = 14000000000; // Track the absolute newest game ID
let banScanPointer = highestPlaceId;

// 1. Anchor the scanner to the current frontier of Roblox creations
async function initializeHighestId() {
    try {
        const response = await axios.get('https://games.roproxy.com/v1/games/list?sortFilter=1&timeFilter=0&genreFilter=1');
        if (response.data && response.data.data && response.data.data.length > 0) {
            const ids = response.data.data.map(game => game.placeId);
            highestPlaceId = Math.max(...ids);
            banScanPointer = highestPlaceId - 100;
            console.log(`[SYSTEM] Scanner initialized at current highest ID: ${highestPlaceId}`);
        }
    } catch (err) {
        console.log("[SYSTEM] Using baseline ID pointer.");
    }
}

// 2. LIVE CREATION TRACKER (Scans forward for new IDs)
async function scanNewCreations() {
    // Look at the next 15 numeric IDs ahead of our highest known ID
    const lookAheadCount = 15;
    const idsToTest = [];
    for (let i = 1; i <= lookAheadCount; i++) {
        idsToTest.push(highestPlaceId + i);
    }

    const idString = idsToTest.join(',');
    const url = `https://games.roproxy.com/v1/games/multiget-place-details?placeIds=${idString}`;

    try {
        const response = await axios.get(url);
        const foundGames = response.data;

        if (foundGames && foundGames.length > 0) {
            // Sort them so they register in perfect sequential order
            foundGames.sort((a, b) => a.placeId - b.placeId);

            foundGames.forEach(game => {
                if (game.placeId > highestPlaceId) {
                    highestPlaceId = game.placeId; // Push the frontier forward
                    
                    const timestamp = new Date().toLocaleTimeString();
                    const payload = {
                        placeId: game.placeId,
                        name: game.name || "New Experience",
                        builder: game.creatorName || "Robloxian",
                        time: `Just now (${timestamp})`
                    };

                    // Send to the live creation feed
                    io.emit('new-game-created', payload);
                }
            });
        }
    } catch (error) {
        // Fail silently during proxy rate limits
    }
}

// 3. LIVE DELETION MONITOR (Scans backward for bans)
async function scanGlobalDeletions() {
    const idsToScan = [];
    for (let i = 0; i < 30; i++) {
        idsToScan.push(banScanPointer - i);
    }
    
    banScanPointer -= 30;
    if (banScanPointer < (highestPlaceId - 3000)) {
        banScanPointer = highestPlaceId; // Loop back up to stay near recent games
    }

    const idString = idsToScan.join(',');
    const url = `https://games.roproxy.com/v1/games/multiget-place-details?placeIds=${idString}`;

    try {
        const response = await axios.get(url);
        const activeMap = {};
        response.data.forEach(game => { activeMap[game.placeId] = game; });

        idsToScan.forEach(id => {
            const gameData = activeMap[id];
            if (gameData && gameData.reasonProhibited && gameData.reasonProhibited !== "None") {
                const timestamp = new Date().toLocaleTimeString();
                io.emit('status-update', {
                    placeId: id,
                    name: gameData.name || "Modded Experience",
                    type: 'deleted',
                    time: `Today at ${timestamp}`
                });
            }
        });
    } catch (error) {}
}

// Boot routines
initializeHighestId().then(() => {
    // Scan for new games every 2 seconds for true live feed speed
    setInterval(scanNewCreations, 2000);
    // Scan for deletions every 6 seconds
    setInterval(scanGlobalDeletions, 6000);
});

server.listen(3000, () => {
    console.log('Dual Tracking Engines Online.');
});
