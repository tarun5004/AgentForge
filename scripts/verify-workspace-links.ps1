param(
    [string]$BaseUrl = 'http://localhost:3001',
    [ValidateSet('links', 'history', 'access', 'session', 'preview')][string]$Suite = 'links'
)

$ErrorActionPreference = 'Stop'
$sessionName = if ($env:AGENTFORGE_BROWSER_SESSION) { $env:AGENTFORGE_BROWSER_SESSION } else { "workspace-$Suite-" + [Guid]::NewGuid().ToString('N').Substring(0, 8) }
if ($sessionName -notmatch '^[a-zA-Z0-9-]+$') { throw 'Invalid test browser session name.' }
$browserOpened = $false
$failed = $false

# A failed browser assertion must fail the command, not produce a false green result.
function Invoke-BrowserCommand {
    param([string[]]$CliArguments)
    # Bypass npx.cmd: cmd.exe treats the & in duplicate-query URLs as another command.
    # npm notices use stderr too; judge native failure by exit status/browser assertions.
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        [string[]]$entryArgs = if ($env:AGENTFORGE_PLAYWRIGHT_CLI) { @($env:AGENTFORGE_PLAYWRIGHT_CLI) } else { @($npxEntry, '--yes', '--package', '@playwright/cli@0.1.22', 'playwright-cli') }
        $output = & $nodeCommand @entryArgs "-s=$sessionName" @CliArguments 2>&1
        $commandExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousPreference }
    if ($commandExit -ne 0 -or ($output -join "`n") -match '### Error') {
        $output | Where-Object { "$_" -match '^(Error|SyntaxError|TimeoutError):' } | ForEach-Object { [Console]::Error.WriteLine("$_") }
        throw "Browser command failed: $($CliArguments[0]). Inspect .playwright-cli/ artifacts for details."
    }
}

