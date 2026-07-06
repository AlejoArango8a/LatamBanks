import subprocess, json, zipfile, io, re
from urllib.request import Request, urlopen

r = subprocess.run(['git','credential','fill'],input='protocol=https\nhost=github.com\n\n',capture_output=True,text=True)
token = next((l[9:] for l in r.stdout.splitlines() if l.startswith('password=')), None)
headers = {'Authorization': f'token {token}', 'Accept': 'application/vnd.github+json'}

# Get raw log ZIP
log_url = 'https://api.github.com/repos/AlejoArango8a/LatamBanks/actions/runs/28830917301/logs'
req = Request(log_url, headers=headers)
with urlopen(req, timeout=30) as resp:
    raw = resp.read()

zf = zipfile.ZipFile(io.BytesIO(raw))
for name in sorted(zf.namelist()):
    if 'autom' in name.lower() or 'loader' in name.lower() or '_5_' in name or 'Correr' in name:
        print(f'\n=== {name} ===')
        text = zf.read(name).decode('utf-8', errors='replace')
        for line in text.splitlines():
            clean = re.sub(r'^\d{4}-\d{2}-\d{2}T[\d:.Z]+\s+', '', line).strip()
            if clean:
                print(clean.encode('ascii', errors='replace').decode('ascii'))
