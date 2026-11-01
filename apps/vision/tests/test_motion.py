import numpy as np

from app.frames import background_of, pick_motion_frame


def scene():
    return np.full((480, 640, 3), 40, dtype=np.uint8)


def with_car(x):
    f = scene()
    f[200:260, x : x + 90] = 230  # bright 90x60 "toy car"
    return f


def test_picks_frame_where_car_is_fully_visible_and_boxes_it():
    background = background_of([scene() for _ in range(5)])
    # car entering (partly off-frame), fully in view, then gone
    candidates = [scene(), with_car(600), with_car(300), scene()]
    index, bbox, score = pick_motion_frame(candidates, background)
    assert index == 2
    x1, y1, x2, y2 = bbox
    assert x1 <= 300 <= x2 and x1 <= 390 <= x2 and y1 <= 200 and y2 >= 259
    assert score > 0.01


def test_no_motion_returns_none():
    background = background_of([scene() for _ in range(3)])
    index, bbox, _ = pick_motion_frame([scene(), scene()], background)
    assert index is None and bbox is None


def test_median_background_ignores_a_passing_car():
    background = background_of([scene(), with_car(100), scene(), scene(), scene()])
    index, _, _ = pick_motion_frame([scene(), with_car(400)], background)
    assert index == 1


def test_prefers_sharp_frame_over_blurred_closer_one():
    import cv2

    background = background_of([scene() for _ in range(5)])
    sharp = scene()
    sharp[200:260, 300:390] = 230
    sharp[215:245, 320:370] = 60  # crisp detail (windows) on the car
    blurred = sharp.copy()
    blurred[:] = cv2.blur(blurred, (41, 1))  # same car, heavy horizontal motion blur (smears wider)
    index, bbox, _ = pick_motion_frame([blurred, sharp], background)
    assert index == 1
    assert bbox[0] <= 300 and bbox[2] >= 389
