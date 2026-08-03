const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    // Allow connections from the same origin and any host in production
    cors: { origin: '*', methods: ['GET', 'POST'] },
});

// ============================================================
//  Static files
// ============================================================
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
//  In-memory session store
// ============================================================
const sessions = new Map(); // id -> { id, parentCode, childCode, createdAt }

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function genCode(length) {
    let result = '';
    for (let i = 0; i < length; i++) {
        result += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    return result;
}

// ------------------------------------------------------------
//  API: create a new session
// ------------------------------------------------------------
app.post('/api/session', (req, res) => {
    const session = {
        id: genCode(10),
        parentCode: genCode(6),
        childCode: genCode(6),
        createdAt: Date.now(),
    };
    sessions.set(session.id, session);
    res.json(session);
});

// ------------------------------------------------------------
//  API: look up a session by its parent or child code
// ------------------------------------------------------------
app.get('/api/session/lookup', (req, res) => {
    const { code } = req.query;
    if (!code) {
        return res.status(400).json({ error: 'missing code' });
    }
    for (const s of sessions.values()) {
        if (s.parentCode === code) {
            return res.json({ sessionId: s.id, role: 'parent', childCode: s.childCode });
        }
        if (s.childCode === code) {
            return res.json({ sessionId: s.id, role: 'child', parentCode: s.parentCode });
        }
    }
    res.status(404).json({ error: 'session not found' });
});

// ------------------------------------------------------------
//  Cleanup sessions older than 24 hours
// ------------------------------------------------------------
setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions.entries()) {
        if (now - s.createdAt > 24 * 60 * 60 * 1000) {
            sessions.delete(id);
        }
    }
}, 60 * 60 * 1000);

// ============================================================
//  Socket.IO - presence / status events
// ============================================================
io.on('connection', (socket) => {
    socket.on('join', ({ sessionId, role }) => {
        socket.data.sessionId = sessionId;
        socket.data.role = role;
        socket.join(sessionId);
        socket.to(sessionId).emit('peer-status', { role, online: true });
    });

    socket.on('status', (payload) => {
        if (!socket.data.sessionId) return;
        socket.to(socket.data.sessionId).emit('peer-status', {
            role: socket.data.role,
            online: true,
            ...payload,
        });
    });

    // ------------------------------------------------------------
    //  WebRTC signaling relay (handles P2P setup across networks,
    //  works behind Render's proxies - connection is direct between
    //  browsers, this server only forwards the setup messages)
    // ------------------------------------------------------------
    socket.on('signal', (payload) => {
        if (!socket.data.sessionId) return;
        // Forward to everyone else in the session room
        socket.to(socket.data.sessionId).emit('signal', {
            ...payload,
            from: socket.data.role,
        });
    });

    socket.on('disconnect', () => {
        if (socket.data.sessionId) {
            socket.to(socket.data.sessionId).emit('peer-status', {
                role: socket.data.role,
                online: false,
            });
        }
    });
});

// ============================================================
//  Start server
// ============================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('============================================');
    console.log('  Parental Control Server is running');
    console.log(`  Local:      http://localhost:${PORT}`);
    console.log('============================================');
});

