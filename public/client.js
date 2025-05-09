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

// Chat elements
const chatContainerDiv = document.getElementById('chat-container');
const chatMessagesDiv = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendMessageButton = document.getElementById('send-message');
const toggleMicButton = document.getElementById('toggle-mic');
const toggleAudioButton = document.getElementById('toggle-audio');

// App State
let currentRoom = '';
let username = '';
let isSyncingVideo = false;
let videoType = 'direct'; // 'direct' or 'embed'
let youtubePlayer = null;

// Voice chat state
let micEnabled = false;
let audioEnabled = true;
let peerConnections = {};
let localStream = null;
let mediaConstraints = {
  audio: true,
  video: false
};

// Initialize
function init() {
  // Clear all input fields on first load
  roomIdInput.value = '';
  usernameInput.value = '';
  videoLinkInput.value = '';
  
  // Check for mobile device
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  if (isMobile) {
    document.body.classList.add('mobile-device');
    // Add mobile detection message
    showStatus('Mobile device detected. Optimizing for better performance.', 'info');
  }
  
  // Check for first time visit
  const firstVisit = localStorage.getItem('watchparty_visited') !== 'true';
  
  if (firstVisit) {
    // First time visitor - set the flag for future visits
    localStorage.setItem('watchparty_visited', 'true');
    
    // Clear any old data
    localStorage.removeItem('watchparty_room');
    localStorage.removeItem('watchparty_username');
  } else {
    // Returning visitor - we could load saved data, but per request, we'll keep fields empty
    // Uncomment below if you want to restore previous session values
    /*
    const savedRoom = localStorage.getItem('watchparty_room');
    const savedName = localStorage.getItem('watchparty_username');
    
    if (savedRoom && savedName) {
      roomIdInput.value = savedRoom;
      usernameInput.value = savedName;
    }
    */
  }
  
  // Check network speed to optimize video quality
  checkNetworkSpeed();
}

// Event Listeners
joinRoomButton.addEventListener('click', joinRoom);
setVideoButton.addEventListener('click', setVideo);
playPauseButton.addEventListener('click', togglePlayPause);
syncButton.addEventListener('click', requestSync);
copyRoomButton.addEventListener('click', copyRoomId);

// Chat event listeners
sendMessageButton.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
});

// Voice chat event listeners
toggleMicButton.addEventListener('click', toggleMicrophone);
toggleAudioButton.addEventListener('click', toggleAudio);

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
  
  try {
    // Process the video link to get embed URL if needed
    const processedLink = processVideoLink(videoLink);
    
    // First check if the URL is valid
    if (!processedLink) {
      showStatus('Unable to process video URL. Please check the link format.', 'error');
      return;
    }
    
    // Preview the video locally first to verify it works
    handleVideoEmbed(processedLink);
    playerContainerDiv.classList.remove('hidden');
    
    // Then send to others in the room
    socket.emit('set-video', { 
      roomId: currentRoom, 
      videoLink: processedLink, 
      setBy: username 
    });
  } catch (error) {
    console.error('Error setting video:', error);
    showStatus('Error processing video URL: ' + error.message, 'error');
  }
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
    // Store user ID for peer connections
    const userId = Object.keys(rooms.get(currentRoom)?.participants || {})
      .find(id => rooms.get(currentRoom)?.participants.get(id) === participant);
    if (userId) {
      el.dataset.userId = userId;
    }
    participantsDiv.appendChild(el);
  });
}

// Socket.io Event Handlers
socket.on('room-joined', (data) => {
  updateParticipants(data.participants);
  showStatus(`${data.username} joined the room`, 'success');
  
  // Show chat container
  chatContainerDiv.classList.remove('hidden');
  
  // Request sync from other participants to make sure we're in sync
  // Small delay to ensure connection is fully established
  setTimeout(() => {
    console.log('Requesting initial sync after joining room');
    requestSync();
  }, 1000);
  
  // If microphone is enabled, connect to the new peer
  if (micEnabled && localStream) {
    // The new user ID should be in the updated participants list
    // We'll connect to them from our end
    connectToPeers();
  }
});

socket.on('room-left', (data) => {
  updateParticipants(data.participants);
  showStatus(`${data.username} left the room`, 'success');
});

