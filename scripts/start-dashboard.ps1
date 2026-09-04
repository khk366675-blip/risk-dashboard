$ErrorActionPreference = "Stop"

$projectDirectory = "C:\Users\khdkf\value-invest-dashboard"
$dashboardUrl = "http://127.0.0.1:3000/markets"
$healthUrl = "http://127.0.0.1:3000/markets"
$logDirectory = Join-Path $projectDirectory "logs"
$serverInfoPath = Join-Path $logDirectory "desktop-server.json"
$buildIdPath = Join-Path $projectDirectory ".next\BUILD_ID"

function Test-DashboardReady {
    try {
        $response = Invoke-WebRequest `
            -Uri $healthUrl `
            -UseBasicParsing `
            -TimeoutSec 5

        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
    }
    catch {
        return $false
    }
}

function Get-PortOwner {
    $connection = Get-NetTCPConnection `
        -LocalPort 3000 `
        -State Listen `
        -ErrorAction SilentlyContinue `
        | Select-Object -First 1

    if ($null -eq $connection) {
        return $null
    }

    return Get-CimInstance `
        -ClassName Win32_Process `
        -Filter "ProcessId = $($connection.OwningProcess)" `
        -ErrorAction SilentlyContinue
}

function Get-ServerInfo {
    if (-not (Test-Path -LiteralPath $serverInfoPath)) {
        return $null
    }

    try {
        return Get-Content -Raw -LiteralPath $serverInfoPath | ConvertFrom-Json
    }
    catch {
        return $null
    }
}

function Test-BuildRequired {
    if (-not (Test-Path -LiteralPath $buildIdPath)) {
        return $true
    }

    $buildTime = (Get-Item -LiteralPath $buildIdPath).LastWriteTimeUtc
    $sourcePaths = @(
        "app",
        "components",
        "lib",
        "research",
        "package.json",
        "package-lock.json",
        "next.config.ts",
        "postcss.config.mjs",
        "tsconfig.json"
    )

    foreach ($relativePath in $sourcePaths) {
        $candidate = Join-Path $projectDirectory $relativePath
        if (-not (Test-Path -LiteralPath $candidate)) {
            continue
        }

        $item = Get-Item -LiteralPath $candidate
        if (-not $item.PSIsContainer) {
            if ($item.LastWriteTimeUtc -gt $buildTime) {
                return $true
            }
            continue
        }

        $newerSource = Get-ChildItem -LiteralPath $candidate -Recurse -File |
            Where-Object { $_.LastWriteTimeUtc -gt $buildTime } |
            Select-Object -First 1
        if ($null -ne $newerSource) {
            return $true
        }
    }

    return $false
}

function Invoke-ProductionBuild {
    Write-Host "Preparing the optimized dashboard. This is only needed after code changes..."
    Push-Location $projectDirectory
    try {
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) {
            throw "The optimized dashboard build failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}

function Show-LaunchError([string]$message) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
        $message,
        "RISK Investment Dashboard",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
}

function Open-Dashboard {
    $browserCandidates = @(
        "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "C:\Program Files\Google\Chrome\Application\chrome.exe"
    )

    $browser = $browserCandidates |
        Where-Object { Test-Path -LiteralPath $_ } |
        Select-Object -First 1

    if ($browser) {
        Start-Process `
            -FilePath $browser `
            -ArgumentList @("--app=$dashboardUrl", "--start-maximized") `
            -WindowStyle Normal
        return
    }

    Start-Process $dashboardUrl
}

try {
    if (-not (Test-Path -LiteralPath $projectDirectory)) {
        throw "Project directory was not found: $projectDirectory"
    }

    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

    $ready = $false
    for ($attempt = 0; $attempt -lt 3; $attempt++) {
        if (Test-DashboardReady) {
            $ready = $true
            break
        }

        Start-Sleep -Seconds 1
    }

    $portOwner = Get-PortOwner
    $serverInfo = Get-ServerInfo
    $managedProductionServer =
        $ready -and
        $null -ne $portOwner -and
        $null -ne $serverInfo -and
        $serverInfo.mode -eq "production" -and
        [int]$serverInfo.pid -eq [int]$portOwner.ProcessId

    if ($managedProductionServer) {
        Open-Dashboard
        exit 0
    }

    if ($null -ne $portOwner) {
        $normalizedProjectDirectory = $projectDirectory.ToLowerInvariant()
        $ownerCommandLine = [string]$portOwner.CommandLine

        if ($ownerCommandLine.ToLowerInvariant().Contains($normalizedProjectDirectory)) {
            Stop-Process -Id $portOwner.ProcessId -Force
            for ($attempt = 0; $attempt -lt 10; $attempt++) {
                Start-Sleep -Milliseconds 500
                if ($null -eq (Get-PortOwner)) {
                    break
                }
            }

            if ($null -ne (Get-PortOwner)) {
                throw "The existing dashboard server could not be stopped."
            }
        }
        else {
            throw "Port 3000 is being used by another program.`n`nProgram: $($portOwner.Name)`nPID: $($portOwner.ProcessId)"
        }
    }

    if (Test-BuildRequired) {
        Invoke-ProductionBuild
    }

    $stdoutPath = Join-Path $logDirectory "desktop-launch.log"
    $stderrPath = Join-Path $logDirectory "desktop-launch-error.log"

    $serverProcess = Start-Process `
        -FilePath "npm.cmd" `
        -ArgumentList @("run", "start", "--", "--hostname", "127.0.0.1", "--port", "3000") `
        -WorkingDirectory $projectDirectory `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -PassThru

    $ready = $false
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        Start-Sleep -Seconds 1

        if (Test-DashboardReady) {
            $ready = $true
            break
        }

        if ($serverProcess.HasExited) {
            break
        }
    }

    if (-not $ready) {
        throw "The dashboard server did not start.`n`nCheck this log:`n$stderrPath"
    }

    $listener = Get-PortOwner
    $buildId = Get-Content -Raw -LiteralPath $buildIdPath
    @{
        mode = "production"
        pid = [int]$listener.ProcessId
        build_id = $buildId.Trim()
        started_at = (Get-Date).ToUniversalTime().ToString("o")
    } | ConvertTo-Json | Set-Content -LiteralPath $serverInfoPath -Encoding ASCII

    Open-Dashboard
}
catch {
    Show-LaunchError $_.Exception.Message
    exit 1
}
