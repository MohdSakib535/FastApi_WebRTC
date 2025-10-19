from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from app.routers import webrtc
import os

app = FastAPI(title="WebRTC FastAPI Video Chat")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

static_path = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=static_path), name="static")

app.include_router(webrtc.router)

@app.get("/")
async def read_root():
    return FileResponse(os.path.join(static_path, "index.html"))

@app.get("/config")
async def rtc_config():
    """Expose ICE server config to the frontend.

    Environment variables (optional):
    - TURN_URL: e.g. stun:stun.l.google.com:19302 or turn:turn.example.com:3478
    - TURN_USERNAME
    - TURN_PASSWORD
    """
    ice_servers = [
        {"urls": "stun:stun.l.google.com:19302"},
        {"urls": "stun:stun1.l.google.com:19302"},
    ]

    turn_url = os.getenv("TURN_URL")
    turn_username = os.getenv("TURN_USERNAME")
    turn_password = os.getenv("TURN_PASSWORD")

    if turn_url and turn_username and turn_password:
        ice_servers.append({
            "urls": turn_url,
            "username": turn_username,
            "credential": turn_password,
        })

    return {"iceServers": ice_servers}

@app.get("/health")
async def health_check():
    return {"status": "healthy", "message": "WebRTC server is running"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
