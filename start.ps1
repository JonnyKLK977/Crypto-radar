$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$bundledPython = 'C:\Users\joan.stopper\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'

if (Get-Command python -ErrorAction SilentlyContinue) {
    $python = (Get-Command python).Source
} elseif (Test-Path -LiteralPath $bundledPython) {
    $python = $bundledPython
} else {
    throw 'Python 3 non trovato. Installa Python 3.11 o successivo e riprova.'
}

$url = 'http://127.0.0.1:8765'
Start-Process $url
& $python (Join-Path $root 'app.py')
