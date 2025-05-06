// Connect to Socket.io server
const socket = io();

// DOM Elements
const usernameInput = document.getElementById('username');
const roomIdInput = document.getElementById('room-id');
const joinRoomButton = document.getElementById('join-room');
const videoLinkInput = document.getElementById('video-link');
const setVideoButton = document.getElementById('set-video');
const videoPlayer = document.getElementById('video-player');
const playPauseButton = document.getElementById('play-pause');
const syncButton = document.getElementById('sync-video');
const statusDiv = document.getElementById('status');
const currentRoomSpan = document.getElementById('current-room');
const roomSetupDiv = document.getElementById('room-setup');
const videoSetupDiv = document.getElementById('video-setup');
const playerContainerDiv = document.getElementById('player-container');
const participantsDiv = document.getElementById('participants');
const copyRoomButton = document.getElementById('copy-room');

// App State
let currentRoom = '';
let username = '';
let isSyncingVideo = false;
let videoType = 'direct'; // 'direct' or 'embed'
let youtubePlayer = null;

// Initialize
function init() {
  // Check if user was in a room before (from localStorage)
  const savedRoom = localStorage.getItem('watchparty_room');
  const savedName = localStorage.getItem('watchparty_username');
  
  if (savedRoom && savedName) {
    roomIdInput.value = savedRoom;
    usernameInput.value = savedName;
  }
}

// Event Listeners
joinRoomButton.addEventListener('click', joinRoom);
setVideoButton.addEventListener('click', setVideo);
playPauseButton.addEventListener('click', togglePlayPause);
syncButton.addEventListener('click', requestSync);
copyRoomButton.addEventListener('click', copyRoomId);

// Video player events
videoPlayer.addEventListener('play', () => {
  if (!isSyncingVideo) {
    socket.emit('video-play', { roomId: currentRoom });
    playPauseButton.textContent = 'Pause';
  }
});

videoPlayer.addEventListener('pause', () => {
  if (!isSyncingVideo) {
    socket.emit('video-pause', { roomId: currentRoom });
    playPauseButton.textContent = 'Play';
  }
});

videoPlayer.addEventListener('seeked', () => {
  if (!isSyncingVideo) {
    socket.emit('video-seek', { 
      roomId: currentRoom, 
      currentTime: videoPlayer.currentTime 
    });
  }
});

// Functions
function joinRoom() {
  username = usernameInput.value.trim();
  let roomId = roomIdInput.value.trim();
  
  if (!username) {
    showStatus('Please enter your name', 'error');
    return;
  }
  
  // If room ID is empty, we'll create a new room
  if (!roomId) {
    roomId = generateRoomId();
    roomIdInput.value = roomId;
  }
  
  currentRoom = roomId;
  
  // Save to localStorage
  localStorage.setItem('watchparty_room', roomId);
  localStorage.setItem('watchparty_username', username);
  
  // Join the room
  socket.emit('join-room', { roomId, username });
  
  // Update UI
  currentRoomSpan.textContent = roomId;
  roomSetupDiv.classList.add('hidden');
  videoSetupDiv.classList.remove('hidden');
  
  // Add animation to the video setup card
  videoSetupDiv.style.animation = 'fadeIn 0.5s ease-in-out';
  
  showStatus(`Joined room: ${roomId}`, 'success');
  
  // Check if there's already a video in this room
  socket.emit('get-video', { roomId });
}

function setVideo() {
  const videoLink = videoLinkInput.value.trim();
  
  if (!videoLink) {
    showStatus('Please enter a video link', 'error');
    return;
  }
  
  // Process the video link to get embed URL if needed
  const processedLink = processVideoLink(videoLink);
  
  socket.emit('set-video', { 
    roomId: currentRoom, 
    videoLink: processedLink, 
    setBy: username 
  });
}

function togglePlayPause() {
  if (videoPlayer.paused) {
    videoPlayer.play();
    playPauseButton.innerHTML = '<i class="fas fa-pause"></i> Pause';
  } else {
    videoPlayer.pause();
    playPauseButton.innerHTML = '<i class="fas fa-play"></i> Play';
  }
}

