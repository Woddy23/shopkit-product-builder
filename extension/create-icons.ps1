Add-Type -AssemblyName System.Drawing

# Create 16x16 icon
$bmp16 = New-Object System.Drawing.Bitmap 16, 16
$gfx16 = [System.Drawing.Graphics]::FromImage($bmp16)
$gfx16.Clear([System.Drawing.Color]::FromArgb(0, 123, 255))
$gfx16.Dispose()
$bmp16.Save('icon16.png', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp16.Dispose()

# Create 48x48 icon
$bmp48 = New-Object System.Drawing.Bitmap 48, 48
$gfx48 = [System.Drawing.Graphics]::FromImage($bmp48)
$gfx48.Clear([System.Drawing.Color]::FromArgb(0, 123, 255))
$gfx48.Dispose()
$bmp48.Save('icon48.png', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp48.Dispose()

# Create 128x128 icon
$bmp128 = New-Object System.Drawing.Bitmap 128, 128
$gfx128 = [System.Drawing.Graphics]::FromImage($bmp128)
$gfx128.Clear([System.Drawing.Color]::FromArgb(0, 123, 255))
$gfx128.Dispose()
$bmp128.Save('icon128.png', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp128.Dispose()

Write-Host "Icons created successfully"
