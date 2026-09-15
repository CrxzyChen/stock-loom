$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$dotnet=Join-Path $projectRoot '.runtime/dotnet10/dotnet.exe'
$native=Join-Path $projectRoot 'services/computer-use-windows/bin/Debug/net10.0-windows10.0.19041.0/win-x64/StockLoom.ComputerUse.dll'
$fixtureDll=Join-Path $projectRoot 'tests/windows/ComputerUseFixture/bin/Debug/net10.0-windows/ComputerUseFixture.dll'
$output=Join-Path $projectRoot '.runtime/round5-native-proof'
[IO.Directory]::CreateDirectory($output) | Out-Null
$fixture=$null
function Call-Native([string]$mode,[string]$handle){
    $result=(& $dotnet $native $mode $handle) | ConvertFrom-Json
    if($LASTEXITCODE -ne 0 -or $result.error){throw ($result.error | ConvertTo-Json -Compress)}
    return $result
}
try{
    $fixture=Start-Process -FilePath $dotnet -ArgumentList ('"'+$fixtureDll+'"') -WindowStyle Hidden -PassThru
    $window=$null
    for($attempt=0;$attempt -lt 20 -and !$window;$attempt++){
        Start-Sleep -Milliseconds 250
        $windows=(& $dotnet $native --probe-windows) | ConvertFrom-Json
        $window=$windows | Where-Object {$_.processId -eq $fixture.Id} | Select-Object -First 1
    }
    if(!$window){throw 'Test window did not appear'}
    $observation=Call-Native '--probe-inspect' $window.handle
    if(!($observation.elements | Where-Object automationId -eq 'ResearchInput')){throw 'Input control missing'}
    $inputResult=Call-Native '--probe-fixture-input' $window.handle
    if(!$inputResult.passed){throw 'Input probe failed'}
    $capture=Call-Native '--probe-capture' $window.handle
    $bytes=[Convert]::FromBase64String($capture.data)
    if($capture.width -lt 100 -or $capture.height -lt 100 -or $bytes.Length -lt 100){throw 'Capture is empty'}
    [IO.File]::WriteAllBytes((Join-Path $output 'after.png'),$bytes)
    [pscustomobject]@{passed=$true;updatedAt=(Get-Date).ToString('o');windowObservation=$true;controlCount=$observation.elements.Count;input=$inputResult;capture=@{width=$capture.width;height=$capture.height;bytes=$bytes.Length;api='Windows.Graphics.Capture'};scope='Dedicated fixture only; not full application acceptance'} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $output 'result.json') -Encoding utf8
    Get-Content -LiteralPath (Join-Path $output 'result.json')
}catch{
    [pscustomobject]@{passed=$false;updatedAt=(Get-Date).ToString('o');error=$_.Exception.Message;scope='Dedicated fixture only'} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $output 'result.json') -Encoding utf8
    throw
}finally{
    # Only close the process object started by this probe. No process-name cleanup.
    if($fixture -and !$fixture.HasExited){$fixture.Refresh();[void]$fixture.CloseMainWindow();if(!$fixture.WaitForExit(2000)){$fixture.Kill()}}
}
