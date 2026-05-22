const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const path = require('path'); // Added for reliable file paths

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Dynamically serves files out of the root or a public folder safely on Render
app.use(express.static(path.join(__dirname)));
app.use(express.static(path.join(__dirname, 'public')));

// Fallback rule: If a browser hits the main site, explicitly stream the HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'), (err) => {
        if (err) {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        }
    });
});

const seenGames = new Set();
const SEARCH_KEYWORDS = ['mm2', 'murder', 'modded', 'free', 'test', 'hangout'];
let keywordIndex = 0;

async function scanNewCreations() {
    const query = SEARCH_KEYWORDS[keywordIndex];
    keywordIndex = (keywordIndex + 1) % SEARCH_KEYWORDS.length;

    try {
        const url = `https://games.roproxy.com/v1/games/list?keyword=${query}&maxRows=20`;
        const response = await axios.get(url);
        
        if (response.data && response.data.data) {
            const currentGames = response.data.data;

            currentGames.forEach(game => {
                if (!seenGames.has(game.placeId)) {
                    seenGames.add(game.placeId);

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

                    io.emit('new-game-created', payload);
                }
            });
        }
    } catch (error) {
        console.log(`[SYSTEM] Retrying directory query for keyword "${query}"...`);
    }
}

async function scanActiveListForBans() {
    if (seenGames.size === 0) return;

    const idsToTest = Array.from(seenGames).slice(-15);
    const idString = idsToTest.join(',');
    const url = `https://games.roproxy.com/v1/games?universeIds=${idString}`;

    try {
        const response = await axios.get(url);
        const operationalIds = new Set();
        
        if (response.data && response.data.data) {
            response.data.data.forEach(game => {
                if (game.allowedPlayerIds === null || game.price === 0) {
                    operationalIds.add(game.rootPlaceId);
                }
            });
        }

        idsToTest.forEach(id => {
            if (!operationalIds.has(id)) {
                const timestamp = new Date().toLocaleTimeString();
                
                io.emit('status-update', {
                    placeId: id,
                    name: "Experience Restricted",
                    type: 'deleted',
                    time: `Moderated at ${timestamp}`
                });
                
                seenGames.delete(id);
            }
        });

    } catch (error) {}
}

setInterval(scanNewCreations, 6000);       
setInterval(scanActiveListForBans, 15000);  

server.listen(3000, () => {
    console.log('Keyword Extraction Monitor Online.');
});
