$base = "D:\automative\aws\lambda\api"
$outZip = "$base\deploy-prod.zip"
$excludeNames = @('function.zip','bundle.js','deploy.zip','deploy-prod.zip','lambda.zip')
$tempDir = "$env:TEMP\lambda-deploy-temp"

if (Test-Path $outZip) { Remove-Item $outZip -Force }
if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
New-Item -ItemType Directory -Path $tempDir | Out-Null

# Copy dist files (excluding dist/node_modules and artifacts)
$distSrc = "$base\dist"
Get-ChildItem -Path $distSrc -Recurse -File | Where-Object {
    $_.FullName -notlike '*\dist\node_modules\*' -and
    $excludeNames -notcontains $_.Name -and
    $_.Extension -ne '.map'
} | ForEach-Object {
    $relPath = $_.FullName.Substring($distSrc.Length)
    $dstPath = Join-Path $tempDir $relPath
    $dstDir = Split-Path $dstPath -Parent
    if (!(Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
    Copy-Item $_.FullName $dstPath
}

# Copy node_modules
Write-Host "Copying node_modules..."
Copy-Item "$base\node_modules" "$tempDir\node_modules" -Recurse

# Create zip
Write-Host "Creating zip..."
Compress-Archive -Path "$tempDir\*" -DestinationPath $outZip -Force

# Cleanup
Remove-Item $tempDir -Recurse -Force
Write-Host "Done. Zip: $outZip"
