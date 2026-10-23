[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('setup', 'init', 'start', 'status', 'stop', 'databases')]
    [string]$Action = 'start',
    [string]$PostgresBin = "$env:ProgramFiles\PostgreSQL\18\bin",
    [string]$DataDirectory = '.local\pgdata',
    [ValidateRange(1024, 65535)]
    [int]$Port = 5433,
    [string]$DatabaseUrl,
    [string]$TestDatabase
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeRoot = Join-Path $projectRoot '.local'
$dataPath = if ([System.IO.Path]::IsPathRooted($DataDirectory)) {
    [System.IO.Path]::GetFullPath($DataDirectory)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $projectRoot $DataDirectory))
}
$dataPath = $dataPath.TrimEnd('\')
if (-not $dataPath.StartsWith($runtimeRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'DataDirectory must be inside the project .local directory.'
}

$binPath = [System.IO.Path]::GetFullPath($PostgresBin)
$pgCtl = Join-Path $binPath 'pg_ctl.exe'
$initDb = Join-Path $binPath 'initdb.exe'
$psql = Join-Path $binPath 'psql.exe'
$postgres = Join-Path $binPath 'postgres.exe'
foreach ($executable in @($pgCtl, $initDb, $psql, $postgres)) {
    if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
        throw "PostgreSQL executable missing: $executable. Set -PostgresBin to the installed bin directory."
    }
}

if (-not $DatabaseUrl) {
    $DatabaseUrl = $env:DATABASE_URL
}
if (-not $DatabaseUrl -and (Test-Path -LiteralPath (Join-Path $projectRoot '.env'))) {
    foreach ($line in Get-Content -LiteralPath (Join-Path $projectRoot '.env')) {
        if ($line -match '^\s*DATABASE_URL\s*=\s*(.*?)\s*$') {
            $DatabaseUrl = $Matches[1].Trim('"', "'")
            break
        }
    }
}
if (-not $DatabaseUrl) {
    $DatabaseUrl = 'postgresql://compass:compass@localhost:5433/compass'
}
try {
    $connectionUri = [System.Uri]$DatabaseUrl
    if ($connectionUri.Scheme -notin @('postgresql', 'postgres')) {
        throw 'Unsupported connection scheme.'
    }
    if ($connectionUri.Host -notin @('localhost', '127.0.0.1', '::1', '[::1]')) {
        throw 'Non-local PostgreSQL host.'
    }
    $credentials = $connectionUri.UserInfo.Split(':', 2)
    $databaseUser = [System.Uri]::UnescapeDataString($credentials[0])
    $databasePassword = if ($credentials.Length -eq 2) {
        [System.Uri]::UnescapeDataString($credentials[1])
    } else {
        $env:PGPASSWORD
    }
    $databaseName = [System.Uri]::UnescapeDataString($connectionUri.AbsolutePath.TrimStart('/'))
    if (-not $PSBoundParameters.ContainsKey('Port') -and $connectionUri.Port -gt 0) {
        $Port = $connectionUri.Port
    }
} catch {
    throw 'DATABASE_URL must be a local PostgreSQL URL with a username and database name.'
}
if ($databaseUser -notmatch '^[a-z][a-z0-9_]{0,62}$' -or $databaseName -notmatch '^[a-z][a-z0-9_]{0,62}$') {
    throw 'Use simple lowercase PostgreSQL usernames and database names for the local setup.'
}
if (-not $TestDatabase) {
    $TestDatabase = $databaseName + '_test'
}
if ($TestDatabase -notmatch '^[a-z][a-z0-9_]{0,62}$' -or $TestDatabase -eq $databaseName) {
    throw 'TestDatabase must be a separate lowercase database name, at most 63 characters.'
}

$version = & $postgres --version
if ($LASTEXITCODE -ne 0 -or $version -notmatch '\) (\d+)') {
    throw 'Could not read the installed PostgreSQL version.'
}
$postgresMajor = $Matches[1]
$logPath = Join-Path $dataPath 'server.log'

function Assert-ExistingCluster {
    $versionFile = Join-Path $dataPath 'PG_VERSION'
    if (-not (Test-Path -LiteralPath $versionFile -PathType Leaf)) {
        throw 'No initialized project cluster found. Run this script with setup first.'
    }
    $clusterMajor = (Get-Content -LiteralPath $versionFile -Raw).Trim()
    if ($clusterMajor -ne $postgresMajor) {
        throw "This cluster requires PostgreSQL $clusterMajor. Select the matching -PostgresBin."
    }
}

function Test-ClusterRunning {
    $null = & $pgCtl -D $dataPath status 2>$null
    $statusCode = $LASTEXITCODE
    if ($statusCode -in @(3, 4)) {
        return $false
    }
    if ($statusCode -ne 0) {
        throw 'Could not inspect the project PostgreSQL process.'
    }
    $serverPid = [int](Get-Content -LiteralPath (Join-Path $dataPath 'postmaster.pid') -TotalCount 1)
    $serverProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$serverPid"
    if (-not $serverProcess -or -not $serverProcess.ExecutablePath -or -not $serverProcess.CommandLine) {
        throw 'Cannot verify the process recorded in this cluster. No process will be changed.'
    }
    $processPath = [System.IO.Path]::GetFullPath($serverProcess.ExecutablePath)
    $commandLine = $serverProcess.CommandLine.Replace('/', '\').ToLowerInvariant()
    $quotedDataPath = '"' + $dataPath.ToLowerInvariant() + '"'
    if ($processPath -ne $postgres -or -not $commandLine.Contains($quotedDataPath)) {
        throw 'The recorded process does not match this PostgreSQL executable and data directory.'
    }
    return $true
}

function Test-PortOccupied {
    foreach ($address in @([System.Net.IPAddress]::Loopback, [System.Net.IPAddress]::IPv6Loopback)) {
        $client = New-Object System.Net.Sockets.TcpClient($address.AddressFamily)
        try {
            $connectionTask = $client.ConnectAsync($address, $Port)
            if ($connectionTask.Wait(500) -and $client.Connected) {
                return $true
            }
        } catch [System.AggregateException] {
            # A refused loopback connection means that this address is free.
        } finally {
            $client.Dispose()
        }
    }
    return $false
}

function Invoke-ProjectSql([string]$Sql, [string]$Database = 'postgres') {
    $previousPassword = $env:PGPASSWORD
    try {
        $env:PGPASSWORD = $databasePassword
        $result = & $psql -X -w -q -A -t -h localhost -p $Port -U $databaseUser -d $Database -v ON_ERROR_STOP=1 -c $Sql
        if ($LASTEXITCODE -ne 0) {
            throw 'PostgreSQL command failed. Check the local credentials and database permissions.'
        }
        return $result
    } finally {
        [System.Environment]::SetEnvironmentVariable('PGPASSWORD', $previousPassword, 'Process')
    }
}

function Assert-ClusterConnection {
    $reportedDataPath = Invoke-ProjectSql 'SHOW data_directory'
    $reportedDataPath = [System.IO.Path]::GetFullPath(($reportedDataPath | Out-String).Trim())
    if ($reportedDataPath -ne $dataPath) {
        throw "Port $Port belongs to a different cluster. No changes were made to that server."
    }
}

function Initialize-ProjectCluster {
    if (Test-Path -LiteralPath $dataPath) {
        Assert-ExistingCluster
        Write-Host 'Existing project cluster retained.'
        return
    }
    if (-not $databasePassword) {
        throw 'Set a nonempty password in DATABASE_URL or PGPASSWORD before initializing PostgreSQL.'
    }
    $null = New-Item -ItemType Directory -Path $runtimeRoot -Force
    $passwordFile = Join-Path $runtimeRoot ('pg-password-' + [guid]::NewGuid().ToString('N') + '.txt')
    try {
        [System.IO.File]::WriteAllText($passwordFile, $databasePassword, (New-Object System.Text.UTF8Encoding($false)))
        & $initDb -D $dataPath -U $databaseUser --auth=scram-sha-256 --pwfile=$passwordFile --encoding=UTF8 --locale=C
        if ($LASTEXITCODE -ne 0) {
            throw 'Could not initialize PostgreSQL. Existing files were not replaced.'
        }
    } finally {
        [System.IO.File]::Delete($passwordFile)
    }
}

function Start-ProjectCluster {
    Assert-ExistingCluster
    if (-not (Test-ClusterRunning)) {
        if (Test-PortOccupied) {
            throw "Port $Port is already occupied. Choose another project port; no server was changed."
        }
        & $pgCtl -D $dataPath -l $logPath -o "-p $Port -h localhost -c timezone=Europe/Riga" -w start
        if ($LASTEXITCODE -ne 0) {
            throw "Could not start the project cluster. See $logPath."
        }
    }
    Assert-ClusterConnection
    Write-Host "Project PostgreSQL is running on localhost:$Port."
}

function Ensure-ProjectDatabases {
    Assert-ExistingCluster
    if (-not (Test-ClusterRunning)) {
        throw 'Start the project cluster before creating databases.'
    }
    Assert-ClusterConnection
    foreach ($name in @($databaseName, $TestDatabase)) {
        $exists = Invoke-ProjectSql ("SELECT 1 FROM pg_database WHERE datname = '{0}'" -f $name)
        if (($exists | Out-String).Trim() -ne '1') {
            $null = Invoke-ProjectSql ('CREATE DATABASE "{0}"' -f $name)
            Write-Host "Created database $name."
        } else {
            Write-Host "Database $name already exists."
        }
    }
}

switch ($Action) {
    'init' { Initialize-ProjectCluster }
    'start' { Start-ProjectCluster }
    'databases' { Ensure-ProjectDatabases }
    'setup' {
        Initialize-ProjectCluster
        Start-ProjectCluster
        Ensure-ProjectDatabases
    }
    'status' {
        Assert-ExistingCluster
        if (Test-ClusterRunning) {
            Assert-ClusterConnection
            Write-Host "$version; project cluster running on localhost:$Port."
        } else {
            Write-Host "$version; project cluster stopped."
        }
    }
    'stop' {
        Assert-ExistingCluster
        if (Test-ClusterRunning) {
            & $pgCtl -D $dataPath -m fast -w stop
            if ($LASTEXITCODE -ne 0) {
                throw 'Could not stop the project PostgreSQL cluster.'
            }
        } else {
            Write-Host 'Project cluster is already stopped.'
        }
    }
}

exit 0
