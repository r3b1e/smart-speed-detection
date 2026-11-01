"""Android phone camera over USB (ADB) — selected with ``CAMERA_SOURCE=android``.

Runs the scrcpy server on the phone in ``raw_stream`` camera mode, reads the
raw H.264 elementary stream through an ``adb forward`` socket and decodes it
in-process with PyAV. Frames come straight from the camera sensor (Camera2),
so no app UI is in the picture and there is no screen-record time limit.

Requirements on the Mac: ``adb`` and ``scrcpy`` (``brew install scrcpy``).
On the phone: USB debugging enabled and the Camera app CLOSED (Android gives
the camera to one client at a time; if another app takes it the stream drops
and the capture worker reconnects with backoff).

Env (all optional):
  ANDROID_SERIAL        lock to this adb serial (default: the single attached device)
  ANDROID_CAMERA_ID     camera id from ``scrcpy --list-cameras`` (default 0 = back)
  ANDROID_CAMERA_SIZE   e.g. 1280x960 (default)
  ANDROID_CAMERA_FPS    default 30
  ANDROID_ROTATE        0 | 90 | 180 | 270 — clockwise rotation applied to frames
  ANDROID_TORCH         true = keep the phone flashlight on while streaming (dark scenes)
  ANDROID_CAMERA_ZOOM   e.g. 1.5 — optical/digital zoom (range from scrcpy --list-cameras)
  SCRCPY_SERVER_PATH    path to scrcpy-server (auto-detected from Homebrew)
"""

from __future__ import annotations

import glob
import logging
import os
import shutil
import socket
import subprocess
import time
from collections import deque

import cv2

from .camera import CameraUnavailable
from .config import Config

logger = logging.getLogger("smart-speed-vision.android")

SCID = "5ad0ca11"  # fixed scrcpy session id -> socket "scrcpy_5ad0ca11" (won't clash with a normal scrcpy)
REMOTE_JAR = "/data/local/tmp/scrcpy-server-ssd.jar"
LOCAL_PORT = int(os.environ.get("ANDROID_FORWARD_PORT", "27183"))
READ_TIMEOUT_S = 3.0

_ROTATIONS = {
    90: cv2.ROTATE_90_CLOCKWISE,
    180: cv2.ROTATE_180,
    270: cv2.ROTATE_90_COUNTERCLOCKWISE,
}


def _run(args: list[str], timeout: float = 10.0) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)


def _scrcpy_server_path() -> str:
    explicit = os.environ.get("SCRCPY_SERVER_PATH", "").strip()
    if explicit:
        return explicit
    candidates = [
        "/opt/homebrew/share/scrcpy/scrcpy-server",
        "/usr/local/share/scrcpy/scrcpy-server",
        *sorted(glob.glob("/opt/homebrew/Cellar/scrcpy/*/share/scrcpy/scrcpy-server")),
    ]
    for path in candidates:
        if os.path.isfile(path):
            return path
    raise CameraUnavailable("scrcpy-server not found — brew install scrcpy (or set SCRCPY_SERVER_PATH)")


def _scrcpy_version() -> str:
    if shutil.which("scrcpy") is None:
        raise CameraUnavailable("scrcpy not installed — brew install scrcpy")
    out = _run(["scrcpy", "--version"]).stdout.split()
    # "scrcpy 5.0.1 <https://...>"
    if len(out) < 2:
        raise CameraUnavailable("could not read scrcpy version")
    return out[1]


def list_adb_devices() -> list[tuple[str, str]]:
    """Returns [(serial, model)] for devices in the 'device' state."""
    if shutil.which("adb") is None:
        raise CameraUnavailable("adb not installed — brew install --cask android-platform-tools")
    res = _run(["adb", "devices", "-l"])
    devices: list[tuple[str, str]] = []
    for line in res.stdout.splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 2 and parts[1] == "device":
            model = next((p.split(":", 1)[1] for p in parts if p.startswith("model:")), "android")
            devices.append((parts[0], model))
    return devices


