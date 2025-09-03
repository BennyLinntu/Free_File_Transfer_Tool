param(
    [string]$Url = "http://localhost:3000/health",
    [int]$TimeoutSec = 20
)

$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ((Get-Date) -lt $deadline) {
    try {
        $res = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
        if ($res.StatusCode -eq 200 -and $res.Content -match '"ok":\s*true') {
            Write-Host "健康检查通过：$Url"
            exit 0
        }
    } catch {
        Start-Sleep -Seconds 1
    }
}

Write-Error "健康检查超时：$Url"
exit 1