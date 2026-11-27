[CmdletBinding()]
param(
    [ValidateSet('Local', 'Production')]
    [string]$Mode = 'Local',
    [string]$Checkout,
    [string]$EnvFile,
    [switch]$RestartLocalDatabase,
    [ValidateRange(1024, 65535)]
    [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if (-not $Checkout) { $Checkout = $root }
$checkoutRoot = (Resolve-Path -LiteralPath $Checkout).Path
$workerDir = (Resolve-Path -LiteralPath (Join-Path $checkoutRoot 'services/worker')).Path
if (-not $EnvFile) {
    $EnvFile = Join-Path $root $(if ($Mode -eq 'Local') { '.env' } else { 'services/worker/.env' })
}
$logs = Join-Path $checkoutRoot ('tmp/start-learnstep/' + $Mode.ToLowerInvariant())
New-Item -Path $logs -ItemType Directory -Force | Out-Null
$node = (Get-Command node.exe).Source
$uv = (Get-Command uv.exe).Source
if ((& $node --version) -notmatch '^v(\d+)' -or [int]$Matches[1] -lt 22) {
    throw 'LearnStep requires Node.js 22 or newer.'
}

function Assert-Succeeded([string]$step) {
    if ($LASTEXITCODE -ne 0) { throw "$step failed with exit code $LASTEXITCODE." }
}

function Invoke-NativeStep([scriptblock]$command) {
    # Windows PowerShell 5.1 can surface redirected native stderr as an error.
    # The caller checks the exit code so warnings do not abort startup.
    $ErrorActionPreference = 'Continue'
    & $command
}

function Wait-Until([string]$step, [scriptblock]$check, [int]$seconds = 90) {
    $until = [DateTime]::UtcNow.AddSeconds($seconds)
    do {
        if (& $check) { return }
        Start-Sleep -Seconds 2
    } while ([DateTime]::UtcNow -lt $until)
    throw "$step did not become ready. See $logs."
}

function Read-EnvFile([string]$path) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return @{} }
    $absolute = (Resolve-Path -LiteralPath $path).Path
    $result = @'
const fs = require("node:fs");
const { parseEnv } = require("node:util");
process.stdout.write(JSON.stringify(parseEnv(fs.readFileSync(process.argv[2], "utf8"))));
'@ | & $node --input-type=commonjs - $absolute
    Assert-Succeeded 'Reading the environment file'
    $values = @{}
    (ConvertFrom-Json -InputObject ($result -join [Environment]::NewLine)).PSObject.Properties | ForEach-Object {
        $values[$_.Name] = [string]$_.Value
    }
    return $values
}

function Test-Http([string]$url, [hashtable]$headers = @{}) {
    try { return (Invoke-WebRequest -Uri $url -Headers $headers -UseBasicParsing -TimeoutSec 4).StatusCode -eq 200 }
    catch { return $false }
}

function Test-LocalPostgres([uri]$url) {
    $client = [Net.Sockets.TcpClient]::new()
    try {
        return $client.ConnectAsync($url.Host, $url.Port).Wait(1500) -and $client.Connected
    } catch { return $false }
    finally { $client.Dispose() }
}

function Start-Logged([string]$file, [string[]]$arguments, [string]$directory, [string]$label) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $out = Join-Path $logs "$label-$stamp.out.log"
    $err = Join-Path $logs "$label-$stamp.err.log"
    $options = @{
        FilePath = $file; ArgumentList = @($arguments | ForEach-Object { '"' + $_ + '"' })
        WorkingDirectory = $directory; WindowStyle = 'Hidden'
        RedirectStandardOutput = $out; RedirectStandardError = $err; PassThru = $true
    }
    return @{ Process = Start-Process @options; Error = $err }
}

function Get-WorkerState {
    Push-Location -LiteralPath $workerDir
    try {
        $probe = @'
from study_worker.config import Settings
from study_worker.main import LOCK_ID, connect
with connect(Settings.load()) as conn:
    acquired = conn.execute("select pg_try_advisory_lock(%s) as acquired", (LOCK_ID,)).fetchone()["acquired"]
    if acquired:
        conn.execute("select pg_advisory_unlock(%s)", (LOCK_ID,))
    online = conn.execute("select public.app_worker_online() as online").fetchone()["online"]
    print("free" if acquired else ("ready" if online else "starting"))
'@
        $state = Invoke-NativeStep { $probe | & $uv run --frozen --no-sync python - 2>> (Join-Path $logs 'worker-probe.err.log') }
        Assert-Succeeded 'Checking the worker database connection'
        return ($state | Select-Object -Last 1)
    } finally { Pop-Location }
}

