# Composes the single-popup usage screenshot (1280x800) for CWS slot 05 and the
# website, from the raw popup capture. A lone narrow popup would look lost on the
# wide store canvas, so it sits on the same branded background as compose.ps1 with
# a soft accent halo behind it and rounded-card framing. Run:
#   powershell -ExecutionPolicy Bypass -File store-assets\compose-usage.ps1
Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$src = Join-Path $PSScriptRoot "popup-usage.png"
$outStore = Join-Path $PSScriptRoot "final\05-popup-usage.png"
$outWeb = Join-Path $root "docs\assets\popup-usage.png"

if (-not (Test-Path $src)) { Write-Error "Missing source: $src"; exit 1 }

$W = 1280; $H = 800
$BG = [System.Drawing.Color]::FromArgb(255, 18, 19, 38)
$BORDER = [System.Drawing.Color]::FromArgb(255, 58, 61, 99)
$ACCENT = [System.Drawing.Color]::FromArgb(124, 131, 255)

function New-RoundedRect {
  param([int]$x, [int]$y, [int]$w, [int]$h, [int]$r)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

$img = [System.Drawing.Image]::FromFile($src)
$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = "AntiAlias"
$g.InterpolationMode = "HighQualityBicubic"
$g.PixelOffsetMode = "HighQuality"
$g.Clear($BG)

# Popup placement: slight upscale from 601 -> 660 keeps it readable without much blur.
$targetH = 660
$pw = [int]($img.Width * $targetH / $img.Height)
$px = [int](($W - $pw) / 2)
$py = [int](($H - $targetH) / 2)
$cx = $px + $pw / 2; $cy = $py + $targetH / 2

# Soft accent halo behind the card so the wide margins read as intentional depth.
$glow = New-Object System.Drawing.Drawing2D.GraphicsPath
$grw = 560; $grh = 430
$glow.AddEllipse($cx - $grw, $cy - $grh, $grw * 2, $grh * 2)
$pgb = New-Object System.Drawing.Drawing2D.PathGradientBrush($glow)
$pgb.CenterPoint = New-Object System.Drawing.PointF($cx, $cy)
$pgb.CenterColor = [System.Drawing.Color]::FromArgb(120, $ACCENT)
$pgb.SurroundColors = @([System.Drawing.Color]::FromArgb(0, $BG))
$g.FillPath($pgb, $glow)
$pgb.Dispose(); $glow.Dispose()

# Rounded card: clip the popup to rounded corners, then stroke a 1px border.
$radius = 16
$card = New-RoundedRect $px $py $pw $targetH $radius
$g.SetClip($card)
$dst = New-Object System.Drawing.Rectangle($px, $py, $pw, $targetH)
$g.DrawImage($img, $dst, 0, 0, $img.Width, $img.Height, [System.Drawing.GraphicsUnit]::Pixel)
$g.ResetClip()
$pen = New-Object System.Drawing.Pen($BORDER, [single]1.5)
$g.DrawPath($pen, $card)
$pen.Dispose(); $card.Dispose()

New-Item -ItemType Directory -Force (Split-Path $outStore) | Out-Null
$bmp.Save($outStore, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Save($outWeb, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $img.Dispose()

foreach ($o in @($outStore, $outWeb)) {
  $check = [System.Drawing.Image]::FromFile($o)
  Write-Output ("{0}: {1}x{2}" -f $o, $check.Width, $check.Height)
  $check.Dispose()
}
