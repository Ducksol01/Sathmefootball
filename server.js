const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Initialize SQLite database
const db = new sqlite3.Database('./watchparty.db');

// Create database tables if they don't exist
db.serialize(() => {
  // Rooms table - stores room information
  db.run(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      video_link TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Participants table - stores active participants in rooms
  db.run(`
    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY,
      room_id TEXT,
      username TEXT,
      last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (room_id) REFERENCES rooms(id)
    )
  `);
});

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Room data cache (in-memory)
const rooms = new Map();

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  let currentRoom = null;
  let currentUsername = null;
  
  // Join Room
  socket.on('join-room', (data) => {
    const { roomId, username } = data;
    currentRoom = roomId;
    currentUsername = username;
    
    // Join the Socket.io room
    socket.join(roomId);
    
    // Check if room exists in database
    db.get('SELECT * FROM rooms WHERE id = ?', [roomId], (err, room) => {
      if (err) {
        console.error('Database error:', err);
        return;
      }
      
      // If room doesn't exist, create it
      if (!room) {
        db.run('INSERT INTO rooms (id) VALUES (?)', [roomId], (err) => {
          if (err) console.error('Error creating room:', err);
        });
      }
      
      // Add participant to the database
      const participantId = socket.id;
      db.run(
        'INSERT OR REPLACE INTO participants (id, room_id, username) VALUES (?, ?, ?)',
        [participantId, roomId, username],
        (err) => {
          if (err) console.error('Error adding participant:', err);
        }
      );
      
      // Get all participants in the room
      db.all('SELECT username FROM participants WHERE room_id = ?', [roomId], (err, participants) => {
        if (err) {
          console.error('Error getting participants:', err);
          return;
        }
        
        const participantNames = participants.map(p => p.username);
        
        // Update room cache
        if (!rooms.has(roomId)) {
          rooms.set(roomId, {
            participants: new Map(),
            videoLink: room ? room.video_link : null
          });
        }
        
        // Add participant to room cache
        rooms.get(roomId).participants.set(socket.id, username);
        
        // Notify all clients in the room about the new participant
        io.to(roomId).emit('room-joined', {
          username,
          participants: participantNames
        });
      });
    });
  });
  
  // Set Video
  socket.on('set-video', (data) => {
    const { roomId, videoLink, setBy } = data;
    
    // Update in database
    db.run('UPDATE rooms SET video_link = ? WHERE id = ?', [videoLink, roomId], (err) => {
      if (err) {
        console.error('Error updating video link:', err);
        return;
      }
      
      // Update in cache
      if (rooms.has(roomId)) {
        rooms.get(roomId).videoLink = videoLink;
      }
      
      // Notify all clients in the room
      io.to(roomId).emit('video-set', { videoLink, setBy });
    });
  });
  
  // Get Video
  socket.on('get-video', (data) => {
    const { roomId } = data;
    
    // Check cache first
    if (rooms.has(roomId) && rooms.get(roomId).videoLink) {
      socket.emit('video-set', {
        videoLink: rooms.get(roomId).videoLink,
        setBy: 'someone'
      });
      return;
    }
    
    // If not in cache, check database
    db.get('SELECT video_link FROM rooms WHERE id = ?', [roomId], (err, room) => {
      if (err) {
        console.error('Error getting video link:', err);
        return;
      }
      
      if (room && room.video_link) {
        socket.emit('video-set', {
          videoLink: room.video_link,
          setBy: 'someone'
        });
        
        // Update cache
        if (rooms.has(roomId)) {
          rooms.get(roomId).videoLink = room.video_link;
        }
      }
    });
  });
  
  // Video control events
  socket.on('video-play', (data) => {
    socket.to(data.roomId).emit('video-play');
  });
  
  socket.on('video-pause', (data) => {
    socket.to(data.roomId).emit('video-pause');
  });
  
  socket.on('video-seek', (data) => {
    socket.to(data.roomId).emit('video-seek', { currentTime: data.currentTime });
  });
  
  // Sync request/response
  socket.on('request-sync', (data) => {
    socket.to(data.roomId).emit('sync-request');
  });
  
  socket.on('sync-response', (data) => {
    socket.to(data.roomId).emit('sync-response', data);
  });
  
  // Disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    if (currentRoom) {
      // Remove participant from database
      db.run('DELETE FROM participants WHERE id = ?', [socket.id], (err) => {
        if (err) console.error('Error removing participant:', err);
      });
      
      // Remove from cache and notify others
      if (rooms.has(currentRoom)) {
        const roomData = rooms.get(currentRoom);
        roomData.participants.delete(socket.id);
        
        // Get updated participant list
        db.all('SELECT username FROM participants WHERE room_id = ?', [currentRoom], (err, participants) => {
          if (err) {
            console.error('Error getting participants:', err);
            return;
          }
          
          const participantNames = participants.map(p => p.username);
          
          // Notify all clients in the room
          io.to(currentRoom).emit('room-left', {
            username: currentUsername,
            participants: participantNames
          });
          
          // If room is empty, remove it from cache (but keep in database)
          if (roomData.participants.size === 0) {
            rooms.delete(currentRoom);
          }
        });
      }
    }
  });
});

// Cleanup inactive participants periodically (every 5 minutes)
setInterval(() => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  
  db.run('DELETE FROM participants WHERE last_active < ?', [fiveMinutesAgo], function(err) {
    if (err) {
      console.error('Error cleaning up inactive participants:', err);
    } else if (this.changes > 0) {
      console.log(`Cleaned up ${this.changes} inactive participants`);
    }
  });
}, 5 * 60 * 1000);

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Watchparty server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser to access the app`);
});
