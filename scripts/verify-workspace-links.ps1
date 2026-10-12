param([string]$BaseUrl = 'http://localhost:3001')

$ErrorActionPreference = 'Stop'
$sessionName = 'workspace-links-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$browserOpened = $false
$failed = $false

# A failed browser assertion must fail the command, not produce a false green result.
function Invoke-BrowserCommand {
    param([string[]]$CliArguments)
    # Bypass npx.cmd: cmd.exe treats the & in duplicate-query URLs as another command.
    $output = & $nodeCommand $npxEntry --yes --package '@playwright/cli@0.1.22' playwright-cli "-s=$sessionName" @CliArguments 2>&1
    if ($LASTEXITCODE -ne 0 -or ($output -join "`n") -match '### Error') {
        $output | Where-Object { "$_" -match '^(Error|SyntaxError|TimeoutError):' } | ForEach-Object { [Console]::Error.WriteLine("$_") }
        throw "Browser command failed: $($CliArguments[0]). Inspect .playwright-cli/ artifacts for details."
    }
}

try {
    # Never send even test credentials to a deployed site or accept a redirecting base URL.
    $address = [Uri]$BaseUrl
    if (-not $address.IsAbsoluteUri -or $address.Scheme -ne 'http' -or
        $address.Host -notin @('localhost', '127.0.0.1') -or $address.UserInfo -or
        $address.AbsolutePath -ne '/' -or $address.Query -or $address.Fragment) {
        throw 'BaseUrl must be a local http://localhost:<port> or http://127.0.0.1:<port> origin.'
    }
    $BaseUrl = $address.GetLeftPart([UriPartial]::Authority)
    $nodeCommand = (Get-Command node.exe -ErrorAction Stop).Source
    $npxCommand = (Get-Command npx.cmd -ErrorAction Stop).Source
    $npxEntry = Join-Path (Split-Path $npxCommand) 'node_modules/npm/bin/npx-cli.js'
    if (-not (Test-Path -LiteralPath $npxEntry)) {
        throw 'Could not find npm beside npx.cmd. Use a standard Node.js/npm installation.'
    }
    $null = Invoke-WebRequest "$BaseUrl/workspace" -UseBasicParsing -MaximumRedirection 0 -TimeoutSec 30

    # Each run gets a new browser session; existing user cookies/tabs are never reused.
    Invoke-BrowserCommand @('open')
    $browserOpened = $true
    Invoke-BrowserCommand @('resize', '1440', '1000')
    # File-based snippets avoid Windows command-line quoting of multiline JavaScript.
    $browserChecks = 'scripts/workspace-links.browser.js'
    Invoke-BrowserCommand @('run-code', "--filename=$browserChecks")
    $queries = @(
        '?project=not-an-id',
        '?project=100000000000000000000001&project=100000000000000000000001',
        '?revision=200000000000000000000001'
    )
    $null = New-Item -ItemType Directory -Force -Path 'output/playwright'
    $snapshotPath = "output/playwright/$sessionName.yml"
    foreach ($query in $queries) {
        Write-Host "Checking malformed link: $query"
        Invoke-BrowserCommand @('goto', "$BaseUrl/workspace$query")
        Invoke-BrowserCommand @('snapshot')
        Invoke-BrowserCommand @('run-code', "--filename=$browserChecks")
        # Use the ref from the fresh snapshot, rather than assuming a stable DOM position.
        Invoke-BrowserCommand @('snapshot', "--filename=$snapshotPath")
        $snapshot = Get-Content -LiteralPath $snapshotPath -Raw
        $buttonMatch = [regex]::Match($snapshot, 'button "New conversation" \[ref=([a-z0-9]+)\]')
        if (-not $buttonMatch.Success) { throw 'New conversation button was absent from the snapshot.' }
        Invoke-BrowserCommand @('click', $buttonMatch.Groups[1].Value)
        Invoke-BrowserCommand @('run-code', "async page => { await page.waitForURL(url => url.pathname === '/workspace' && url.search === ''); }")
        Invoke-BrowserCommand @('snapshot')
        Invoke-BrowserCommand @('run-code', "--filename=$browserChecks")
        Write-Host "PASS malformed link + empty workspace recovery: $query"
    }
    Invoke-BrowserCommand @('run-code', "async page => { const counts = await page.evaluate(() => window.workspaceLinkSmokeCounts()); if (counts.invalidChecks !== 3 || counts.recoveryChecks !== 3) throw new Error('Expected three invalid states and three recoveries.'); }")
    Invoke-BrowserCommand @('screenshot', "--filename=output/playwright/$sessionName.png", '--full-page')
    Write-Host 'PASS 3/3 browser scenarios. API responses mocked; no persistence or provider verification claimed.'
} catch {
    $failed = $true
    [Console]::Error.WriteLine($_.Exception.Message)
} finally {
    # Close only our own session, including after assertion failures.
    if ($browserOpened) {
        try { Invoke-BrowserCommand @('close') }
        catch { $failed = $true; [Console]::Error.WriteLine('Could not close the smoke-test browser session.') }
    }
}
if ($failed) { exit 1 }
