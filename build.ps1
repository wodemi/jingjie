# ==========================================================================
#  净界 JingJie —— 打包脚本
#  用法： powershell -ExecutionPolicy Bypass -File build.ps1 [-SkipNode] [-NoIcon]
#  产物： dist\净界.exe  + dist\app\ + dist\runtime\node.exe + dist\*.dll
# ==========================================================================
param(
  [switch]$SkipNode,
  [switch]$NoIcon,
  [switch]$NoShortcut,
  [switch]$Zip,
  [switch]$NoInstall,
  [string]$InstallDir = 'D:\Programs\净界',
  [string]$OutName = "净界"
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Dist = Join-Path $Root 'dist'
$Lib  = Join-Path $Root 'lib'
$Src  = Join-Path $Root 'src'
$Assets = Join-Path $Root 'assets'
$Csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $Csc)) { throw "找不到 csc.exe：$Csc" }

New-Item -ItemType Directory -Force -Path $Dist, $Assets | Out-Null

# ---------- 1. 图标 ----------
$Ico = Join-Path $Assets 'jingjie.ico'
if (-not $NoIcon) {
  Write-Host '==> 生成图标' -ForegroundColor Cyan
  Add-Type -AssemblyName System.Drawing
  $sizes = 16, 24, 32, 48, 64, 128, 256
  $pngs = @()
  foreach ($s in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap 256, 256
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.TextRenderingHint = 'AntiAliasGridFit'
    $g.Clear([System.Drawing.Color]::Transparent)
    $rect = New-Object System.Drawing.RectangleF 8, 8, 240, 240
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $r = 62.0
    $path.AddArc($rect.X, $rect.Y, $r, $r, 180, 90)
    $path.AddArc($rect.Right - $r, $rect.Y, $r, $r, 270, 90)
    $path.AddArc($rect.Right - $r, $rect.Bottom - $r, $r, $r, 0, 90)
    $path.AddArc($rect.X, $rect.Bottom - $r, $r, $r, 90, 90)
    $path.CloseFigure()
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
      (New-Object System.Drawing.PointF 0, 0),
      (New-Object System.Drawing.PointF 256, 256),
      [System.Drawing.Color]::FromArgb(52, 229, 164),
      [System.Drawing.Color]::FromArgb(91, 140, 255))
    $g.FillPath($brush, $path)
    # 内层高光
    $hl = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(38, 255, 255, 255))
    $g.FillEllipse($hl, 40, 26, 176, 110)
    # 文字
    $font = New-Object System.Drawing.Font('Microsoft YaHei UI', 118, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = 'Center'
    $fmt.LineAlignment = 'Center'
    $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $g.DrawString('净', $font, $white, (New-Object System.Drawing.RectangleF 0, 6, 256, 256), $fmt)
    $g.Dispose()
    if ($s -eq 256) { $small = $bmp } else {
      $small = New-Object System.Drawing.Bitmap $s, $s
      $g2 = [System.Drawing.Graphics]::FromImage($small)
      $g2.InterpolationMode = 'HighQualityBicubic'
      $g2.DrawImage($bmp, 0, 0, $s, $s)
      $g2.Dispose()
    }
    $ms = New-Object System.IO.MemoryStream
    $small.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngs += ,@($s, $ms.ToArray())
    $ms.Dispose(); $small.Dispose()
    if ($s -ne 256) { $bmp.Dispose() } else { $small.Dispose() }
  }
  # 组装 ICO
  $out = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter $out
  $bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$pngs.Count)
  $offset = 6 + 16 * $pngs.Count
  foreach ($p in $pngs) {
    $sz = $p[0]; $data = $p[1]
    $bw.Write([Byte]$(if ($sz -ge 256) { 0 } else { $sz }))
    $bw.Write([Byte]$(if ($sz -ge 256) { 0 } else { $sz }))
    $bw.Write([Byte]0); $bw.Write([Byte]0)
    $bw.Write([UInt16]1); $bw.Write([UInt16]32)
    $bw.Write([UInt32]$data.Length); $bw.Write([UInt32]$offset)
    $offset += $data.Length
  }
  foreach ($p in $pngs) { $bw.Write($p[1]) }
  $bw.Flush()
  [System.IO.File]::WriteAllBytes($Ico, $out.ToArray())
  $bw.Dispose(); $out.Dispose()
  Write-Host ("    图标 -> {0} ({1:N0} 字节)" -f $Ico, (Get-Item $Ico).Length)
}

# ---------- 2. 编译外壳 ----------
Write-Host '==> 编译 净界.exe' -ForegroundColor Cyan
$exe = Join-Path $Dist ($OutName + '.exe')
$refs = @(
  'System.dll', 'System.Core.dll', 'System.Drawing.dll', 'System.Windows.Forms.dll',
  (Join-Path $Lib 'Microsoft.Web.WebView2.Core.dll'),
  (Join-Path $Lib 'Microsoft.Web.WebView2.WinForms.dll')
)
$args = @('/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/debug-',
  ('/out:' + $exe), ('/win32icon:' + $Ico), ('/lib:' + $Lib))
foreach ($r in $refs) { $args += ('/reference:' + $r) }
$args += (Join-Path $Src 'JingJie.cs')
& $Csc @args
if ($LASTEXITCODE -ne 0) { throw "编译失败（csc 退出码 $LASTEXITCODE）" }
Write-Host ("    {0} ({1:N0} KB)" -f $exe, ((Get-Item $exe).Length / 1KB))