socket.on('video-set', (data) => {
  console.log(`Received video-set event: ${data.videoLink} by ${data.setBy}`);
  videoLinkInput.value = data.videoLink;
  
  // Handle the video based on its type
  handleVideoEmbed(data.videoLink);
  playerContainerDiv.classList.remove('hidden');
  
  showStatus(`Video set by ${data.setBy}`, 'success');
  
  // Request synchronization after a short delay to ensure video is loaded
  setTimeout(() => {
    console.log('Requesting sync after video set');
    requestSync();
  }, 2000);
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
  try {
    // Try to create a URL object to validate the URL
    // This will throw an error if the URL is invalid
    let validatedUrl;
    try {
      validatedUrl = new URL(url);
    } catch (e) {
      // If it's not a valid URL, try adding https:// prefix
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        validatedUrl = new URL('https://' + url);
        url = 'https://' + url;
      } else {
        throw new Error('Invalid URL format');
      }
    }

    // YouTube
    if (url.includes('youtube.com/watch') || url.includes('youtu.be/')) {
      let videoId = '';
      
      if (url.includes('youtube.com/watch')) {
        const urlParams = new URLSearchParams(new URL(url).search);
        videoId = urlParams.get('v');
      } else if (url.includes('youtu.be/')) {
        videoId = url.split('youtu.be/')[1];
        if (videoId.includes('?')) {
          videoId = videoId.split('?')[0];
        }
      }
      
      if (videoId) {
        return `https://www.youtube.com/embed/${videoId}?enablejsapi=1&autoplay=1&controls=1`;
      }
    }
    
    // Vimeo
    if (url.includes('vimeo.com/')) {
      // Handle regular vimeo URLs
      let vimeoId = '';
      const vimeoRegex = /vimeo\.com\/(?:video\/)?([0-9]+)/;
      const match = url.match(vimeoRegex);
      
      if (match && match[1]) {
        vimeoId = match[1];
      } else {
        vimeoId = url.split('vimeo.com/')[1];
        if (vimeoId && vimeoId.includes('?')) {
          vimeoId = vimeoId.split('?')[0];
        }
        if (vimeoId && vimeoId.includes('/')) {
          vimeoId = vimeoId.split('/')[0];
        }
      }
      
      if (vimeoId) {
        return `https://player.vimeo.com/video/${vimeoId}?autoplay=1`;
      }
    }
    
    // Dailymotion
    if (url.includes('dailymotion.com/video/')) {
      const dmId = url.split('dailymotion.com/video/')[1];
      if (dmId && dmId.includes('?')) {
        return `https://www.dailymotion.com/embed/video/${dmId.split('?')[0]}?autoplay=1`;
      } else {
        return `https://www.dailymotion.com/embed/video/${dmId}?autoplay=1`;
      }
    }
    
    // For direct video files (mp4, webm, etc.)
    if (url.match(/\.(mp4|webm|ogg|mov|mkv)$/i)) {
      return url;
    }

    // For Facebook videos
    if (url.includes('facebook.com/watch') || url.includes('fb.watch')) {
      // Facebook doesn't allow embeds via iframe, so we'll just return a message
      showStatus('Facebook videos cannot be embedded directly. Please use YouTube, Vimeo, or direct video links.', 'error');
      return null;
    }
    
    // Try to detect if it's a video file hosted on a server
    if (url.includes('.mp4') || url.includes('.webm') || url.includes('.ogg') || 
        url.includes('.mov') || url.includes('.mkv')) {
      return url;
    }
    
    // If we can't process it, return the original URL with a warning
    showStatus('Unknown video format. The video may not play correctly.', 'warning');
    return url;
  } catch (error) {
    console.error('Error processing video URL:', error);
    showStatus('Invalid video URL format. Please check the link.', 'error');
    return null;
  }
}

