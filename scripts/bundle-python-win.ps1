# Builds python-win/ : an embeddable Python 3.11 with the agent's packages already installed (used by the Windows installer, so users need no Python).
$ErrorActionPreference = "Stop"
$v = "3.11.9"; $d = "python-win"
New-Item -ItemType Directory -Force $d | Out-Null
Invoke-WebRequest "https://www.python.org/ftp/python/$v/python-$v-embed-amd64.zip" -OutFile py.zip
Expand-Archive py.zip $d -Force
$pth = Get-ChildItem "$d\python*._pth" | Select-Object -First 1
(Get-Content $pth) -replace '#import site', 'import site' | Set-Content $pth
Add-Content $pth "Lib\site-packages"
Invoke-WebRequest https://bootstrap.pypa.io/get-pip.py -OutFile get-pip.py
& "$d\python.exe" get-pip.py --no-warn-script-location
& "$d\python.exe" -m pip install --no-warn-script-location -r agent\requirements.txt
& "$d\python.exe" -c "import fastapi, uvicorn, sherpa_onnx, numpy, edge_tts; print('bundled python ok')"