function copyRoomId() {
  const roomId = currentRoom;
  
  // Use the Clipboard API to copy the room ID
  navigator.clipboard.writeText(roomId)
    .then(() => {
      showStatus('Room ID copied to clipboard!', 'success');
      
      // Change button text temporarily
      const originalText = copyRoomButton.innerHTML;
      copyRoomButton.innerHTML = '<i class="fas fa-check"></i> Copied!';
      
      setTimeout(() => {
        copyRoomButton.innerHTML = originalText;
      }, 2000);
    })
    .catch(err => {
      console.error('Could not copy text: ', err);
      showStatus('Failed to copy room ID', 'error');
    });
}

function requestSync() {
  socket.emit('request-sync', { roomId: currentRoom });
  showStatus('Requesting sync from room...', 'success');
}

function sendCurrentVideoState() {
  if (videoType === 'direct') {
    const videoPlayer = document.getElementById('video-player');
    if (videoPlayer && videoPlayer.src) {
      socket.emit('sync-response', {
        roomId: currentRoom,
        currentTime: videoPlayer.currentTime,
        isPaused: videoPlayer.paused,
        videoLink: videoPlayer.src
      });
    }
  } else if (videoType === 'youtube' && youtubePlayer) {
    const state = youtubePlayer.getPlayerState();
    const isPaused = (state !== 1); // 1 is playing
    const currentTime = youtubePlayer.getCurrentTime();
    const videoLink = document.getElementById('video-frame').src;
    
    socket.emit('sync-response', {
      roomId: currentRoom,
      currentTime: currentTime,
      isPaused: isPaused,
      videoLink: videoLink
    });
  }
}

function showStatus(message, type = '') {
  statusDiv.textContent = message;
  statusDiv.className = 'status';
  
  if (type) {
    statusDiv.classList.add(type);
  }
  
  // Clear status after 5 seconds
  setTimeout(() => {
    statusDiv.textContent = '';
    statusDiv.className = 'status';
  }, 5000);
}

function generateRoomId() {
  // Generate a unique room ID using timestamp and random string
  const timestamp = new Date().getTime().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 8);
  return `room-${timestamp}-${randomStr}`;
}

function updateParticipants(participants) {
  participantsDiv.innerHTML = '<h3>Participants:</h3>';
  
  participants.forEach(participant => {
    const el = document.createElement('span');
    el.className = 'participant';
    el.textContent = participant;
    participantsDiv.appendChild(el);
  });
}

// Socket.io Event Handlers
socket.on('room-joined', (data) => {
  updateParticipants(data.participants);
  showStatus(`${data.username} joined the room`, 'success');
});

socket.on('room-left', (data) => {
  updateParticipants(data.participants);
  showStatus(`${data.username} left the room`, 'success');
});

socket.on('video-set', (data) => {
  videoLinkInput.value = data.videoLink;
  
  // Handle the video based on its type
  handleVideoEmbed(data.videoLink);
  playerContainerDiv.classList.remove('hidden');
  
  showStatus(`Video set by ${data.setBy}`, 'success');
});

socket.on('video-play', () => {
  isSyncingVideo = true;
  
  if (videoType === 'direct') {
    const videoPlayer = document.getElementById('video-player');
    const playPauseButton = document.getElementById('play-pause');
    
    if (videoPlayer) {
      videoPlayer.play()
        .then(() => {
          if (playPauseButton) playPauseButton.innerHTML = '<i class="fas fa-pause"></i> Pause';
          isSyncingVideo = false;
        })
        .catch(error => {
          console.error('Error playing video:', error);
          isSyncingVideo = false;
        });
    } else {
      isSyncingVideo = false;
    }
  } else if (videoType === 'youtube' && youtubePlayer) {
    youtubePlayer.playVideo();
    isSyncingVideo = false;
  } else {
    isSyncingVideo = false;
  }
});

socket.on('video-pause', () => {
  isSyncingVideo = true;
  
  if (videoType === 'direct') {
    const videoPlayer = document.getElementById('video-player');
    const playPauseButton = document.getElementById('play-pause');
    
    if (videoPlayer) {
      videoPlayer.pause();
      if (playPauseButton) playPauseButton.innerHTML = '<i class="fas fa-play"></i> Play';
    }
  } else if (videoType === 'youtube' && youtubePlayer) {
    youtubePlayer.pauseVideo();
  }
  
  isSyncingVideo = false;
});

