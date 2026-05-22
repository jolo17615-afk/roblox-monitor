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

// Poll newly created assets (like badges) to instantly find their parents (games)
async function scanNewCreations() {
    try {
        // We scrape recent badges globally across Roblox.
        // This endpoint remains open and chronological since badges are catalog items.
        const badgeCatalogUrl = 'https://badges.roproxy.com/v1/badges/universes/voted-up?page=1&limit=25';
        const response = await axios.get(badgeCatalogUrl);
        
        if (response.data && response.data.data) {
            const recentBadges = response.data.data;

            // Extract the unique universe IDs attached to these brand new assets
            const universeIds = [...new Set(recentBadges.map(item => item.id).filter(Boolean))];

            if (universeIds.length === 0) return;

            // Translate those Universe IDs into readable Place Details
            const universeString = universeIds.slice(0, 15).join(',');
            const gamesUrl = `https://games.roproxy.com/v1/games?universeIds=${universeString}`;
            const gamesResponse = await axios.get(gamesUrl);

            if (gamesResponse.data && gamesResponse.data.data) {
                gamesResponse.data.data.forEach(game => {
                    if (!seenGames.has(game.rootPlaceId)) {
                        seenGames.add(game.rootPlaceId);

                        // Keep local cache memory clean
                        if (seenGames.size > 500) {
                            const firstKey = seenGames.values().next().value;
                            seenGames.delete(firstKey);
                        }

                        const timestamp = new Date().toLocaleTimeString();
                        const payload = {
                            placeId: game.rootPlaceId,
                            name: game.name || "Active Room",
                            builder: game.creator.name || "Robloxian",
                            time: `Discovered at ${timestamp}`
                        };

                        // Push immediately to the live creation dashboard window
                        io.emit('new-game-created', payload);
                    }
                });
            }
        }
    } catch (error) {
        console.log("[SYSTEM] Re-centering tracker filters...");
    }
}

// Check if any of our newly cached games suddenly drop offline / get moderated
async function scanActiveListForBans() {
    if (seenGames.size === 0) return;

    const idsToTest = Array.from(seenGames).slice(-20);
    const idString = idsToTest.join(',');
    const url = `https://games.roproxy.com/v1/games/multiget-place-details?placeIds=${idString}`;

    try {
        const response = await axios.get(url);
        const activeMap = {};
        response.data.forEach(game => { activeMap[game.placeId] = game; });

        idsToTest.forEach(id => {
            const gameData = activeMap[id];
            
            // Catching instances where the place instantly sets flags or vanishes
            if (gameData && gameData.reasonProhibited && gameData.reasonProhibited !== "None") {
                const timestamp = new Date().toLocaleTimeString();
                io.emit('status-update', {
                    placeId: id,
                    name: gameData.name || "Banned Experience",
                    type: 'deleted',
                    time: `Flagged at ${timestamp}`
                });
                seenGames.delete(id);
            }
        });
    } catch (error) {}
}

// Set up stable intervals to avoid hitting proxy rate gates
setInterval(scanNewCreations, 5000);       // Fetch fresh configurations every 5 seconds
setInterval(scanActiveListForBans, 12000);  // Screen moderation adjustments every 12 seconds

server.listen(3000, () => {
    console.log('Catalog Asset Link Discovery Engine Online.');
});
