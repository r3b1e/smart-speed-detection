"""Camera discovery test tool - helps verify iPhone camera is accessible."""

from __future__ import annotations

import argparse
import sys

from . import avfoundation


def discover_cameras() -> int:
    """List all available cameras and highlight the iPhone."""
    devices = avfoundation.camera_devices()
    
    if not devices:
        print("❌ No cameras visible to macOS")
        print("\nTroubleshooting checklist:")
        print("  • Check System Settings > Privacy & Security > Camera")
        print("  • Ensure Python/Terminal has camera permissions")
        print("  • Try restarting your Mac if Continuity Camera was just enabled")
        return 1
    
    print(f"Found {len(devices)} camera(s):\n")
    
    iphone_found = False
    for i, (unique_id, name) in enumerate(devices):
        is_iphone = "iphone" in name.lower()
        if is_iphone:
            iphone_found = True
            print(f"  ✅ [{i}] {name}")
            print(f"      Unique ID: {unique_id}")
            print(f"      👉 This is your iPhone camera - it will be used for scanning")
        else:
            print(f"  ⚪ [{i}] {name}")
            print(f"      Unique ID: {unique_id}")
        print()
    
    if not iphone_found:
        print("❌ No iPhone camera detected!\n")
        print("Continuity Camera Setup Checklist:")
        print("  1. Unlock your iPhone")
        print("  2. Ensure both devices use the same Apple ID")
        print("  3. Enable Wi-Fi and Bluetooth on both devices")
        print("  4. Enable Continuity Camera on iPhone:")
        print("     Settings > General > AirPlay & Handoff > Continuity Camera")
        print("  5. Ensure iOS 16+ on iPhone and macOS 13+ on Mac")
        print("  6. Mount iPhone physically (stand/tripod) and wait a moment")
        print("  7. Check that iPhone appears in Control Center > Video Input")
        return 1
    
    print("✅ iPhone camera is properly configured and ready for use!")
    
    try:
        chosen_id, chosen_name = avfoundation.choose_camera(devices)
        print(f"\nSelected camera: {chosen_name}")
        print(f"OpenCV index: {devices.index((chosen_id, chosen_name))}")
    except ValueError as e:
        print(f"\n❌ Error selecting camera: {e}")
        return 1
    
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Test camera discovery for Smart Speed Vision")
    parser.add_argument("--discover", action="store_true", help="List all available cameras")
    
    args = parser.parse_args()
    
    if args.discover:
        return discover_cameras()
    
    # Default: show discovery
    return discover_cameras()


if __name__ == "__main__":
    sys.exit(main())
