# Builds the one-click "Paper Toss Installer.exe" into dist\.
# It packs the Electron runtime from node_modules plus src\ into one file, so
# run `npm install` first. Usage:
#   powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1 [output folder]
param([string]$OutDir = "")
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
if (-not $OutDir) { $OutDir = Join-Path $root "dist" }
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$dist = Join-Path $root "node_modules\electron\dist"
if (-not (Test-Path "$dist\electron.exe")) { throw "Electron not found. Run npm install first." }

$work = Join-Path $here "build"
$stage = Join-Path $work "stage"
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
New-Item -ItemType Directory -Force $stage, $OutDir | Out-Null

# 1. The app folder: Electron renamed to Paper Toss.exe, with the app in resources\app.
"Staging app..."
Copy-Item "$dist\*" $stage -Recurse
Rename-Item "$stage\electron.exe" "Paper Toss.exe"
Remove-Item "$stage\resources\default_app.asar" -ErrorAction SilentlyContinue
# Chromium falls back to en-US, and the other languages add ~40 MB.
Get-ChildItem "$stage\locales" -Exclude "en-US.pak" | Remove-Item
New-Item -ItemType Directory -Force "$stage\resources\app" | Out-Null
Copy-Item "$root\package.json" "$stage\resources\app"
Copy-Item "$root\src" "$stage\resources\app" -Recurse

# 2. Give the exe the Paper Toss icon.
& $csc /nologo /out:"$work\IconPatch.exe" "$here\IconPatch.cs"
if ($LASTEXITCODE -ne 0) { throw "IconPatch build failed" }
& "$work\IconPatch.exe" "$stage\Paper Toss.exe" "$here\PaperToss.ico"
if ($LASTEXITCODE -ne 0) { throw "Icon patch failed" }

# 3. Zip it up and build the installer around the zip.
"Zipping..."
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stage, "$work\app.zip", [IO.Compression.CompressionLevel]::Optimal, $false)

$version = (Get-Content "$root\package.json" -Raw | ConvertFrom-Json).version
@"
using System.Reflection;
[assembly: AssemblyVersion("$version.0")]
[assembly: AssemblyFileVersion("$version.0")]
static partial class Installer { const string Version = "$version"; }
"@ | Set-Content "$work\Version.cs" -Encoding UTF8

$common = @("/nologo", "/target:winexe", "/optimize+", "/win32icon:$here\PaperToss.ico",
  "/reference:System.Windows.Forms.dll", "/reference:System.Drawing.dll",
  "/reference:System.IO.Compression.dll", "/reference:System.IO.Compression.FileSystem.dll")

# Without app.zip inside, the same program is just the uninstaller.
& $csc @common /out:"$work\Uninstall.exe" "$here\Installer.cs" "$work\Version.cs"
if ($LASTEXITCODE -ne 0) { throw "Uninstaller build failed" }

& $csc @common `
  /resource:"$work\app.zip,app.zip" `
  /resource:"$work\Uninstall.exe,Uninstall.exe" `
  /resource:"$here\logo.png,logo.png" `
  /out:"$OutDir\Paper Toss Installer.exe" `
  "$here\Installer.cs" "$work\Version.cs"

if ($LASTEXITCODE -eq 0) { "Built: $OutDir\Paper Toss Installer.exe" } else { throw "Build failed" }
