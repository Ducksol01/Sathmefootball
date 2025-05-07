const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Sequelize, DataTypes } = require('sequelize');
require('dotenv').config();

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// For local development, allow SQLite fallback if PostgreSQL isn't available
let sequelize;
const useSqlite = !process.env.DATABASE_URL && process.env.NODE_ENV !== 'production';

if (useSqlite) {
  console.log('Using SQLite for local development');
  // Dynamically import sqlite3
  try {
    const sqlite3 = require('sqlite3').verbose();
    const db = new sqlite3.Database('./watchparty.db');
    console.log('SQLite database connected');
    
    // Create tables if they don't exist
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS rooms (
          id TEXT PRIMARY KEY,
          video_link TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
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
    
    // We'll use our SQLite handlers below
  } catch (error) {
    console.error('SQLite not available:', error.message);
  }
} else {
  // Use PostgreSQL (for production or if explicitly configured locally)
  sequelize = new Sequelize(process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/watchparty', {
    dialect: 'postgres',
    dialectOptions: {
      ssl: process.env.NODE_ENV === 'production' ? {
        require: true,
        rejectUnauthorized: false
      } : false
    },
    logging: false
  });
}

// Define models
const Room = sequelize.define('Room', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  video_link: {
    type: DataTypes.STRING,
    allowNull: true
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: Sequelize.NOW
  }
}, {
  timestamps: false,
  tableName: 'rooms'
});

const Participant = sequelize.define('Participant', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  room_id: {
    type: DataTypes.STRING,
    references: {
      model: Room,
      key: 'id'
    }
  },
  username: {
    type: DataTypes.STRING,
    allowNull: false
  },
  last_active: {
    type: DataTypes.DATE,
    defaultValue: Sequelize.NOW
  }
}, {
  timestamps: false,
  tableName: 'participants'
});

// Only do Sequelize setup if not using SQLite
if (!useSqlite) {
  // Define associations
  Room.hasMany(Participant, { foreignKey: 'room_id' });
  Participant.belongsTo(Room, { foreignKey: 'room_id' });

  // Sync database
  (async () => {
    try {
      await sequelize.sync();
      console.log('PostgreSQL database synchronized successfully');
    } catch (error) {
      console.error('Unable to sync database:', error);
    }
  })();
}


// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Room data cache (in-memory)
const rooms = new Map();

// Message history (limited to last 50 messages per room)
const messageHistory = new Map();

// Debug function to log room state
function logRoomState(roomId) {
  if (rooms.has(roomId)) {
    const room = rooms.get(roomId);
    console.log(`Room ${roomId} state: ${room.participants.size} participants, video: ${room.videoLink || 'none'}`);
    console.log('Participants:', Array.from(room.participants.entries()));
  } else {
    console.log(`Room ${roomId} not found in cache`);
  }
}

