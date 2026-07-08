# Generates the optional Chrome Web Store promo tiles, matching the brand of
# docs/assets/social-preview.png (navy field, purple logo tile, accent underline):
#   store-assets/final/promo-small-440x280.png    (small promo tile)
#   store-assets/final/promo-marquee-1400x560.png  (marquee promo tile)
# Both are saved as 24-bit RGB (no alpha), per CWS requirements. Run:
#   powershell -ExecutionPolicy Bypass -File store-assets\promo-tiles.ps1
Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$logoPath = Join-Path $root "docs\assets\icon128.png"
$cardPath = Join-Path $PSScriptRoot "popup-usage.png"
$outDir = Join-Path $PSScriptRoot "final"
New-Item -ItemType Directory -Force $outDir | Out-Null

$BG      = [System.Drawing.Color]::FromArgb(255, 14, 19, 48)
$BORDER  = [System.Drawing.Color]::FromArgb(255, 58, 61, 99)
$ACCENT  = [System.Drawing.Color]::FromArgb(124, 131, 255)
$WHITE   = [System.Drawing.Color]::FromArgb(255, 245, 246, 255)
$MUTED   = [System.Drawing.Color]::FromArgb(255, 173, 178, 214)
$TAG     = [System.Drawing.Color]::FromArgb(255, 141, 147, 181)
# Non-ASCII glyphs built from code points so the .ps1 stays ASCII (PS 5.1 reads
# scripts as ANSI; a raw UTF-8 em-dash would be mangled and break parsing).
$DASH = [char]0x2014  # em dash
$MID  = [char]0x00B7  # middle dot

function New-Canvas24 {
  param([int]$w, [int]$h)
  $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = "AntiAlias"
  $g.InterpolationMode = "HighQualityBicubic"
  $g.PixelOffsetMode = "HighQuality"
  $g.TextRenderingHint = "AntiAliasGridFit"
  $g.Clear($BG)
  return $bmp, $g
}

