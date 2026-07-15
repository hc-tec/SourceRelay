$ErrorActionPreference = "Stop"

$images = @(
    @{
        Mirror = "dockerproxy.net/getmaxun/maxun-frontend:latest"
        Official = "getmaxun/maxun-frontend:latest"
        ExpectedIndexDigest = "sha256:803076b49cb7a3b07aab3c56e293a2a18e39784d9dd5b4ad5ec964c86d361cee"
    },
    @{
        Mirror = "dockerproxy.net/getmaxun/maxun-backend:latest"
        Official = "getmaxun/maxun-backend:latest"
        ExpectedIndexDigest = "sha256:5945a48b1ddb6f751b1f3412aec4513bce720e532fd60b6c355c5a2f3953ae07"
    },
    @{
        Mirror = "dockerproxy.net/getmaxun/maxun-browser:latest"
        Official = "getmaxun/maxun-browser:latest"
        ExpectedIndexDigest = "sha256:8d78aff8d2d28d0fcefb9609c8326ccceb495149b4f79b6e178f5df2f0d24271"
    }
)

foreach ($entry in $images) {
    $previousErrorPreference = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    $existingDigest = docker image inspect $entry.Official --format '{{json .RepoDigests}}' 2>$null
    $inspectExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorPreference
    if ($inspectExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($existingDigest) -and
        $existingDigest -match [regex]::Escape("@$($entry.ExpectedIndexDigest)")) {
        Write-Output "PULL_SKIP $($entry.Official) digest already verified"
        continue
    }

    Write-Output "PULL_START $($entry.Official) FROM $($entry.Mirror)"
    docker pull $entry.Mirror
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to pull $($entry.Mirror)"
    }
    $repoDigests = docker image inspect $entry.Mirror --format '{{json .RepoDigests}}'
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($repoDigests) -or
        $repoDigests -notmatch [regex]::Escape("@$($entry.ExpectedIndexDigest)")) {
        throw "Digest mismatch for $($entry.Mirror); expected $($entry.ExpectedIndexDigest)"
    }
    docker tag $entry.Mirror $entry.Official
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to tag $($entry.Official)"
    }
    $metadata = docker image inspect $entry.Official --format '{{.Id}} {{.Architecture}} {{.Os}} {{.Size}}'
    Write-Output "PULL_DONE $($entry.Official) $metadata"
}

Write-Output "ALL_IMAGES_READY"
