# 把本仓库镜像到 D 盘备份。由 .git/hooks/post-commit 调用。
#
# 为什么是 .ps1 而不是 .cmd：目标路径含中文（D:\dsh-delete-session备份），
# cmd.exe 在中文代码页下读 UTF-8 的 .cmd 会把多字节字符拆开、整行命令被截断。
# PowerShell 只要脚本带 UTF-8 BOM 就能正确解析中文路径字面量。
#
# robocopy 的 0-7 都算成功（0=无变化，1=有复制，2=有删除，3=两者），>=8 才是失败。

$ErrorActionPreference = 'Stop'

$src = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dst = 'D:\dsh-delete-session备份\code\dsh-delete-session'

if (-not (Test-Path 'D:\')) {
    [Console]::Error.WriteLine('[backup] D 盘不可用，跳过同步')
    exit 0
}

New-Item -ItemType Directory -Path $dst -Force | Out-Null

robocopy $src $dst /MIR /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
$rc = $LASTEXITCODE

if ($rc -ge 8) {
    [Console]::Error.WriteLine("[backup] 同步失败：robocopy exit $rc")
    exit 1
}

exit 0
