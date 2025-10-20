from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class TranscriptCreate(BaseModel):
    room: Optional[str] = Field(default=None, description="Room name")
    client_id: Optional[str] = Field(default=None, description="Client identifier")
    language: Optional[str] = Field(default="en-US", description="Language code")
    text: str = Field(min_length=1, description="Transcribed text")


class TranscriptRead(BaseModel):
    id: int
    room: Optional[str]
    client_id: Optional[str]
    language: Optional[str]
    text: str
    created_at: datetime

    class Config:
        from_attributes = True

