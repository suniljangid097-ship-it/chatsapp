const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let registeredIDs = {}; // 6-digit ID -> Name
let activeConnections = {}; // 6-digit ID -> Socket ID
let socketToId = {}; // Socket ID -> 6-digit ID

io.on('connection', (socket) => {
    
    // Register VIP ID
    socket.on('register_user', (data, callback) => {
        const { id, name } = data;
        if (registeredIDs[id] && registeredIDs[id] !== name) {
            callback({ success: false, message: "❌ This Premium ID is already taken!" });
        } else {
            registeredIDs[id] = name;
            activeConnections[id] = socket.id;
            socketToId[socket.id] = id;
            callback({ success: true, message: "VIP ID Registered!" });
        }
    });

    // Search Friend via 6-digit ID
    socket.on('find_user', (targetId, callback) => {
        if (activeConnections[targetId] && targetId !== socketToId[socket.id]) {
            callback({ success: true, name: registeredIDs[targetId], id: targetId });
        } else if (targetId === socketToId[socket.id]) {
            callback({ success: false, message: "You cannot chat with yourself." });
        } else {
            callback({ success: false, message: "User is offline or ID is wrong." });
        }
    });

    // Universal message routing system
    const routeData = (eventName, data) => {
        data.from_id = socketToId[socket.id]; // Sender's ID attached
        data.name = registeredIDs[data.from_id]; // Sender's Name attached

        if (data.to && data.to !== 'Public') {
            const targetSocket = activeConnections[data.to];
            if (targetSocket) {
                io.to(targetSocket).emit(eventName, data); // Send to receiver
            }
            socket.emit(eventName, data); // Send back to self
        } else {
            io.emit(eventName, data); // Broadcast to Public
        }
    };

    socket.on('chat message', data => routeData('chat message', data));
    socket.on('voice message', data => routeData('voice message', data));
    socket.on('image message', data => routeData('image message', data));
    
    socket.on('typing', data => routeData('typing', data));
    socket.on('stop_typing', data => routeData('stop_typing', data));
    
    socket.on('reaction', data => io.emit('reaction', data)); // Simplified for now

    // WebRTC Calls with Privacy Routing
    socket.on('offer', data => routeData('offer', data));
    socket.on('answer', data => routeData('answer', data));
    socket.on('candidate', data => routeData('candidate', data));
    socket.on('call_rejected', data => routeData('call_rejected', data));

    socket.on('disconnect', () => {
        const id = socketToId[socket.id];
        if (id) {
            delete activeConnections[id];
            delete socketToId[socket.id];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Chatsapp Premium running on port ${PORT}`));
