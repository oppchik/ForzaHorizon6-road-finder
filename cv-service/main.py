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


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

INTERNAL_SECRET = os.getenv("INTERNAL_SERVICE_SECRET", "")
MAX_IMAGE_BYTES = 10 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {"image/png", "image/jpeg", "image/webp"}


UNEXPLORED_HSV_LOWER = np.array([0,   0,  90])
UNEXPLORED_HSV_UPPER = np.array([30, 35, 170])


MIN_CONTOUR_AREA_1080P = 20
MAX_CONTOUR_AREA_FRACTION = 0.3


MORPH_CLOSE_KERNEL = (5, 5)
MORPH_OPEN_KERNEL  = (3, 3)


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


app = FastAPI(
    title="Forza Road Finder CV Service",
    description="Computer vision microservice for detecting unexplored roads",
    docs_url=None,
    redoc_url=None,
)


allowed_origins = os.getenv("ALLOWED_CV_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["POST"],
    allow_headers=["X-Internal-Secret", "Content-Type"],
)


def verify_secret(secret: str | None) -> None:
    if not INTERNAL_SECRET:

        logger.warning("INTERNAL_SERVICE_SECRET not set — accepting all requests (dev mode)")
        return
    if secret != INTERNAL_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")


def decode_image(data: bytes) -> np.ndarray:
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image. Make sure it is a valid PNG/JPEG/WebP.")
    return img


def find_unexplored_roads(img_bgr: np.ndarray) -> List[RoadSegment]:
    h, w = img_bgr.shape[:2]
    total_pixels = h * w

    target = np.array([128, 128, 128], dtype=np.int32)
    diff = np.abs(img_bgr.astype(np.int32) - target)
    dist = diff.max(axis=2)

    mask = (dist <= 18).astype(np.uint8) * 255

    margin_top    = int(h * 0.07)
    margin_bottom = int(h * 0.09)
    margin_lr     = int(w * 0.02)
    mask[:margin_top, :]     = 0
    mask[h-margin_bottom:, :] = 0
    mask[:, :margin_lr]      = 0
    mask[:, w-margin_lr:]    = 0

    k_close = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    k_open  = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k_close)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN,  k_open)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    scale = total_pixels / (1920 * 1080)
    min_area = max(40, int(80 * scale))
    max_area = int(total_pixels * 0.03)

    segments: List[RoadSegment] = []

    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < min_area or area > max_area:
            continue

        x, y, cw, ch = cv2.boundingRect(cnt)

        aspect = max(cw, ch) / max(min(cw, ch), 1)
        if aspect < 1.5 and area < 60:
            continue

        M = cv2.moments(cnt)
        if M["m00"] == 0:
            cx, cy = x + cw / 2, y + ch / 2
        else:
            cx = M["m10"] / M["m00"]
            cy = M["m01"] / M["m00"]

        roi = mask[y:y+ch, x:x+cw]
        confidence = round(int(np.count_nonzero(roi)) / (cw * ch), 3) if cw * ch > 0 else 0.0

        segments.append(RoadSegment(
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
        ))

    segments.sort(key=lambda s: s.pixelArea, reverse=True)
    return segments

app = FastAPI(
    title="Forza Road Finder CV Service",
    description="Computer vision microservice for detecting unexplored roads",
    docs_url=None,
    redoc_url=None,
)


allowed_origins = os.getenv("ALLOWED_CV_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["POST"],
    allow_headers=["X-Internal-Secret", "Content-Type"],
)


def verify_secret(secret: str | None) -> None:
    if not INTERNAL_SECRET:

        logger.warning("INTERNAL_SERVICE_SECRET not set — accepting all requests (dev mode)")
        return
    if secret != INTERNAL_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")


def decode_image(data: bytes) -> np.ndarray:
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image. Make sure it is a valid PNG/JPEG/WebP.")
    return img


def find_unexplored_roads(img_bgr: np.ndarray) -> List[RoadSegment]:
    h, w = img_bgr.shape[:2]
    total_pixels = h * w

    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    H, S, V = hsv[:,:,0], hsv[:,:,1], hsv[:,:,2]


    explored = (V > 185) & (S < 45)


    orange_routes = (H < 15) & (S > 120) & (V > 100)


    green_terrain = (H > 25) & (H < 90) & (S > 55) & (V > 50)


    brown_terrain = (H > 8) & (H < 30) & (S > 60)


    water = (H > 85) & (H < 130) & (S > 20) & (V > 55) & (V < 145)


    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (7, 7), 0)
    local_bright = cv2.subtract(gray, blur)


    unexplored = (
        (V > 80) & (V < 182) &
        (S < 55) &
        (local_bright > 5) &
        ~explored &
        ~orange_routes &
        ~green_terrain &
        ~brown_terrain &
        ~water
    )


    margin_top    = int(h * 0.08)
    margin_bottom = int(h * 0.10)
    margin_lr     = int(w * 0.03)
    ui_mask = np.zeros((h, w), dtype=bool)
    ui_mask[:margin_top, :]  = True
    ui_mask[h-margin_bottom:, :] = True
    ui_mask[:, :margin_lr]   = True
    ui_mask[:, w-margin_lr:] = True
    unexplored = unexplored & ~ui_mask


    mask = unexplored.astype(np.uint8) * 255
    k_close = cv2.getStructuringElement(cv2.MORPH_RECT, (4, 4))
    k_open  = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k_close)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN,  k_open)


    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    scale = (w * h) / (1920 * 1080)
    min_area = max(10, int(15 * scale))
    max_area = int(total_pixels * 0.03)

    segments: List[RoadSegment] = []

    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < min_area or area > max_area:
            continue

        x, y, cw, ch = cv2.boundingRect(cnt)


        aspect = max(cw, ch) / max(min(cw, ch), 1)
        if aspect < 1.3 and area < 80:
            continue

        M = cv2.moments(cnt)
        if M["m00"] == 0:
            cx, cy = x + cw / 2, y + ch / 2
        else:
            cx = M["m10"] / M["m00"]
            cy = M["m01"] / M["m00"]

        roi_mask = mask[y:y+ch, x:x+cw]
        masked_px = int(np.count_nonzero(roi_mask))
        confidence = round(masked_px / (cw * ch), 3) if cw * ch > 0 else 0.0

        segments.append(RoadSegment(
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
        ))

    segments.sort(key=lambda s: s.pixelArea, reverse=True)
    return segments


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


