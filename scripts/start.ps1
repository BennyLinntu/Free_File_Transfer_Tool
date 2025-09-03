param(
    [switch]$ForceInstall
)

function Has-Command([string]$cmd) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'SilentlyContinue'
    $null = Get-Command $cmd
    $ok = $?
    $ErrorActionPreference = $old
    return $ok
}

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

Write-Host "[File Converter] Working directory: $root"

$needNode = -not (Has-Command 'node') -or -not (Has-Command 'npm')
if ($needNode) {
    Write-Warning "Node.js/npm 未检测到。"
    if (Has-Command 'winget') {
        if ($ForceInstall) {
            Write-Host "尝试使用 winget 安装 Node.js LTS…"
            winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
        } else {
            Write-Host "你可以运行以下命令自动安装（可能需要确认）："
            Write-Host "winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements" -ForegroundColor Cyan
            Write-Host "或手动前往 https://nodejs.org/ 下载 LTS 安装包。安装后重启 PowerShell。"
            exit 1
        }
    } else {
        Write-Host "未检测到 winget。请前往 https://nodejs.org/ 下载并安装 Node.js LTS（包含 npm），安装后重启 PowerShell。"
        exit 1
    }
}

Write-Host "安装依赖…"
if (Test-Path package-lock.json) {
    npm ci
} else {
    npm install
}
if ($LASTEXITCODE -ne 0) {
    Write-Error "依赖安装失败"
    exit 1
}

Write-Host "启动服务器…"
npm start