const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let registeredIDs = {};      // 6-digit ID -> Name
let activeConnections = {};  // 6-digit ID -> Socket ID
let socketToId = {};         // Socket ID -> 6-digit ID
let offlineMessageQueue = {};// 6-digit ID -> Array of missed messages

io.on('connection', (socket) => {
    
    // Register VIP ID & Deliver Offline Messages Safely
    socket.on('register_user', (data, callback) => {
        if (!data || !data.id || !data.name) {
            if (typeof callback === 'function') callback({ success: false, message: "Invalid data" });
            return;
        }
        
        const { id, name } = data;
        if (registeredIDs[id] && registeredIDs[id] !== name) {
            if (typeof callback === 'function') callback({ success: false, message: "❌ This Premium ID is already taken!" });
            return;
        }
        
        registeredIDs[id] = name;
        activeConnections[id] = socket.id;
        socketToId[socket.id] = id;
        
        if (typeof callback === 'function') callback({ success: true, message: "VIP ID Registered!" });

        // Deliver pending offline messages after short delay
        if (offlineMessageQueue[id] && offlineMessageQueue[id].length > 0) {
            setTimeout(() => {
                offlineMessageQueue[id].forEach(msg => {
                    socket.emit('offline_notification', msg);
                });
                offlineMessageQueue[id] = []; 
            }, 800);
        }
    });

    socket.on('find_user', (targetId, callback) => {
        if (registeredIDs[targetId] && targetId !== socketToId[socket.id]) {
            if (typeof callback === 'function') callback({ success: true, name: registeredIDs[targetId], id: targetId });
        } else if (targetId === socketToId[socket.id]) {
            if (typeof callback === 'function') callback({ success: false, message: "You cannot chat with yourself." });
        } else {
            if (typeof callback === 'function') callback({ success: false, message: "User is offline or ID is wrong." });
        }
    });

    const routeData = (eventName, data) => {
        const senderId = socketToId[socket.id];
        if (!senderId) return;

        data.from_id = senderId;
        data.name = registeredIDs[senderId];

        if (data.to && data.to !== 'Public') {
            const targetSocketId = activeConnections[data.to];
            if (targetSocketId) {
                io.to(targetSocketId).emit(eventName, data);
            } else {
                if (!offlineMessageQueue[data.to]) {
                    offlineMessageQueue[data.to] = [];
                }
                offlineMessageQueue[data.to].push({
                    from_name: data.name,
                    from_id: senderId,
                    text: data.text || 'Media / Audio Note',
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                });
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

    // WebRTC Signaling
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
