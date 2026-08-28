import json,sys
from pathlib import Path
root=Path(__file__).resolve().parent
source=Path(sys.argv[1]).expanduser() if len(sys.argv)>1 else root.parent/'umm-v2-radar'/'watchlist.json'
target=root/'radar_snapshot.json'
data=json.loads(source.read_text(encoding='utf-8'))
if not isinstance(data.get('tickers'),list): raise SystemExit("Invalid watchlist: 'tickers' must be a list")
tmp=target.with_suffix('.tmp');tmp.write_text(json.dumps(data,indent=2),encoding='utf-8');tmp.replace(target)
print(f"Published {len(data['tickers'])} tickers to {target.name}")