# ---------- 3. 组装绿色版 ----------
Write-Host '==> 组装运行目录' -ForegroundColor Cyan
foreach ($f in 'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll') {
  Copy-Item (Join-Path $Lib $f) $Dist -Force
}
$appDst = Join-Path $Dist 'app'
if (Test-Path $appDst) { Remove-Item $appDst -Recurse -Force }
Copy-Item (Join-Path $Root 'app') $appDst -Recurse -Force

if (-not $SkipNode) {
  $nodeSrc = 'C:\Program Files\nodejs\node.exe'
  if (-not (Test-Path $nodeSrc)) { throw "找不到 $nodeSrc，请用 -SkipNode 跳过内置引擎（需系统已装 Node）" }
  $rt = Join-Path $Dist 'runtime'
  New-Item -ItemType Directory -Force -Path $rt | Out-Null
  $nodeDst = Join-Path $rt 'node.exe'
  if (-not (Test-Path $nodeDst) -or (Get-Item $nodeDst).Length -ne (Get-Item $nodeSrc).Length) {
    Copy-Item $nodeSrc $nodeDst -Force
  }
}
Copy-Item (Join-Path $Root 'README.md') $Dist -Force -ErrorAction SilentlyContinue

# ---------- 4. 复制到安装目录（默认 D:\Programs\净界） ----------
# 说明：程序所在的目录若被策略/沙箱限制，会导致所有删除操作被拒绝（EPERM），
# 所以真正运行的副本放在普通目录，源码与构建产物仍留在工程目录。
$RunDir = $Dist
if (-not $NoInstall) {
  Write-Host ("==> 复制到安装目录 {0}" -f $InstallDir) -ForegroundColor Cyan
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  robocopy $Dist $InstallDir /E /XD data /XF _o.txt _e.txt /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
  $RunDir = $InstallDir
  Write-Host ("    {0}" -f (Join-Path $InstallDir '净界.exe'))
}

# ---------- 5. 桌面快捷方式（指向安装目录） ----------
if (-not $NoShortcut) {
  Write-Host '==> 创建桌面快捷方式' -ForegroundColor Cyan
  try {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $lnk = Join-Path $desktop '净界.lnk'
    $target = Join-Path $RunDir '净界.exe'
    $ws = New-Object -ComObject WScript.Shell
    $sc = $ws.CreateShortcut($lnk)
    $sc.TargetPath = $target
    $sc.WorkingDirectory = $RunDir
    $sc.IconLocation = "$target,0"
    $sc.Description = '净界 · 系统清理与优化'
    $sc.Save()
    Write-Host ("    {0}  ->  {1}" -f $lnk, $target)
  } catch {
    Write-Host ("    创建失败：{0}" -f $_.Exception.Message) -ForegroundColor Yellow
  }
}

$total = (Get-ChildItem $Dist -Recurse -File | Measure-Object Length -Sum).Sum

# ---------- 5. 打包 zip（去掉运行时数据目录，避免 WebView2 锁文件） ----------
if ($Zip) {
  Write-Host '==> 打包 zip' -ForegroundColor Cyan
  $stage = Join-Path $Root '_stage'
  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
  $stageApp = Join-Path $stage $OutName
  New-Item -ItemType Directory -Path $stageApp -Force | Out-Null
  robocopy $Dist $stageApp /E /XD data /XF _o.txt _e.txt /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
  # 给收件人看的快速开始（纯文本，双击即可打开）
  $readme = Join-Path $stageApp '快速开始.txt'
  $lines = @(
    '净界 JingJie v1.0.0 — 绿色版，免安装',
    '',
    '一、怎么用',
    '  1) 把整个文件夹解压到任意位置（不要在压缩包里直接双击）',
    '  2) 双击 净界.exe',
    '  3) 点「一键扫描」，看结果，点「一键清理推荐」或「开始清理」',
    '',
    '二、第一次打开可能遇到的提示',
    '  · Windows 提示「已保护你的电脑」：这是没做数字签名，点「更多信息」→「仍要运行」',
    '  · 安全软件（火绒/360/管家）提示：它们会把清理工具当可疑程序，选「允许」或把整个文件夹加入信任区',
    '  · 清理系统项目（系统临时文件、Windows 更新缓存、注册表 HKLM）需要管理员：点页面上的「以管理员身份重启」，',
    '    在 Windows 弹出的「用户账户控制」窗口点「是」即可',
    '',
    '三、数据放在哪',
    '  全部在程序目录下的 data\ 文件夹（日志 jingjie.log、设置 settings.json、注册表备份 regbackup\）',
    '  想彻底卸载：直接删掉整个文件夹，再用「清理加速」清一次就干净了',
    '',
    '四、它不做什么',
    '  · 不联网上传任何文件清单，不收集个人信息',
    '  · 微信/QQ 的聊天记录、图片、视频默认不勾选，勾了也会二次确认',
    '  · 注册表删除前会自动导出 .reg 备份到 data\regbackup\',
    '',
    '需要 WebView2 运行时（Win10/11 一般自带；缺失时程序会提示下载链接）'
  )
  Set-Content -Path $readme -Value $lines -Encoding UTF8
  $zipPath = Join-Path $Root ("{0}-v1.0.0.zip" -f $OutName)
  if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
  # 打成“净界-v1.0.0.zip/净界/…”，解压时自动落在同一个文件夹里
  Compress-Archive -Path $stageApp -DestinationPath $zipPath -CompressionLevel Optimal
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host ("    {0} ({1:N1} MB)" -f $zipPath, ((Get-Item $zipPath).Length / 1MB))
}
Write-Host ''
Write-Host ("完成：{0}" -f $Dist) -ForegroundColor Green
Write-Host ("      总大小 {0:N1} MB" -f ($total / 1MB))
Write-Host ("      启动：{0}" -f $exe) -ForegroundColor Green
