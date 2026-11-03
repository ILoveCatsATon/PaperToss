# Draws the Paper Toss icon (a steel bin with a paper ball dropping in) and writes
# installer\PaperToss.ico (16-256 px) and installer\logo.png (256 px).
# Only needed if you want to change the icon. Usage:
#   powershell -ExecutionPolicy Bypass -File installer\make-icon.ps1
Add-Type -AssemblyName System.Drawing
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

function C([string]$hex) { [System.Drawing.ColorTranslator]::FromHtml($hex) }

function Draw([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.ScaleTransform($size / 256.0, $size / 256.0)
  $small = $size -le 32

  # Bin body: a tapered can, shaded like the "steel" skin.
  $body = New-Object System.Drawing.Drawing2D.GraphicsPath
  $body.AddLines([System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF 58, 118), (New-Object System.Drawing.PointF 198, 118),
    (New-Object System.Drawing.PointF 184, 236), (New-Object System.Drawing.PointF 72, 236)))
  $body.CloseFigure()
  $shade = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.PointF 58, 0), (New-Object System.Drawing.PointF 198, 0), (C '#6d7680'), (C '#5c646d')
  $blend = New-Object System.Drawing.Drawing2D.ColorBlend
  $blend.Colors = [System.Drawing.Color[]]@((C '#6d7680'), (C '#d6dce1'), (C '#f4f6f8'), (C '#b7bfc7'), (C '#8d959e'), (C '#5c646d'))
  $blend.Positions = [single[]]@(0, 0.22, 0.34, 0.55, 0.82, 1)
  $shade.InterpolationColors = $blend
  $g.FillPath($shade, $body)

  if (-not $small) {
    # Vertical ridges.
    $ridge = New-Object System.Drawing.Pen (C '#00000022'), 3
    foreach ($t in 0.2, 0.4, 0.6, 0.8) {
      $g.DrawLine($ridge, (58 + 140 * $t), 132, (72 + 112 * $t), 226)
    }
  }
  $outline = New-Object System.Drawing.Pen (C '#3d444d'), ($(if ($small) { 9 } else { 5 }))
  $outline.LineJoin = 'Round'
  $g.DrawPath($outline, $body)

  # Opening: rim ellipse with a dark inside.
  $g.FillEllipse((New-Object System.Drawing.SolidBrush (C '#eef1f3')), 50, 102, 156, 34)
  $g.FillEllipse((New-Object System.Drawing.SolidBrush (C '#22272e')), 60, 107, 136, 24)
  $g.DrawEllipse($outline, 50, 102, 156, 34)

  # Dotted throw arc in the app's accent red.
  if (-not $small) {
    $dot = New-Object System.Drawing.SolidBrush (C '#e2553d')
    foreach ($p in @(@(28, 150, 9), @(30, 112, 10), @(42, 78, 11), @(62, 52, 12))) {
      $g.FillEllipse($dot, $p[0] - $p[2] / 2, $p[1] - $p[2] / 2, $p[2], $p[2])
    }
  }

  # Crumpled paper ball just above the opening.
  $cx = 140; $cy = 62; $r = 46
  $rnd = New-Object System.Random 7
  $pts = @()
  for ($i = 0; $i -lt 14; $i++) {
    $a = $i / 14.0 * 2 * [Math]::PI
    $rr = $r * (0.86 + 0.14 * $rnd.NextDouble())
    $pts += New-Object System.Drawing.PointF ($cx + $rr * [Math]::Cos($a)), ($cy + $rr * [Math]::Sin($a))
  }
  $ballPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $ballPath.AddPolygon([System.Drawing.PointF[]]$pts)
  $ballFill = New-Object System.Drawing.Drawing2D.PathGradientBrush $ballPath
  $ballFill.CenterPoint = New-Object System.Drawing.PointF ($cx - 14), ($cy - 16)
  $ballFill.CenterColor = C '#ffffff'
  $ballFill.SurroundColors = [System.Drawing.Color[]]@(C '#cfc8b6')
  $g.FillPath($ballFill, $ballPath)
  if (-not $small) {
    # Zigzag creases across the ball.
    $crease = New-Object System.Drawing.Pen (C '#a69f8c'), 3
    $crease.LineJoin = 'Round'; $crease.StartCap = 'Round'; $crease.EndCap = 'Round'
    $lines = @(
      @(@(-30, -14), @(-12, -4), @(-2, -22), @(14, -10), @(30, -20)),
      @(@(-28, 14), @(-10, 6), @(4, 20), @(20, 8), @(32, 16)),
      @(@(-6, -34), @(-2, -4), @(-14, 10), @(-8, 32)),
      @(@(12, -30), @(18, -6), @(24, 30)))
    foreach ($l in $lines) {
      $lp = foreach ($q in $l) { New-Object System.Drawing.PointF ($cx + $q[0]), ($cy + $q[1]) }
      $g.DrawLines($crease, [System.Drawing.PointF[]]$lp)
    }
  }
  $ballLine = New-Object System.Drawing.Pen (C '#6f6957'), ($(if ($small) { 8 } else { 4 }))
  $ballLine.LineJoin = 'Round'
  $g.DrawPath($ballLine, $ballPath)

  $g.Dispose()
  return $bmp
}

function PngBytes($bmp) {
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  return $ms.ToArray()
}

# ICO file: header, one directory entry per size, then the PNG data for each.
$sizes = 16, 24, 32, 48, 64, 128, 256
$images = foreach ($s in $sizes) { , [byte[]](PngBytes (Draw $s)) }
$out = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $out
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]; $len = $images[$i].Length
  $w.Write([byte]($s % 256)); $w.Write([byte]($s % 256)); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$len); $w.Write([uint32]$offset)
  $offset += $len
}
foreach ($img in $images) { $w.Write([byte[]]$img) }
[System.IO.File]::WriteAllBytes("$here\PaperToss.ico", $out.ToArray())
[System.IO.File]::WriteAllBytes("$here\logo.png", (PngBytes (Draw 256)))
"Wrote $here\PaperToss.ico and $here\logo.png"
