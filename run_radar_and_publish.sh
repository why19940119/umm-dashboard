#!/bin/bash
set -u
RADAR=/Users/fat/projects/umm-v2-radar
DASHBOARD=/Users/fat/projects/umm-dashboard
PYTHON="$RADAR/.venv/bin/python"
LOGDIR="$RADAR/logs"
LOCK="$RADAR/.radar_dashboard.lock"
mkdir -p "$LOGDIR"
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "$(date '+%F %T') skipped: previous run is still active" >> "$LOGDIR/radar_dashboard.log"
  exit 0
fi
trap 'rmdir "$LOCK"' EXIT
{
  echo "===== $(date '+%F %T %Z') radar run ====="
  cd "$RADAR" && "$PYTHON" stock_radar_v2_extended.py
  cd "$DASHBOARD" && "$PYTHON" publish_radar_snapshot.py
  echo "===== completed ====="
} >> "$LOGDIR/radar_dashboard.log" 2>&1
