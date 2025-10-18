# WebRTC FastAPI Video Chat

A real-time peer-to-peer video chat application built with FastAPI and WebRTC.

## Features

- 🎥 Real-time video and audio communication
- 🔒 Room-based private conversations
- 🌐 WebSocket signaling server
- 📱 Responsive design
- 🎛️ Media controls (mute/unmute, video on/off)
- 👥 Multiple participants support
- 🐳 Docker support

## Quick Start with Docker

### Prerequisites

- Docker and Docker Compose installed
- A webcam and microphone
- Modern web browser

### Run the Application

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

Access: http://localhost:8000

## Manual Setup (without Docker)

### 1. Create Virtual Environment

```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Run the Application

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Usage

1. Open http://localhost:8000 in your browser
2. Allow camera and microphone permissions
3. Enter a room name
4. Click "Join Room"
5. Share the room name with others
6. Start video chatting!

## Testing Locally

Open two browser tabs:
- Tab 1: Enter room "test-room" and join
- Tab 2: Enter same room "test-room" and join
- Both tabs should connect and show video

## Docker Commands

```bash
# Build
docker-compose build

# Start
docker-compose up -d

# Stop
docker-compose down

# View logs
docker-compose logs -f

# Restart
docker-compose restart

# Remove everything
docker-compose down -v
```

## Project Structure

```
webrtc-fastapi/
├── app/
│   ├── main.py              # FastAPI app
│   ├── models.py            # Data models
│   ├── routers/
│   │   └── webrtc.py        # WebSocket endpoints
│   ├── services/
│   └── static/
│       ├── css/
│       │   └── style.css
│       ├── js/
│       │   └── webrtc.js
│       └── index.html
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
└── README.md
```

## Configuration

Edit `.env` file:

```
STUN_SERVER=stun:stun.l.google.com:19302
HOST=0.0.0.0
PORT=8000
```

## Troubleshooting

### Camera not working
- Check browser permissions
- Use HTTPS in production
- Try different browser

### Port already in use
```bash
# Use different port
docker-compose up -d -e PORT=8001
```

### Connection failed
- Ensure both users in same room
- Check firewall settings
- View logs: `docker-compose logs -f`

## Production Deployment

For production use:
1. Use HTTPS (WebRTC requires secure context)
2. Add TURN servers for NAT traversal
3. Implement authentication
4. Set up monitoring

## License

MIT License

## Support

For issues, please check the logs and browser console (F12).
EOF

# Create Makefile
echo "🔧 Creating Makefile..."
cat > Makefile << 'EOF'
.PHONY: build up down restart logs clean dev help

help:
	@echo "WebRTC FastAPI - Available commands:"
	@echo "  make build    - Build Docker image"
	@echo "  make up       - Start containers (detached)"
	@echo "  make dev      - Start containers (foreground)"
	@echo "  make down     - Stop containers"
	@echo "  make restart  - Restart containers"
	@echo "  make logs     - View logs"
	@echo "  make clean    - Remove all containers and volumes"
	@echo "  make shell    - Enter container shell"

build:
	docker-compose build

up:
	docker-compose up -d
	@echo "✅ Application started at http://localhost:8000"

dev:
	docker-compose up

down:
	docker-compose down

restart:
	docker-compose restart

logs:
	docker-compose logs -f

clean:
	docker-compose down -v
	docker system prune -f

shell:
	docker-compose exec webrtc-app /bin/bash