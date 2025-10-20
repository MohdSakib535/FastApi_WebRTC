from sqlalchemy import Column, Integer, String, Text, DateTime
from datetime import datetime
from .db import Base


class Transcript(Base):
    __tablename__ = "transcripts"

    id = Column(Integer, primary_key=True, index=True)
    room = Column(String(255), index=True, nullable=True)
    client_id = Column(String(255), index=True, nullable=True)
    language = Column(String(32), nullable=True)
    text = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