class AndroidCamera:
    """Same interface as ``camera.LiveCamera``: open() / read() / close() / label."""

    def __init__(self, cfg: Config, source: str | None) -> None:
        self._cfg = cfg
        self._serial_pref = os.environ.get("ANDROID_SERIAL", "").strip() or None
        self._camera_id = os.environ.get("ANDROID_CAMERA_ID", "0").strip() or "0"
        self._size = os.environ.get("ANDROID_CAMERA_SIZE", "1280x960").strip() or "1280x960"
        self._fps = os.environ.get("ANDROID_CAMERA_FPS", "30").strip() or "30"
        try:
            self._rotate = _ROTATIONS.get(int(os.environ.get("ANDROID_ROTATE", "0")))
        except ValueError:
            self._rotate = None
        self._torch = os.environ.get("ANDROID_TORCH", "false").strip().lower() in {"1", "true", "yes", "on"}
        self._zoom = os.environ.get("ANDROID_CAMERA_ZOOM", "").strip()
        self._serial: str | None = None
        self._label: str | None = None
        self._proc: subprocess.Popen[bytes] | None = None
        self._sock: socket.socket | None = None
        self._codec = None
        self._pending: deque = deque()

    @property
    def label(self) -> str:
        return self._label or "unopened"

    # ---------------- lifecycle ----------------
    def open(self) -> None:
        import av  # local import so tests without PyAV still import the module

        serial, model = self._pick_device()
        self._serial = serial
        version = _scrcpy_version()
        adb = ["adb", "-s", serial]

        push = _run([*adb, "push", _scrcpy_server_path(), REMOTE_JAR], timeout=30)
        if push.returncode != 0:
            raise CameraUnavailable(f"adb push failed: {push.stderr.strip()[:120]}")
        _run([*adb, "shell", "pkill", "-f", f"scid={SCID}"])  # stale session from a crash
        _run([*adb, "forward", "--remove", f"tcp:{LOCAL_PORT}"])
        fwd = _run([*adb, "forward", f"tcp:{LOCAL_PORT}", f"localabstract:scrcpy_{SCID}"])
        if fwd.returncode != 0:
            raise CameraUnavailable(f"adb forward failed: {fwd.stderr.strip()[:120]}")

        self._proc = subprocess.Popen(
            [
                *adb, "shell",
                f"CLASSPATH={REMOTE_JAR}", "app_process", "/", "com.genymobile.scrcpy.Server", version,
                f"scid={SCID}", "log_level=warn", "tunnel_forward=true", "audio=false",
                "control=false", "cleanup=false", "raw_stream=true", "video_source=camera",
                f"camera_id={self._camera_id}", f"camera_size={self._size}", f"camera_fps={self._fps}",
                *(["camera_torch=true"] if self._torch else []),
                *([f"camera_zoom={self._zoom}"] if self._zoom else []),
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        self._codec = av.CodecContext.create("h264", "r")
        self._pending.clear()
        self._sock = self._connect()  # decodes the first chunk (SPS/PPS) with the codec above
        # verify: a decoded frame must arrive (camera busy / locked phone -> no frames)
        deadline = time.monotonic() + self._cfg.max_frame_read_ms / 1000.0 + 3.0
        while not self._pending:
            if time.monotonic() > deadline:
                err = self._server_error()
                self.close()
                raise CameraUnavailable(
                    "phone camera produced no frames" + (f" ({err})" if err else " — close the Camera app / unlock the phone")
                )
            self._fill(deadline - time.monotonic())
        self._label = f"{model} ({serial}) camera {self._camera_id} {self._size}" + (" torch" if self._torch else "")

    def _pick_device(self) -> tuple[str, str]:
        devices = list_adb_devices()
        if self._serial_pref:
            for serial, model in devices:
                if serial == self._serial_pref:
                    return serial, model
            raise CameraUnavailable(f"android device {self._serial_pref} not attached over adb")
        if not devices:
            raise CameraUnavailable("no android device attached over adb (USB debugging on? cable data-capable?)")
        if len(devices) > 1:
            raise CameraUnavailable("several adb devices attached — set ANDROID_SERIAL")
        return devices[0]

    def _connect(self) -> socket.socket:
        # adb forward accepts the TCP connection even before the server listens on
        # the phone; that shows up as an immediate EOF, so retry briefly.
        deadline = time.monotonic() + 8.0
        while time.monotonic() < deadline:
            if self._proc is not None and self._proc.poll() is not None:
                raise CameraUnavailable(f"scrcpy server exited: {self._server_error() or 'unknown error'}")
            try:
                sock = socket.create_connection(("127.0.0.1", LOCAL_PORT), timeout=2.0)
                sock.settimeout(READ_TIMEOUT_S)
                first = sock.recv(65536)
                if first:
                    self._decode(first)
                    return sock
                sock.close()
            except OSError:
                pass
            time.sleep(0.3)
        raise CameraUnavailable("could not connect to scrcpy camera stream")

    def _server_error(self) -> str:
        if self._proc is None or self._proc.stderr is None or self._proc.poll() is None:
            return ""
        try:
            text = self._proc.stderr.read().decode(errors="replace")
        except Exception:
            return ""
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        errors = [ln for ln in lines if "ERROR" in ln or "Exception" in ln]
        return (errors or lines or [""])[0][:160]

    # ---------------- streaming ----------------
    def _decode(self, data: bytes) -> None:
        if self._codec is None:
            return
        import av

        try:
            packets = self._codec.parse(data)
        except av.error.FFmpegError:
            return
        for packet in packets:
            try:
                frames = self._codec.decode(packet)
            except av.error.FFmpegError:
                continue  # skip a corrupt packet; the next keyframe resyncs
            for frame in frames:
                img = frame.to_ndarray(format="bgr24")
                if self._rotate is not None:
                    img = cv2.rotate(img, self._rotate)
                self._pending.append(img)
        while len(self._pending) > 4:  # never fall behind live
            self._pending.popleft()

    def _fill(self, budget_s: float) -> None:
        if self._sock is None:
            raise CameraUnavailable("camera not open")
        self._sock.settimeout(max(0.1, min(READ_TIMEOUT_S, budget_s)))
        try:
            data = self._sock.recv(65536)
        except socket.timeout as exc:
            raise CameraUnavailable("phone camera stream stalled") from exc
        except OSError as exc:
            raise CameraUnavailable(f"phone camera stream error: {exc}") from exc
        if not data:
            raise CameraUnavailable("phone camera stream closed (camera taken by another app?)")
        self._decode(data)

    def read(self):
        while not self._pending:
            self._fill(READ_TIMEOUT_S)
        return self._pending.popleft()

    def close(self) -> None:
        if self._sock is not None:
            try:
                self._sock.close()
            except OSError:
                pass
            self._sock = None
        if self._proc is not None:
            if self._proc.poll() is None:
                self._proc.terminate()
                try:
                    self._proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    self._proc.kill()
            self._proc = None
        if self._serial:
            _run(["adb", "-s", self._serial, "shell", "pkill", "-f", f"scid={SCID}"])
            _run(["adb", "-s", self._serial, "forward", "--remove", f"tcp:{LOCAL_PORT}"])
        self._codec = None
        self._pending.clear()
        self._label = None