function New-RoundedRect {
  param([single]$x, [single]$y, [single]$w, [single]$h, [single]$r)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function Draw-Glow {
  param($g, [single]$cx, [single]$cy, [single]$rw, [single]$rh, [int]$alpha)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddEllipse($cx - $rw, $cy - $rh, $rw * 2, $rh * 2)
  $pgb = New-Object System.Drawing.Drawing2D.PathGradientBrush($path)
  $pgb.CenterPoint = New-Object System.Drawing.PointF($cx, $cy)
  $pgb.CenterColor = [System.Drawing.Color]::FromArgb($alpha, $ACCENT)
  $pgb.SurroundColors = @([System.Drawing.Color]::FromArgb(0, $BG))
  $g.FillPath($pgb, $path)
  $pgb.Dispose(); $path.Dispose()
}

function Font-B { param([single]$sz) New-Object System.Drawing.Font("Segoe UI", $sz, [System.Drawing.FontStyle]::Bold) }
function Font-R { param([single]$sz) New-Object System.Drawing.Font("Segoe UI", $sz, [System.Drawing.FontStyle]::Regular) }
function Brush { param($c) New-Object System.Drawing.SolidBrush($c) }

$logo = [System.Drawing.Image]::FromFile($logoPath)

# ── Small promo tile 440x280 ──────────────────────────────────────────────
$bmp, $g = New-Canvas24 440 280
Draw-Glow $g 220 120 300 190 90

$logoSz = 84
$nameF = Font-B 42; $subF = Font-R 18
$nameSz = $g.MeasureString("Aleph", $nameF)
$subSz = $g.MeasureString("AI Chat Styler", $subF)
$textW = [Math]::Max($nameSz.Width, $subSz.Width)
$gap = 20
$groupW = $logoSz + $gap + $textW
$gx = (440 - $groupW) / 2
$gy = 78
$g.DrawImage($logo, $gx, $gy, $logoSz, $logoSz)
$tx = $gx + $logoSz + $gap
$g.DrawString("Aleph", $nameF, (Brush $WHITE), $tx, $gy + 2)
$g.DrawString("AI Chat Styler", $subF, (Brush $MUTED), $tx + 2, $gy + 2 + $nameSz.Height - 4)
# accent underline under the lockup
$pen = New-Object System.Drawing.Pen($ACCENT, [single]3)
$g.DrawLine($pen, $tx + 2, $gy + $logoSz + 4, $tx + 2 + [Math]::Min($textW, 210), $gy + $logoSz + 4)
$pen.Dispose()
# tagline
$tagF = Font-R 15
$tagStr = "Hebrew & Arabic RTL for AI chats"
$tagSz = $g.MeasureString($tagStr, $tagF)
$g.DrawString($tagStr, $tagF, (Brush $TAG), (440 - $tagSz.Width) / 2, 232)
$bmp.Save((Join-Path $outDir "promo-small-440x280.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()

# ── Marquee promo tile 1400x560 ───────────────────────────────────────────
$bmp, $g = New-Canvas24 1400 560
Draw-Glow $g 430 280 620 420 70

# Left: branding lockup
$lx = 96
$logoM = 132
$logoY = 122
$g.DrawImage($logo, $lx, $logoY, $logoM, $logoM)
$nameMF = Font-B 72; $subMF = Font-R 30
$nx = $lx + $logoM + 30
$g.DrawString("Aleph", $nameMF, (Brush $WHITE), $nx, $logoY + 6)
$g.DrawString("AI Chat Styler", $subMF, (Brush $MUTED), ($nx + 4), 262)
$pen = New-Object System.Drawing.Pen($ACCENT, [single]4)
$g.DrawLine($pen, ($nx + 4), 314, ($nx + 274), 314)
$pen.Dispose()
# tagline: short, explicitly-positioned lines (no wrap, so nothing clips)
$tl1 = Font-R 28; $tl2 = Font-R 22
$g.DrawString("Readable Hebrew & Arabic-script AI chats", $tl1, (Brush $MUTED), $lx, 356)
$g.DrawString("Per-element BiDi fixes " + $MID + " 14 themes " + $MID + " usage dashboard", $tl2, (Brush $TAG), $lx, 408)
$g.DrawString("Claude " + $MID + " ChatGPT " + $MID + " Gemini", $tl2, (Brush $TAG), $lx, 444)

# Right: the usage popup card with glow
if (Test-Path $cardPath) {
  $card = [System.Drawing.Image]::FromFile($cardPath)
  $ch = 470
  $cw = [int]($card.Width * $ch / $card.Height)
  $cxp = 1400 - $cw - 150
  $cyp = [int]((560 - $ch) / 2)
  Draw-Glow $g ($cxp + $cw / 2) ($cyp + $ch / 2) ($cw * 1.4) ($ch * 0.7) 150
  $radius = 18
  $clip = New-RoundedRect $cxp $cyp $cw $ch $radius
  $g.SetClip($clip)
  $g.DrawImage($card, (New-Object System.Drawing.Rectangle($cxp, $cyp, $cw, $ch)), 0, 0, $card.Width, $card.Height, [System.Drawing.GraphicsUnit]::Pixel)
  $g.ResetClip()
  $pen = New-Object System.Drawing.Pen($BORDER, [single]1.5)
  $g.DrawPath($pen, $clip)
  $pen.Dispose(); $clip.Dispose(); $card.Dispose()
}
$bmp.Save((Join-Path $outDir "promo-marquee-1400x560.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
$logo.Dispose()

foreach ($n in @("promo-small-440x280.png", "promo-marquee-1400x560.png")) {
  $p = Join-Path $outDir $n
  $img = [System.Drawing.Image]::FromFile($p)
  Write-Output ("{0}: {1}x{2}  {3}" -f $n, $img.Width, $img.Height, $img.PixelFormat)
  $img.Dispose()
}
