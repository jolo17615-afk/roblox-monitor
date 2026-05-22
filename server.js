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

const trackedGames = new Set();

async function streamLiveGames() {
    try {
        console.log("Fetching live platform data stream...");
        
        // Rolimons provides a wide-open API containing a directory of actively tracked platform experiences
        const response = await axios.get('https://api.rolimons.com/games/v1/gamelist', {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        if (response.data && response.data.success && response.data.games) {
            const gamesData = response.data.games;
            const placeIds = Object.keys(gamesData);
            
            // Grab the last 15 active games shifting player weights
            const currentBatch = placeIds.slice(-15);

            currentBatch.forEach(id => {
                const gameDetails = gamesData[id]; // Format: [Name, ActivePlayers, IconURL...]
                const gameName = gameDetails[0] || "Active Experience";
                const activePlayers = gameDetails[1] || 0;

                if (!trackedGames.has(id)) {
                    trackedGames.add(id);

                    // Prevent local server cache flooding
                    if (trackedGames.size > 200) {
                        const firstKey = trackedGames.values().next().value;
                        trackedGames.delete(firstKey);
                    }

                    const timestamp = new Date().toLocaleTimeString();
                    
                    // Fire a guaranteed event over to your left "Live Creations" column
                    io.emit('new-game-created', {
                        placeId: id,
                        name: gameName,
                        builder: `Active Players: ${activePlayers.toLocaleString()}`,
                        time: `Streaming live (${timestamp})`
                    });
                }
            });
        }
    } catch (error) {
        console.error("Data stream connection error:", error.message);
    }
}

// Check the network cache stream for sudden moderation dropouts or bans
async function checkLiveDeletions() {
    if (trackedGames.size === 0) return;

    // Test a cross-slice of currently active IDs
    const testList = Array.from(trackedGames).slice(-10);
    
    for (const id of testList) {
        try {
            // Using a raw thumbnail proxy check—if a game is banned, its asset endpoints explicitly fail
            const checkUrl = `https://thumbnails.roproxy.com/v1/games/icons?placeIds=${id}&returnPolicy=PlaceHolder&size=50x50&format=Png&isCircular=false`;
            const res = await axios.get(checkUrl);
            
            if (res.data && res.data.data && res.data.data[0]) {
                const item = res.data.data[0];
                // If Roblox moderation replaces the thumbnail icon with an error state, it's banned
                if (item.state === "Blocked" || item.state === "Error") {
                    const timestamp = new Date().toLocaleTimeString();
                    io.emit('status-update', {
                        placeId: id,
                        name: "Experience Banned / Deleted",
                        type: 'deleted',
                        time: `Detected at ${timestamp}`
                    });
                    trackedGames.delete(id);
                }
            }
        } catch (err) {}
    }
}

// Optimized timing limits to stay clean under proxy firewalls
setInterval(streamLiveGames, 7000);   // Pull the active matrix every 7 seconds
setInterval(checkLiveDeletions, 15000); // Check for flags every 15 seconds

server.listen(3000, () => {
    console.log('Rolimons Sync Matrix Engine Active.');
});
