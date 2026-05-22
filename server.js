// Replace your old app.use(express.static...) lines with these:
const path = require('path');

// Dynamically serves files out of the root or a public folder safely on Linux servers
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
