[CmdletBinding()]
param(
  [string]$OutputDirectory = '',
  [switch]$ValidationOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDirectory = Split-Path -Parent $PSCommandPath
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $scriptDirectory '..')).Path

# Keep this allowlist deliberately small. Runtime data and development helpers must
# never be copied into a package implicitly.
$packageFiles = @(
  'SETUP-FACEBOOK-WORKER.cmd',
  'START-FACEBOOK-WORKER.cmd',
  'FACEBOOK-WORKER-SECOND-PC-TH.txt',
  'package.json',
  'package-lock.json',
  'facebook-worker/backend-client.js',
  'facebook-worker/facebook-page.js',
  'facebook-worker/instance-lock.js',
  'facebook-worker/lease-keeper.js',
  'facebook-worker/pairing-store.js',
  'facebook-worker/portable-preflight.js',
  'facebook-worker/recovery.js',
  'facebook-worker/result-store.js',
  'facebook-worker/telemetry.js',
  'facebook-worker/worker.js'
)

$forbiddenPackagePathPatterns = @(
  '(?i)(^|/)(node_modules|tests?|cache|caches|logs?|backups?|artifacts?)(/|$)',
  '(?i)(^|/)(\.facebook-worker-profile|\.facebook-worker-state|FacebookWorkerProfile)(/|$)',
  '(?i)(^|/)(worker-pair\.json|worker-results\.json(?:\.bak)?|worker-telemetry\.jsonl(?:\.1)?|npm-debug\.log.*)(/|$)',
  '(?i)(^|/)(dev-server\.js|test\.js|\.env(?:\..*)?|\.npmrc|Cookies|Local State)$'
)

$forbiddenContentPatterns = @(
  @{ Label = 'absolute Windows user path'; Pattern = '(?i)[A-Z]:\\Users\\[^\\\r\n]+' },
  @{ Label = 'absolute Unix user path'; Pattern = '(?i)/Users/[^/\r\n]+' },
  @{ Label = 'local repository path'; Pattern = '(?i)dmo-backoffice-pro-phase-1-chatgpt|v20_2_production_repo|Documents[\\/]+Codex' },
  @{ Label = 'development/test URL'; Pattern = '(?i)https?://(?:localhost|127\.0\.0\.1)(?::(?:3000|4173|4174|4175|5173))\b|shop-name-test=|test-deployment' },
  @{ Label = 'embedded Apps Script deployment URL'; Pattern = '(?i)https://script\.google\.com/macros/s/AKfy[a-z0-9_-]+' },
  @{ Label = 'Facebook Worker pair token'; Pattern = '(?i)fbw_[a-f0-9]{64}' },
  @{ Label = 'GitHub access token'; Pattern = '(?i)(?:gh[pousr]_[a-z0-9]{30,}|github_pat_[a-z0-9_]{30,})' },
  @{ Label = 'Google API key'; Pattern = 'AIza[0-9A-Za-z_-]{30,}' },
  @{ Label = 'private key'; Pattern = '-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----' },
  @{ Label = 'raw cookie assignment'; Pattern = '(?im)^\s*(?:cookie|set-cookie)\s*[:=]' },
  @{ Label = 'literal password assignment'; Pattern = '(?im)^\s*(?:password|passwd)\s*[:=]\s*["''][^"'']+' }
)

function Assert-SafeRelativePath {
  param([Parameter(Mandatory = $true)][string]$RelativePath)

  $normalized = $RelativePath.Replace('\', '/')
  if ([string]::IsNullOrWhiteSpace($normalized) -or
      $normalized.StartsWith('/') -or
      $normalized.Contains(':') -or
      $normalized.Split('/') -contains '..') {
    throw "Unsafe package path: $RelativePath"
  }
  foreach ($pattern in $forbiddenPackagePathPatterns) {
    if ($normalized -match $pattern) {
      throw "Forbidden file in package: $RelativePath"
    }
  }
}

function Assert-SafeTextFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$DisplayName
  )

  $content = [System.IO.File]::ReadAllText($Path)
  foreach ($rule in $forbiddenContentPatterns) {
    if ($content -match $rule.Pattern) {
      throw "Forbidden content ($($rule.Label)) in $DisplayName"
    }
  }
}

