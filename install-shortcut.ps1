[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

$pkgDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$vbsPath = Join-Path $pkgDir 'launch-silent.vbs'

if (-not (Test-Path -LiteralPath $vbsPath)) {
    Write-Host "[错误] 未在当前目录找到 launch-silent.vbs：$vbsPath" -ForegroundColor Red
    exit 1
}

# 1. Check Node.js (>= 22)
$nodeExe = $null
$cmdNode = Get-Command node -ErrorAction SilentlyContinue
if ($cmdNode -and $cmdNode.Source -and (Test-Path -LiteralPath $cmdNode.Source)) {
    $nodeExe = $cmdNode.Source
}
if (-not $nodeExe) {
    $nodeCandidates = @(
        'C:\Program Files\nodejs\node.exe',
        'C:\Program Files (x86)\nodejs\node.exe',
        (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
    )
    foreach ($cand in $nodeCandidates) {
        if ($cand -and (Test-Path -LiteralPath $cand)) {
            $nodeExe = $cand
            break
        }
    }
}

$nodeMajor = 0
$nodeVerStr = ''
if ($nodeExe) {
    try {
        $rawVer = (& $nodeExe --version 2>$null | Select-Object -First 1)
        if ($rawVer) {
            $nodeVerStr = "$rawVer".Trim()
        }
        if ($nodeVerStr -match '^v(\d+)') {
            $nodeMajor = [int]$Matches[1]
        }
    } catch {
        $nodeVerStr = ''
    }
}

if (-not $nodeExe) {
    Write-Host '[警告] 未检测到 Node.js。本汉化包需要 Node.js 22 或更高版本才能运行。' -ForegroundColor Yellow
    Write-Host '       请前往 https://nodejs.org/ 下载安装最新版 Node.js (LTS)。' -ForegroundColor Yellow
} elseif ($nodeMajor -lt 22) {
    Write-Host "[警告] 检测到 Node.js 版本为 $nodeVerStr，低于要求的 Node.js 22。" -ForegroundColor Yellow
    Write-Host '       请前往 https://nodejs.org/ 升级到 Node.js 22+ (LTS)。' -ForegroundColor Yellow
} else {
    Write-Host "[通过] 已检测到 Node.js $nodeVerStr ($nodeExe)" -ForegroundColor Green
}

# 2. Discover Antigravity.exe for shortcut icon
$exePath = $null
$exeCandidates = @()
if ($env:ANTIGRAVITY_EXE) {
    $exeCandidates += $env:ANTIGRAVITY_EXE
}
if ($env:LOCALAPPDATA) {
    $exeCandidates += (Join-Path $env:LOCALAPPDATA 'Programs\antigravity\Antigravity.exe')
}
$exeCandidates += 'C:\Program Files\Antigravity\Antigravity.exe'
$exeCandidates += 'C:\Program Files (x86)\Antigravity\Antigravity.exe'

foreach ($cand in $exeCandidates) {
    if ($cand -and (Test-Path -LiteralPath $cand)) {
        $exePath = $cand
        break
    }
}

$desktopDir = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell

if (-not $exePath) {
    $searchDirs = @(
        $desktopDir,
        "$env:PUBLIC\Desktop",
        "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"
    )
    foreach ($dir in $searchDirs) {
        if (-not $dir -or -not (Test-Path -LiteralPath $dir)) { continue }
        $links = Get-ChildItem -LiteralPath $dir -Recurse -Filter '*Antigravity*.lnk' -ErrorAction SilentlyContinue
        foreach ($lnk in $links) {
            try {
                $target = $shell.CreateShortcut($lnk.FullName).TargetPath
                if ($target -and ($target -like '*\Antigravity.exe') -and (Test-Path -LiteralPath $target)) {
                    $exePath = $target
                    break
                }
            } catch {
                # Ignore unreadable shortcut
            }
        }
        if ($exePath) { break }
    }
}

if ($exePath) {
    Write-Host "[通过] 已找到 Antigravity 图标来源：$exePath" -ForegroundColor Green
} else {
    Write-Host '[提示] 暂未找到 Antigravity.exe，将使用系统默认图标；正式启动时启动器仍会自动搜索客户端路径。' -ForegroundColor Yellow
}

# 3. Create Desktop shortcut without touching Antigravity.lnk
$shortcutPath = Join-Path $desktopDir 'Antigravity 中文版.lnk'
$wscriptExe = Join-Path $env:SystemRoot 'System32\wscript.exe'
if (-not (Test-Path -LiteralPath $wscriptExe)) {
    $wscriptExe = 'wscript.exe'
}

$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $wscriptExe
$shortcut.Arguments = "`"$vbsPath`""
$shortcut.WorkingDirectory = $pkgDir
if ($exePath) {
    $shortcut.IconLocation = "$exePath,0"
}
$shortcut.Description = 'Antigravity 简体中文版（无损动态汉化）'
$shortcut.Save()

Write-Host ''
Write-Host "已成功创建桌面快捷方式：$shortcutPath" -ForegroundColor Cyan
Write-Host "指向中文包目录：$pkgDir" -ForegroundColor Cyan
Write-Host ''
Write-Host '使用提示：'
Write-Host '  1. 双击桌面的「Antigravity 中文版」即可进入简体中文界面（原英文快捷方式保持不变）。'
Write-Host '  2. 在窗口内按 Ctrl + Alt + L 可随时一键切换「简体中文 / 英文原版」。'
Write-Host '  3. 如需补充或微调译文，可编辑同目录下的 dict.custom.json 并保存即可热更新生效。'
Write-Host '  4. 请保留本中文包文件夹位置；如移动了文件夹，重新运行一次「创建桌面中文快捷方式.bat」即可。'
