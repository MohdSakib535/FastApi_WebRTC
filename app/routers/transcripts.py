from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError
import logging

from app.db import get_db
from app.db_models import Transcript
from app.schemas import TranscriptCreate, TranscriptRead

router = APIRouter(prefix="/transcripts", tags=["transcripts"])
logger = logging.getLogger(__name__)


@router.post("", response_model=TranscriptRead)
def create_transcript(payload: TranscriptCreate, db: Session = Depends(get_db)):
    if not payload.text.strip():
        raise HTTPException(status_code=400, detail="Transcript text is empty")

    t = Transcript(
        room=payload.room,
        client_id=payload.client_id,
        language=payload.language,
        text=payload.text.strip(),
    )
    try:
        db.add(t)
        db.commit()
        db.refresh(t)
        logger.info("Saved transcript %s (%d chars) for room=%s client=%s", t.id, len(t.text or ""), t.room, t.client_id)
    except SQLAlchemyError as e:
        db.rollback()
        logger.exception("Failed to save transcript: %s", e)
        raise HTTPException(status_code=500, detail="Database error while saving transcript")
    return t


@router.get("", response_model=list[TranscriptRead])
def list_transcripts(
    room: str | None = Query(None, description="Filter by room"),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    q = db.query(Transcript)
    if room:
        q = q.filter(Transcript.room == room)
    rows = q.order_by(Transcript.id.desc()).limit(limit).all()
    return rows