function Get-Sha256 {
  param([Parameter(Mandatory = $true)][string]$Path)
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToUpperInvariant()
}

function Assert-ExactFileSet {
  param(
    [Parameter(Mandatory = $true)][string[]]$Actual,
    [Parameter(Mandatory = $true)][string[]]$Expected,
    [Parameter(Mandatory = $true)][string]$Context
  )

  $actualSorted = @($Actual | ForEach-Object { $_.Replace('\', '/') } | Sort-Object)
  $expectedSorted = @($Expected | ForEach-Object { $_.Replace('\', '/') } | Sort-Object)
  if ($actualSorted.Count -ne $expectedSorted.Count -or
      (($actualSorted -join "`n") -cne ($expectedSorted -join "`n"))) {
    $difference = Compare-Object -ReferenceObject $expectedSorted -DifferenceObject $actualSorted
    throw "$Context does not match the 15-file allowlist: $($difference | Out-String)"
  }
}

function New-DeterministicZip {
  param(
    [Parameter(Mandatory = $true)][string]$DestinationPath,
    [Parameter(Mandatory = $true)][string[]]$RelativeFiles
  )

  $fileStream = [System.IO.File]::Open(
    $DestinationPath,
    [System.IO.FileMode]::CreateNew,
    [System.IO.FileAccess]::Write,
    [System.IO.FileShare]::None
  )
  $archive = $null
  try {
    $archive = [System.IO.Compression.ZipArchive]::new(
      $fileStream,
      [System.IO.Compression.ZipArchiveMode]::Create,
      $false,
      [System.Text.Encoding]::UTF8
    )
    $fixedTimestamp = [System.DateTimeOffset]::new(2000, 1, 1, 0, 0, 0, [System.TimeSpan]::Zero)
    foreach ($relativePath in ($RelativeFiles | Sort-Object)) {
      $entryName = $relativePath.Replace('\', '/')
      $entry = $archive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
      $entry.LastWriteTime = $fixedTimestamp
      $sourceStream = [System.IO.File]::OpenRead((Join-Path $repoRoot $relativePath))
      $entryStream = $null
      try {
        $entryStream = $entry.Open()
        $sourceStream.CopyTo($entryStream)
      } finally {
        if ($null -ne $entryStream) { $entryStream.Dispose() }
        $sourceStream.Dispose()
      }
    }
  } finally {
    if ($null -ne $archive) { $archive.Dispose() }
    $fileStream.Dispose()
  }
}

function Test-ZipAndExtractedPackage {
  param(
    [Parameter(Mandatory = $true)][string]$ZipPath,
    [Parameter(Mandatory = $true)][string]$ExtractionPath
  )

  $archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    $entryNames = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
    Assert-ExactFileSet -Actual $entryNames -Expected $packageFiles -Context 'ZIP entries'

    $caseInsensitiveNames = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($entryName in $entryNames) {
      Assert-SafeRelativePath -RelativePath $entryName
      if (-not $caseInsensitiveNames.Add($entryName)) {
        throw "Duplicate ZIP entry: $entryName"
      }
    }
  } finally {
    $archive.Dispose()
  }

  [System.IO.Directory]::CreateDirectory($ExtractionPath) | Out-Null
  [System.IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $ExtractionPath)

  $extractedFiles = @(
    Get-ChildItem -LiteralPath $ExtractionPath -Recurse -File | ForEach-Object {
      $_.FullName.Substring($ExtractionPath.Length).TrimStart('\', '/').Replace('\', '/')
    }
  )
  Assert-ExactFileSet -Actual $extractedFiles -Expected $packageFiles -Context 'Extracted files'

  foreach ($relativePath in $packageFiles) {
    $normalized = $relativePath.Replace('\', '/')
    Assert-SafeRelativePath -RelativePath $normalized
    $sourcePath = Join-Path $repoRoot $relativePath
    $extractedPath = Join-Path $ExtractionPath ($normalized.Replace('/', [System.IO.Path]::DirectorySeparatorChar))
    if ((Get-Sha256 -Path $sourcePath) -cne (Get-Sha256 -Path $extractedPath)) {
      throw "Extracted file differs from source: $relativePath"
    }
    Assert-SafeTextFile -Path $extractedPath -DisplayName $relativePath
  }

  $setupText = [System.IO.File]::ReadAllText((Join-Path $ExtractionPath 'SETUP-FACEBOOK-WORKER.cmd'))
  $startText = [System.IO.File]::ReadAllText((Join-Path $ExtractionPath 'START-FACEBOOK-WORKER.cmd'))
  foreach ($requiredSetupText in @('cd /d "%~dp0"', 'portable-preflight.js" setup', 'npm ci --omit=dev')) {
    if (-not $setupText.Contains($requiredSetupText)) {
      throw "Setup portability requirement is missing: $requiredSetupText"
    }
  }
  foreach ($requiredStartText in @('cd /d "%~dp0"', 'portable-preflight.js" start', 'facebook-worker\worker.js')) {
    if (-not $startText.Contains($requiredStartText)) {
      throw "Start portability requirement is missing: $requiredStartText"
    }
  }

  $nodeCommand = Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1
  foreach ($relativePath in ($packageFiles | Where-Object { $_.EndsWith('.js', [System.StringComparison]::OrdinalIgnoreCase) })) {
    $javascriptPath = Join-Path $ExtractionPath ($relativePath.Replace('/', [System.IO.Path]::DirectorySeparatorChar))
    & $nodeCommand.Source '--check' $javascriptPath
    if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax check failed: $relativePath" }
  }

  # This exercises path resolution from an extracted directory containing spaces.
  # It imports only pure helpers: it does not run SETUP/START, probe port 17821,
  # install dependencies, launch Chrome, or create/read the real PC1 profile.
  $isolatedProfile = Join-Path $ExtractionPath 'Isolated Profile For Validation Only'
  $preflightPath = Join-Path $ExtractionPath 'facebook-worker\portable-preflight.js'
  $preflightSimulation = @'
const path = require('path');
const preflight = require(process.argv[1]);
const isolatedProfile = path.resolve(process.argv[2]);
if (!preflight.nodeMajorSupported(process.versions.node)) throw Error('NODE_VERSION_NOT_SUPPORTED');
if (preflight.workerPort({}) !== 17821) throw Error('DEFAULT_PORT_CHANGED');
if (preflight.portableProfileDir({ FACEBOOK_WORKER_PROFILE_DIR: isolatedProfile }, 'ignored') !== isolatedProfile) {
  throw Error('ISOLATED_PROFILE_RESOLUTION_FAILED');
}
'@
  & $nodeCommand.Source '-e' $preflightSimulation $preflightPath $isolatedProfile
  if ($LASTEXITCODE -ne 0) { throw 'Isolated setup path simulation failed.' }
  if (Test-Path -LiteralPath $isolatedProfile) {
    throw 'The setup path simulation unexpectedly created a profile directory.'
  }
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

if ($packageFiles.Count -ne 15) {
  throw "Portable Worker allowlist must contain exactly 15 files; found $($packageFiles.Count)."
}
Assert-ExactFileSet -Actual $packageFiles -Expected ($packageFiles | Select-Object -Unique) -Context 'Source allowlist'

foreach ($relativePath in $packageFiles) {
  Assert-SafeRelativePath -RelativePath $relativePath
  $sourcePath = Join-Path $repoRoot $relativePath
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw "Required package source is missing: $relativePath"
  }
  $sourceItem = Get-Item -LiteralPath $sourcePath
  if (($sourceItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Package source cannot be a symlink/reparse point: $relativePath"
  }
  Assert-SafeTextFile -Path $sourcePath -DisplayName $relativePath
}

$packageMetadataValidation = @'
const fs = require('fs');
const [packagePath, lockPath] = process.argv.slice(1);
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
if (String(packageJson.version) !== String(packageLock.version)) {
  throw new Error('package.json and package-lock.json versions do not match.');
}
if (!packageJson.dependencies?.['playwright-core'] || !packageLock.packages?.['node_modules/playwright-core']) {
  throw new Error('The locked playwright-core runtime dependency is missing.');
}
process.stdout.write(String(packageJson.version));
'@
$metadataNodeCommand = Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1
$workerVersion = (& $metadataNodeCommand.Source '-e' $packageMetadataValidation (Join-Path $repoRoot 'package.json') (Join-Path $repoRoot 'package-lock.json')).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Portable package metadata validation failed.' }

$commit = (& git -C $repoRoot rev-parse --short=7 HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[0-9a-f]{7,}$') {
  throw 'Unable to resolve a valid Git commit for the package name.'
}

if (-not $ValidationOnly) {
  & git -C $repoRoot diff --quiet --exit-code
  if ($LASTEXITCODE -ne 0) { throw 'Tracked working-tree changes must be committed before publishing a Portable Worker ZIP.' }
  & git -C $repoRoot diff --cached --quiet --exit-code
  if ($LASTEXITCODE -ne 0) { throw 'Staged changes must be committed before publishing a Portable Worker ZIP.' }
}

$tempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\', '/')
$workingRoot = Join-Path $tempBase ("DMO Portable Worker Build {0} {1}" -f $PID, [System.Guid]::NewGuid().ToString('N'))
$workingRoot = [System.IO.Path]::GetFullPath($workingRoot)
if (-not $workingRoot.StartsWith($tempBase + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Refusing to create a validation directory outside the system temporary directory.'
}

[System.IO.Directory]::CreateDirectory($workingRoot) | Out-Null
$packageName = "GUN-SHOP-DMO-FACEBOOK-WORKER-SINGLE-ACCOUNT-$commit"
$candidateOne = Join-Path $workingRoot "$packageName.candidate-1.zip"
$candidateTwo = Join-Path $workingRoot "$packageName.candidate-2.zip"
$extractionPath = Join-Path $workingRoot 'Extracted Package With Spaces'

try {
  New-DeterministicZip -DestinationPath $candidateOne -RelativeFiles $packageFiles
  New-DeterministicZip -DestinationPath $candidateTwo -RelativeFiles $packageFiles
  $candidateHash = Get-Sha256 -Path $candidateOne
  if ($candidateHash -cne (Get-Sha256 -Path $candidateTwo)) {
    throw 'Two builds from the same source were not byte-for-byte reproducible.'
  }

  Test-ZipAndExtractedPackage -ZipPath $candidateOne -ExtractionPath $extractionPath

  $publishedPath = ''
  if (-not $ValidationOnly) {
    if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
      $OutputDirectory = Join-Path $repoRoot 'artifacts'
    } elseif (-not [System.IO.Path]::IsPathRooted($OutputDirectory)) {
      $OutputDirectory = Join-Path $repoRoot $OutputDirectory
    }
    $OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
    [System.IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
    $publishedPath = Join-Path $OutputDirectory "$packageName.zip"
    if (Test-Path -LiteralPath $publishedPath) {
      if ((Get-Sha256 -Path $publishedPath) -cne $candidateHash) {
        throw "A different package already exists for commit $commit`: $publishedPath"
      }
    } else {
      [System.IO.File]::Move($candidateOne, $publishedPath)
    }
  }

  Write-Output 'Portable Worker package validation PASS'
  Write-Output "Commit: $commit"
  Write-Output "Worker version: $workerVersion"
  Write-Output "Entries: $($packageFiles.Count)"
  Write-Output "SHA-256: $candidateHash"
  if ($ValidationOnly) {
    Write-Output 'ZIP: validation-only; no artifact was published'
  } else {
    Write-Output "ZIP: $publishedPath"
  }
} finally {
  $resolvedWorkingRoot = [System.IO.Path]::GetFullPath($workingRoot)
  if ((Test-Path -LiteralPath $resolvedWorkingRoot) -and
      $resolvedWorkingRoot.StartsWith($tempBase + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolvedWorkingRoot -Recurse -Force
  }
}
