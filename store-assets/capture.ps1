# Screen-capture toolkit for store screenshots.
# calibrate: find the browser viewport rect on the primary screen via magenta corner probes.
# shot:      capture the calibrated rect to a PNG.
param(
  [Parameter(Mandatory)][ValidateSet("calibrate", "shot", "toggle")] [string]$Mode,
  [string]$OutFile
)
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$rectFile = Join-Path $PSScriptRoot "viewport-rect.json"

# Bring the Claude browser window to the foreground before capturing.
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32Fg {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  public delegate bool EnumProc(IntPtr h, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
  public static IntPtr Found = IntPtr.Zero;
  public static string FoundTitle = "";
  public static void FindByTitle(string needle) {
    Found = IntPtr.Zero;
    FoundTitle = "";
    EnumWindows(delegate(IntPtr h, IntPtr lp) {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(512);
      GetWindowTextW(h, sb, 512);
      var t = sb.ToString();
      if (t.Contains(needle)) { Found = h; FoundTitle = t; return false; }
      return true;
    }, IntPtr.Zero);
  }
  public static void SelectLastTab() {
    keybd_event(0x11, 0, 0, UIntPtr.Zero);  // Ctrl down
    keybd_event(0x39, 0, 0, UIntPtr.Zero);  // 9 down
    keybd_event(0x39, 0, 2, UIntPtr.Zero);  // 9 up
    keybd_event(0x11, 0, 2, UIntPtr.Zero);  // Ctrl up
  }
}
"@
# The MCP-controlled window: match the Claude tab title first, else any tab of it.
[Win32Fg]::FindByTitle("Claude - Google Chrome")
if ([Win32Fg]::Found -eq [IntPtr]::Zero) { [Win32Fg]::FindByTitle("AI Chat Styler") }
if ([Win32Fg]::Found -eq [IntPtr]::Zero) { Write-Output "FAIL: no target Chrome window found"; exit 1 }
Write-Output ("window: " + [Win32Fg]::FoundTitle)
# Alt-key tap unlocks SetForegroundWindow from a background process.
[Win32Fg]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
$null = [Win32Fg]::SetForegroundWindow([Win32Fg]::Found)
[Win32Fg]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 600
# Real Ctrl+9 keystroke selects the rightmost tab (the capture tab).
[Win32Fg]::SelectLastTab()
Start-Sleep -Milliseconds 800

if ($Mode -eq "toggle") {
  # Real Alt+Shift+A fires the extension's chrome.commands toggle.
  [Win32Fg]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)  # Alt down
  [Win32Fg]::keybd_event(0x10, 0, 0, [UIntPtr]::Zero)  # Shift down
  [Win32Fg]::keybd_event(0x41, 0, 0, [UIntPtr]::Zero)  # A down
  [Win32Fg]::keybd_event(0x41, 0, 2, [UIntPtr]::Zero)  # A up
  [Win32Fg]::keybd_event(0x10, 0, 2, [UIntPtr]::Zero)  # Shift up
  [Win32Fg]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)  # Alt up
  Write-Output "TOGGLED"
  exit 0
}

# Capture the full virtual desktop (all monitors).
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bmp.Size)
$g.Dispose()

if ($Mode -eq "calibrate") {
  # Probes are pure magenta (255,0,255) 40px squares at viewport corners.
  $isMagenta = {
    param($c)
    ($c.R -gt 230) -and ($c.G -lt 40) -and ($c.B -gt 230)
  }
  $minX = -1; $minY = -1; $maxX = -1; $maxY = -1
  for ($y = 0; $y -lt $bmp.Height; $y += 4) {
    for ($x = 0; $x -lt $bmp.Width; $x += 4) {
      $c = $bmp.GetPixel($x, $y)
      if (& $isMagenta $c) {
        if ($minX -lt 0 -or $x -lt $minX) { $minX = $x }
        if ($minY -lt 0 -or $y -lt $minY) { $minY = $y }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }
  $bmp.Dispose()
  if ($minX -lt 0) { Write-Output "CALIBRATE-FAIL: no probe pixels found"; exit 1 }
  # Refine to exact probe edges (probes sit flush at viewport corners).
  $rect = @{ x = $minX; y = $minY; w = ($maxX - $minX + 1); h = ($maxY - $minY + 1) }
  $rect | ConvertTo-Json | Out-File $rectFile -Encoding utf8
  Write-Output ("CALIBRATED: x=$($rect.x) y=$($rect.y) w=$($rect.w) h=$($rect.h)")
} else {
  if (-not (Test-Path $rectFile)) { Write-Output "SHOT-FAIL: not calibrated"; exit 1 }
  if (-not $OutFile) { Write-Output "SHOT-FAIL: missing -OutFile"; exit 1 }
  $rect = Get-Content $rectFile -Raw | ConvertFrom-Json
  $crop = New-Object System.Drawing.Bitmap($rect.w, $rect.h)
  $cg = [System.Drawing.Graphics]::FromImage($crop)
  $srcRect = New-Object System.Drawing.Rectangle($rect.x, $rect.y, $rect.w, $rect.h)
  $dstRect = New-Object System.Drawing.Rectangle(0, 0, $rect.w, $rect.h)
  $cg.DrawImage($bmp, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
  $cg.Dispose()
  $crop.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
  $crop.Dispose()
  $bmp.Dispose()
  Write-Output ("SAVED: $OutFile ($($rect.w)x$($rect.h))")
}
