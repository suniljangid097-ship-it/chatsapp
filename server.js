const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Public folder ko static banane ke liye taaki HTML/CSS load ho sake
app.use(express.static(path.join(__dirname, 'public')));

// Jab koi user chat par connect ho
io.on('connection', (socket) => {
    console.log('A user connected');

    socket.on('chat message', (msg) => {
        io.emit('chat message', msg);
    });

    socket.on('disconnect', () => {
        console.log('A user disconnected');
    });
});

const PORT = process.env.PORT || 3000;
server.PORT || server.listen(PORT, () => {
    console.log(`Chatsapp server running on port ${PORT}`);
});
