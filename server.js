const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('chat message', (data) => io.emit('chat message', data));
    socket.on('voice message', (data) => io.emit('voice message', data));
    socket.on('image message', (data) => io.emit('image message', data));

    // WebRTC Calling Signaling
    socket.on('offer', (data) => socket.broadcast.emit('offer', data));
    socket.on('answer', (data) => socket.broadcast.emit('answer', data));
    socket.on('candidate', (data) => socket.broadcast.emit('candidate', data));
    
    // Call Reject and End Call Signals
    socket.on('call_rejected', () => socket.broadcast.emit('call_rejected'));
    socket.on('end_call', () => socket.broadcast.emit('end_call')); // Naya End Call Feature

    socket.on('disconnect', () => {
        console.log('A user disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Chatsapp server running on port ${PORT}`);
});
