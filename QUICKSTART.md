# Quick Start Guide

## For Docker Users (Recommended)

### 1. Make sure Docker is running

```bash
docker --version
docker-compose --version
```

### 2. Start the application

```bash
# Option A: Use the run script
./run.sh

# Option B: Use docker-compose directly
docker-compose up -d

# Option C: Use Makefile
make up
```

### 3. Open your browser

Go to: http://localhost:8000 (or use your machine IP if testing from another device)

### 4. Test it

- Open two browser tabs
- Enter room name "test" in both
- Click "Join Room" in both tabs
- Allow camera/microphone access
- Video chat should connect!

## For Non-Docker Users

### 1. Create virtual environment

```bash
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
```

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Run the server

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 4. Open browser

Go to: http://localhost:8000 (or use your machine IP if testing from another device)

## Test on Another Device (Phone/Tablet)

1. **Find your machine IP**
   - macOS/Linux: `ipconfig getifaddr en0` or `hostname -I`
   - Windows: `ipconfig` and look for the active adapter IPv4 address
2. Ensure your phone/tablet is on the **same Wi-Fi/LAN** as the host machine
3. Browsers require HTTPS (or localhost) for camera/mic access. Create a local TLS cert (see below) or tunnel through a trusted HTTPS service.
4. Start the server (either `./run.sh` or `uvicorn ... --host 0.0.0.0 --port 8000`) and include your cert/key if using HTTPS.
5. On the phone/tablet browser, open `https://<your-machine-ip>:8000` (accept the trust prompt if using a self-signed cert)
6. Allow camera/microphone, join the same room name, and you should connect across devices

### Generate a Dev Certificate with `mkcert`

```bash
brew install mkcert nss            # macOS (use chocolatey or package manager on Windows/Linux)
mkcert -install                    # adds a local CA to the trust store
mkcert your-machine.local 192.168.1.10  # include hostname and LAN IP
```

This creates two files (e.g. `your-machine.local+1.pem` and `your-machine.local+1-key.pem`). Run the server with:

```bash
SSL_CERTFILE=./your-machine.local+1.pem \
SSL_KEYFILE=./your-machine.local+1-key.pem \
./run.sh
```

Then open `https://your-machine.local:8000` or `https://192.168.1.10:8000`. Trust prompts should disappear once the mkcert CA is installed on each device.

### Alternative: Use ngrok for HTTPS Tunnel

If certificate setup feels heavy, ngrok can expose your local server over HTTPS:

```bash
# Terminal 1
./run.sh

# Terminal 2 (ngrok auth token required)
ngrok http 8000
```

Share the generated `https://` forwarding URL with other devices. Since ngrok terminates TLS, browsers allow camera/mic immediately.

## Common Commands

```bash
# View logs
docker-compose logs -f

# Stop application
docker-compose down

# Restart
docker-compose restart

# Enter container
docker-compose exec webrtc-app bash

# Clean everything
docker-compose down -v
```

## Troubleshooting

**Port 8000 in use?**
```bash
# Linux/Mac
lsof -i :8000

# Windows
netstat -ano | findstr :8000
```

**Camera not working?**
- Click camera icon in browser address bar
- Allow permissions (HTTPS required for non-localhost URLs; use mkcert or ngrok)
- Try different browser

**Can't connect to peer?**
- Both users must be in same room name
- Check browser console (F12)
- View server logs: `docker-compose logs -f`

## Success Indicators

✅ Container status shows "Up"
✅ http://localhost:8000 loads
✅ Camera permission granted
✅ Local video appears
✅ After joining same room, remote video appears

Need help? Check README.md for full documentation.
