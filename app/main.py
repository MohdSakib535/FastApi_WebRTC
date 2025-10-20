from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from app.routers import webrtc
from app.routers import transcripts
from app.routers import summaries
from app.db import Base, engine
# Ensure models are imported so metadata is populated before create_all
from app import db_models  # noqa: F401
from app.config import settings
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
app.include_router(transcripts.router)
app.include_router(summaries.router)

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
    ice_servers = []
    if settings.STUN_SERVER:
        ice_servers.append({"urls": settings.STUN_SERVER})
    # Always include Google public STUN as fallback
    ice_servers.extend([
        {"urls": "stun:stun.l.google.com:19302"},
        {"urls": "stun:stun1.l.google.com:19302"},
    ])

    turn_url = settings.TURN_URL
    turn_username = settings.TURN_USERNAME
    turn_password = settings.TURN_PASSWORD

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

# Ensure tables are created on startup (simple auto-migrate)
@app.on_event("startup")
def on_startup():
    # Create DB tables if they don't exist
    Base.metadata.create_all(bind=engine)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
