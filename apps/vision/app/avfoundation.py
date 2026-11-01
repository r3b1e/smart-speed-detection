"""AVFoundation camera discovery.

Selection is locked to a specific iPhone by Unique ID and Model ID.
Priority order:
  1. Exact Unique ID match  (LIVE_CAMERA_UNIQUE_ID)
  2. Model ID prefix match  (LIVE_CAMERA_MODEL_ID — stored as the AVFoundation uniqueID prefix)
  3. Case-insensitive 'iphone' name match  (fallback for first-run / re-paired device)

NEVER falls back to FaceTime or any other non-iPhone camera.
"""

from __future__ import annotations

import logging
from typing import Sequence

logger = logging.getLogger("smart-speed-vision.avfoundation")

# ---------------------------------------------------------------------------
# Target device — iPhone 15 Pro Max (Model ID: iPhone15,5)
# These are matched against AVFoundation's uniqueID and localizedName.
# ---------------------------------------------------------------------------
LIVE_CAMERA_UNIQUE_ID: str = "E63B6BDD-EB3D-46B0-81D5-42D500000001"
LIVE_CAMERA_MODEL_ID: str = "iPhone15,5"


def choose_camera(
    devices: Sequence[tuple[str, str]],
    unique_id: str = LIVE_CAMERA_UNIQUE_ID,
    model_id: str = LIVE_CAMERA_MODEL_ID,
) -> tuple[str, str]:
    """Select ONLY the configured iPhone camera.

    Each item in *devices* is ``(avfoundation_unique_id, localized_name)``.

    Match priority:
    1. ``unique_id`` — exact AVFoundation unique-ID match (most reliable; survives
       renames and re-pairing as long as the hardware UUID stays the same).
    2. ``model_id`` — the AVFoundation unique ID for Continuity Camera devices
       often encodes the model identifier as a prefix (e.g. ``"iPhone15,5-…"``).
       Checked as a case-insensitive prefix of the stored unique ID.
    3. ``'iphone'`` in the localized name — broadest safety net for the very first
       connection before the unique ID is confirmed. Logs a warning so you know
       which tier matched.

    Raises ``ValueError`` if none of the tiers match, listing available devices.
    NEVER selects FaceTime HD, USB webcams, or any non-iPhone source.
    """
    if not devices:
        raise ValueError(
            "No video devices visible to macOS. "
            "Ensure the iPhone is unlocked and Continuity Camera is enabled."
        )

    # --- Tier 1: exact Unique ID ---
    for device in devices:
        if device[0] == unique_id:
            logger.info(
                "Camera selected by Unique ID (%s): %s", unique_id, device[1]
            )
            return device

    # --- Tier 2: Model ID prefix in unique ID ---
    model_prefix = model_id.lower()
    for device in devices:
        if device[0].lower().startswith(model_prefix):
            logger.warning(
                "Camera Unique ID not matched; selected by Model ID prefix (%s): "
                "unique_id=%s name=%s. Update LIVE_CAMERA_UNIQUE_ID if this is correct.",
                model_id,
                device[0],
                device[1],
            )
            return device

    # --- Tier 3: 'iphone' in localized name ---
    iphone_candidates = [
        (uid, name) for uid, name in devices if "iphone" in name.lower()
    ]
    if iphone_candidates:
        chosen = iphone_candidates[0]
        logger.warning(
            "Camera matched by name fallback only — neither Unique ID (%s) nor "
            "Model ID (%s) found. Using: unique_id=%s name=%s. "
            "Set LIVE_CAMERA_UNIQUE_ID and LIVE_CAMERA_MODEL_ID to lock to this device.",
            unique_id,
            model_id,
            chosen[0],
            chosen[1],
        )
        if len(iphone_candidates) > 1:
            logger.warning(
                "Multiple iPhone cameras found: %s. Using first: %s",
                [name for _, name in iphone_candidates],
                chosen[1],
            )
        return chosen

    # --- No match ---
    available = ", ".join(f"{name} (id={uid})" for uid, name in devices)
    raise ValueError(
        f"Configured iPhone camera not found. "
        f"Unique ID: {unique_id!r}, Model ID: {model_id!r}. "
        f"Available devices: {available}. "
        "Check: (1) iPhone is unlocked, (2) Same Apple ID on both devices, "
        "(3) Wi-Fi and Bluetooth enabled, (4) Continuity Camera enabled "
        "(Settings > General > AirPlay & Handoff), (5) iOS 16+ / macOS 13+."
    )


def camera_devices() -> list[tuple[str, str]]:
    """Unique IDs and names of every attached video device via AVFoundation.

    Returns an empty list when pyobjc is missing (tests / non-macOS), which the
    caller treats as "configured camera unavailable".
    """
    try:
        import AVFoundation  # type: ignore[import-not-found]  # mac-only
    except Exception as exc:  # pragma: no cover - platform dependent
        logger.debug("AVFoundation unavailable: %s", exc)
        return []
    try:
        devices = AVFoundation.AVCaptureDevice.devicesWithMediaType_(
            AVFoundation.AVMediaTypeVideo
        )
    except Exception:  # pragma: no cover - platform dependent
        return []
    return [(str(d.uniqueID()), str(d.localizedName())) for d in (devices or [])]


def discover_camera_name() -> str | None:
    """Name of the configured camera, or None; never use a fallback."""
    try:
        return choose_camera(camera_devices())[1]
    except ValueError:
        return None
