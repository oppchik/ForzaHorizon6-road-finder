import io
import os
import numpy as np
import cv2
import pytest
from fastapi.testclient import TestClient

os.environ["INTERNAL_SERVICE_SECRET"] = "test-secret"

from main import app, find_unexplored_roads  

client = TestClient(app)

SECRET_HEADER = {"X-Internal-Secret": "test-secret"}

def make_png_bytes(img_bgr: np.ndarray) -> bytes:
    """Encode an OpenCV image to PNG bytes."""
    ok, buf = cv2.imencode(".png", img_bgr)
    assert ok
    return buf.tobytes()


def solid_image(h: int, w: int, bgr: tuple) -> np.ndarray:
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[:] = bgr
    return img

class TestFindUnexploredRoads:
    def test_no_unexplored_on_blank_dark_image(self):
        img = solid_image(1080, 1920, (20, 20, 20)) 
        segs = find_unexplored_roads(img)
        assert segs == []

    def test_detects_grey_blob(self):
        """A medium-grey rectangle should be detected as unexplored."""
        img = solid_image(1080, 1920, (20, 20, 20))
        cv2.rectangle(img, (800, 400), (900, 420), (130, 120, 125), -1)
        segs = find_unexplored_roads(img)
        assert len(segs) >= 1
        assert 0.3 < segs[0].centerX < 0.7
        assert 0.2 < segs[0].centerY < 0.6

    def test_confidence_between_0_and_1(self):
        img = solid_image(1080, 1920, (20, 20, 20))
        cv2.rectangle(img, (100, 100), (200, 120), (130, 120, 125), -1)
        segs = find_unexplored_roads(img)
        for s in segs:
            assert 0.0 <= s.confidence <= 1.0

    def test_bbox_normalised(self):
        img = solid_image(1080, 1920, (20, 20, 20))
        cv2.rectangle(img, (100, 100), (200, 120), (130, 120, 125), -1)
        segs = find_unexplored_roads(img)
        for s in segs:
            assert 0.0 <= s.bbox.x <= 1.0
            assert 0.0 <= s.bbox.y <= 1.0
            assert 0.0 < s.bbox.width <= 1.0
            assert 0.0 < s.bbox.height <= 1.0

    def test_ignores_full_image_grey(self):
        """An entirely grey image should be treated as background noise, not a road."""
        img = solid_image(1080, 1920, (130, 120, 125))
        segs = find_unexplored_roads(img)
        assert len(segs) == 0

class TestHealthEndpoint:
    def test_health_ok(self):
        res = client.get("/health")
        assert res.status_code == 200
        assert res.json()["status"] == "ok"


class TestAnalyzeEndpoint:
    def _upload(self, img: np.ndarray, headers: dict | None = None):
        png_bytes = make_png_bytes(img)
        return client.post(
            "/analyze",
            files={"image": ("map.png", io.BytesIO(png_bytes), "image/png")},
            headers=headers or SECRET_HEADER,
        )

    def test_rejects_missing_secret(self):
        img = solid_image(100, 100, (20, 20, 20))
        res = self._upload(img, headers={"X-Internal-Secret": "wrong-secret"})
        assert res.status_code == 401

    def test_accepts_valid_image(self):
        img = solid_image(1080, 1920, (20, 20, 20))
        res = self._upload(img)
        assert res.status_code == 200
        body = res.json()
        assert body["success"] is True
        assert "unexploredSegments" in body
        assert body["imageWidth"] == 1920
        assert body["imageHeight"] == 1080

    def test_detects_road_segment(self):
        img = solid_image(1080, 1920, (20, 20, 20))
        cv2.rectangle(img, (800, 400), (900, 420), (130, 120, 125), -1)
        res = self._upload(img)
        assert res.status_code == 200
        body = res.json()
        assert body["totalUnexplored"] >= 1

    def test_rejects_oversized_file(self):
        big_data = b"x" * (11 * 1024 * 1024)
        res = client.post(
            "/analyze",
            files={"image": ("big.png", io.BytesIO(big_data), "image/png")},
            headers=SECRET_HEADER,
        )
        assert res.status_code == 422

    def test_rejects_invalid_content_type(self):
        res = client.post(
            "/analyze",
            files={"image": ("doc.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
            headers=SECRET_HEADER,
        )
        assert res.status_code == 422
