from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, Dict[str, WebSocket]] = {}

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
                "clients": manager.get_room_clients(room)
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

    except WebSocketDisconnect:
        manager.disconnect(room, client_id)
        await manager.broadcast_to_room(
            {
                "type": "user-left",
                "client_id": client_id
            },
            room
        )
    except Exception as e:
        logger.error(f"❌ Error in websocket: {e}")
        manager.disconnect(room, client_id)