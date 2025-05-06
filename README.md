# Football Watchparty App

A real-time synchronized watchparty application for football fans to watch matches together by sharing links.

## Features

- Create or join rooms with unique room IDs
- Paste video links to watch together with friends
- Synchronized playback across all users in the same room
- Real-time participant tracking
- Persistent rooms and video links using SQLite database
- Automatic synchronization when joining existing rooms

## Technologies Used

- **Frontend**: HTML, CSS, JavaScript
- **Backend**: Node.js, Express
- **Real-time Communication**: Socket.io
- **Database**: SQLite

## Installation

1. Make sure you have Node.js installed on your system
2. Install the dependencies:

```bash
npm install
```

## Usage

1. Start the server:

```bash
npm start
```

2. Open your browser and navigate to `http://localhost:3000`

3. Enter your name and either:
   - Leave the room ID field empty to create a new room
   - Enter an existing room ID to join that room

4. Share the room ID with friends so they can join the same room

5. Paste a video link (YouTube, Vimeo, or any other video URL) and click "Set Video"

6. The video will be synchronized for all participants in the room

## How It Works

- Each room has a unique ID generated when created
- When a user joins a room, they are added to the room's participant list
- When a video is set, all participants in the room receive the video link
- Play, pause, and seek events are synchronized across all participants
- If a user joins an existing room with a video already set, they will automatically receive the current video and playback position

## Synchronization

The app uses Socket.io to achieve real-time synchronization:

- When a user plays, pauses, or seeks in the video, the action is broadcast to all other users in the room
- Users can manually request synchronization by clicking the "Sync with Room" button
- When joining a room, the app automatically requests the current video and playback position

## Database

The app uses SQLite to store:

- Room information (ID, video link)
- Participant information (username, room ID)

This allows rooms to persist even if all participants leave and rejoin later.

## License

MIT
