"""Extract a user-provided local ModLoader bundle for isolated tests; never commit it."""
from pathlib import Path
import re,sys
if len(sys.argv)!=2: raise SystemExit('Usage: python scripts/prepare-native.py PATH_TO_GAME_HTML')
root=Path(__file__).resolve().parent.parent
source=Path(sys.argv[1]).read_text(encoding='utf-8')
for match in re.finditer(r'<script\b[^>]*>(.*?)</script>',source,re.S):
 if 'class IndexDBLoader' in match[1]:
  (root/'mods/mod-center-v1/tests/native-loader.fixture.js').write_text(match[1],encoding='utf-8')
  print('Local test fixture prepared (gitignored).');break
else: raise RuntimeError('Compatible loader bundle not found')
