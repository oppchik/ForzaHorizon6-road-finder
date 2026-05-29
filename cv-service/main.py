"""
Forza Road Finder — Computer Vision Service
============================================
FastAPI microservice that receives a Forza Horizon map screenshot
and returns bounding boxes of unexplored (grey) road segments.

Algorithm:
  1. Convert image to HSV colour space
  2. Mask pixels matching the "unexplored road" grey colour range
  3. Apply morphological operations to clean up noise
  4. Find connected components (contours)
  5. Filter by size (remove dust pixels and full-map noise)
  6. Return normalised bounding boxes + centroids

Security:
  - X-Internal-Secret header required (shared with Next.js)
  - File size hard-capped
  - Image decoded via OpenCV (not PIL exec paths)
  - No files written to disk
  - All exceptions caught and sanitised before returning to caller
"""

import os
import time
import logging
from io import BytesIO
from typing import List

import cv2
import numpy as np
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

INTERNAL_SECRET = os.getenv("INTERNAL_SERVICE_SECRET", "")
MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_CONTENT_TYPES = {"image/png", "image/jpeg", "image/webp"}

# ---------------------------------------------------------------------------
# Forza Horizon map colour tuning
#
# These HSV ranges target the "unexplored road" grey segments.
# Forza Horizon 6 maps use a slightly warm grey for unexplored roads:
#   - Low saturation (roads are desaturated)
#   - Medium-low value (darker than explored white/yellow roads)
#
# IMPORTANT: These values will need calibration once FH6 ships.
# Run `python calibrate.py <screenshot.png>` to fine-tune.
# ---------------------------------------------------------------------------

# HSV range for unexplored roads (tweak after testing with real screenshots)
UNEXPLORED_HSV_LOWER = np.array([0,   0,  90])   # H, S, V min
UNEXPLORED_HSV_UPPER = np.array([30, 35, 170])   # H, S, V max

# Explored roads are typically bright white/yellow — excluded by the mask
# Minimum contour area in pixels (relative to a 1920×1080 image)
# Scaled proportionally for other resolutions
MIN_CONTOUR_AREA_1080P = 20
MAX_CONTOUR_AREA_FRACTION = 0.3   # ignore blobs > 30% of image (background)

# Morphological kernel sizes
MORPH_CLOSE_KERNEL = (5, 5)   # close small gaps in road lines
MORPH_OPEN_KERNEL  = (3, 3)   # remove isolated noise pixels

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class BoundingBox(BaseModel):
    x: float
    y: float
    width: float
    height: float

class RoadSegment(BaseModel):
    bbox: BoundingBox
    centerX: float
    centerY: float
    pixelArea: int
    confidence: float

class AnalysisResult(BaseModel):
    success: bool
    imageWidth: int
    imageHeight: int
    unexploredSegments: List[RoadSegment]
    totalUnexplored: int
    processingTimeMs: int
    error: str | None = None

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Forza Road Finder CV Service",
    description="Computer vision microservice for detecting unexplored roads",
    docs_url=None,   # Disable Swagger UI in production
    redoc_url=None,
)

# Only the Next.js backend talks to us — no browser CORS needed.
# Restrict origins to the Next.js server.
allowed_origins = os.getenv("ALLOWED_CV_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["POST"],
    allow_headers=["X-Internal-Secret", "Content-Type"],
)


def verify_secret(secret: str | None) -> None:
    """Reject requests missing the shared secret."""
    if not INTERNAL_SECRET:
        # Dev mode: skip check if secret not configured
        logger.warning("INTERNAL_SERVICE_SECRET not set — accepting all requests (dev mode)")
        return
    if secret != INTERNAL_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")


def decode_image(data: bytes) -> np.ndarray:
    """Decode image bytes to OpenCV BGR array. Raises ValueError on failure."""
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image. Make sure it is a valid PNG/JPEG/WebP.")
    return img


def find_unexplored_roads(img_bgr: np.ndarray) -> List[RoadSegment]:
    """
    Core CV pipeline. Returns a list of RoadSegment objects for each
    detected unexplored road cluster.
    """
    h, w = img_bgr.shape[:2]
    total_pixels = h * w

    # 1. Convert to HSV
    img_hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)

    # 2. Threshold to isolate unexplored-road colour range
    mask = cv2.inRange(img_hsv, UNEXPLORED_HSV_LOWER, UNEXPLORED_HSV_UPPER)

    # 3. Morphological clean-up
    kernel_close = cv2.getStructuringElement(cv2.MORPH_RECT, MORPH_CLOSE_KERNEL)
    kernel_open  = cv2.getStructuringElement(cv2.MORPH_RECT, MORPH_OPEN_KERNEL)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel_close)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN,  kernel_open)

    # 4. Find contours
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    # Scale min area to the actual resolution (calibrated for 1080p)
    scale = (w * h) / (1920 * 1080)
    min_area = int(MIN_CONTOUR_AREA_1080P * scale)
    max_area = int(total_pixels * MAX_CONTOUR_AREA_FRACTION)

    segments: List[RoadSegment] = []

    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < min_area or area > max_area:
            continue

        x, y, cw, ch = cv2.boundingRect(cnt)

        # Centroid via moments (more accurate than bbox centre for irregular shapes)
        M = cv2.moments(cnt)
        if M["m00"] == 0:
            cx, cy = x + cw / 2, y + ch / 2
        else:
            cx = M["m10"] / M["m00"]
            cy = M["m01"] / M["m00"]

        # Confidence: ratio of masked pixels inside the bounding box
        roi_mask = mask[y : y + ch, x : x + cw]
        masked_px = int(np.count_nonzero(roi_mask))
        confidence = round(masked_px / (cw * ch), 3) if cw * ch > 0 else 0.0

        segments.append(
            RoadSegment(
                bbox=BoundingBox(
                    x=round(x / w, 4),
                    y=round(y / h, 4),
                    width=round(cw / w, 4),
                    height=round(ch / h, 4),
                ),
                centerX=round(cx / w, 4),
                centerY=round(cy / h, 4),
                pixelArea=int(area),
                confidence=confidence,
            )
        )

    # Sort by area descending so the biggest unexplored blobs come first
    segments.sort(key=lambda s: s.pixelArea, reverse=True)
    return segments


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "forza-road-finder-cv"}


@app.post("/analyze", response_model=AnalysisResult)
async def analyze(
    image: UploadFile = File(...),
    x_internal_secret: str | None = Header(default=None, alias="X-Internal-Secret"),
) -> AnalysisResult:
    start = time.monotonic()

    # Auth
    verify_secret(x_internal_secret)

    # Content-type check (defence-in-depth; Next.js already validated magic bytes)
    if image.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported content type: {image.content_type}",
        )

    # Read (with size cap)
    data = await image.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=422, detail="Image exceeds 10 MB size limit.")

    try:
        img_bgr = decode_image(data)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    h, w = img_bgr.shape[:2]
    logger.info("Analysing image %dx%d (%d bytes)", w, h, len(data))

    try:
        segments = find_unexplored_roads(img_bgr)
    except Exception as exc:
        logger.exception("CV pipeline error")
        # Don't leak internal tracebacks
        raise HTTPException(status_code=500, detail="Image analysis failed internally.") from exc

    elapsed_ms = int((time.monotonic() - start) * 1000)
    logger.info("Found %d unexplored segments in %dms", len(segments), elapsed_ms)

    return AnalysisResult(
        success=True,
        imageWidth=w,
        imageHeight=h,
        unexploredSegments=segments,
        totalUnexplored=len(segments),
        processingTimeMs=elapsed_ms,
    )
