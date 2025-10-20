from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, Dict[str, WebSocket]] = {}
        # Track one active recorder per room
        self.room_active_recorder: Dict[str, str] = {}

    async def connect(self, websocket: WebSocket, room: str, client_id: str):
        await websocket.accept()
        if room not in self.active_connections:
            self.active_connections[room] = {}
        self.active_connections[room][client_id] = websocket
        logger.info(f"✅ Client {client_id} joined room {room}")

    def disconnect(self, room: str, client_id: str):
        if room in self.active_connections:
            if client_id in self.active_connections[room]:
                del self.active_connections[room][client_id]
                logger.info(f"❌ Client {client_id} left room {room}")
            if not self.active_connections[room]:
                del self.active_connections[room]
                logger.info(f"🗑️  Room {room} is now empty")
            # If the leaving client was the active recorder, clear it and announce
            if self.room_active_recorder.get(room) == client_id:
                self.room_active_recorder.pop(room, None)

    async def send_to_client(self, message: dict, room: str, client_id: str):
        if room in self.active_connections and client_id in self.active_connections[room]:
            try:
                await self.active_connections[room][client_id].send_json(message)
            except Exception as e:
                logger.error(f"❌ Error sending to client {client_id}: {e}")

    async def broadcast_to_room(self, message: dict, room: str, exclude_client: str = None):
        if room in self.active_connections:
            for client_id, websocket in self.active_connections[room].items():
                if client_id != exclude_client:
                    try:
                        await websocket.send_json(message)
                    except Exception as e:
                        logger.error(f"❌ Error broadcasting to {client_id}: {e}")

    def get_room_clients(self, room: str) -> list:
        if room in self.active_connections:
            return list(self.active_connections[room].keys())
        return []

    def get_active_recorder(self, room: str):
        return self.room_active_recorder.get(room)

manager = ConnectionManager()

@router.websocket("/ws/{room}/{client_id}")
async def websocket_endpoint(websocket: WebSocket, room: str, client_id: str):
    await manager.connect(websocket, room, client_id)
    
    try:
        await manager.broadcast_to_room(
            {
                "type": "user-joined",
                "client_id": client_id,
                "clients": manager.get_room_clients(room)
            },
            room,
            exclude_client=client_id
        )

        await manager.send_to_client(
            {
                "type": "room-clients",
                "clients": manager.get_room_clients(room),
                "active_recorder": manager.get_active_recorder(room)
            },
            room,
            client_id
        )

        while True:
            data = await websocket.receive_json()
            message_type = data.get("type")

            logger.info(f"📨 Received {message_type} from {client_id} in room {room}")

            if message_type == "offer":
                target_id = data.get("target_id")
                await manager.send_to_client(
                    {
                        "type": "offer",
                        "sender_id": client_id,
                        "offer": data.get("offer")
                    },
                    room,
                    target_id
                )

            elif message_type == "answer":
                target_id = data.get("target_id")
                await manager.send_to_client(
                    {
                        "type": "answer",
                        "sender_id": client_id,
                        "answer": data.get("answer")
                    },
                    room,
                    target_id
                )

            elif message_type == "ice-candidate":
                target_id = data.get("target_id")
                await manager.send_to_client(
                    {
                        "type": "ice-candidate",
                        "sender_id": client_id,
                        "candidate": data.get("candidate")
                    },
                    room,
                    target_id
                )
            
            elif message_type == "recording-state":
                want_on = bool(data.get("recording", False))
                current = manager.get_active_recorder(room)
                if want_on:
                    if current and current != client_id:
                        # Deny: someone else is already recording
                        await manager.send_to_client(
                            {
                                "type": "recording-denied",
                                "active_recorder": current,
                            },
                            room,
                            client_id,
                        )
                    else:
                        manager.room_active_recorder[room] = client_id
                        await manager.broadcast_to_room(
                            {
                                "type": "recording-state",
                                "sender_id": client_id,
                                "recording": True,
                                "active_recorder": client_id,
                            },
                            room,
                            exclude_client=None,
                        )
                else:
                    # Turning off only if the sender is the active recorder
                    if current == client_id:
                        manager.room_active_recorder.pop(room, None)
                        await manager.broadcast_to_room(
                            {
                                "type": "recording-state",
                                "sender_id": client_id,
                                "recording": False,
                                "active_recorder": None,
                            },
                            room,
                            exclude_client=None,
                        )

            elif message_type == "transcript-update":
                # Allow transcript only from the active recorder
                if manager.get_active_recorder(room) == client_id:
                    await manager.broadcast_to_room(
                        {
                            "type": "transcript-update",
                            "sender_id": client_id,
                            "buffer": data.get("buffer", ""),
                            "interim": data.get("interim", ""),
                            "language": data.get("language"),
                        },
                        room,
                        exclude_client=None,
                    )

    except WebSocketDisconnect:
        was_recorder = manager.get_active_recorder(room) == client_id
        manager.disconnect(room, client_id)
        await manager.broadcast_to_room(
            {
                "type": "user-left",
                "client_id": client_id
            },
            room
        )
        if was_recorder:
            await manager.broadcast_to_room(
                {
                    "type": "recording-state",
                    "sender_id": client_id,
                    "recording": False,
                    "active_recorder": None,
                },
                room,
            )
    except Exception as e:
        logger.error(f"❌ Error in websocket: {e}")
        manager.disconnect(room, client_id)
