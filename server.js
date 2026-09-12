const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let registeredIDs = {};
let activeConnections = {};
let socketToId = {};
let offlineMessageQueue = {}; // Stores all missed messages per ID

io.on('connection', (socket) => {
    socket.on('register_user', (data, callback) => {
        if (!data || !data.id || !data.name) return callback({ success: false, message: "Invalid data" });
        const { id, name } = data;
        if (registeredIDs[id] && registeredIDs[id] !== name) {
            return callback({ success: false, message: "❌ This Premium ID is already taken!" });
        }
        
        registeredIDs[id] = name;
        activeConnections[id] = socket.id;
        socketToId[socket.id] = id;
        
        callback({ success: true, message: "VIP ID Registered!" });

        // Deliver ALL pending offline messages one by one
        if (offlineMessageQueue[id] && offlineMessageQueue[id].length > 0) {
            setTimeout(() => {
                offlineMessageQueue[id].forEach(item => {
                    socket.emit(item.type, item.data);
                });
                offlineMessageQueue[id] = []; // Clear queue after sending all
            }, 800);
        }
    });

    socket.on('find_user', (targetId, callback) => {
        if (registeredIDs[targetId] && targetId !== socketToId[socket.id]) {
            callback({ success: true, name: registeredIDs[targetId], id: targetId });
        } else if (targetId === socketToId[socket.id]) {
            callback({ success: false, message: "You cannot chat with yourself." });
        } else {
            callback({ success: false, message: "User is offline or ID is wrong." });
        }
    });

    const routeData = (eventName, data) => {
        const senderId = socketToId[socket.id];
        if (!senderId) return;

        data.from_id = senderId;
        data.name = registeredIDs[senderId];
        // World Clock / Accurate Local Time
        data.time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });

        if (data.to && data.to !== 'Public') {
            const targetSocketId = activeConnections[data.to];
            if (targetSocketId) {
                io.to(targetSocketId).emit(eventName, data);
            } else {
                // Push ALL messages into queue if recipient is offline
                if (!offlineMessageQueue[data.to]) offlineMessageQueue[data.to] = [];
                offlineMessageQueue[data.to].push({ type: eventName, data: data });
            }
            socket.emit(eventName, data);
        } else {
            io.emit(eventName, data);
        }
    };

    socket.on('chat message', data => routeData('chat message', data));
    socket.on('voice message', data => routeData('voice message', data));
    socket.on('image message', data => routeData('image message', data));
    
    socket.on('typing', data => { if(data.to && activeConnections[data.to]) io.to(activeConnections[data.to]).emit('typing', data); });
    socket.on('stop_typing', data => { if(data.to && activeConnections[data.to]) io.to(activeConnections[data.to]).emit('stop_typing', data); });
    socket.on('reaction', data => io.emit('reaction', data));

    socket.on('offer', data => { if(data.to && activeConnections[data.to]) io.to(activeConnections[data.to]).emit('offer', data); });
    socket.on('answer', data => { if(data.to && activeConnections[data.to]) io.to(activeConnections[data.to]).emit('answer', data); });
    socket.on('candidate', data => { if(data.to && activeConnections[data.to]) io.to(activeConnections[data.to]).emit('candidate', data); });
    socket.on('call_rejected', data => { if(data.to && activeConnections[data.to]) io.to(activeConnections[data.to]).emit('call_rejected', data); });

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