app = FastAPI(
    title="Forza Road Finder CV Service",
    description="Computer vision microservice for detecting unexplored roads",
    docs_url=None,
    redoc_url=None,
)


allowed_origins = os.getenv("ALLOWED_CV_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["POST"],
    allow_headers=["X-Internal-Secret", "Content-Type"],
)


def verify_secret(secret: str | None) -> None:
    if not INTERNAL_SECRET:

        logger.warning("INTERNAL_SERVICE_SECRET not set — accepting all requests (dev mode)")
        return
    if secret != INTERNAL_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")


def decode_image(data: bytes) -> np.ndarray:
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image. Make sure it is a valid PNG/JPEG/WebP.")
    return img


def validate_is_map(img_bgr: np.ndarray) -> tuple[bool, str]:
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    h, w = img_bgr.shape[:2]
    total_px = h * w

    H, S, V = hsv[:,:,0], hsv[:,:,1], hsv[:,:,2]


    low_sat_ratio = float(np.sum(S < 80) / total_px)


    road_like = (V > 140) & (S < 60)
    road_ratio = float(np.sum(road_like) / total_px)


    sky_like = (H > 85) & (H < 135) & (S > 90) & (V > 140)
    sky_ratio = float(np.sum(sky_like) / total_px)


    bottom_third = img_bgr[int(h * 0.66):, :]
    bottom_dark = np.sum(cv2.cvtColor(bottom_third, cv2.COLOR_BGR2GRAY) < 60)
    bottom_dark_ratio = float(bottom_dark / (bottom_third.shape[0] * bottom_third.shape[1]))

    logger.info(
        "Map validation: low_sat=%.2f road=%.2f sky=%.2f bottom_dark=%.2f",
        low_sat_ratio, road_ratio, sky_ratio, bottom_dark_ratio
    )


    bright_isolated = (V > 200) & (S < 30)
    bright_ratio = float(np.sum(bright_isolated) / total_px)


    green = (H > 25) & (H < 90) & (S > 55) & (V > 50)
    green_ratio = float(np.sum(green) / total_px)

    logger.info(
        "Map validation: bright_isolated=%.3f green_terrain=%.3f",
        bright_ratio, green_ratio
    )


    if bright_ratio > 0.05 and green_ratio < 0.03:
        return False, "This looks like a gameplay screenshot, not a map. Please open the map in Forza (press Menu → Map) and screenshot that instead."

    return True, ""


def find_unexplored_roads(img_bgr: np.ndarray) -> List[RoadSegment]:
    h, w = img_bgr.shape[:2]
    total_pixels = h * w


    img_hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)


    mask = cv2.inRange(img_hsv, UNEXPLORED_HSV_LOWER, UNEXPLORED_HSV_UPPER)


    kernel_close = cv2.getStructuringElement(cv2.MORPH_RECT, MORPH_CLOSE_KERNEL)
    kernel_open  = cv2.getStructuringElement(cv2.MORPH_RECT, MORPH_OPEN_KERNEL)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel_close)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN,  kernel_open)


    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)


    scale = (w * h) / (1920 * 1080)
    min_area = int(MIN_CONTOUR_AREA_1080P * scale)
    max_area = int(total_pixels * MAX_CONTOUR_AREA_FRACTION)

    segments: List[RoadSegment] = []

    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < min_area or area > max_area:
            continue

        x, y, cw, ch = cv2.boundingRect(cnt)


        M = cv2.moments(cnt)
        if M["m00"] == 0:
            cx, cy = x + cw / 2, y + ch / 2
        else:
            cx = M["m10"] / M["m00"]
            cy = M["m01"] / M["m00"]


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


    segments.sort(key=lambda s: s.pixelArea, reverse=True)
    return segments


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
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported content type: {image.content_type}",
        )


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
        is_map, reason = validate_is_map(img_bgr)
        if not is_map:
            return AnalysisResult(
                success=False,
                imageWidth=w,
                imageHeight=h,
                unexploredSegments=[],
                totalUnexplored=0,
                processingTimeMs=int((time.monotonic() - start) * 1000),
                error=reason,
            )

        segments = find_unexplored_roads(img_bgr)
    except Exception as exc:
        logger.exception("CV pipeline error")

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
