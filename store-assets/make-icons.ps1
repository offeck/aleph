# Generates the extension icons (16/48/128) from the chosen logo font: a flat
# #7C83FF rounded tile (matching the existing icon spec: 6.25% inset, ~16% corner
# radius, transparent corners) with the glyph ink-centered at 0.62 fill. Rendered
# at 4x supersampling for crisp edges.
#
# The font is Frank Ruhl Libre 700, a static instance cut from the OFL variable
# font (google/fonts) via: python -m fontTools.varLib.instancer "FrankRuhlLibre[wght].ttf" wght=700 -o FRL-700.ttf
#
#   powershell -ExecutionPolicy Bypass -File store-assets\make-icons.ps1 -FontPath <FRL-700.ttf> -OutDir <dir>
param([string]$FontPath, [string]$OutDir, [double]$Fill = 0.62)
Add-Type -AssemblyName System.Drawing

$ALEF   = [string][char]0x05D0
$PURPLE = [System.Drawing.Color]::FromArgb(255, 124, 131, 255)   # #7C83FF, flat
$WHITE  = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)
$INSET  = 0.0625   # 8/128
$RADIUS = 0.1641   # 21/128
New-Item -ItemType Directory -Force $OutDir | Out-Null

$pfc = New-Object System.Drawing.Text.PrivateFontCollection
$pfc.AddFontFile($FontPath)
$family = $pfc.Families[0]

# Ink box of the glyph (pixels at a reference em), via alpha scan.
function Calibrate {
  $EM = 300; $pad = 30; $cv = 380
  $tb = New-Object System.Drawing.Bitmap($cv, $cv, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $tg = [System.Drawing.Graphics]::FromImage($tb)
  $tg.SmoothingMode = "AntiAlias"; $tg.TextRenderingHint = "AntiAlias"
  $f = New-Object System.Drawing.Font($family, [single]$EM, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $tg.DrawString($ALEF, $f, (New-Object System.Drawing.SolidBrush($WHITE)), [single]$pad, [single]$pad)
  $f.Dispose(); $tg.Dispose()
  $bd = $tb.LockBits((New-Object System.Drawing.Rectangle(0,0,$cv,$cv)), [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $stride = $bd.Stride; $len = [Math]::Abs($stride) * $cv
  $buf = New-Object byte[] $len
  [System.Runtime.InteropServices.Marshal]::Copy($bd.Scan0, $buf, 0, $len)
  $tb.UnlockBits($bd); $tb.Dispose()
  $minX=$cv;$minY=$cv;$maxX=0;$maxY=0
  for ($yy=0;$yy -lt $cv;$yy++){ $ro=$yy*$stride
    for ($xx=0;$xx -lt $cv;$xx++){ if ($buf[$ro+$xx*4+3] -gt 16){
      if($xx -lt $minX){$minX=$xx};if($xx -gt $maxX){$maxX=$xx};if($yy -lt $minY){$minY=$yy};if($yy -gt $maxY){$maxY=$yy} } } }
  return @{ EM=$EM; bx=($minX-$pad); by=($minY-$pad); bw=($maxX-$minX+1); bh=($maxY-$minY+1) }
}
$cal = Calibrate

function Rounded { param([single]$x,[single]$y,[single]$w,[single]$h,[single]$r)
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath; $d=$r*2
  $p.AddArc($x,$y,$d,$d,180,90); $p.AddArc($x+$w-$d,$y,$d,$d,270,90)
  $p.AddArc($x+$w-$d,$y+$h-$d,$d,$d,0,90); $p.AddArc($x,$y+$h-$d,$d,$d,90,90)
  $p.CloseFigure(); return $p }

# Render one icon at resolution R (square, transparent), returns bitmap.
function Render { param([int]$R)
  $bmp = New-Object System.Drawing.Bitmap($R, $R, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = "AntiAlias"; $g.TextRenderingHint = "AntiAlias"
  $g.InterpolationMode = "HighQualityBicubic"; $g.PixelOffsetMode = "HighQuality"
  $g.Clear([System.Drawing.Color]::Transparent)
  $inset = $R * $INSET; $tile = $R - 2*$inset; $rad = $R * $RADIUS
  $path = Rounded $inset $inset $tile $tile $rad
  $g.FillPath((New-Object System.Drawing.SolidBrush($PURPLE)), $path); $path.Dispose()
  $cx = $R/2; $cy = $R/2
  $k = ($tile * $Fill) / [Math]::Max($cal.bw, $cal.bh)
  $emPx = $cal.EM * $k
  $ox = $cx - $k*($cal.bx + $cal.bw/2)
  $oy = $cy - $k*($cal.by + $cal.bh/2)
  $f = New-Object System.Drawing.Font($family, [single]$emPx, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $g.DrawString($ALEF, $f, (New-Object System.Drawing.SolidBrush($WHITE)), [single]$ox, [single]$oy)
  $f.Dispose(); $g.Dispose()
  return $bmp
}

$ss = 4
foreach ($S in @(16, 48, 128)) {
  $hi = Render ($S * $ss)
  $out = New-Object System.Drawing.Bitmap($S, $S, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $og = [System.Drawing.Graphics]::FromImage($out)
  $og.InterpolationMode = "HighQualityBicubic"; $og.PixelOffsetMode = "HighQuality"; $og.SmoothingMode = "HighQuality"
  $og.Clear([System.Drawing.Color]::Transparent)
  $og.DrawImage($hi, (New-Object System.Drawing.Rectangle(0,0,$S,$S)))
  $og.Dispose(); $hi.Dispose()
  $out.Save((Join-Path $OutDir "icon$S.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $out.Dispose()
  Write-Output "icon$S.png"
}
