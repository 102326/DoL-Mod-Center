"""Package only explicitly declared mod assets; never crawl the workspace."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parent
SRC = ROOT / 'src'


def build():
    boot = json.loads((SRC / 'boot.json').read_text(encoding='utf-8'))
    version = boot['version']
    zip_name = f'DoLModCenter-{version}.mod.zip'
    names = {'boot.json'}
    for key in ('scriptFileList', 'styleFileList', 'tweeFileList', 'imgFileList', 'additionFile'):
        names.update(boot.get(key, []))
    for addon in boot.get('addonPlugin', []):
        if isinstance(addon.get('params'), list):
            for patch in addon['params']:
                if patch.get('replaceFile'):
                    names.add(patch['replaceFile'])
    payload = {}
    for name in sorted(names):
        source = (SRC / name).resolve()
        if not source.is_relative_to(SRC.resolve()) or '\\' in name:
            raise ValueError(f'Invalid package path: {name}')
        payload[name] = source.read_bytes()
    out = ROOT / 'dist' / zip_name
    out.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in payload.items():
            entry = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, data)
    with zipfile.ZipFile(out) as archive:
        assert archive.testzip() is None
        assert set(archive.namelist()) == set(payload)
        assert all(archive.read(name) == data for name, data in payload.items())
    print(json.dumps({'file': str(out), 'members': len(payload), 'sha256': hashlib.sha256(out.read_bytes()).hexdigest()}))


if __name__ == '__main__':
    build()
