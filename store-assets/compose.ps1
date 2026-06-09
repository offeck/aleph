# Composes the Chrome Web Store screenshot set (1280x800 PNGs) in
# store-assets/final/ from loosely-sized source shots:
#
#   store-assets/before.png + after.png   -> 01-before-after.png (stacked hero)
#   store-assets/after.png (or math.png)  -> 02-rtl-math.png
#   images/front_page1.png + front_page2.png -> 03-popup.png
#   images/dashboard.png + settings_page.png -> 04-insights-settings.png
#
# Sources can be any size: bands fill-and-center-crop, pairs fit by height.
# Missing sources skip their asset with a note. Run:
#   powershell -ExecutionPolicy Bypass -File store-assets\compose.ps1
Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$outDir = Join-Path $PSScriptRoot "final"
New-Item -ItemType Directory -Force $outDir | Out-Null

$W = 1280; $H = 800
$BG = [System.Drawing.Color]::FromArgb(255, 18, 19, 38)
$BORDER = [System.Drawing.Color]::FromArgb(255, 58, 61, 99)
$ACCENT = [System.Drawing.Color]::FromArgb(255, 124, 131, 255)

function New-Canvas {
  $bmp = New-Object System.Drawing.Bitmap($W, $H)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = "AntiAlias"
  $g.InterpolationMode = "HighQualityBicubic"
  $g.PixelOffsetMode = "HighQuality"
  $g.Clear($BG)
  return $bmp, $g
}

function Draw-Pill {
  param($g, [string]$text, [int]$x, [int]$y, $fillColor)
  $font = New-Object System.Drawing.Font("Segoe UI", 17, [System.Drawing.FontStyle]::Bold)
  $size = $g.MeasureString($text, $font)
  $padX = 18; $padY = 7
  $rw = [int]($size.Width + 2 * $padX); $rh = [int]($size.Height + 2 * $padY)
  $r = [int]($rh / 2)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc($x, $y, $r * 2, $r * 2, 90, 180)
  $path.AddArc($x + $rw - $r * 2, $y, $r * 2, $r * 2, 270, 180)
  $path.CloseFigure()
  $fill = New-Object System.Drawing.SolidBrush($fillColor)
  $g.FillPath($fill, $path)
  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $g.DrawString($text, $font, $white, $x + $padX, $y + $padY)
  $fill.Dispose(); $white.Dispose(); $font.Dispose(); $path.Dispose()
}