$config = Read-EnvFile $EnvFile
if ($Mode -ne 'Local' -and $RestartLocalDatabase) { throw '-RestartLocalDatabase only applies to Local mode.' }
if ($Mode -eq 'Local') {
    if ($Port -in @(6333, 11434, 54321, 54322, 54323, 54324)) { throw 'Choose a web port outside the database and model ports.' }
    $docker = (Get-Command docker.exe).Source
    $npx = (Get-Command npx.cmd).Source
    $npm = (Get-Command npm.cmd).Source
    Write-Host 'Starting Docker, Supabase and Qdrant locally...'
    Invoke-NativeStep { & $docker info --format '{{.ServerVersion}}' 2>$null } | Out-Null
    if ($LASTEXITCODE -ne 0) {
        $desktop = Join-Path $env:ProgramFiles 'Docker/Docker/Docker Desktop.exe'
        if (-not (Test-Path -LiteralPath $desktop)) { throw 'Open Docker Desktop or start the configured Docker engine.' }
        Start-Process -FilePath $desktop -WindowStyle Hidden
        Wait-Until 'Docker' {
            Invoke-NativeStep { & $docker info --format '{{.ServerVersion}}' 2>$null } | Out-Null
            $LASTEXITCODE -eq 0
        } 150
    }
    Push-Location -LiteralPath $checkoutRoot
    try {
        $cliVersion = Invoke-NativeStep { & $npx --yes supabase --version 2>$null }
        Assert-Succeeded 'Checking Supabase CLI'
        if ($RestartLocalDatabase) {
            Invoke-NativeStep { & $npx --yes supabase stop *> (Join-Path $logs 'supabase-stop.log') }
            Assert-Succeeded "Stopping local Supabase without deleting volumes (see $logs)"
        }
        $status = Invoke-NativeStep { & $npx --yes supabase status -o json 2>$null }
        if ($LASTEXITCODE -ne 0) {
            # Supabase prints local credentials on startup. Keep stdout out of logs.
            Invoke-NativeStep { & $npx --yes supabase start 1>$null 2> (Join-Path $logs 'supabase-start.err.log') }
            Assert-Succeeded "Starting Supabase (see $logs)"
            $status = Invoke-NativeStep { & $npx --yes supabase status -o json 2>$null }
            Assert-Succeeded 'Reading local Supabase status'
        }
        $db = ConvertFrom-Json -InputObject ($status -join [Environment]::NewLine)
        $anon = if ($db.ANON_KEY) { $db.ANON_KEY } else { $db.PUBLISHABLE_KEY }
        $secret = if ($db.SERVICE_ROLE_KEY) { $db.SERVICE_ROLE_KEY } else { $db.SECRET_KEY }
        if (-not ($db.API_URL -and $db.DB_URL -and $anon -and $secret)) {
            throw 'Supabase CLI did not report the local API, database and keys.'
        }
        if (-not ([uri]$db.DB_URL).IsLoopback -or -not ([uri]$db.API_URL).IsLoopback) {
            throw 'Local mode requires a loopback Supabase API and database.'
        }
        Wait-Until 'Local PostgreSQL' { Test-LocalPostgres ([uri]$db.DB_URL) } 45
        $migrationArgs = @('migration', 'up')
        # Supabase CLI 3 uses the local database by default and removes --local.
        if ($cliVersion -match '^2\.') { $migrationArgs += '--local' }
        elseif ($cliVersion -notmatch '^3\.') { throw "Unsupported Supabase CLI version. Install v2 or v3." }
        $migrationLog = Join-Path $logs 'supabase-migrations.log'
        Invoke-NativeStep { & $npx --yes supabase @migrationArgs *> $migrationLog }
        if ($LASTEXITCODE -ne 0 -and (Select-String -LiteralPath $migrationLog -Pattern 'MigrationMissingLocalError|migration versions not found' -Quiet)) {
            throw "The local database has migrations missing from '$checkoutRoot'. Run again with -Checkout pointing to an up-to-date worktree. See $migrationLog."
        }
        Assert-Succeeded "Applying local Supabase migrations (see $logs)"
        $apiHeaders = @{ apikey = $anon }
        Wait-Until 'Supabase Auth' { Test-Http "$($db.API_URL)/auth/v1/health" $apiHeaders }
        Wait-Until 'Supabase Storage' { Test-Http "$($db.API_URL)/storage/v1/status" $apiHeaders }
        if (-not (Test-Path -LiteralPath 'node_modules/next/dist/bin/next')) {
            & $npm ci
            Assert-Succeeded 'Installing web dependencies'
        }
    } finally { Pop-Location }
    $container = 'learnstep-qdrant-local'
    $qdrant = Invoke-NativeStep { & $docker inspect --format '{{.State.Running}}' $container 2>$null }
    if ($LASTEXITCODE -ne 0) {
        $argsQdrant = @('run', '-d', '--name', $container, '--restart', 'unless-stopped', '-p', '127.0.0.1:6333:6333',
            '-v', 'learnstep-qdrant-local:/qdrant/storage', 'qdrant/qdrant:v1.20.0')
        & $docker @argsQdrant | Out-Null
        Assert-Succeeded 'Creating Qdrant'
    } elseif ($qdrant -ne 'true') {
        & $docker start $container | Out-Null
        Assert-Succeeded 'Starting Qdrant'
    }
    Wait-Until 'Qdrant' { Test-Http 'http://127.0.0.1:6333/readyz' }
    $local = @{
        DATABASE_URL = $db.DB_URL; SUPABASE_URL = $db.API_URL; NEXT_PUBLIC_SUPABASE_URL = $db.API_URL
        NEXT_PUBLIC_SUPABASE_ANON_KEY = $anon; SUPABASE_SERVICE_ROLE_KEY = $secret
        QDRANT_URL = 'http://127.0.0.1:6333'; QDRANT_API_KEY = ''; QDRANT_COLLECTION = 'study_bge_m3_v1'
        AI_PROVIDER = 'ollama'; CHAT_FALLBACK_PROVIDER = 'none'; OLLAMA_URL = 'http://127.0.0.1:11434'
        # Windows PowerShell 5.1 removes empty environment entries. Prevent the
        # worker from then loading cloud values from its own .env file.
        PYTHON_DOTENV_DISABLED = '1'; BGE_EMBEDDINGS_URL = ''
        CLOUD_WORKER_URL = 'http://127.0.0.1'; WORKER_WAKE_SECRET = ''
        CHAT_MODEL = 'qwen3.5:4b-q4_K_M'; EMBED_MODEL = 'bge-m3'
    }
    foreach ($name in @('CHAT_MODEL', 'EMBED_MODEL')) {
        if ($config[$name]) { $local[$name] = $config[$name] }
    }
    foreach ($name in @('TOKENIZER_MODEL', 'TOKENIZER_PATH', 'RETRIEVAL_MIN_SCORE', 'SEARXNG_URL', 'OLLAMA_THINKING_MODEL', 'PDF_PARSER', 'OCR_MODEL',
        'PADDLE_OCR_DEVICE', 'TESSERACT_EXECUTABLE', 'TESSDATA_PREFIX', 'OCR_LLAMA_SERVER',
        'OCR_GGUF_MODEL', 'OCR_GGUF_MMPROJ', 'MINERU_PYTHON', 'MINERU_MODEL_PATH', 'MINERU_BATCH_SIZE')) {
        if ($config.ContainsKey($name)) { $local[$name] = $config[$name] }
    }
    $config = $local
} else {
    if (-not $config.SUPABASE_URL -or -not $config.DATABASE_URL -or -not $config.QDRANT_URL) {
        throw 'Production mode requires the worker cloud environment file with Supabase, PostgreSQL and Qdrant endpoints.'
    }
    if (([uri]$config.SUPABASE_URL).IsLoopback -or ([uri]$config.DATABASE_URL).IsLoopback -or ([uri]$config.QDRANT_URL).IsLoopback) {
        throw 'Production mode requires hosted Supabase, PostgreSQL and Qdrant endpoints.'
    }
    if ($config.MINERU_PYTHON -and -not (Select-String -LiteralPath (Join-Path $workerDir 'src/study_worker/main.py') -Pattern 'learnstep-mineru' -SimpleMatch -Quiet)) {
        throw 'This checkout predates the production MinerU worker. Select the production checkout with -Checkout.'
    }
}