socket.on('video-seek', (data) => {
  isSyncingVideo = true;
  
  if (videoType === 'direct') {
    const videoPlayer = document.getElementById('video-player');
    if (videoPlayer) {
      videoPlayer.currentTime = data.currentTime;
    }
  } else if (videoType === 'youtube' && youtubePlayer) {
    youtubePlayer.seekTo(data.currentTime, true);
  }
  
  isSyncingVideo = false;
});

socket.on('sync-request', (data) => {
  sendCurrentVideoState();
});

socket.on('sync-response', (data) => {
  isSyncingVideo = true;
  
  // If we don't have the video yet, set it
  const currentVideoSrc = videoType === 'direct' ? 
    (document.getElementById('video-player')?.src || '') : 
    (document.getElementById('video-frame')?.src || '');
    
  if (!currentVideoSrc || currentVideoSrc !== data.videoLink) {
    handleVideoEmbed(data.videoLink);
    videoLinkInput.value = data.videoLink;
    playerContainerDiv.classList.remove('hidden');
    
    // Give a moment for the video to load before trying to sync time
    setTimeout(() => syncVideoTime(data), 1000);
    return;
  }
  
  syncVideoTime(data);
});

function syncVideoTime(data) {
  if (videoType === 'direct') {
    const videoPlayer = document.getElementById('video-player');
    if (videoPlayer) {
      // Set the current time
      videoPlayer.currentTime = data.currentTime;
      
      // Play or pause based on the sync response
      if (data.isPaused) {
        videoPlayer.pause();
        if (playPauseButton) playPauseButton.innerHTML = '<i class="fas fa-play"></i> Play';
      } else {
        videoPlayer.play()
          .then(() => {
            if (playPauseButton) playPauseButton.innerHTML = '<i class="fas fa-pause"></i> Pause';
          })
          .catch(error => {
            console.error('Error playing video:', error);
          });
      }
    }
  } else if (videoType === 'youtube' && youtubePlayer) {
    // For YouTube videos
    youtubePlayer.seekTo(data.currentTime, true);
    
    if (data.isPaused) {
      youtubePlayer.pauseVideo();
    } else {
      youtubePlayer.playVideo();
    }
  }
  
  isSyncingVideo = false;
  showStatus('Synchronized with room', 'success');
}

socket.on('connect_error', () => {
  showStatus('Connection error. Please try again later.', 'error');
});

// Process video link to get proper embed URL
function processVideoLink(url) {
  // YouTube
  if (url.includes('youtube.com/watch') || url.includes('youtu.be/')) {
    let videoId = '';
    
    if (url.includes('youtube.com/watch')) {
      const urlParams = new URLSearchParams(new URL(url).search);
      videoId = urlParams.get('v');
    } else if (url.includes('youtu.be/')) {
      videoId = url.split('youtu.be/')[1].split('?')[0];
    }
    
    if (videoId) {
      return `https://www.youtube.com/embed/${videoId}?enablejsapi=1&autoplay=1&controls=1`;
    }
  }
  
  // Vimeo
  if (url.includes('vimeo.com/')) {
    const vimeoId = url.split('vimeo.com/')[1].split('?')[0].split('/')[0];
    if (vimeoId) {
      return `https://player.vimeo.com/video/${vimeoId}?autoplay=1`;
    }
  }
  
  // Dailymotion
  if (url.includes('dailymotion.com/video/')) {
    const dmId = url.split('dailymotion.com/video/')[1].split('?')[0];
    if (dmId) {
      return `https://www.dailymotion.com/embed/video/${dmId}?autoplay=1`;
    }
  }
  
  // For direct video files (mp4, webm, etc.)
  if (url.match(/\.(mp4|webm|ogg)$/i)) {
    return url;
  }
  
  // If we can't process it, return the original URL
  return url;
}

