

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

    // =========================
    // USER REGISTER
    // =========================
    socket.on('register_user', (data, callback) => {
        if (!data || !data.id || !data.name) {
            return callback({
                success: false,
                message: "Invalid data"
            });
        }

        const { id, name } = data;

        if (registeredIDs[id] && registeredIDs[id] !== name) {
            return callback({
                success: false,
                message: "❌ This Premium ID is already taken!"
            });
        }

        registeredIDs[id] = name;

        // MULTI TAB / MULTI DEVICE SAFE
        if (!activeConnections[id]) {
            activeConnections[id] = new Set();
        }

        activeConnections[id].add(socket.id);
        socketToId[socket.id] = id;

        callback({
            success: true,
            message: "VIP ID Registered!"
        });

        // =========================
        // OFFLINE MESSAGE DELIVERY
        // =========================
        if (
            offlineMessageQueue[id] &&
            offlineMessageQueue[id].length > 0
        ) {
            const queuedMessages = offlineMessageQueue[id].splice(0);

            queuedMessages.forEach((item, index) => {
                setTimeout(() => {
                    if (socket.connected) {
                        socket.emit(item.type, item.data);
                    }
                }, 1200 + (index * 500));
            });
        }

        // =========================
        // GROUP RESTORE
        // =========================
        for (let gId in groups) {
            if (groups[gId].members.includes(id)) {
                socket.emit('group_added', {
                    id: gId,
                    name: groups[gId].name
                });
            }
        }
    });


    // =========================
    // FIND USER
    // =========================
    socket.on('find_user', (targetId, callback) => {
        const currentUserId = socketToId[socket.id];

        if (
            registeredIDs[targetId] &&
            targetId !== currentUserId
        ) {
            callback({
                success: true,
                name: registeredIDs[targetId],
                id: targetId
            });
        } else if (targetId === currentUserId) {
            callback({
                success: false,
                message: "You cannot chat with yourself."
            });
        } else {
            callback({
                success: false,
                message: "User is offline or ID is wrong."
            });
        }
    });


    // =========================
    // CREATE GROUP
    // =========================
    socket.on('create_group', (data, callback) => {
        const senderId = socketToId[socket.id];

        if (!senderId) {
            return callback({
                success: false,
                message: "User not registered."
            });
        }

        if (!data || !data.name || !data.members) {
            return callback({
                success: false,
                message: "Please fill all fields."
            });
        }

        const groupId =
            'G' + Math.floor(100000 + Math.random() * 900000);

        let membersArray = data.members
            .split(',')
            .map(m => m.trim())
            .filter(
                m => m.length === 6 && registeredIDs[m]
            );

        if (!membersArray.includes(senderId)) {
            membersArray.push(senderId);
        }

        if (membersArray.length < 2) {
            return callback({
                success: false,
                message: "Need valid IDs to create group."
            });
        }

        groups[groupId] = {
            name: data.name,
            admin: senderId,
            members: membersArray
        };

        // Notify all group members
        membersArray.forEach(mId => {
            if (activeConnections[mId]) {
                activeConnections[mId].forEach(socketId => {
                    io.to(socketId).emit('group_added', {
                        id: groupId,
                        name: data.name
                    });
                });
            }
        });

        callback({
            success: true
        });
    });


    // =========================
    // COMMON MESSAGE ROUTER
    // =========================
    const routeData = (eventName, data) => {
        const senderId = socketToId[socket.id];

        if (!senderId) return;
        if (!data) return;

        data.from_id = senderId;
        data.name = registeredIDs[senderId];

        data.time =
            new Date().toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });


        // =========================
        // GROUP MESSAGE
        // =========================
        if (
            data.to &&
            data.to.startsWith('G') &&
            groups[data.to]
        ) {
            groups[data.to].members.forEach(memberId => {

                if (memberId === senderId) return;

                // Online
                if (
                    activeConnections[memberId] &&
                    activeConnections[memberId].size > 0
                ) {
                    activeConnections[memberId].forEach(targetSocketId => {
                        io.to(targetSocketId).emit(
                            eventName,
                            data
                        );
                    });
                }

                // Offline
                else {
                    if (!offlineMessageQueue[memberId]) {
                        offlineMessageQueue[memberId] = [];
                    }

                    offlineMessageQueue[memberId].push({
                        type: eventName,
                        data: { ...data }
                    });
                }
            });

            // Show sender's own message
            socket.emit(eventName, data);
        }


        // =========================
        // PRIVATE MESSAGE
        // =========================
        else if (
            data.to &&
            data.to !== 'Public'
        ) {
            const targetSockets =
                activeConnections[data.to];

            // Online
            if (
                targetSockets &&
                targetSockets.size > 0
            ) {
                targetSockets.forEach(targetSocketId => {
                    io.to(targetSocketId).emit(
                        eventName,
                        data
                    );
                });
            }

            // Offline
            else {
                if (!offlineMessageQueue[data.to]) {
                    offlineMessageQueue[data.to] = [];
                }

                offlineMessageQueue[data.to].push({
                    type: eventName,
                    data: { ...data }
                });
            }

            // Sender gets own message
            socket.emit(eventName, data);
        }


        // =========================
        // PUBLIC CHAT
        // =========================
        else {
            io.emit(eventName, data);
        }
    };


    // =========================
    // CHAT EVENTS
    // =========================
    socket.on('chat message', data => {
        routeData('chat message', data);
    });

    socket.on('voice message', data => {
        routeData('voice message', data);
    });

    socket.on('image message', data => {
        routeData('image message', data);
    });

    // Ghost Mode Delete Sync
    socket.on('delete_message', data => {
        routeData('delete_message', data);
    });


    // =========================
    // SCREEN EFFECT
    // =========================
    socket.on('screen_effect', (data) => {
        const senderId = socketToId[socket.id];

        if (!senderId || !data) return;

        data.from_name = registeredIDs[senderId];

        // Group
        if (
            data.to &&
            data.to.startsWith('G') &&
            groups[data.to]
        ) {
            groups[data.to].members.forEach(memberId => {
                if (memberId === senderId) return;

                if (activeConnections[memberId]) {
                    activeConnections[memberId].forEach(targetSocketId => {
                        io.to(targetSocketId).emit(
                            'screen_effect',
                            data
                        );
                    });
                }
            });
        }

        // Private
        else if (
            data.to &&
            data.to !== 'Public' &&
            activeConnections[data.to]
        ) {
            activeConnections[data.to].forEach(targetSocketId => {
                io.to(targetSocketId).emit(
                    'screen_effect',
                    data
                );
            });
        }

        // Public
        else {
            io.emit('screen_effect', data);
        }
    });


    // =========================
    // SHAREPLAY
    // =========================
    socket.on('shareplay_event', (data) => {
        const senderId = socketToId[socket.id];

        if (!senderId || !data) return;

        data.from_name = registeredIDs[senderId];

        if (
            data.to &&
            data.to !== 'Public' &&
            activeConnections[data.to]
        ) {
            activeConnections[data.to].forEach(targetSocketId => {
                io.to(targetSocketId).emit(
                    'shareplay_event',
                    data
                );
            });
        } else {
            socket.broadcast.emit(
                'shareplay_event',
                data
            );
        }
    });


    // =========================
    // SCREENSHOT ALERT
    // =========================
    socket.on('screenshot_alert', (data) => {
        const senderId = socketToId[socket.id];

        if (!senderId || !data) return;

        const alertPayload = {
            from_name: registeredIDs[senderId]
        };

        if (
            data.to &&
            data.to !== 'Public' &&
            activeConnections[data.to]
        ) {
            activeConnections[data.to].forEach(targetSocketId => {
                io.to(targetSocketId).emit(
                    'screenshot_alert',
                    alertPayload
                );
            });
        }
    });


    // =========================
    // TYPING
    // =========================
    socket.on('typing', data => {
        const senderId = socketToId[socket.id];

        if (!senderId || !data || !data.to) return;

        data.from_id = senderId;
        data.name = registeredIDs[senderId];

        if (activeConnections[data.to]) {
            activeConnections[data.to].forEach(targetSocketId => {
                io.to(targetSocketId).emit(
                    'typing',
                    data
                );
            });
        }
    });


    // =========================
    // STOP TYPING
    // =========================
    socket.on('stop_typing', data => {
        const senderId = socketToId[socket.id];

        if (!senderId || !data || !data.to) return;

        data.from_id = senderId;
        data.name = registeredIDs[senderId];

        if (activeConnections[data.to]) {
            activeConnections[data.to].forEach(targetSocketId => {
                io.to(targetSocketId).emit(
                    'stop_typing',
                    data
                );
            });
        }
    });


    // =========================
    // REACTION
    // =========================
    socket.on('reaction', data => {
        io.emit('reaction', data);
    });


    // =========================
    // WEBRTC CALL EVENTS
    // =========================
    socket.on('offer', data => {
        if (
            data.to &&
            activeConnections[data.to]
        ) {
            activeConnections[data.to].forEach(targetSocketId => {
                io.to(targetSocketId).emit(
                    'offer',
                    data
                );
            });
        }
    });

    socket.on('answer', data => {
        if (
            data.to &&
            activeConnections[data.to]
        ) {
            activeConnections[data.to].forEach(targetSocketId => {
                io.to(targetSocketId).emit(
                    'answer',
                    data
                );
            });
        }
    });

    socket.on('candidate', data => {
        if (
            data.to &&
            activeConnections[data.to]
        ) {
            activeConnections[data.to].forEach(targetSocketId => {
                io.to(targetSocketId).emit(
                    'candidate',
                    data
                );
            });
        }
    });

    socket.on('call_rejected', data => {
        if (
            data.to &&
            activeConnections[data.to]
        ) {
            activeConnections[data.to].forEach(targetSocketId => {
                io.to(targetSocketId).emit(
                    'call_rejected',
                    data
                );
            });
        }
    });

    socket.on('end_call', data => {
        if (
            data.to &&
            activeConnections[data.to]
        ) {
            activeConnections[data.to].forEach(targetSocketId => {
                io.to(targetSocketId).emit(
                    'call_ended'
                );
            });
        }
    });


    // =========================
    // DISCONNECT
    // =========================
    socket.on('disconnect', () => {
        const id = socketToId[socket.id];

        if (id && activeConnections[id]) {

            activeConnections[id].delete(socket.id);

            // Remove only when no connection remains
            if (activeConnections[id].size === 0) {
                delete activeConnections[id];
            }

            delete socketToId[socket.id];
        }
    });
});


// =========================
// SERVER START
// =========================
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(
        `Chatsapp Premium VIP running on port ${PORT}`
    );
});
