from pydantic import BaseModel
from typing import Optional, Dict, Any

class SignalingMessage(BaseModel):
    type: str
    room: str
    data: Optional[Dict[str, Any]] = None
    sender_id: Optional[str] = None

class JoinRoomMessage(BaseModel):
    room: str
    client_id: str

class RTCMessage(BaseModel):
    type: str
    room: str
    sender_id: str
    target_id: Optional[str] = None
    data: Dict[str, Any]