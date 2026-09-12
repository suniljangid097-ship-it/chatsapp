const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Online users track karne ke liye
let onlineUsers = {}; 

io.on('connection', (socket) => {
    
    // Naya banda aane par
    socket.on('user_join', (name) => {
        onlineUsers[socket.id] = name;
        io.emit('update_users', onlineUsers); // Sabko list bhejo
    });

    // Chat Message (Public & Private)
    socket.on('chat message', (data) => {
        if (data.to && data.to !== 'Public') {
            io.to(data.to).emit('chat message', data); // Jisko bheja use milega
            socket.emit('chat message', data); // Bhejne wale ko bhi dikhega
        } else {
            io.emit('chat message', data); // Public Chat
        }
    });

    // Voice Message
    socket.on('voice message', (data) => {
        if (data.to && data.to !== 'Public') {
            io.to(data.to).emit('voice message', data);
            socket.emit('voice message', data);
        } else {
            io.emit('voice message', data);
        }
    });

    // Image Message
    socket.on('image message', (data) => {
        if (data.to && data.to !== 'Public') {
            io.to(data.to).emit('image message', data);
            socket.emit('image message', data);
        } else {
            io.emit('image message', data);
        }
    });

    // Typing Status
    socket.on('typing', (data) => {
        socket.broadcast.emit('typing', data);
    });

    socket.on('stop_typing', (data) => {
        socket.broadcast.emit('stop_typing', data);
    });

    // Emoji Reaction
    socket.on('reaction', (data) => {
        io.emit('reaction', data);
    });

    // WebRTC Video Call Signaling 
    socket.on('offer', (data) => socket.broadcast.emit('offer', data));
    socket.on('answer', (data) => socket.broadcast.emit('answer', data));
    socket.on('candidate', (data) => socket.broadcast.emit('candidate', data));
    socket.on('call_rejected', () => socket.broadcast.emit('call_rejected'));

    // Disconnect
    socket.on('disconnect', () => {
        delete onlineUsers[socket.id];
        io.emit('update_users', onlineUsers);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Chatsapp Premium running on port ${PORT}`);
});
