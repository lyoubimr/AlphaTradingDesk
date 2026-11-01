"""Shared image-upload helper (jpeg/png/webp/gif, max 10 MB) stored under settings.uploads_dir."""

from __future__ import annotations

import os
import uuid

from fastapi import HTTPException, UploadFile, status

from src.core.config import settings

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_IMAGE_SIZE_MB = 10


def save_image_upload(file: UploadFile, *subdir: str) -> str:
    """Validate and store an uploaded image; returns its /uploads/... URL path."""
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported image type: {file.content_type}. Allowed: jpeg, png, webp, gif",
        )
    content = file.file.read()
    if len(content) > MAX_IMAGE_SIZE_MB * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Image too large (max {MAX_IMAGE_SIZE_MB} MB).",
        )

    ext = (file.filename or "image.png").rsplit(".", 1)[-1].lower()
    if ext not in ("jpg", "jpeg", "png", "webp", "gif"):
        ext = "png"

    dest_dir = os.path.join(settings.uploads_dir, *subdir)
    os.makedirs(dest_dir, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.{ext}"
    with open(os.path.join(dest_dir, filename), "wb") as f:
        f.write(content)
    return "/uploads/" + "/".join((*subdir, filename))