$backup = @{}
try {
    foreach ($key in $config.Keys) {
        $backup[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
        Set-Item -LiteralPath "Env:$key" -Value ([string]$config[$key])
    }
    if ((-not $config.AI_PROVIDER) -or $config.AI_PROVIDER -eq 'ollama') {
        $ollama = (Get-Command ollama.exe).Source
        $ollamaUrl = if ($config.OLLAMA_URL) { $config.OLLAMA_URL.TrimEnd('/') } else { 'http://127.0.0.1:11434' }
        if (-not ([uri]$ollamaUrl).IsLoopback) { throw 'Ollama must use a loopback address.' }
        if (-not $backup.ContainsKey('OLLAMA_HOST')) { $backup['OLLAMA_HOST'] = $env:OLLAMA_HOST }
        $env:OLLAMA_HOST = ([uri]$ollamaUrl).Authority
        if (-not (Test-Http "$ollamaUrl/api/tags")) {
            Write-Host 'Starting Ollama...'
            $null = Start-Logged $ollama @('serve') $checkoutRoot 'ollama'
            Wait-Until 'Ollama' { Test-Http "$ollamaUrl/api/tags" }
        }
        $tags = (Invoke-RestMethod -Uri "$ollamaUrl/api/tags" -TimeoutSec 4).models.name
        $chat = if ($config.CHAT_MODEL) { $config.CHAT_MODEL } else { 'qwen3.5:4b-q4_K_M' }
        $embed = if ($config.EMBED_MODEL) { $config.EMBED_MODEL } else { 'bge-m3' }
        $localModelDir = Join-Path $checkoutRoot 'models/finetuned'
        $localModelfile = Join-Path $localModelDir 'Modelfile'
        $models = @($chat, $embed)
        if ($config.OLLAMA_THINKING_MODEL) { $models += $config.OLLAMA_THINKING_MODEL }
        if ($config.PDF_PARSER -eq 'ollama_ocr' -and $config.OCR_MODEL) { $models += $config.OCR_MODEL }
        foreach ($model in ($models | Select-Object -Unique)) {
            if ($model -notin $tags -and "$($model):latest" -notin $tags) {
                if (($model -eq $chat -or $model -eq $config.OLLAMA_THINKING_MODEL) -and (Test-Path -LiteralPath $localModelfile -PathType Leaf)) {
                    Write-Host "Creating local Ollama model $model from $localModelfile..."
                    Push-Location -LiteralPath $localModelDir
                    try {
                        & $ollama create $model -f $localModelfile
                        Assert-Succeeded "Creating local model $model"
                    } finally { Pop-Location }
                } else {
                    Write-Host "Downloading Ollama model $model..."
                    & $ollama pull $model
                    Assert-Succeeded "Downloading $model"
                }
            }
        }
    }
    Push-Location -LiteralPath $workerDir
    try {
        & $uv sync --frozen
        Assert-Succeeded 'Preparing the worker environment'
    } finally { Pop-Location }

    $workerState = Get-WorkerState
    if ($workerState -eq 'starting') {
        Wait-Until 'Current queue worker' { (Get-WorkerState) -ne 'starting' }
        $workerState = Get-WorkerState
    }
    if ($workerState -eq 'ready') {
        Write-Host 'Reusing the worker already connected to this queue.'
    } else {
        Write-Host 'Starting the worker...'
        $worker = Start-Logged $uv @('run', '--frozen', '--no-sync', 'learnstep-worker') $workerDir 'worker'
        Wait-Until 'Worker' {
            if ($worker.Process.HasExited) { throw "Worker exited. See $($worker.Error)." }
            Select-String -LiteralPath $worker.Error -Pattern 'worker_ready' -SimpleMatch -Quiet
        }
    }

    if ($Mode -eq 'Local') {
        $webDir = Join-Path $checkoutRoot 'apps/web'
        $next = Join-Path $checkoutRoot 'node_modules/next/dist/bin/next'
        $webUrl = "http://127.0.0.1:$Port"
        $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
        if ($listeners.Count -eq 0) {
            Write-Host 'Starting the web app...'
            $web = Start-Logged $node @($next, 'dev', '--hostname', '127.0.0.1', '--port', "$Port") $webDir 'web'
            Wait-Until 'LearnStep web' {
                if ($web.Process.HasExited) { throw "Web exited. See $($web.Error)." }
                Test-Http "$webUrl/"
            }
        } else {
            $processes = Get-CimInstance Win32_Process
            foreach ($listener in $listeners) {
                $current = $processes | Where-Object ProcessId -eq $listener.OwningProcess
                while ($current -and (-not $current.CommandLine -or -not $current.CommandLine.Contains($next)) -and
                    $current.ParentProcessId -gt 0 -and $current.ParentProcessId -ne $current.ProcessId) {
                    $current = $processes | Where-Object ProcessId -eq $current.ParentProcessId
                }
                if (-not $current.CommandLine -or -not $current.CommandLine.Contains($next)) {
                    throw "Port $Port is already used. Run the command with -Port to choose another port."
                }
            }
            Wait-Until 'LearnStep web' { Test-Http "$webUrl/" }
            Write-Host 'Reusing the web app already listening on this port.'
        }
        Write-Host "LearnStep local: $webUrl/study"
    } else {
        Write-Host 'LearnStep production: https://learnstep-gamma.vercel.app/study'
    }
    Write-Host "Logs: $logs"
} finally {
    foreach ($key in $backup.Keys) {
        [Environment]::SetEnvironmentVariable($key, $backup[$key], 'Process')
    }
}
