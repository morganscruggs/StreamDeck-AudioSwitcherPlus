# Renders gallery.html slides to 1920x960 PNGs (Elgato Marketplace gallery/thumbnail size) with headless Edge,
# plus the 288x288 Marketplace app icon. Each slide id in the list maps to section #s<id> and is written as
# gallery-<id>.png.
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$html = (Resolve-Path "$PSScriptRoot\gallery.html").Path
$uri = ([System.Uri]$html).AbsoluteUri

function Render($hash, $size, $out) {
    & $edge --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files `
        --force-device-scale-factor=1 "--window-size=$size" --virtual-time-budget=3000 `
        "--screenshot=$out" "$uri#$hash" | Out-Null
    Write-Output "Wrote $out"
}

foreach ($n in @("1", "2", "3", "4", "5")) {
    Render $n "1920,960" (Join-Path $PSScriptRoot ("gallery-{0}.png" -f $n))
}
Render "icon" "288,288" (Join-Path $PSScriptRoot "app-icon.png")
