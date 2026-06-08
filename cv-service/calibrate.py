import sys
import cv2
import numpy as np


def nothing(_: int) -> None:
    pass


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python calibrate.py <screenshot.png>")
        sys.exit(1)

    img_path = sys.argv[1]
    img_bgr = cv2.imread(img_path)
    if img_bgr is None:
        print(f"Could not read image: {img_path}")
        sys.exit(1)

    img_hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)

    display_h = 600
    scale = display_h / img_bgr.shape[0]
    display_w = int(img_bgr.shape[1] * scale)
    img_display = cv2.resize(img_bgr, (display_w, display_h))

    cv2.namedWindow("Calibration", cv2.WINDOW_NORMAL)
    cv2.namedWindow("Mask", cv2.WINDOW_NORMAL)

    for name, val, max_val in [
        ("H_min", 0,   179),
        ("H_max", 30,  179),
        ("S_min", 0,   255),
        ("S_max", 35,  255),
        ("V_min", 90,  255),
        ("V_max", 170, 255),
    ]:
        cv2.createTrackbar(name, "Calibration", val, max_val, nothing)

    print("Adjust trackbars until only unexplored (grey) road pixels are white in Mask.")
    print("Press 'q' to quit and print final values, 's' to save debug image.")

    while True:
        h_min = cv2.getTrackbarPos("H_min", "Calibration")
        h_max = cv2.getTrackbarPos("H_max", "Calibration")
        s_min = cv2.getTrackbarPos("S_min", "Calibration")
        s_max = cv2.getTrackbarPos("S_max", "Calibration")
        v_min = cv2.getTrackbarPos("V_min", "Calibration")
        v_max = cv2.getTrackbarPos("V_max", "Calibration")

        lower = np.array([h_min, s_min, v_min])
        upper = np.array([h_max, s_max, v_max])

        mask = cv2.inRange(img_hsv, lower, upper)
        mask_display = cv2.resize(mask, (display_w, display_h))

        overlay = img_display.copy()
        overlay[cv2.resize(mask, (display_w, display_h)) > 0] = [0, 0, 255]

        cv2.imshow("Calibration", overlay)
        cv2.imshow("Mask", mask_display)

        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            print("\n--- Paste these into main.py ---")
            print(f"UNEXPLORED_HSV_LOWER = np.array([{h_min:3d}, {s_min:3d}, {v_min:3d}])")
            print(f"UNEXPLORED_HSV_UPPER = np.array([{h_max:3d}, {s_max:3d}, {v_max:3d}])")
            break
        elif key == ord("s"):
            out_path = "debug_mask.png"
            cv2.imwrite(out_path, overlay)
            print(f"Saved debug image to {out_path}")

    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
