[CmdletBinding()]
param(
    [string]$ModelName = 'qwen3.5:4b-learnstep',
    [string]$ModelDir,
    [string]$BaseModel = 'qwen3.5:4b-q4_K_M',
    [int]$NumCtx = 8192
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if (-not $ModelDir) {
    $ModelDir = Join-Path $root 'models/finetuned'
}
$resolvedDir = (Resolve-Path -LiteralPath $ModelDir).Path
$modelfilePath = Join-Path $resolvedDir 'Modelfile'

$allGguf = @(Get-ChildItem -LiteralPath $resolvedDir -Filter '*.gguf' -File | Sort-Object LastWriteTime -Descending)
$mmprojFiles = @($allGguf | Where-Object { $_.Name -match 'mmproj' })
$ollamaGgufFiles = @($allGguf | Where-Object { $_.Name -notmatch 'mmproj' -and $_.Name -match '\.ollama\.gguf$' })
$rawGgufFiles = @($allGguf | Where-Object { $_.Name -notmatch 'mmproj' -and $_.Name -notmatch '\.ollama\.gguf$' })
$mainGgufFiles = if ($ollamaGgufFiles.Count -gt 0) { $ollamaGgufFiles } else { $rawGgufFiles }
$adapterDir = Join-Path $resolvedDir 'adapter'

if ($mainGgufFiles.Count -gt 0) {
    $targetGguf = $mainGgufFiles[0].Name
    $lines = @("FROM ./$targetGguf")
    if ($mmprojFiles.Count -gt 0) {
        $targetMmproj = $mmprojFiles[0].Name
        $lines += "FROM ./$targetMmproj"
        Write-Host "Using GGUF: $targetGguf + mmproj: $targetMmproj"
    } else {
        Write-Host "Using GGUF: $targetGguf (no mmproj found)"
    }
    if ($targetGguf -match 'qwen3\.5' -or $ModelName -match 'qwen3\.5') {
        $lines += @(
            'TEMPLATE {{ .Prompt }}'
            'RENDERER qwen3.5'
            'PARSER qwen3.5'
        )
    }
    $lines += @(
        "PARAMETER num_ctx $NumCtx"
        'PARAMETER temperature 0.2'
        'PARAMETER top_k 20'
        'PARAMETER top_p 0.95'
        'PARAMETER presence_penalty 1.5'
    )
    $content = $lines -join [Environment]::NewLine
} elseif (Test-Path -LiteralPath $adapterDir -PathType Container) {
    $content = @(
        "FROM $BaseModel"
        'ADAPTER ./adapter'
        "PARAMETER num_ctx $NumCtx"
        'PARAMETER temperature 0.2'
    ) -join [Environment]::NewLine
    Write-Host "Using LoRA adapter directory: $adapterDir (base: $BaseModel)"
} else {
    throw "No .gguf file or adapter/ folder found in '$resolvedDir'. Place your finetuned model there first."
}

Set-Content -LiteralPath $modelfilePath -Value ($content + [Environment]::NewLine) -Encoding utf8

$ollama = (Get-Command ollama.exe).Source
Write-Host "Registering Ollama model '$ModelName' from $modelfilePath..."
Push-Location -LiteralPath $resolvedDir
try {
    & $ollama create $ModelName -f $modelfilePath
    if ($LASTEXITCODE -ne 0) {
        throw "ollama create failed with exit code $LASTEXITCODE."
    }
} finally {
    Pop-Location
}

Write-Host "Done. Set CHAT_MODEL=$ModelName and OLLAMA_THINKING_MODEL=$ModelName in your .env file."