// Handle video embedding based on URL
function handleVideoEmbed(url) {
  // Clear the player container first
  const playerContainer = document.getElementById('player-container');
  
  // If it's a YouTube embed URL
  if (url.includes('youtube.com/embed/')) {
    videoType = 'youtube';
    
    // Extract video ID for YouTube API
    const videoId = url.split('youtube.com/embed/')[1].split('?')[0];
    
    // Replace video player with YouTube iframe API
    playerContainer.innerHTML = `
      <div class="video-wrapper">
        <div id="youtube-player"></div>
      </div>
      <div class="controls">
        <button id="sync-video">Sync with Room</button>
      </div>
    `;
    
    // Load YouTube API if not already loaded
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
      
      window.onYouTubeIframeAPIReady = function() {
        createYouTubePlayer(videoId);
      };
    } else {
      createYouTubePlayer(videoId);
    }
    
    // Re-attach sync button event listener
    document.getElementById('sync-video').addEventListener('click', requestSync);
  }
  // If it's a Vimeo or Dailymotion embed URL
  else if (url.includes('player.vimeo.com/video/') || 
      url.includes('dailymotion.com/embed/')) {
    
    videoType = 'embed';
    
    // Replace video player with iframe
    playerContainer.innerHTML = `
      <div class="video-wrapper">
        <iframe 
          id="video-frame" 
          src="${url}" 
          frameborder="0" 
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
          allowfullscreen>
        </iframe>
      </div>
      <div class="controls">
        <button id="sync-video">Sync with Room</button>
      </div>
    `;
    
    // Re-attach sync button event listener
    document.getElementById('sync-video').addEventListener('click', requestSync);
    
  } else if (url.match(/\.(mp4|webm|ogg)$/i)) {
    // It's a direct video file, use the video element
    videoType = 'direct';
    
    playerContainer.innerHTML = `
      <video id="video-player" controls></video>
      <div class="controls">
        <button id="play-pause">Play</button>
        <button id="sync-video">Sync with Room</button>
      </div>
    `;
    
    // Re-attach event listeners
    const videoPlayer = document.getElementById('video-player');
    const playPauseButton = document.getElementById('play-pause');
    const syncButton = document.getElementById('sync-video');
    
    videoPlayer.src = url;
    
    playPauseButton.addEventListener('click', togglePlayPause);
    syncButton.addEventListener('click', requestSync);
    
    videoPlayer.addEventListener('play', () => {
      if (!isSyncingVideo) {
        socket.emit('video-play', { roomId: currentRoom });
        playPauseButton.textContent = 'Pause';
      }
    });
    
    videoPlayer.addEventListener('pause', () => {
      if (!isSyncingVideo) {
        socket.emit('video-pause', { roomId: currentRoom });
        playPauseButton.textContent = 'Play';
      }
    });
    
    videoPlayer.addEventListener('seeked', () => {
      if (!isSyncingVideo) {
        socket.emit('video-seek', { 
          roomId: currentRoom, 
          currentTime: videoPlayer.currentTime 
        });
      }
    });
  } else {
    // For other types of URLs, show a message
    showStatus('This video format may not be supported. Try a YouTube, Vimeo, or direct MP4 link.', 'error');
  }
}

// Create YouTube player using the YouTube iframe API
function createYouTubePlayer(videoId) {
  youtubePlayer = new YT.Player('youtube-player', {
    height: '100%',
    width: '100%',
    videoId: videoId,
    playerVars: {
      'playsinline': 1,
      'autoplay': 1,
      'controls': 1
    },
    events: {
      'onReady': onYouTubePlayerReady,
      'onStateChange': onYouTubePlayerStateChange
    }
  });
}

// YouTube player event handlers
function onYouTubePlayerReady(event) {
  // Player is ready
  showStatus('YouTube player ready', 'success');
}

function onYouTubePlayerStateChange(event) {
  if (isSyncingVideo) return;
  
  const playerState = event.data;
  
  // YT.PlayerState.PLAYING = 1
  // YT.PlayerState.PAUSED = 2
  if (playerState === 1) { // Playing
    socket.emit('video-play', { roomId: currentRoom });
  } else if (playerState === 2) { // Paused
    socket.emit('video-pause', { roomId: currentRoom });
  }
  
  // Send current time periodically when playing
  if (playerState === 1) {
    socket.emit('video-seek', {
      roomId: currentRoom,
      currentTime: youtubePlayer.getCurrentTime()
    });
  }
}

// Add CSS animation to the stylesheet
const style = document.createElement('style');
style.textContent = `
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  
  @keyframes pulse {
    0% { transform: scale(1); }
    50% { transform: scale(1.05); }
    100% { transform: scale(1); }
  }
`;
document.head.appendChild(style);

// Initialize the app
init();
