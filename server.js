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

// Initialize Sequelize with PostgreSQL
const sequelize = new Sequelize(process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/watchparty', {
  dialect: 'postgres',
  dialectOptions: {
    ssl: process.env.NODE_ENV === 'production' ? {
      require: true,
      rejectUnauthorized: false
    } : false
  },
  logging: false
});

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

// Define associations
Room.hasMany(Participant, { foreignKey: 'room_id' });
Participant.belongsTo(Room, { foreignKey: 'room_id' });

// Sync database
(async () => {
  try {
    await sequelize.sync();
    console.log('Database synchronized successfully');
  } catch (error) {
    console.error('Unable to sync database:', error);
  }
})();


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
  socket.on('join-room', async (data) => {
    try {
      const { roomId, username } = data;
      currentRoom = roomId;
      currentUsername = username;
      
      // Join the Socket.io room
      socket.join(roomId);
      
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
    } catch (error) {
      console.error('Error joining room:', error);
    }
  });
  
  // Set Video
  socket.on('set-video', async (data) => {
    try {
      const { roomId, videoLink, setBy } = data;
      
      // Update in database
      await Room.update(
        { video_link: videoLink },
        { where: { id: roomId } }
      );
      
      // Update in cache
      if (rooms.has(roomId)) {
        rooms.get(roomId).videoLink = videoLink;
      }
      
      // Notify all clients in the room
      io.to(roomId).emit('video-set', { videoLink, setBy });
    } catch (error) {
      console.error('Error updating video link:', error);
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
