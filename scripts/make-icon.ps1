# Draws the Prompt Studio icon and writes assets/icon.ico (PNG-compressed entries, 16-256 px).
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot '..\assets'
New-Item -ItemType Directory -Force $out | Out-Null

function New-IconPng([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.Clear([System.Drawing.Color]::Transparent)
  $r = [single]($size * 0.22)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $s = [single]($size - 1)
  $path.AddArc(0, 0, $r, $r, 180, 90); $path.AddArc($s - $r, 0, $r, $r, 270, 90)
  $path.AddArc($s - $r, $s - $r, $r, $r, 0, 90); $path.AddArc(0, $s - $r, $r, $r, 90, 90); $path.CloseFigure()
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Point 0, 0), (New-Object System.Drawing.Point $size, $size), ([System.Drawing.Color]::FromArgb(255, 61, 111, 216)), ([System.Drawing.Color]::FromArgb(255, 124, 77, 214))
  $g.FillPath($brush, $path)
  # Speech bubble with a spark: "prompt"
  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $bx = [single]($size * 0.18); $by = [single]($size * 0.2); $bw = [single]($size * 0.64); $bh = [single]($size * 0.46)
  $bubble = New-Object System.Drawing.Drawing2D.GraphicsPath
  $br = [single]($size * 0.14)
  $bubble.AddArc($bx, $by, $br, $br, 180, 90); $bubble.AddArc($bx + $bw - $br, $by, $br, $br, 270, 90)
  $bubble.AddArc($bx + $bw - $br, $by + $bh - $br, $br, $br, 0, 90); $bubble.AddArc($bx, $by + $bh - $br, $br, $br, 90, 90); $bubble.CloseFigure()
  $g.FillPath($white, $bubble)
  $tail = [System.Drawing.PointF[]]@((New-Object System.Drawing.PointF ([single]($size * 0.3)), ([single]($by + $bh - 1))), (New-Object System.Drawing.PointF ([single]($size * 0.26)), ([single]($size * 0.8))), (New-Object System.Drawing.PointF ([single]($size * 0.46)), ([single]($by + $bh - 1))))
  $g.FillPolygon($white, $tail)
  $ink = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 61, 111, 216))
  $cx = [single]($size * 0.5); $cy = [single]($by + $bh / 2); $k = [single]($size * 0.15)
  $spark = [System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF $cx, ($cy - $k)), (New-Object System.Drawing.PointF ($cx + $k * 0.28), ($cy - $k * 0.28)),
    (New-Object System.Drawing.PointF ($cx + $k), $cy), (New-Object System.Drawing.PointF ($cx + $k * 0.28), ($cy + $k * 0.28)),
    (New-Object System.Drawing.PointF $cx, ($cy + $k)), (New-Object System.Drawing.PointF ($cx - $k * 0.28), ($cy + $k * 0.28)),
    (New-Object System.Drawing.PointF ($cx - $k), $cy), (New-Object System.Drawing.PointF ($cx - $k * 0.28), ($cy - $k * 0.28)))
  $g.FillPolygon($ink, $spark)
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  if ($size -eq 256) { $bmp.Save((Join-Path $out 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png) }
  $bmp.Dispose()
  return ,$ms.ToArray()
}

$sizes = 16, 24, 32, 48, 64, 128, 256
$pngs = $sizes | ForEach-Object { ,(New-IconPng $_) }
$fs = [System.IO.File]::Create((Join-Path $out 'icon.ico'))
$w = New-Object System.IO.BinaryWriter $fs
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $sz = $sizes[$i]; $len = $pngs[$i].Length
  $w.Write([byte]($sz % 256)); $w.Write([byte]($sz % 256)); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$len); $w.Write([uint32]$offset)
  $offset += $len
}
foreach ($p in $pngs) { $w.Write($p) }
$w.Close()
Write-Output "Wrote $(Join-Path $out 'icon.ico')"