# Read a new snapshot for each click because navigation can replace element refs.
function Click-WorkspaceButton {
    param([string]$Name)
    Invoke-BrowserCommand @('snapshot', "--filename=$snapshotPath")
    $snapshot = Get-Content -LiteralPath $snapshotPath -Raw
    $buttonMatch = [regex]::Match($snapshot, 'button "' + [regex]::Escape($Name) + '" \[ref=([a-z0-9]+)\]')
    if (-not $buttonMatch.Success) { throw "Button was absent from the snapshot: $Name" }
    Invoke-BrowserCommand @('click', $buttonMatch.Groups[1].Value)
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
    $browserOpened = $true
    Invoke-BrowserCommand @('open')
    Invoke-BrowserCommand @('resize', '1440', '1000')
    # File-based snippets avoid Windows command-line quoting of multiline JavaScript.
    $browserChecks = "scripts/workspace-$Suite.browser.js"
    Invoke-BrowserCommand @('run-code', "--filename=$browserChecks")
    $queries = @(
        '?project=not-an-id',
        '?project=100000000000000000000001&project=100000000000000000000001',
        '?revision=200000000000000000000001'
    )
    $null = New-Item -ItemType Directory -Force -Path 'output/playwright'
    $snapshotPath = "output/playwright/$sessionName.yml"
    if ($Suite -eq 'links') {
        foreach ($query in $queries) {
            Write-Host "Checking malformed link: $query"
            Invoke-BrowserCommand @('goto', "$BaseUrl/workspace$query")
            Invoke-BrowserCommand @('snapshot')
            Invoke-BrowserCommand @('run-code', "--filename=$browserChecks")
            Click-WorkspaceButton 'New conversation'
            Invoke-BrowserCommand @('run-code', "async page => { await page.waitForURL(url => url.pathname === '/workspace' && url.search === ''); }")
            Invoke-BrowserCommand @('snapshot')
            Invoke-BrowserCommand @('run-code', "--filename=$browserChecks")
            Write-Host "PASS malformed link + empty workspace recovery: $query"
        }
        Invoke-BrowserCommand @('run-code', "async page => { const counts = await page.evaluate(() => window.workspaceLinkSmokeCounts()); if (counts.invalidChecks !== 3 || counts.recoveryChecks !== 3) throw new Error('Expected three invalid states and three recoveries.'); }")
        Write-Host 'PASS 3/3 browser scenarios. API responses mocked; no persistence or provider verification claimed.'
    } elseif ($Suite -eq 'history') {
        Invoke-BrowserCommand @('goto', "$BaseUrl/workspace")
        Invoke-BrowserCommand @('snapshot')
        Invoke-BrowserCommand @('run-code', "--filename=$browserChecks")
        Click-WorkspaceButton 'Load more projects'
        Invoke-BrowserCommand @('snapshot')
        Invoke-BrowserCommand @('run-code', "--filename=$browserChecks")
        Write-Host 'PASS project pagination, cursor forwarding and deduplication.'
        Click-WorkspaceButton 'History demo v3'
        Invoke-BrowserCommand @('snapshot')
        Invoke-BrowserCommand @('run-code', "--filename=$browserChecks")
        Click-WorkspaceButton 'Load older revisions'
        Invoke-BrowserCommand @('snapshot')
        Invoke-BrowserCommand @('run-code', "--filename=$browserChecks")
        Write-Host 'PASS revision pagination, newest-first order and deduplication.'
        Invoke-BrowserCommand @('screenshot', "--filename=output/playwright/$sessionName-pagination.png", '--full-page')
        # Only the mock session expires; this never logs out a real account.
        Invoke-BrowserCommand @('run-code', 'async page => { await page.evaluate(() => window.expireWorkspaceHistorySession()); }')
        Click-WorkspaceButton 'Reload saved projects'
        Invoke-BrowserCommand @('run-code', "async page => { await page.waitForURL(url => url.pathname === '/login', { timeout: 8000 }); }")
        Invoke-BrowserCommand @('snapshot')
        Invoke-BrowserCommand @('run-code', "--filename=$browserChecks")
        Invoke-BrowserCommand @('run-code', "async page => { const state = await page.evaluate(() => window.workspaceHistorySmokeState()); if (state.step !== 5) throw new Error('Expected five history checkpoints.'); }")
        Write-Host 'PASS protected-401 login recovery without a redirect loop.'
        Write-Host 'PASS 3/3 history browser scenarios. API mocked; real auth/database/provider not verified.'
    } elseif ($Suite -eq 'preview') {
        Invoke-BrowserCommand @('goto', "$BaseUrl/workspace?project=100000000000000000000001&revision=200000000000000000000001")
        Invoke-BrowserCommand @('snapshot')
        Invoke-BrowserCommand @('run-code', "--filename=$browserChecks")
        Write-Host 'PASS preview success, cancellation, outage recovery and cleanup warning. Every API intercepted; no paid calls or real account/database used.'
    } elseif ($Suite -eq 'session') {
        Invoke-BrowserCommand @('goto', "$BaseUrl/workspace")
        Invoke-BrowserCommand @('snapshot')
        Invoke-BrowserCommand @('run-code', "--filename=$browserChecks")
        Write-Host 'PASS session recovery and keyboard regressions. Every API intercepted; no real account, database or provider touched.'
    } else {
        $accessCases = @(
            @{ Name = 'legacy'; Query = '?project=100000000000000000000001'; Unavailable = $false },
            @{ Name = 'draft'; Query = '?project=100000000000000000000002'; Unavailable = $false },
            @{ Name = 'project404'; Query = '?project=100000000000000000000099'; Unavailable = $true },
            @{ Name = 'revision404'; Query = '?project=100000000000000000000001&revision=200000000000000000000099'; Unavailable = $true }
        )
        foreach ($case in $accessCases) {
            Write-Host "Checking workspace access case: $($case.Name)"
            Invoke-BrowserCommand @('goto', "$BaseUrl/workspace$($case.Query)")
            Invoke-BrowserCommand @('snapshot')
            Invoke-BrowserCommand @('run-code', "--filename=$browserChecks")
            Invoke-BrowserCommand @('screenshot', "--filename=output/playwright/$sessionName-$($case.Name).png", '--full-page')
            if ($case.Unavailable) {
                # Retry the same IDs; a 404 is not permission to invent files or start AI.
                Click-WorkspaceButton 'Retry loading'
                Invoke-BrowserCommand @('snapshot')
                Invoke-BrowserCommand @('run-code', "--filename=$browserChecks")
                Click-WorkspaceButton 'New conversation'
                Invoke-BrowserCommand @('run-code', "async page => { await page.waitForURL(url => url.pathname === '/workspace' && url.search === ''); }")
                Invoke-BrowserCommand @('snapshot')
                Invoke-BrowserCommand @('run-code', "--filename=$browserChecks")
            }
            Write-Host "PASS access/legacy case: $($case.Name)"
        }
        Invoke-BrowserCommand @('run-code', "async page => { const state = await page.evaluate(() => window.workspaceAccessSmokeState()); const checks = state.checks; if (checks.legacy !== 1 || checks.draft !== 1 || checks.project404 !== 2 || checks.revision404 !== 2 || checks.recovery !== 2) throw new Error('Expected eight access checkpoints.'); }")
        Write-Host 'PASS 4/4 access browser scenarios. API mocked; real cross-owner authorization not verified.'
    }
    Invoke-BrowserCommand @('screenshot', "--filename=output/playwright/$sessionName.png", '--full-page')
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