# Scales the source to FILL the destination rect, cropping overflow.
# insets (fractions of source W/H) pre-trim browser chrome/composer;
# biasX/biasY place the crop window (0 = left/top, 0.5 = center, 1 = right/bottom).
function Draw-Fill {
  param($g, $img, [int[]]$dst, [double]$biasX = 0.5, [double]$biasY = 0.5,
        [double]$insetTop = 0, [double]$insetBottom = 0, [double]$insetLeft = 0, [double]$insetRight = 0)
  $ax = [int]($img.Width * $insetLeft); $ay = [int]($img.Height * $insetTop)
  $aw = [int]($img.Width * (1 - $insetLeft - $insetRight)); $ah = [int]($img.Height * (1 - $insetTop - $insetBottom))
  $scale = [Math]::Max($dst[2] / $aw, $dst[3] / $ah)
  $srcW = [int]($dst[2] / $scale); $srcH = [int]($dst[3] / $scale)
  $srcX = $ax + [int](($aw - $srcW) * $biasX); $srcY = $ay + [int](($ah - $srcH) * $biasY)
  $srcRect = New-Object System.Drawing.Rectangle($srcX, $srcY, $srcW, $srcH)
  $dstRect = New-Object System.Drawing.Rectangle($dst[0], $dst[1], $dst[2], $dst[3])
  $g.DrawImage($img, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
}

# Scales the source to FIT a target height, draws centered at x; 1px border.
function Draw-Fit {
  param($g, $img, [int]$x, [int]$y, [int]$targetH)
  $w = [int]($img.Width * $targetH / $img.Height)
  $dstRect = New-Object System.Drawing.Rectangle($x, $y, $w, $targetH)
  $srcRect = New-Object System.Drawing.Rectangle(0, 0, $img.Width, $img.Height)
  $g.DrawImage($img, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
  $pen = New-Object System.Drawing.Pen($BORDER, [single]1)
  $g.DrawRectangle($pen, $x, $y, $w - 1, $targetH - 1)
  $pen.Dispose()
  return $w
}

function Load-First {
  param([string[]]$paths)
  foreach ($p in $paths) {
    if (Test-Path $p) { return [System.Drawing.Image]::FromFile($p), $p }
  }
  return $null, $null
}

# ── 01: before/after hero — full-width bands stacked ─────────────────────
$before, $bp = Load-First @((Join-Path $root "images\before.png"), (Join-Path $PSScriptRoot "before.png"))
$after, $ap = Load-First @((Join-Path $root "images\after.png"), (Join-Path $PSScriptRoot "after.png"))
if ($before -and $after) {
  $bmp, $g = New-Canvas
  # Trim browser chrome (top), composer/watermark (bottom), and side margins
  # (left rail + dead space) so band text renders near 1:1.
  Draw-Fill $g $before @(0, 0, $W, 399) 0.5 0.25 0.10 0.20 0.25 0.05
  Draw-Fill $g $after  @(0, 401, $W, 399) 0.5 0.25 0.10 0.20 0.25 0.05
  $pen = New-Object System.Drawing.Pen($ACCENT, [single]2)
  $g.DrawLine($pen, 0, 400, $W, 400)
  $pen.Dispose()
  Draw-Pill $g "WITHOUT ALEPH" 20 16 ([System.Drawing.Color]::FromArgb(230, 140, 40, 50))
  Draw-Pill $g "WITH ALEPH" 20 417 ([System.Drawing.Color]::FromArgb(230, 35, 120, 75))
  $bmp.Save((Join-Path $outDir "01-before-after.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Output ("01-before-after.png <- " + (Split-Path $bp -Leaf) + " + " + (Split-Path $ap -Leaf))
} else {
  Write-Output "01 SKIPPED: need store-assets/before.png and after.png"
}
if ($before) { $before.Dispose() }

# ── 02: fixed conversation solo ───────────────────────────────────────────
$math, $mp = Load-First @((Join-Path $root "images\math.png"), (Join-Path $PSScriptRoot "math.png"))
$solo = if ($math) { $math } else { $after }
if ($solo) {
  $bmp, $g = New-Canvas
  # Same trims as the hero; keep the right side (Hebrew is right-aligned).
  Draw-Fill $g $solo @(0, 0, $W, $H) 0.6 0.3 0.10 0.20
  $bmp.Save((Join-Path $outDir "04-rtl-math.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Output ("04-rtl-math.png <- " + $(if ($math) { "math.png" } else { "after.png" }))
} else {
  Write-Output "04 SKIPPED: need images/math.png or after.png"
}
if ($math) { $math.Dispose() }
if ($after) { $after.Dispose() }

# ── 03/04: paired page shots on branded canvas ────────────────────────────
function Compose-Pair {
  param([string]$leftPath, [string]$rightPath, [string]$outName, [int]$gap = 64)
  if (-not ((Test-Path $leftPath) -and (Test-Path $rightPath))) {
    Write-Output ("$outName SKIPPED: need " + (Split-Path $leftPath -Leaf) + " + " + (Split-Path $rightPath -Leaf))
    return
  }
  $l = [System.Drawing.Image]::FromFile($leftPath)
  $r = [System.Drawing.Image]::FromFile($rightPath)
  $bmp, $g = New-Canvas
  $targetH = 730
  $wl = [int]($l.Width * $targetH / $l.Height)
  $wr = [int]($r.Width * $targetH / $r.Height)
  $x0 = [int](($W - $wl - $wr - $gap) / 2)
  $y0 = [int](($H - $targetH) / 2)
  $null = Draw-Fit $g $l $x0 $y0 $targetH
  $null = Draw-Fit $g $r ($x0 + $wl + $gap) $y0 $targetH
  $bmp.Save((Join-Path $outDir $outName), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose(); $l.Dispose(); $r.Dispose()
  Write-Output ("$outName <- " + (Split-Path $leftPath -Leaf) + " + " + (Split-Path $rightPath -Leaf))
}

Compose-Pair (Join-Path $root "images\front_page1.png") (Join-Path $root "images\front_page2.png") "02-popup.png" 70
Compose-Pair (Join-Path $root "images\dashboard.png") (Join-Path $root "images\settings_page.png") "03-insights-settings.png" 60

Get-ChildItem $outDir -Filter *.png | ForEach-Object {
  $img = [System.Drawing.Image]::FromFile($_.FullName)
  Write-Output ("{0}: {1}x{2}" -f $_.Name, $img.Width, $img.Height)
  $img.Dispose()
}
