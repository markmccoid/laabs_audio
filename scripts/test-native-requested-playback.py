#!/usr/bin/env python3
"""Compile and exercise the production Swift requested-playback policy."""
import pathlib
import subprocess
import tempfile

root = pathlib.Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix="native-requested-playback-") as temp:
    binary = pathlib.Path(temp) / "requested-playback-tests"
    subprocess.run([
        "xcrun", "swiftc", "-module-cache-path", str(pathlib.Path(temp) / "module-cache"),
        str(root / "modules/react-native-audio-pro/ios/RequestedPlaybackState.swift"),
        str(root / "modules/react-native-audio-pro/ios/Tests/RequestedPlaybackStateTests.swift"),
        "-o", str(binary),
    ], check=True)
    subprocess.run([str(binary)], check=True)
