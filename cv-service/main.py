import os
import time
import logging
import base64
from typing import Tuple

import cv2
import numpy as np
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

INTERNAL_SECRET = os.getenv("INTERNAL_SERVICE_SECRET", "")
MAX_IMAGE_BYTES = 10 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {"image/png", "image/jpeg", "image/webp"}

FIND_SRGB  = np.array([0x80, 0x80, 0x80], dtype=np.float32) / 255.0
PAINT_BGR  = np.array([20, 255, 0],        dtype=np.uint8)
TOLERANCE  = 5.0 / 255.0
REC601     = np.array([0.114, 0.587, 0.299], dtype=np.float32)


class AnalysisResult(BaseModel):
    success: bool
    imageWidth: int
    imageHeight: int
    imageBase64: str
    totalUnexplored: int
    processingTimeMs: int
    error: str | None = None


app = FastAPI(docs_url=None, redoc_url=None)

allowed_origins = os.getenv("ALLOWED_CV_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["POST"],
    allow_headers=["X-Internal-Secret", "Content-Type"],
)


def verify_secret(secret: str | None) -> None:
    if not INTERNAL_SECRET:
        logger.warning("INTERNAL_SERVICE_SECRET not set")
        return
    if secret != INTERNAL_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")


def decode_image(data: bytes) -> np.ndarray:
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image.")
    return img


def highlight_unexplored(img_bgr: np.ndarray, tolerance: float = TOLERANCE) -> Tuple[np.ndarray, int]:
    img_rgb = img_bgr[:, :, ::-1].astype(np.float32) / 255.0

    linear = img_rgb * img_rgb

    find_linear = FIND_SRGB * FIND_SRGB

    diff = linear - find_linear
    dist_sq = (diff * diff * REC601).sum(axis=2)

    dist_max = tolerance * tolerance * 3.0

    h, w = img_bgr.shape[:2]
    margin_top    = int(h * 0.07)
    margin_bottom = int(h * 0.09)
    margin_lr     = int(w * 0.02)

    mask = dist_sq <= dist_max
    mask[:margin_top, :]      = False
    mask[h-margin_bottom:, :] = False
    mask[:, :margin_lr]       = False
    mask[:, w-margin_lr:]     = False

    result = img_bgr.copy()
    result[mask] = PAINT_BGR

    count = int(mask.sum())
    return result, count


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "forza-road-finder-cv"}


@app.post("/analyze", response_model=AnalysisResult)
async def analyze(
    image: UploadFile = File(...),
    x_internal_secret: str | None = Header(default=None, alias="X-Internal-Secret"),
) -> AnalysisResult:
    start = time.monotonic()

    verify_secret(x_internal_secret)

    if image.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=422, detail=f"Unsupported: {image.content_type}")

    data = await image.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=422, detail="Image too large.")

    try:
        img_bgr = decode_image(data)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    h, w = img_bgr.shape[:2]
    logger.info("Analysing %dx%d (%d bytes)", w, h, len(data))

    try:
        result_img, pixel_count = highlight_unexplored(img_bgr)
    except Exception as exc:
        logger.exception("CV error")
        raise HTTPException(status_code=500, detail="Analysis failed.") from exc

    _, buf = cv2.imencode(".jpg", result_img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    img_b64 = base64.b64encode(buf.tobytes()).decode("ascii")

    elapsed_ms = int((time.monotonic() - start) * 1000)
    logger.info("Done: %d grey pixels in %dms", pixel_count, elapsed_ms)

    return AnalysisResult(
        success=True,
        imageWidth=w,
        imageHeight=h,
        imageBase64=img_b64,
        totalUnexplored=pixel_count,
        processingTimeMs=elapsed_ms,
    )
