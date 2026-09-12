const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let onlineUsers = {}; // Tracks currently online users
let registeredIDs = {}; // "123456" -> "Rahul" (Tracks claimed VIP IDs)

io.on('connection', (socket) => {
    
    // Premium VIP Login/Registration
    socket.on('register_user', (data, callback) => {
        const { id, name } = data;
        
        if (registeredIDs[id]) {
            if (registeredIDs[id] === name) {
                // Returning valid user
                onlineUsers[socket.id] = { id, name };
                io.emit('update_users', onlineUsers);
                callback({ success: true, message: "Welcome back!" });
            } else {
                // ID is already taken by someone else
                callback({ success: false, message: "❌ This Premium ID is already taken!" });
            }
        } else {
            // New user registration
            registeredIDs[id] = name;
            onlineUsers[socket.id] = { id, name };
            io.emit('update_users', onlineUsers);
            callback({ success: true, message: "VIP ID Registered!" });
        }
    });

    socket.on('chat message', (data) => {
        if (data.to && data.to !== 'Public') {
            io.to(data.to).emit('chat message', data);
            socket.emit('chat message', data);
        } else {
            io.emit('chat message', data);
        }
    });

    socket.on('voice message', (data) => {
        if (data.to && data.to !== 'Public') {
            io.to(data.to).emit('voice message', data);
            socket.emit('voice message', data);
        } else {
            io.emit('voice message', data);
        }
    });

    socket.on('image message', (data) => {
        if (data.to && data.to !== 'Public') {
            io.to(data.to).emit('image message', data);
            socket.emit('image message', data);
        } else {
            io.emit('image message', data);
        }
    });

    socket.on('typing', (data) => socket.broadcast.emit('typing', data));
    socket.on('stop_typing', (data) => socket.broadcast.emit('stop_typing', data));
    socket.on('reaction', (data) => io.emit('reaction', data));

    socket.on('offer', (data) => socket.broadcast.emit('offer', data));
    socket.on('answer', (data) => socket.broadcast.emit('answer', data));
    socket.on('candidate', (data) => socket.broadcast.emit('candidate', data));
    socket.on('call_rejected', () => socket.broadcast.emit('call_rejected'));

    socket.on('disconnect', () => {
        delete onlineUsers[socket.id];
        io.emit('update_users', onlineUsers);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Chatsapp Premium running on port ${PORT}`);
});
