from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional
from io import BytesIO
from datetime import datetime

from starlette.responses import Response
from pydantic import BaseModel

from app.db import get_db
from app.db_models import Transcript
from app.services.llm.factory import get_llm_provider

router = APIRouter(prefix="/summaries", tags=["summaries"])


def _concat_transcripts(rows) -> str:
    parts = []
    for r in rows:
        who = r.client_id or "user"
        txt = (r.text or "").strip()
        if not txt:
            continue
        parts.append(f"{who}: {txt}")
    return "\n".join(parts)


def _fetch_room_text(db: Session, room: str, limit: int) -> str:
    rows = (
        db.query(Transcript)
        .filter(Transcript.room == room)
        .order_by(Transcript.id.desc())
        .limit(limit)
        .all()
    )
    if not rows:
        raise HTTPException(status_code=404, detail="No transcripts found for this room")
    rows = list(reversed(rows))
    text = _concat_transcripts(rows)
    # Clamp input for large rooms (rough ~12k chars)
    if len(text) > 12000:
        text = text[-12000:]
    return text


@router.post("/room/{room}")
def summarize_room(
    room: str,
    limit: int = Query(200, ge=1, le=2000, description="Max transcript rows to include (most recent first)"),
    db: Session = Depends(get_db),
):
    provider = get_llm_provider()
    if not provider:
        raise HTTPException(status_code=400, detail="LLM provider not configured. Set LLM_PROVIDER and corresponding API key.")

    text = _fetch_room_text(db, room, limit)
    summary = provider.summarize(text)
    return {"room": room, "summary": summary}


class SummaryPayload(BaseModel):
    summary: Optional[str] = None


@router.post("/room/{room}/pdf")
def summarize_room_pdf(
    room: str,
    limit: int = Query(200, ge=1, le=2000),
    payload: SummaryPayload | None = None,
    db: Session = Depends(get_db),
):
    summary_text = (payload.summary.strip() if payload and payload.summary else None)
    if not summary_text:
        provider = get_llm_provider()
        if not provider:
            raise HTTPException(status_code=400, detail="LLM provider not configured and no summary provided")
        text = _fetch_room_text(db, room, limit)
        summary_text = provider.summarize(text)

    # Generate PDF in memory
    try:
        from reportlab.lib.pagesizes import LETTER
        from reportlab.lib.units import inch
        from reportlab.pdfgen import canvas
    except Exception:
        raise HTTPException(status_code=500, detail="PDF engine not available. Ensure reportlab is installed.")

    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=LETTER)
    width, height = LETTER
    margin = 0.75 * inch

    # Header
    title = "Room Summary"
    sub = f"Room: {room}"
    ts = datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")

    c.setTitle(f"Summary - {room}")
    c.setFont("Helvetica-Bold", 16)
    c.drawString(margin, height - margin, title)
    c.setFont("Helvetica", 11)
    c.drawString(margin, height - margin - 18, sub)
    c.drawString(margin, height - margin - 34, f"Generated: {ts}")

    # Body (wrap text)
    y = height - margin - 60
    font_name = "Helvetica"
    font_size = 11
    line_height = 14
    max_width = width - 2 * margin
    c.setFont(font_name, font_size)

    def wrap_lines(txt: str) -> list[str]:
        lines: list[str] = []
        for paragraph in (txt or "").split("\n"):
            words = paragraph.split()
            line = ""
            for w in words:
                candidate = (line + " " + w).strip()
                if c.stringWidth(candidate, font_name, font_size) <= max_width:
                    line = candidate
                else:
                    if line:
                        lines.append(line)
                    line = w
            if line:
                lines.append(line)
            # Add paragraph spacing
            lines.append("")
        return lines

    for line in wrap_lines(summary_text):
        if y <= margin:
            c.showPage()
            c.setFont(font_name, font_size)
            y = height - margin
        c.drawString(margin, y, line)
        y -= line_height

    c.showPage()
    c.save()
    pdf_bytes = buffer.getvalue()
    buffer.close()

    filename = f"room-summary-{room}-{datetime.utcnow().strftime('%Y%m%d-%H%M')}.pdf"
    headers = {"Content-Disposition": f"attachment; filename=\"{filename}\""}
    return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)
