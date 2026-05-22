const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// This tells the server to look in the main folder OR a public folder
app.use(express.static(__dirname));
app.use(express.static('public'));

// The list of Place IDs you want to actively monitor
const TARGET_PLACES = [1095759499738, 16302801369, 185655149]; 

let cache = {};
TARGET_PLACES.forEach(id => {
    cache[id] = { status: 'unknown', name: `Game #${id}` };
});

async function checkGameStatuses() {
    console.log("Checking Roblox API via open asset proxy...");

    for (const id of TARGET_PLACES) {
        // Using the item-details asset endpoint which is generally wide open publicly
        const url = `https://economy.roproxy.com/v2/assets/${id}/details`;

        try {
            const response = await axios.get(url);
            const gameData = response.data;
            
            let currentStatus = 'active';
            let gameName = gameData.Name || `Game #${id}`;

            // If a game gets reviewed or banned, Roblox changes the IsForSale/Creator status 
            // or the asset is flagged. We check if it returns valid data or an asset error.
            if (!gameData || gameData.IsPublicDomain === undefined && !gameData.Name) {
                currentStatus = 'deleted';
            }

            const previousStatus = cache[id].status;
            if (previousStatus !== 'unknown' && previousStatus !== currentStatus) {
                const timestamp = new Date().toLocaleTimeString();
                
                const logPayload = {
                    placeId: id,
                    name: gameName,
                    type: currentStatus === 'active' ? 'restored' : 'deleted',
                    time: `Today at ${timestamp}`
                };

                io.emit('status-update', logPayload);
                console.log(`[ALERT] ${gameName} (${id}) shifted to ${currentStatus.toUpperCase()}`);
            }

            cache[id] = { status: currentStatus, name: gameName };

        } catch (error) {
            // If the asset throws a 404 or 403, it means it's content deleted / banned!
            if (error.response && (error.response.status === 404 || error.response.status === 403)) {
                let gameName = cache[id]?.name || `Game #${id}`;
                let currentStatus = 'deleted';

                const previousStatus = cache[id].status;
                if (previousStatus !== 'unknown' && previousStatus !== currentStatus) {
                    const timestamp = new Date().toLocaleTimeString();
                    const logPayload = {
                        placeId: id,
                        name: gameName,
                        type: 'deleted',
                        time: `Today at ${timestamp}`
                    };
                    io.emit('status-update', logPayload);
                    console.log(`[ALERT] ${gameName} (${id}) is DELETED (API returned ${error.response.status})`);
                }
                cache[id] = { status: currentStatus, name: gameName };
            } else {
                console.error(`Error querying ID ${id}:`, error.message);
            }
        }
        
        // Brief 1-second pause between requests so we don't spam the proxy rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

// Check every 30 seconds to keep the free proxy happy
setInterval(checkGameStatuses, 30000);
setTimeout(checkGameStatuses, 2000);

server.listen(3000, () => {
    console.log('Server live and monitoring.');
});
