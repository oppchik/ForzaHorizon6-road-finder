import os
import time
import logging
from typing import List

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


def highlight_unexplored(img_bgr: np.ndarray) -> tuple[np.ndarray, int]:
    h, w = img_bgr.shape[:2]

    img_f = img_bgr.astype(np.float32)
    B, G, R = img_f[:,:,0], img_f[:,:,1], img_f[:,:,2]
    mx = np.maximum(np.maximum(B, G), R)
    mn = np.minimum(np.minimum(B, G), R)
    sat = mx - mn
    brightness = (B + G + R) / 3.0

    is_neutral_grey = (sat < 28) & (np.abs(R-B) < 18) & (np.abs(G-B) < 18)
    mask_dark  = is_neutral_grey & (brightness >= 95)  & (brightness <= 155)
    mask_light = is_neutral_grey & (brightness > 155) & (brightness <= 210)
    combined = mask_dark | mask_light

    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    blur_large = cv2.GaussianBlur(gray, (21, 21), 0)
    local_contrast = gray.astype(np.int16) - blur_large.astype(np.int16)
    combined = combined & (local_contrast > 4)

    margin_top    = int(h * 0.07)
    margin_bottom = int(h * 0.09)
    margin_lr     = int(w * 0.02)
    combined[:margin_top, :]      = False
    combined[h-margin_bottom:, :] = False
    combined[:, :margin_lr]       = False
    combined[:, w-margin_lr:]     = False

    result = img_bgr.copy()
    result[combined] = [0, 255, 20]

    count = int(np.sum(combined))
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

    _, buf = cv2.imencode(".jpg", result_img, [cv2.IMWRITE_JPEG_QUALITY, 90])
    import base64
    img_b64 = base64.b64encode(buf.tobytes()).decode("ascii")

    elapsed_ms = int((time.monotonic() - start) * 1000)
    logger.info("Done: %d grey pixels highlighted in %dms", pixel_count, elapsed_ms)

    return AnalysisResult(
        success=True,
        imageWidth=w,
        imageHeight=h,
        imageBase64=img_b64,
        totalUnexplored=pixel_count,
        processingTimeMs=elapsed_ms,
    )
