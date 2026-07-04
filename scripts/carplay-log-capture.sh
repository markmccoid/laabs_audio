#!/usr/bin/env bash
# Live CarPlay debugging capture from a physical iPhone.
#
# Streams the phone's syslog (USB preferred, Wi-Fi pairing as fallback),
# filters to CarPlay/LAABS/AudioPro lines, and tees to both the terminal and
# a timestamped file under logs/carplay/ so the session can be analyzed
# afterwards.
#
# Usage:
#   ./scripts/carplay-log-capture.sh              # filtered capture (default)
#   ./scripts/carplay-log-capture.sh --all        # full unfiltered firehose
#   ./scripts/carplay-log-capture.sh out.log      # explicit output file
#
# Requires: brew install libimobiledevice   (idevicesyslog, idevice_id)
# The iPhone must be paired/trusted with this Mac. CarPlay Simulator.app
# needs the phone on USB anyway, and USB also gives the most reliable stream.
set -euo pipefail

FILTER="CarPlay|LAABS|AudioPro"
OUT=""
for arg in "$@"; do
  case "$arg" in
    --all) FILTER="" ;;
    *) OUT="$arg" ;;
  esac
done

if ! command -v idevicesyslog >/dev/null; then
  echo "idevicesyslog not found — run: brew install libimobiledevice" >&2
  exit 1
fi

UDID=$(idevice_id -l 2>/dev/null | head -1 || true)
NET_FLAG=""
if [ -z "$UDID" ]; then
  UDID=$(idevice_id -n 2>/dev/null | head -1 || true)
  NET_FLAG="-n"
fi
if [ -z "$UDID" ]; then
  echo "No paired iPhone found (USB or network). Plug the phone in and trust this Mac." >&2
  exit 1
fi

REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$REPO_DIR/logs/carplay"
if [ -z "$OUT" ]; then
  OUT="$REPO_DIR/logs/carplay/carplay-$(date +%Y%m%d-%H%M%S).log"
fi

echo "Device:  $UDID ${NET_FLAG:+(over Wi-Fi — plug in USB for CarPlay Simulator)}"
echo "Output:  $OUT"
echo "Filter:  ${FILTER:-<none — full firehose>}"
echo "Stop with Ctrl-C. Marker lines you should see: [CarPlay], [CarPlay][JS], trace loadBook:*"
echo "---"

if [ -n "$FILTER" ]; then
  # shellcheck disable=SC2086
  idevicesyslog $NET_FLAG -u "$UDID" 2>/dev/null \
    | grep --line-buffered -E "$FILTER" \
    | tee "$OUT"
else
  # shellcheck disable=SC2086
  idevicesyslog $NET_FLAG -u "$UDID" 2>/dev/null | tee "$OUT"
fi
