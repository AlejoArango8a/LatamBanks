import subprocess, json
from urllib.request import Request, urlopen

r = subprocess.run(['git','credential','fill'],input='protocol=https\nhost=github.com\n\n',capture_output=True,text=True)
token = next((l[9:] for l in r.stdout.splitlines() if l.startswith('password=')), None)

url = 'https://api.github.com/repos/AlejoArango8a/LatamBanks/actions/workflows/brasil_auto_update.yml/runs?per_page=5'
req = Request(url, headers={'Authorization': f'token {token}','Accept': 'application/vnd.github+json'})
with urlopen(req, timeout=15) as resp:
    data = json.loads(resp.read())
for run in data['workflow_runs'][:5]:
    print(f"id={run['id']} status={run['status']:12s} conclusion={str(run['conclusion']):10s} event={run['event']:18s} created={run['created_at'][:19]}")