// Handle video embedding based on URL
function handleVideoEmbed(url) {
  // Clear the player container first
  const playerContainer = document.getElementById('player-container');
  
  // Detect if user is on mobile
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  
  // If it's a YouTube embed URL
  if (url.includes('youtube.com/embed/')) {
    videoType = 'youtube';
    
    // Extract video ID for YouTube API
    const videoId = url.split('youtube.com/embed/')[1].split('?')[0];
    
    // Add mobile-specific optimization parameters for YouTube
    let embedUrl = url;
    if (isMobile && !url.includes('playsinline=1')) {
      embedUrl = url + (url.includes('?') ? '&' : '?') + 'playsinline=1&rel=0&modestbranding=1&controls=1';
    }
    
    // Replace video player with YouTube iframe API
    playerContainer.innerHTML = `
      <div class="video-wrapper">
        <div id="youtube-player"></div>
      </div>
      <div class="controls">
        <button id="sync-video">Sync with Room</button>
        <div class="mobile-indicator ${isMobile ? 'visible' : 'hidden'}">Mobile mode: optimized playback</div>
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
    
  } else if (url.match(/\.(mp4|webm|ogg|mov|m3u8)$/i) || url.includes('.mp4') || url.includes('video')) {
    // It's a direct video file, use the video element
    videoType = 'direct';
    
    // Enhanced video player with mobile optimizations
    playerContainer.innerHTML = `
      <video id="video-player" controls playsinline preload="auto"></video>
      <div class="controls">
        <button id="play-pause">Play</button>
        <button id="sync-video">Sync with Room</button>
        <div class="mobile-indicator ${isMobile ? 'visible' : 'hidden'}">Mobile mode: optimized playback</div>
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
    // Try to handle other types of URLs as general media
    // First, check if it's a direct video file that wasn't caught earlier
    if (url.includes('.mp4') || url.includes('.webm') || url.includes('.ogg') || 
        url.includes('.mov') || url.includes('.m3u8')) {
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

      // Add error handling for video
      videoPlayer.addEventListener('error', (e) => {
        console.error('Video error:', videoPlayer.error);
        showStatus(`Error loading video: ${videoPlayer.error?.message || 'Unknown error'}`, 'error');
      });
    } else {
      // Last resort: try to use an iframe for any other URL
      videoType = 'embed';
      
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
        <div class="warning-message">
          <p>This video source may not work correctly. If you have issues, try YouTube, Vimeo, or direct video links.</p>
        </div>
      `;
      
      // Re-attach sync button event listener
      document.getElementById('sync-video').addEventListener('click', requestSync);
    }
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

// Chat Functions
function sendChatMessage() {
  const message = chatInput.value.trim();
  
  if (!message) return;
  
  // Send chat message to server
  socket.emit('chat-message', {
    roomId: currentRoom,
    message,
    sender: username
  });
  
  // Clear input
  chatInput.value = '';
}

function addChatMessage(messageObj) {
  const { sender, message, timestamp, senderId } = messageObj;
  
  // Create message element
  const messageEl = document.createElement('div');
  messageEl.classList.add('message');
  messageEl.classList.add(senderId === socket.id ? 'from-me' : 'from-other');
  
  // Add sender name (except for own messages)
  if (senderId !== socket.id) {
    const senderEl = document.createElement('div');
    senderEl.classList.add('sender');
    senderEl.textContent = sender;
    messageEl.appendChild(senderEl);
  }
  
  // Add message text
  const textEl = document.createElement('div');
  textEl.classList.add('text');
  textEl.textContent = message;
  messageEl.appendChild(textEl);
  
  // Add timestamp
  const timeEl = document.createElement('div');
  timeEl.classList.add('time');
  timeEl.textContent = formatTimestamp(timestamp);
  messageEl.appendChild(timeEl);
  
  // Add to chat container
  chatMessagesDiv.appendChild(messageEl);
  
  // Scroll to bottom
  chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Voice Chat Functions
async function startMicrophone() {
  if (localStream) {
    stopLocalStream(); // Clean up existing stream first
  }
  
  showStatus('Requesting microphone access...', 'info');
  
  // Optimized audio constraints for voice chat
  const audioConstraints = {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: 48000,
      channelCount: 1,
      latency: 0,
      volume: 1.0
    },
    video: false
  };
  
  try {
    const stream = await navigator.mediaDevices.getUserMedia(audioConstraints);
    
    // Set up audio processing
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const sourceNode = audioContext.createMediaStreamSource(stream);
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 1.0; // Adjust volume if needed
    
    // Add some audio processing for better quality
    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = -50;
    compressor.knee.value = 40;
    compressor.ratio.value = 12;
    compressor.attack.value = 0;
    compressor.release.value = 0.25;
    
    // Connect the audio nodes
    sourceNode.connect(gainNode);
    gainNode.connect(compressor);
    compressor.connect(audioContext.destination);
    
    localStream = stream;
    
    // Set microphone state
    micEnabled = true;
    toggleMicButton.innerHTML = '<i class="fas fa-microphone"></i>';
    toggleMicButton.classList.add('active');
    showStatus('Microphone enabled', 'success');
    
    // Close any existing peer connections
    Object.keys(peerConnections).forEach(peerId => {
      if (peerConnections[peerId]) {
        peerConnections[peerId].close();
        delete peerConnections[peerId];
      }
    });
    
    // Connect to all participants
    await connectToPeers();
    
    // Notify others that mic is on
    socket.emit('voice-state-change', {
      roomId: currentRoom,
      isMuted: false
    });
    
    // Monitor audio levels for activity
    const audioAnalyser = audioContext.createAnalyser();
    compressor.connect(audioAnalyser);
    audioAnalyser.fftSize = 256;
    const bufferLength = audioAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    function checkAudioLevel() {
      if (!micEnabled) return;
      
      audioAnalyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / bufferLength;
      
      // Visual feedback when speaking
      if (average > 30) {
        toggleMicButton.classList.add('speaking');
      } else {
        toggleMicButton.classList.remove('speaking');
      }
      
      requestAnimationFrame(checkAudioLevel);
    }
    
    checkAudioLevel();
    
  } catch (error) {
    console.error('Error accessing microphone:', error);
    micEnabled = false;
    toggleMicButton.classList.remove('active');
    
    // Show more detailed error to user
    if (error.name === 'NotAllowedError') {
      showStatus('Microphone access denied. Please allow microphone access in your browser settings.', 'error');
    } else if (error.name === 'NotFoundError') {
      showStatus('No microphone found. Please connect a microphone and try again.', 'error');
    } else {
      showStatus(`Microphone error: ${error.message}`, 'error');
    }
  }
}

function toggleMicrophone() {
  if (micEnabled) {
    // Turn off microphone
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }
    
    micEnabled = false;
    toggleMicButton.innerHTML = '<i class="fas fa-microphone-slash"></i>';
    toggleMicButton.classList.remove('active');
    showStatus('Microphone disabled', 'info');
    
    // Notify others that mic is off
    socket.emit('voice-state-change', {
      roomId: currentRoom,
      isMuted: true
    });
  } else {
    startMicrophone();
  }
}

function toggleAudio() {
  audioEnabled = !audioEnabled;
  
  if (audioEnabled) {
    toggleAudioButton.innerHTML = '<i class="fas fa-volume-up"></i>';
    toggleAudioButton.classList.add('active');
    showStatus('Audio enabled', 'success');
  } else {
    toggleAudioButton.innerHTML = '<i class="fas fa-volume-mute"></i>';
    toggleAudioButton.classList.remove('active');
    showStatus('Audio disabled', 'success');
  }
  
  // Update all remote audio elements
  document.querySelectorAll('audio.remote-audio').forEach(audio => {
    audio.muted = !audioEnabled;
  });
}

async function startLocalStream() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
    return true;
  } catch (error) {
    console.error('Error accessing media devices.', error);
    throw error;
  }
}

function stopLocalStream() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  
  // Close all peer connections
  Object.values(peerConnections).forEach(pc => pc.close());
  peerConnections = {};
}

function createPeerConnection(peerId) {
  if (peerConnections[peerId]) {
    console.log(`Closing existing connection to ${peerId}`);
    peerConnections[peerId].close();
    delete peerConnections[peerId];
  }
  
  console.log(`Creating peer connection to ${peerId}`);
  
  // Create a new RTCPeerConnection with improved configuration
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun1.l.google.com:19302' },
      { urls: 'stun2.l.google.com:19302' },
      { urls: 'stun3.l.google.com:19302' },
      { urls: 'stun4.l.google.com:19302' }
    ],
    iceTransportPolicy: 'all',
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    iceCandidatePoolSize: 10
  });
  
  // Store the connection
  peerConnections[peerId] = pc;
  
  // Add local stream tracks to peer connection
  if (localStream) {
    try {
      localStream.getTracks().forEach(track => {
        console.log(`Adding track to peer connection: ${track.kind}`);
        pc.addTrack(track, localStream);
      });
    } catch (error) {
      console.error('Error adding tracks to peer connection:', error);
    }
  } else {
    console.warn('No local stream available when creating peer connection');
  }
  
  // ICE candidate event
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      console.log('Sending ICE candidate');
      socket.emit('voice-signal', {
        roomId: currentRoom,
        to: peerId,
        signal: {
          type: 'ice-candidate',
          candidate: event.candidate
        }
      });
    }
  };
  
  // ICE connection state change
  pc.oniceconnectionstatechange = () => {
    console.log(`ICE connection state with ${peerId}: ${pc.iceConnectionState}`);
    if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
      console.log('Attempting to restart ICE');
      pc.restartIce();
    }
  };
  
  // Stream received event
  pc.ontrack = (event) => {
    console.log(`Received ${event.streams.length} streams from ${peerId}`);
    if (!document.getElementById(`audio-${peerId}`)) {
      const audioEl = document.createElement('audio');
      audioEl.id = `audio-${peerId}`;
      audioEl.className = 'remote-audio';
      audioEl.autoplay = true;
      audioEl.playsInline = true;
      audioEl.muted = !audioEnabled;
      document.body.appendChild(audioEl);
      
      // Add audio visualization
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(event.streams[0]);
      const analyser = audioContext.createAnalyser();
      source.connect(analyser);
      
      // Visual feedback when receiving audio
      const participantEl = document.querySelector(`[data-user-id="${peerId}"]`);
      if (participantEl) {
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        function checkAudio() {
          if (!audioEnabled) return;
          analyser.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b) / bufferLength;
          
          if (average > 30) {
            participantEl.classList.add('speaking');
          } else {
            participantEl.classList.remove('speaking');
          }
          
          requestAnimationFrame(checkAudio);
        }
        
        checkAudio();
      }
    }
    
    const audioEl = document.getElementById(`audio-${peerId}`);
    if (audioEl.srcObject !== event.streams[0]) {
      audioEl.srcObject = event.streams[0];
      console.log('Updated remote stream source');
      
      // Ensure audio is playing
      audioEl.play().catch(error => {
        console.error('Error playing remote audio:', error);
      });
    }
  };
  
  // Create and send offer with audio preferences
  const offerOptions = {
    offerToReceiveAudio: true,
    offerToReceiveVideo: false,
    voiceActivityDetection: true
  };
  
  pc.createOffer(offerOptions)
    .then(offer => {
      // Modify SDP to prioritize audio quality
      offer.sdp = offer.sdp.replace('useinbandfec=1', 'useinbandfec=1; stereo=1; maxaveragebitrate=510000');
      return pc.setLocalDescription(offer);
    })
    .then(() => {
      console.log('Sending offer to peer');
      socket.emit('voice-signal', {
        roomId: currentRoom,
        to: peerId,
        signal: {
          type: 'offer',
          sdp: pc.localDescription
        }
      });
    })
    .catch(error => {
      console.error('Error creating/sending offer:', error);
    });
  
  return pc;
}

function connectToPeers() {
  if (!micEnabled || !localStream) return;
  
  // Connect to all existing participants
  const participantEls = participantsDiv.querySelectorAll('.participant');
  participantEls.forEach(el => {
    const peerId = el.dataset.userId;
    if (peerId && peerId !== socket.id && !peerConnections[peerId]) {
      createPeerConnection(peerId);
    }
  });
}

// Add socket handlers for chat messages
socket.on('chat-message', (messageObj) => {
  addChatMessage(messageObj);
});

socket.on('chat-history', (data) => {
  // Clear existing messages
  chatMessagesDiv.innerHTML = '';
  
  // Add all messages from history
  data.messages.forEach(msg => {
    addChatMessage(msg);
  });
  
  // Scroll to bottom
  chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
});

socket.on('show-chat', () => {
  chatContainerDiv.classList.remove('hidden');
});

// Voice chat signal handlers
socket.on('voice-signal', (data) => {
  const { signal, from } = data;
  
  if (!peerConnections[from] && signal.type === 'offer') {
    // Create a new peer connection if we receive an offer
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });
    
    peerConnections[from] = pc;
    
    // Add local stream tracks if microphone is enabled
    if (micEnabled && localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }
    
    // ICE candidate event
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('voice-signal', {
          roomId: currentRoom,
          to: from,
          signal: {
            type: 'ice-candidate',
            candidate: event.candidate
          }
        });
      }
    };
    
    // Stream received event
    pc.ontrack = (event) => {
      if (!document.getElementById(`audio-${from}`)) {
        const audioEl = document.createElement('audio');
        audioEl.id = `audio-${from}`;
        audioEl.className = 'remote-audio';
        audioEl.autoplay = true;
        audioEl.muted = !audioEnabled;
        document.body.appendChild(audioEl);
      }
      
      const audioEl = document.getElementById(`audio-${from}`);
      if (audioEl.srcObject !== event.streams[0]) {
        audioEl.srcObject = event.streams[0];
        console.log('Received remote stream');
      }
    };
    
    // Set remote description (the offer)
    pc.setRemoteDescription(new RTCSessionDescription(signal.sdp))
      .then(() => {
        // Create answer
        return pc.createAnswer();
      })
      .then(answer => {
        // Set local description
        return pc.setLocalDescription(answer);
      })
      .then(() => {
        // Send answer back
        socket.emit('voice-signal', {
          roomId: currentRoom,
          to: from,
          signal: {
            type: 'answer',
            sdp: pc.localDescription
          }
        });
      })
      .catch(error => {
        console.error('Error creating answer', error);
      });
  } else if (peerConnections[from] && signal.type === 'answer') {
    // Set remote description (the answer)
    peerConnections[from].setRemoteDescription(new RTCSessionDescription(signal.sdp))
      .catch(error => {
        console.error('Error setting remote description', error);
      });
  } else if (peerConnections[from] && signal.type === 'ice-candidate') {
    // Add ICE candidate
    peerConnections[from].addIceCandidate(new RTCIceCandidate(signal.candidate))
      .catch(error => {
        console.error('Error adding ICE candidate', error);
      });
  }
});

socket.on('voice-state-change', (data) => {
  const { userId, username, isMuted } = data;
  
  // Show audio status message
  const statusMsg = document.createElement('div');
  statusMsg.classList.add('audio-status');
  
  if (isMuted) {
    statusMsg.innerHTML = `<i class="fas fa-microphone-slash"></i> ${username} muted their microphone`;
  } else {
    statusMsg.innerHTML = `<i class="fas fa-microphone"></i> ${username} unmuted their microphone`;
    statusMsg.classList.add('speaking');
  }
  
  chatMessagesDiv.appendChild(statusMsg);
  chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
  
  // Auto-remove the status after a few seconds
  setTimeout(() => {
    statusMsg.remove();
  }, 5000);
});

// Network speed detection for video optimization
function checkNetworkSpeed() {
  // Default to low quality on mobile
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  if (isMobile) {
    window.lowBandwidth = true;
    return;
  }
  
  // Simple network speed test
  const startTime = Date.now();
  const imageUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/1x1.png/100px-1x1.png' + '?r=' + Math.random();
  const downloadSize = 11035; // bytes
  
  const testImage = new Image();
  testImage.onload = function() {
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000; // seconds
    const speedBps = downloadSize * 8 / duration; // bits per second
    const speedKbps = speedBps / 1024; // kilobits per second
    
    console.log(`Network speed: ${Math.round(speedKbps)} Kbps`);
    
    // Set low bandwidth mode if speed is too low
    if (speedKbps < 1000) { // Less than 1 Mbps
      window.lowBandwidth = true;
      showStatus('Low network speed detected. Using optimized video quality.', 'info');
    } else {
      window.lowBandwidth = false;
    }
  };
  
  testImage.onerror = function() {
    // Failed to test speed, assume low bandwidth
    window.lowBandwidth = true;
  };
  
  testImage.src = imageUrl;
}

// Additional helper for mobile devices
function optimizeForMobile() {
  // Detect if we're on a mobile device
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  
  if (isMobile) {
    // Use lower quality video
    if (videoType === 'youtube' && youtubePlayer) {
      youtubePlayer.setPlaybackQuality('small');
    }
    
    // Reduce animation and effects
    document.documentElement.style.setProperty('--transition-speed', '0.1s');
    
    // Enable hardware acceleration
    document.body.style.transform = 'translateZ(0)';
    
    // Add meta viewport for better mobile experience
    if (!document.querySelector('meta[name="viewport"]')) {
      const metaViewport = document.createElement('meta');
      metaViewport.name = 'viewport';
      metaViewport.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no';
      document.head.appendChild(metaViewport);
    }
    
    // Optimize video streaming parameters
    if (videoType === 'direct' && videoPlayer) {
      videoPlayer.preload = 'auto';
      videoPlayer.playsInline = true;
      videoPlayer.autoplay = false;
      videoPlayer.controls = true;
      
      // Set lower buffer size for faster loading
      if (videoPlayer.buffered && videoPlayer.duration) {
        videoPlayer.currentTime = videoPlayer.buffered.end(0) || 0;
      }
    }
  }
  
  return isMobile;
}

// Initialize the app
init();

// Call optimizeForMobile on page load
window.addEventListener('load', optimizeForMobile);