// Function to add a message to history
function addMessageToHistory(roomId, message) {
  if (!messageHistory.has(roomId)) {
    messageHistory.set(roomId, []);
  }
  
  const messages = messageHistory.get(roomId);
  messages.push(message);
  
  // Keep only last 50 messages
  if (messages.length > 50) {
    messages.shift();
  }
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  let currentRoom = null;
  let currentUsername = null;
  
  // Join Room
  socket.on('join-room', async (data) => {
    const { roomId, username } = data;
    currentRoom = roomId;
    currentUsername = username;
    
    console.log(`User ${username} (${socket.id}) joining room: ${roomId}`);
    
    // Join the Socket.io room
    socket.join(roomId);
    
    if (useSqlite) {
      // SQLite implementation
      try {
        const sqlite3 = require('sqlite3').verbose();
        const db = new sqlite3.Database('./watchparty.db');
        
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
              console.log(`Creating new room in cache: ${roomId}`);
              rooms.set(roomId, {
                participants: new Map(),
                videoLink: room ? room.video_link : null
              });
            } else {
              console.log(`Existing room found in cache: ${roomId}`);
            }
            
            // Add participant to room cache
            rooms.get(roomId).participants.set(socket.id, username);
            
            // Log room state after joining
            logRoomState(roomId);
            
            // Notify all clients in the room about the new participant
            io.to(roomId).emit('room-joined', {
              username,
              participants: participantNames
            });
            
            // Send current video to the new participant if it exists
            const currentRoom = rooms.get(roomId);
            if (currentRoom && currentRoom.videoLink) {
              console.log(`Sending existing video to new participant: ${username}`);
              socket.emit('video-set', {
                videoLink: currentRoom.videoLink,
                setBy: 'someone in the room'
              });
            }
            
            // Send chat history to new participant
            if (messageHistory.has(roomId)) {
              const messages = messageHistory.get(roomId);
              if (messages.length > 0) {
                console.log(`Sending ${messages.length} chat messages to new participant: ${username}`);
                socket.emit('chat-history', { messages });
              }
            }
            
            // Show the chat container
            socket.emit('show-chat');
          });
        });
      } catch (error) {
        console.error('Error with SQLite operations:', error);
      }
    } else {
      // PostgreSQL implementation with Sequelize
      try {
        // Check if room exists in database
        let room = await Room.findByPk(roomId);
        
        // If room doesn't exist, create it
        if (!room) {
          room = await Room.create({ id: roomId });
        }
        
        // Add participant to the database
        const participantId = socket.id;
        await Participant.upsert({
          id: participantId,
          room_id: roomId,
          username: username,
          last_active: new Date()
        });
        
        // Get all participants in the room
        const participants = await Participant.findAll({
          where: { room_id: roomId },
          attributes: ['username']
        });
        
        const participantNames = participants.map(p => p.username);
        
        // Update room cache
        if (!rooms.has(roomId)) {
          console.log(`Creating new room in cache (PostgreSQL): ${roomId}`);
          rooms.set(roomId, {
            participants: new Map(),
            videoLink: room ? room.video_link : null
          });
        } else {
          console.log(`Existing room found in cache (PostgreSQL): ${roomId}`);
        }
        
        // Add participant to room cache
        rooms.get(roomId).participants.set(socket.id, username);
        
        // Log room state after joining
        logRoomState(roomId);
        
        // Notify all clients in the room about the new participant
        io.to(roomId).emit('room-joined', {
          username,
          participants: participantNames
        });
        
        // Send current video to the new participant if it exists
        const currentRoom = rooms.get(roomId);
        if (currentRoom && currentRoom.videoLink) {
          console.log(`Sending existing video to new participant (PostgreSQL): ${username}`);
          socket.emit('video-set', {
            videoLink: currentRoom.videoLink,
            setBy: 'someone in the room'
          });
        }
        
        // Send chat history to new participant
        if (messageHistory.has(roomId)) {
          const messages = messageHistory.get(roomId);
          if (messages.length > 0) {
            console.log(`Sending ${messages.length} chat messages to new participant (PostgreSQL): ${username}`);
            socket.emit('chat-history', { messages });
          }
        }
        
        // Show the chat container
        socket.emit('show-chat');
      } catch (error) {
        console.error('Error joining room with Sequelize:', error);
      }
    }
  });
  
  // Set Video
  socket.on('set-video', async (data) => {
    try {
      const { roomId, videoLink, setBy } = data;
      console.log(`Setting video for room ${roomId} by ${setBy}: ${videoLink}`);
      
      if (!useSqlite) {
        // PostgreSQL implementation
        try {
          // Update in database
          await Room.update(
            { video_link: videoLink },
            { where: { id: roomId } }
          );
        } catch (dbError) {
          console.error('PostgreSQL error updating video link:', dbError);
        }
      } else {
        // SQLite implementation
        try {
          const sqlite3 = require('sqlite3').verbose();
          const db = new sqlite3.Database('./watchparty.db');
          db.run('UPDATE rooms SET video_link = ? WHERE id = ?', [videoLink, roomId]);
        } catch (dbError) {
          console.error('SQLite error updating video link:', dbError);
        }
      }
      
      // Update in cache (very important for synchronization)
      if (rooms.has(roomId)) {
        rooms.get(roomId).videoLink = videoLink;
        console.log(`Updated video link in room cache: ${roomId}`);
        logRoomState(roomId);
      } else {
        console.log(`Room ${roomId} not found in cache when setting video`);
        // Create room in cache if it doesn't exist
        rooms.set(roomId, {
          participants: new Map(),
          videoLink: videoLink
        });
        console.log(`Created new room in cache when setting video: ${roomId}`);
        logRoomState(roomId);
      }
      
      // Notify all clients in the room
      console.log(`Broadcasting video-set to room ${roomId}`);
      io.to(roomId).emit('video-set', { videoLink, setBy });
    } catch (error) {
      console.error('Error in set-video handler:', error);
    }
  });
  
  // Get Video
  socket.on('get-video', async (data) => {
    try {
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
      const room = await Room.findOne({
        where: { id: roomId },
        attributes: ['video_link']
      });
      
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
    } catch (error) {
      console.error('Error getting video link:', error);
    }
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
  
  // Chat message handler
  socket.on('chat-message', (data) => {
    const { roomId, message, sender } = data;
    console.log(`Chat message in room ${roomId} from ${sender}: ${message}`);
    
    // Create message object with timestamp
    const messageObj = {
      sender,
      message,
      timestamp: new Date().toISOString(),
      senderId: socket.id
    };
    
    // Add to message history
    addMessageToHistory(roomId, messageObj);
    
    // Broadcast to all users in the room including sender for consistent timestamp
    io.to(roomId).emit('chat-message', messageObj);
  });
  
  // Voice chat signaling
  socket.on('voice-signal', (data) => {
    const { roomId, signal, to } = data;
    console.log(`Voice signal from ${socket.id} to ${to} in room ${roomId}`);
    
    // Forward the signal to the specific recipient
    socket.to(to).emit('voice-signal', {
      signal,
      from: socket.id
    });
  });
  
  // Voice chat state change (mute/unmute)
  socket.on('voice-state-change', (data) => {
    const { roomId, isMuted } = data;
    console.log(`Voice state change in room ${roomId} - User ${socket.id} is ${isMuted ? 'muted' : 'unmuted'}`);
    
    // Broadcast voice state change to room
    socket.to(roomId).emit('voice-state-change', {
      userId: socket.id,
      username: currentUsername,
      isMuted
    });
  });
  
  // Sync request/response
  socket.on('request-sync', (data) => {
    socket.to(data.roomId).emit('sync-request');
  });
  
  socket.on('sync-response', (data) => {
    socket.to(data.roomId).emit('sync-response', data);
  });
  
  // Disconnect
  socket.on('disconnect', async () => {
    console.log('User disconnected:', socket.id);
    
    if (currentRoom) {
      try {
        // Remove participant from database
        await Participant.destroy({
          where: { id: socket.id }
        });
        
        // Remove from cache and notify others
        if (rooms.has(currentRoom)) {
          const roomData = rooms.get(currentRoom);
          roomData.participants.delete(socket.id);
          
          // Get updated participant list
          const participants = await Participant.findAll({
            where: { room_id: currentRoom },
            attributes: ['username']
          });
          
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
        }
      } catch (error) {
        console.error('Error handling disconnect:', error);
      }
    }
  });
});

// Cleanup inactive participants periodically (every 5 minutes)
setInterval(async () => {
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    const result = await Participant.destroy({
      where: {
        last_active: {
          [Sequelize.Op.lt]: fiveMinutesAgo
        }
      }
    });
    
    if (result > 0) {
      console.log(`Cleaned up ${result} inactive participants`);
    }
  } catch (error) {
    console.error('Error cleaning up inactive participants:', error);
  }
}, 5 * 60 * 1000);

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Watchparty server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser to access the app`);
});
