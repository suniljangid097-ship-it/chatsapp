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
let offlineMessageQueue = {};
let groups = {}; // Custom VIP Groups -> groupId: { name, admin, members: [] }

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

        // Push offline messages sequentially for Apple-style stacked notifications
        if (offlineMessageQueue[id] && offlineMessageQueue[id].length > 0) {
            let delay = 1000;
            offlineMessageQueue[id].forEach((item, index) => {
                setTimeout(() => socket.emit(item.type, item.data), delay + (index * 1200));
            });
            offlineMessageQueue[id] = [];
        }

        // Re-join user to their active groups
        for (let gId in groups) {
            if (groups[gId].members.includes(id)) {
                socket.emit('group_added', { id: gId, name: groups[gId].name });
            }
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

    // VIP Group Creation
    socket.on('create_group', (data, callback) => {
        const senderId = socketToId[socket.id];
        if(!senderId) return;
        
        const groupId = 'G' + Math.floor(100000 + Math.random() * 900000); // e.g. G123456
        let membersArray = data.members.split(',').map(m => m.trim()).filter(m => m.length === 6 && registeredIDs[m]);
        if(!membersArray.includes(senderId)) membersArray.push(senderId); // Add admin
        
        if (membersArray.length < 2) return callback({ success: false, message: "Need valid IDs to create group." });

        groups[groupId] = { name: data.name, admin: senderId, members: membersArray };
        
        membersArray.forEach(mId => {
            if (activeConnections[mId]) {
                io.to(activeConnections[mId]).emit('group_added', { id: groupId, name: data.name });
            }
        });
        callback({ success: true });
    });

    const routeData = (eventName, data) => {
        const senderId = socketToId[socket.id];
        if (!senderId) return;

        data.from_id = senderId;
        data.name = registeredIDs[senderId];
        data.time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });

        // Group Routing
        if (data.to && data.to.startsWith('G') && groups[data.to]) {
            groups[data.to].members.forEach(memberId => {
                if (memberId !== senderId) {
                    if (activeConnections[memberId]) {
                        io.to(activeConnections[memberId]).emit(eventName, data);
                    } else {
                        if (!offlineMessageQueue[memberId]) offlineMessageQueue[memberId] = [];
                        offlineMessageQueue[memberId].push({ type: eventName, data: data });
                    }
                }
            });
            socket.emit(eventName, data); // send back to sender
        } 
        // 1-to-1 Routing
        else if (data.to && data.to !== 'Public') {
            const targetSocketId = activeConnections[data.to];
            if (targetSocketId) {
                io.to(targetSocketId).emit(eventName, data);
            } else {
                if (!offlineMessageQueue[data.to]) offlineMessageQueue[data.to] = [];
                offlineMessageQueue[data.to].push({ type: eventName, data: data });
            }
            socket.emit(eventName, data);
        } 
        // Public Routing
        else {
            io.emit(eventName, data);
        }
    };

    socket.on('chat message', data => routeData('chat message', data));
    socket.on('voice message', data => routeData('voice message', data));
    socket.on('image message', data => routeData('image message', data));
    
    socket.on('screen_effect', (data) => {
        const senderId = socketToId[socket.id];
        if (!senderId) return;
        data.from_name = registeredIDs[senderId];
        if (data.to && data.to.startsWith('G') && groups[data.to]) {
             groups[data.to].members.forEach(m => { if(m !== senderId && activeConnections[m]) io.to(activeConnections[m]).emit('screen_effect', data); });
        } else if (data.to && data.to !== 'Public' && activeConnections[data.to]) {
            io.to(activeConnections[data.to]).emit('screen_effect', data);
        } else {
            io.emit('screen_effect', data);
        }
    });

    socket.on('shareplay_event', (data) => {
        const senderId = socketToId[socket.id];
        if (!senderId) return;
        data.from_name = registeredIDs[senderId];
        if (data.to && data.to !== 'Public' && activeConnections[data.to]) {
            io.to(activeConnections[data.to]).emit('shareplay_event', data);
        } else {
            socket.broadcast.emit('shareplay_event', data);
        }
    });

    socket.on('screenshot_alert', (data) => {
        const senderId = socketToId[socket.id];
        if (!senderId) return;
        const alertPayload = { from_name: registeredIDs[senderId] };
        if (data.to && data.to !== 'Public' && activeConnections[data.to]) {
            io.to(activeConnections[data.to]).emit('screenshot_alert', alertPayload);
        }
    });

    socket.on('typing', data => { if(data.to && activeConnections[data.to]) io.to(activeConnections[data.to]).emit('typing', data); });
    socket.on('stop_typing', data => { if(data.to && activeConnections[data.to]) io.to(activeConnections[data.to]).emit('stop_typing', data); });
    socket.on('reaction', data => io.emit('reaction', data));

    // Calls Sync
    socket.on('offer', data => { if(data.to && activeConnections[data.to]) io.to(activeConnections[data.to]).emit('offer', data); });
    socket.on('answer', data => { if(data.to && activeConnections[data.to]) io.to(activeConnections[data.to]).emit('answer', data); });
    socket.on('candidate', data => { if(data.to && activeConnections[data.to]) io.to(activeConnections[data.to]).emit('candidate', data); });
    socket.on('call_rejected', data => { if(data.to && activeConnections[data.to]) io.to(activeConnections[data.to]).emit('call_rejected', data); });
    
    // NEW: End call for the peer
    socket.on('end_call', data => { if(data.to && activeConnections[data.to]) io.to(activeConnections[data.to]).emit('call_ended'); });

    socket.on('disconnect', () => {
        const id = socketToId[socket.id];
        if (id) {
            delete activeConnections[id];
            delete socketToId[socket.id];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Chatsapp Premium VIP running on port ${PORT}`));
