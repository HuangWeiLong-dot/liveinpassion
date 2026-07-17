require('dotenv').config();
const express = require('express');
const cors = require('cors');
const https = require('https');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3001;
const ALIST_URL = process.env.ALIST_URL || 'http://localhost:5244';

// Middleware
app.use(cors());
app.use(express.json());

// Alist reverse proxy
app.use('/movies', createProxyMiddleware({
    target: ALIST_URL,
    changeOrigin: true,
    pathRewrite: { '^/movies': '' },
    onProxyRes: function (proxyRes, req, res) {
        proxyRes.headers['X-Proxy-By'] = 'liveinpassion-backend';
    }
}));

// Steam API endpoint
app.get('/api/steam/profile', (req, res) => {
    const apiKey = process.env.STEAM_API_KEY;
    const steamId = process.env.STEAM_ID;
    
    if (!apiKey || !steamId) {
        return res.status(500).json({ error: 'Steam API credentials not configured' });
    }

    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=${steamId}`;

    https.get(url, (response) => {
        let data = '';

        response.on('data', (chunk) => {
            data += chunk;
        });

        response.on('end', () => {
            try {
                const jsonData = JSON.parse(data);
                if (jsonData.response && jsonData.response.players && jsonData.response.players.length > 0) {
                    res.json(jsonData.response.players[0]);
                } else {
                    res.status(404).json({ error: 'No player data found' });
                }
            } catch (error) {
                res.status(500).json({ error: 'Failed to parse Steam API response' });
            }
        });
    }).on('error', (error) => {
        console.error('Error fetching Steam profile:', error);
        res.status(500).json({ error: 'Failed to fetch Steam profile' });
    });
});

// GetOwnedGames endpoint
app.get('/api/steam/games', (req, res) => {
    const apiKey = process.env.STEAM_API_KEY;
    const steamId = process.env.STEAM_ID;
    
    if (!apiKey || !steamId) {
        return res.status(500).json({ error: 'Steam API credentials not configured' });
    }

    const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${apiKey}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1`;

    https.get(url, (response) => {
        let data = '';

        response.on('data', (chunk) => {
            data += chunk;
        });

        response.on('end', () => {
            try {
                const jsonData = JSON.parse(data);
                res.json(jsonData.response);
            } catch (error) {
                res.status(500).json({ error: 'Failed to parse Steam API response' });
            }
        });
    }).on('error', (error) => {
        console.error('Error fetching Steam games:', error);
        res.status(500).json({ error: 'Failed to fetch Steam games' });
    });
});

// GetRecentlyPlayedGames endpoint
app.get('/api/steam/recent', (req, res) => {
    const apiKey = process.env.STEAM_API_KEY;
    const steamId = process.env.STEAM_ID;
    
    if (!apiKey || !steamId) {
        return res.status(500).json({ error: 'Steam API credentials not configured' });
    }

    const url = `https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v0001/?key=${apiKey}&steamid=${steamId}`;

    https.get(url, (response) => {
        let data = '';

        response.on('data', (chunk) => {
            data += chunk;
        });

        response.on('end', () => {
            try {
                const jsonData = JSON.parse(data);
                res.json(jsonData.response);
            } catch (error) {
                res.status(500).json({ error: 'Failed to parse Steam API response' });
            }
        });
    }).on('error', (error) => {
        console.error('Error fetching recent games:', error);
        res.status(500).json({ error: 'Failed to fetch recent games' });
    });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});