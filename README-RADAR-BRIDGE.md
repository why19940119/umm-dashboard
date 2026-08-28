# Local Radar Bridge

Run after the existing radar has written its `watchlist.json`:

```bash
cd ~/projects/umm-dashboard
python3 publish_radar_snapshot.py
```

This only reads `../umm-v2-radar/watchlist.json` and writes `radar_snapshot.json` in this dashboard folder. It does not modify the Radar project.
