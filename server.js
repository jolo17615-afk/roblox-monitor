const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));
app.use(express.static('public'));

// Keeps track of games we've already displayed so we don't duplicate them
const seenGames = new Set();

// Fetch newly populated games from Roblox's real-time sorting filters
async function scanNewCreations() {
    try {
        // This endpoint returns an active feed of experiences currently updating/running on the platform
        // sortFilter=1 (Popular/Recently Updated) or custom token scraping
        const url = 'https://games.roproxy.com/v1/games/list?sortFilter=1&timeFilter=0&genreFilter=1&maxRows=25';
        const response = await axios.get(url);
        
        if (response.data && response.data.data) {
            const currentGames = response.data.data;

            currentGames.forEach(game => {
                // If it's a completely new ID our tracker hasn't caught yet
                if (!seenGames.has(game.placeId)) {
                    seenGames.add(game.placeId);

                    // Prevent memory leak by keeping cache limited to last 1000 items
                    if (seenGames.size > 1000) {
                        const firstKey = seenGames.values().next().value;
                        seenGames.delete(firstKey);
                    }

                    const timestamp = new Date().toLocaleTimeString();
                    const payload = {
                        placeId: game.placeId,
                        name: game.name || "Active Experience",
                        builder: game.creatorName || "Robloxian",
                        time: `Discovered at ${timestamp}`
                    };

                    // Broadcast directly to your left column
                    io.emit('new-game-created', payload);
                }
            });
        }
    } catch (error) {
        console.log("[SYSTEM] Discovery loop waiting on rate limits...");
    }
}

// Fallback logic for Deletions: Instead of guessing sequential numbers backwards,
// we scan the *already discovered active games list* to see if any of them suddenly break/get banned!
async function scanActiveListForBans() {
    if (seenGames.size === 0) return;

    const idsToTest = Array.from(seenGames).slice(-30); // Grab the 30 most recently seen games
    const idString = idsToTest.join(',');
    const url = `https://games.roproxy.com/v1/games/multiget-place-details?placeIds=${idString}`;

    try {
        const response = await axios.get(url);
        const activeMap = {};
        response.data.forEach(game => { activeMap[game.placeId] = game; });

        idsToTest.forEach(id => {
            const gameData = activeMap[id];
            // If it was working a minute ago, but now returns an absolute reasonProhibited statement, it's a confirmed live ban!
            if (gameData && gameData.reasonProhibited && gameData.reasonProhibited !== "None") {
                const timestamp = new Date().toLocaleTimeString();
                io.emit('status-update', {
                    placeId: id,
                    name: gameData.name || "Banned Experience",
                    type: 'deleted',
                    time: `Banned at ${timestamp}`
                });
                // Remove from active tracking so it doesn't loop spam
                seenGames.delete(id);
            }
        });
    } catch (error) {}
}

// Polling intervals optimized for platform API limits
setInterval(scanNewCreations, 4000);       // Look for active platform games every 4 seconds
setInterval(scanActiveListForBans, 10000);  // Cross-reference moderation status every 10 seconds

server.listen(3000, () => {
    console.log('Roblox Platform Scraper Engine Online (Non-Sequential Framework).');
});
