# Windows タスクスケジューラに「毎日 1 回の収集」を登録するスクリプト
# （server.mjs を常駐させずに収集だけ回したい場合に使う。server.mjs 常駐なら不要）
#
# 使い方: PowerShell で  .\setup-task.ps1 [-Hour 7] [-Minute 0]

param(
  [int]$Hour = 7,
  [int]$Minute = 0,
  [string]$TaskName = "NewSitesRadar-Collect"
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  Write-Error "node が PATH に見つかりません。"
  exit 1
}

$action  = New-ScheduledTaskAction -Execute $node -Argument "scripts\collect.mjs" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At ([datetime]::Today.AddHours($Hour).AddMinutes($Minute))
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "登録しました: $TaskName  毎日 $Hour`:$($Minute.ToString('00'))  ($node scripts\collect.mjs @ $root)"
