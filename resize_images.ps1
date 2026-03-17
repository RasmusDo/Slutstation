Add-Type -AssemblyName System.Drawing

$imgDir = "C:\Users\Rasmu\Documents\programiingnas\website-test\src\assets\eventimages"
$images = Get-ChildItem -Path $imgDir -Filter "*.jpg" | Where-Object { $_.Name -notlike "*_small*" }

foreach ($img in $images) {
    try {
        $bmp = [System.Drawing.Image]::FromFile($img.FullName)
        if ($bmp.Width -gt 1200) {
            $ratio = 1200.0 / $bmp.Width
            $newHeight = [math]::Round($bmp.Height * $ratio)
            $newBmp = New-Object System.Drawing.Bitmap($bmp, 1200, $newHeight)
            
            # Setup high quality
            $gfx = [System.Drawing.Graphics]::FromImage($newBmp)
            $gfx.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $gfx.DrawImage($bmp, 0, 0, 1200, $newHeight)
            
            $newPath = Join-Path $imgDir ($img.BaseName + "_small.jpg")
            $newBmp.Save($newPath, [System.Drawing.Imaging.ImageFormat]::Jpeg)
            
            $gfx.Dispose()
            $newBmp.Dispose()
            Write-Host "Successfully resized $($img.Name)"
        }
        $bmp.Dispose()
    } catch {
        Write-Host "Failed to process $($img.Name): `n$_"
    }
}
