# 把本仓库镜像到 D 盘备份。由 .git/hooks/post-commit 调用。
#
# 备份语义：备份 = 源仓库「已跟踪文件的工作区内容 + 完整 .git 历史」。
# 未跟踪文件（如误重定向产物、编辑器临时文件、尚未提交的草稿）永不进备份，
# 也不从源侧删除——它们不属于「已提交」这个备份边界，删源侧可能误删重要草稿。
#
# 实现：robocopy /MIR 全量镜像（保留 .git，备份仍是完整可恢复仓库），
# 再从备份侧剔除未跟踪文件，最后清掉因此产生的空目录。
#
# 本文件必须以 UTF-8 BOM 保存——PowerShell 5.1 无 BOM 会按 ANSI 读，中文会坏。
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

# 1. 全量镜像（含 .git：备份保持为完整可恢复仓库）
robocopy $src $dst /MIR /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
$rc = $LASTEXITCODE
if ($rc -ge 8) {
    [Console]::Error.WriteLine("[backup] 同步失败：robocopy exit $rc")
    exit 1
}

# 2. 从备份侧剔除未跟踪文件（垃圾不进备份）
$untracked = & git -C $src ls-files --others --exclude-standard 2>$null
foreach ($u in $untracked) {
    if ($u) {
        $dstFile = Join-Path $dst $u
        if (Test-Path -LiteralPath $dstFile) { Remove-Item -LiteralPath $dstFile -Force }
    }
}

# 3. 清理备份侧因剔除产生的空目录（最深优先）
Get-ChildItem -LiteralPath $dst -Recurse -Directory -Force -ErrorAction SilentlyContinue |
    Sort-Object { $_.FullName.Length } -Descending | ForEach-Object {
        if (-not (Get-ChildItem -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue)) {
            Remove-Item -LiteralPath $_.FullName -Force
        }
    }

exit 0
