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
    
    // Register VIP ID & Deliver Offline Messages
    socket.on('register_user', (data, callback) => {
        const { id, name } = data;
        if (registeredIDs[id] && registeredIDs[id] !== name) {
            callback({ success: false, message: "❌ This Premium ID is already taken!" });
            return;
        }
        
        registeredIDs[id] = name;
        activeConnections[id] = socket.id;
        socketToId[socket.id] = id;
        
        callback({ success: true, message: "VIP ID Registered!" });

        // Deliver pending offline messages right after login
        if (offlineMessageQueue[id] && offlineMessageQueue[id].length > 0) {
            setTimeout(() => {
                offlineMessageQueue[id].forEach(msg => {
                    socket.emit('offline_notification', msg);
                });
                offlineMessageQueue[id] = []; // Clear queue
            }, 1000);
        }
    });

    socket.on('find_user', (targetId, callback) => {
        if (registeredIDs[targetId] && targetId !== socketToId[socket.id]) {
            callback({ success: true, name: registeredIDs[targetId], id: targetId });
        } else if (targetId === socketToId[socket.id]) {
            callback({ success: false, message: "You cannot chat with yourself." });
        } else {
            callback({ success: false, message: "ID does not exist." });
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
                // Save to offline queue if recipient is offline
                if (!offlineMessageQueue[data.to]) {
                    offlineMessageQueue[data.to] = [];
                }
                offlineMessageQueue[data.to].push({
                    from_name: data.name,
                    from_id: senderId,
                    text: data.text || 'Sent an attachment',
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                });
            }
            socket.emit(eventName, data); // Echo back to sender
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

    socket.on('offer', data => { if(activeConnections[data.to]) io.to(activeConnections[data.to]).emit('offer', data); });
    socket.on('answer', data => { if(activeConnections[data.to]) io.to(activeConnections[data.to]).emit('answer', data); });
    socket.on('candidate', data => { if(activeConnections[data.to]) io.to(activeConnections[data.to]).emit('candidate', data); });
    socket.on('call_rejected', data => { if(activeConnections[data.to]) io.to(activeConnections[data.to]).emit('call_rejected', data); });

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
