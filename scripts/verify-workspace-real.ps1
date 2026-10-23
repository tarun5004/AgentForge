param(
    [string]$BaseUrl = 'http://localhost:3102',
    [ValidateSet('loop', 'recovery', 'state', 'preview-real', 'build-gate')][string]$Suite = 'loop'
)

$ErrorActionPreference = 'Stop'
$sessionName = if ($env:AGENTFORGE_BROWSER_SESSION) { $env:AGENTFORGE_BROWSER_SESSION } else { 'workspace-real-' + [Guid]::NewGuid().ToString('N').Substring(0, 8) }
if ($sessionName -notmatch '^[a-zA-Z0-9-]+$') { throw 'Invalid test browser session name.' }
$opened = $false
$failed = $false
$browserChannel = if ($env:AGENTFORGE_BROWSER_CHANNEL) { $env:AGENTFORGE_BROWSER_CHANNEL } else { 'chrome' }
if ($browserChannel -notin @('chrome', 'msedge', 'firefox', 'webkit')) { throw 'Unsupported verification browser channel.' }
$browserChecks = @{ loop = 'scripts/workspace-real.browser.js'; recovery = 'scripts/workspace-recovery.browser.js'; state = 'scripts/workspace-state.browser.js'; 'preview-real' = 'scripts/workspace-preview-real.browser.js'; 'build-gate' = 'scripts/workspace-build-gate.browser.js' }[$Suite]

# Fail on assertion errors, not just on a successful invocation of the CLI executable.
function Invoke-RealBrowser {
    param([string[]]$Arguments)
    # Windows PowerShell treats native stderr (including harmless npm notices) as ErrorRecords.
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        [string[]]$entryArgs = if ($env:AGENTFORGE_PLAYWRIGHT_CLI) { @($env:AGENTFORGE_PLAYWRIGHT_CLI) } else { @($npxEntry, '--yes', '--package', '@playwright/cli@0.1.22', 'playwright-cli') }
        $output = & $nodeCommand @entryArgs "-s=$sessionName" @Arguments 2>&1
        $commandExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousPreference }
    if ($commandExit -ne 0 -or ($output -join "`n") -match '### Error') {
        $output | Where-Object { "$_" -match '^(Error|TimeoutError):' } | ForEach-Object { [Console]::Error.WriteLine("$_") }
        throw "Real browser command failed: $($Arguments[0])"
    }
}

# Fresh refs avoid clicking the wrong controls after a reload or revision switch.
function Use-RealControl {
    param([string]$Role, [string]$Name, [string]$Value = '')
    Invoke-RealBrowser @('snapshot', "--filename=$snapshotPath")
    $snapshot = Get-Content -LiteralPath $snapshotPath -Raw
    $match = [regex]::Match($snapshot, $Role + ' "' + [regex]::Escape($Name) + '"[^\r\n]*?\[ref=([a-z0-9]+)\]')
    if (-not $match.Success) { throw "Control missing: $Name" }
    if ($Role -eq 'textbox') { Invoke-RealBrowser @('fill', $match.Groups[1].Value, $Value) }
    else { Invoke-RealBrowser @('click', $match.Groups[1].Value) }
}

# Read-only unauthorized probes verify rewrites before any registration or generation writes.
function Read-FixtureMarker {
    param([string]$Path)
    try { return (Invoke-WebRequest "$BaseUrl$Path" -UseBasicParsing -MaximumRedirection 0 -TimeoutSec 10).Headers['x-agentforge-test-fixture'] }
    catch {
        if ($_.Exception.Response) { return $_.Exception.Response.Headers['x-agentforge-test-fixture'] }
        throw 'Test API probe unavailable.'
    }
}

# Exercise rejection and uncertainty separately: only an uncertain attempt should reuse its key.
function Invoke-RecoveryFlow {
    Use-RealControl 'textbox' 'Describe a frontend page or change' 'Build a simple portfolio page for my CV'
    Use-RealControl 'button' 'Send prompt'
    Invoke-RealBrowser @('run-code', "async page => { await page.getByText('Viewing v1', { exact: true }).waitFor(); }")
    Use-RealControl 'button' 'page.tsx A'
    Invoke-RealBrowser @('run-code', "--filename=$browserChecks")
    Write-Host 'PASS initial saved v1.'

    Use-RealControl 'textbox' 'Describe a frontend page or change' 'Return invalid output for this change'
    Use-RealControl 'button' 'Send prompt'
    Invoke-RealBrowser @('run-code', "async page => { await page.getByRole('alert').filter({ hasText: 'Code generation failed.' }).waitFor(); }")
    Invoke-RealBrowser @('run-code', "--filename=$browserChecks")
    Write-Host 'PASS failed follow-up preserved v1 and cleared terminal intent.'
    Invoke-RealBrowser @('reload')
    Invoke-RealBrowser @('run-code', "async page => { await page.getByText('Viewing v1', { exact: true }).waitFor(); }")
    Use-RealControl 'button' 'page.tsx A'
    Invoke-RealBrowser @('run-code', "--filename=$browserChecks")
    Write-Host 'PASS failed follow-up stays absent from revision history after refresh.'

    Use-RealControl 'textbox' 'Describe a frontend page or change' 'Make the hero darker and remove old component'
    Invoke-RealBrowser @('run-code', 'async page => { await page.evaluate(() => window.armRecoveryResponseLoss()); }')
    Use-RealControl 'button' 'Send prompt'
    Invoke-RealBrowser @('run-code', "async page => { await page.getByRole('button', { name: 'Retry same attempt', exact: true }).waitFor(); }")
    Invoke-RealBrowser @('run-code', "--filename=$browserChecks")
    Invoke-RealBrowser @('screenshot', "--filename=output/playwright/$sessionName-uncertain.png", '--full-page')
    Write-Host 'PASS committed response dropped; prior files and pending key retained.'
    Invoke-RealBrowser @('reload')
    Invoke-RealBrowser @('run-code', "async page => { await page.getByRole('button', { name: 'Retry same attempt', exact: true }).waitFor(); }")
    Use-RealControl 'button' 'page.tsx A'
    Invoke-RealBrowser @('run-code', "--filename=$browserChecks")
    Write-Host 'PASS pending identity survived refresh without automatic resubmission.'

    Use-RealControl 'button' 'Retry same attempt'
    Invoke-RealBrowser @('run-code', "async page => { await page.getByText('Viewing v2', { exact: true }).waitFor(); }")
    Use-RealControl 'button' 'page.tsx M'
    Invoke-RealBrowser @('run-code', "--filename=$browserChecks")
    Write-Host 'PASS retry used the exact key/body and recovered v2 without another AI call.'
    Invoke-RealBrowser @('reload')
    Invoke-RealBrowser @('run-code', "async page => { await page.getByText('Viewing v2', { exact: true }).waitFor(); }")
    Use-RealControl 'button' 'page.tsx M'
    Invoke-RealBrowser @('run-code', "--filename=$browserChecks")
    Write-Host 'PASS recovered v2 reloads with no pending controls.'
}

# Freeze a real model request while the UI reflows; reconcile by GET, then test a stale read.
function Invoke-StateFlow {
    Use-RealControl 'textbox' 'Describe a frontend page or change' 'Build a portfolio website page'
    Use-RealControl 'button' 'Send prompt'
    Invoke-RealBrowser @('run-code', "async page => { await page.getByText('Viewing v1', { exact: true }).waitFor(); }")
    Use-RealControl 'button' 'page.tsx A'
    Invoke-RealBrowser @('run-code', "--filename=$browserChecks")
    Invoke-RealBrowser @('run-code', "async page => { await page.evaluate(() => window.workspaceStateAction('arm-generation')); }")
    Use-RealControl 'textbox' 'Describe a frontend page or change' 'Make the hero darker and remove old component'
    Use-RealControl 'button' 'Send prompt'
    Invoke-RealBrowser @('run-code', "async page => { await page.evaluate(() => window.workspaceStateAction('wait-pending')); }")
    Invoke-RealBrowser @('run-code', "--filename=$browserChecks")
    Write-Host 'PASS in-flight desktop/mobile/desktop identity and frozen controls.'
    Invoke-RealBrowser @('run-code', "async page => { await page.evaluate(() => window.workspaceStateAction('release-generation')); }")
    Invoke-RealBrowser @('run-code', "async page => { await page.getByRole('button', { name: 'Check status', exact: true }).waitFor(); }")
    Use-RealControl 'button' 'page.tsx A'
    Invoke-RealBrowser @('run-code', "--filename=$browserChecks")
    Use-RealControl 'button' 'Check status'
    Invoke-RealBrowser @('run-code', "async page => { await page.getByText('Viewing v2', { exact: true }).waitFor(); }")
    Use-RealControl 'button' 'page.tsx M'
    Invoke-RealBrowser @('run-code', "--filename=$browserChecks")
    Write-Host 'PASS real generation-status GET reconciled committed v2 without a new POST.'
    Use-RealControl 'button' 'New conversation'
    Use-RealControl 'textbox' 'Describe a frontend page or change' 'Build a contact website page'
    Use-RealControl 'button' 'Send prompt'
    Invoke-RealBrowser @('run-code', "async page => { await page.getByText('Viewing v1', { exact: true }).waitFor(); }")
    Use-RealControl 'button' 'page.tsx A'
    Invoke-RealBrowser @('run-code', "--filename=$browserChecks")
    Invoke-RealBrowser @('run-code', "async page => { await page.evaluate(() => window.workspaceStateAction('arm-read')); }")
    Use-RealControl 'button' 'Build a portfolio website page v2'
    Invoke-RealBrowser @('run-code', "async page => { await page.evaluate(() => window.workspaceStateAction('wait-read')); }")
    Use-RealControl 'button' 'Build a contact website page v1'
    Invoke-RealBrowser @('run-code', "async page => { await page.getByText('Viewing v1', { exact: true }).waitFor(); }")
    Use-RealControl 'button' 'page.tsx A'
    Invoke-RealBrowser @('run-code', "--filename=$browserChecks")
    Invoke-RealBrowser @('run-code', "async page => { await page.evaluate(() => window.workspaceStateAction('release-read')); }")
    Invoke-RealBrowser @('run-code', "--filename=$browserChecks")
    Invoke-RealBrowser @('screenshot', "--filename=output/playwright/$sessionName-selection.png", '--full-page')
    Write-Host 'PASS delayed old-project read cannot overwrite the newer selected project.'
}

try {
    $address = [Uri]$BaseUrl
    if (-not $address.IsAbsoluteUri -or $address.Scheme -ne 'http' -or $address.Host -notin @('localhost', '127.0.0.1') -or
        $address.UserInfo -or $address.AbsolutePath -ne '/' -or $address.Query -or $address.Fragment) { throw 'Only a local HTTP origin is allowed.' }
    $BaseUrl = $address.GetLeftPart([UriPartial]::Authority)
    $fixture = Invoke-RestMethod 'http://127.0.0.1:4312/__fixture' -TimeoutSec 10
    if ($fixture.fixtureId -ne 'agentforge-real-revision-loop-v1' -or $fixture.databaseName -notmatch '^agentforge_test_' -or
        $fixture.aiRequests.Count -ne 0 -or ($fixture.counts.PSObject.Properties.Value | Where-Object { $_ -ne 0 })) { throw 'Expected a fresh, empty dedicated browser fixture.' }
    if ((Read-FixtureMarker '/api/auth/me') -ne $fixture.fixtureId -or (Read-FixtureMarker '/api/projects') -ne $fixture.fixtureId) {
        throw 'Next rewrites do not point at the isolated Auth/Project fixture. Refusing writes.'
    }
    if ($Suite -in @('preview-real', 'build-gate') -and (-not $fixture.previewEnabled -or (Read-FixtureMarker '/api/runs') -ne 'agentforge-real-preview-v1')) {
        throw 'Preview rewrite does not point at the isolated real Execution API. Refusing writes.'
    }
    if ($Suite -eq 'build-gate' -and -not $fixture.buildGateEnabled) { throw 'Build gate is not enabled in the isolated fixture. Refusing writes.' }
    $nodeCommand = (Get-Command node.exe).Source
    $npxEntry = Join-Path (Split-Path (Get-Command npx.cmd).Source) 'node_modules/npm/bin/npx-cli.js'
    $null = New-Item -ItemType Directory -Force -Path 'output/playwright'
    $snapshotPath = "output/playwright/$sessionName.yml"
    $opened = $true
    Invoke-RealBrowser @('open', "--browser=$browserChannel")
    Invoke-RealBrowser @('resize', '1440', '1000')
    Invoke-RealBrowser @('run-code', "--filename=$browserChecks")
    Invoke-RealBrowser @('goto', "$BaseUrl/register")
    Use-RealControl 'textbox' 'Name' 'Revision loop owner'
    Use-RealControl 'textbox' 'Email' 'frontend-slice5-20261012@agentforge.test'
    Use-RealControl 'textbox' 'Password' 'Disposable-test-password-13'
    Use-RealControl 'button' 'Create account'
    if ($Suite -in @('preview-real', 'build-gate')) {
        Invoke-RealBrowser @('snapshot', "--filename=$snapshotPath")
        Invoke-RealBrowser @('run-code', "--filename=$browserChecks")
        Invoke-RealBrowser @('screenshot', "--filename=output/playwright/$sessionName-ready.png", '--full-page')
        Invoke-RealBrowser @('run-code', "--filename=$browserChecks")
        Invoke-RealBrowser @('screenshot', "--filename=output/playwright/$sessionName.png", '--full-page')
        if ($Suite -eq 'build-gate') {
            Write-Host 'PASS real login/202 unpublished candidate/build evidence/reload/interactive preview/failed-check preservation/ownership/Stop. Only AI transport is a fixture.'
        } else {
            Write-Host 'PASS real login/generation/reload/interactive Docker preview/failed generation/failed build/ownership/Stop. Only AI transport is a fixture.'
        }
    } elseif ($Suite -eq 'state') {
        Invoke-RealBrowser @('run-code', "async page => { await page.getByRole('textbox', { name: 'Describe a frontend page or change' }).waitFor(); }")
        Invoke-StateFlow
        Write-Host 'PASS 9/9 state checkpoints. Real services; controlled AI barrier/proxy uncertainty/read delay.'
    } elseif ($Suite -eq 'recovery') {
        Invoke-RealBrowser @('run-code', "async page => { await page.getByRole('textbox', { name: 'Describe a frontend page or change' }).waitFor(); }")
        Invoke-RecoveryFlow
        Invoke-RealBrowser @('screenshot', "--filename=output/playwright/$sessionName-recovered.png", '--full-page')
        Write-Host 'PASS 7/7 recovery checkpoints. Real Auth/Project/Mongo; deterministic AI and one controlled response drop.'
    } else {
    Invoke-RealBrowser @('run-code', "async page => { await page.getByRole('textbox', { name: 'Describe a frontend page or change' }).fill('Build a simple portfolio page for my CV'); }")
    Use-RealControl 'button' 'Send prompt'
    Invoke-RealBrowser @('run-code', "async page => { await page.getByText('Viewing v1', { exact: true }).waitFor(); }")
    Use-RealControl 'button' 'page.tsx A'
    Invoke-RealBrowser @('run-code', '--filename=scripts/workspace-real.browser.js')
    Write-Host 'PASS initial generation committed as v1.'
    Invoke-RealBrowser @('reload')
    Invoke-RealBrowser @('run-code', "async page => { await page.getByText('Viewing v1', { exact: true }).waitFor(); }")
    Use-RealControl 'button' 'page.tsx A'
    Invoke-RealBrowser @('run-code', '--filename=scripts/workspace-real.browser.js')
    Write-Host 'PASS hard refresh restored real session and v1.'
    Use-RealControl 'textbox' 'Describe a frontend page or change' 'Make the hero darker and remove old component'
    Use-RealControl 'button' 'Send prompt'
    Invoke-RealBrowser @('run-code', "async page => { await page.getByText('Viewing v2', { exact: true }).waitFor(); }")
    Use-RealControl 'button' 'page.tsx M'
    Invoke-RealBrowser @('run-code', '--filename=scripts/workspace-real.browser.js')
    Write-Host 'PASS follow-up parent, complete snapshots and explicit deletion.'
    Invoke-RealBrowser @('reload')
    Invoke-RealBrowser @('run-code', "async page => { await page.getByText('Viewing v2', { exact: true }).waitFor(); }")
    Use-RealControl 'button' 'page.tsx M'
    Invoke-RealBrowser @('run-code', '--filename=scripts/workspace-real.browser.js')
    Write-Host 'PASS hard refresh restored v2.'
    Use-RealControl 'button' 'v1 Build a simple portfolio page for my CV Initial saved portfolio snapshot'
    Invoke-RealBrowser @('run-code', "async page => { await page.getByText('Viewing v1', { exact: true }).waitFor(); }")
    Use-RealControl 'button' 'page.tsx A'
    Invoke-RealBrowser @('run-code', '--filename=scripts/workspace-real.browser.js')
    Invoke-RealBrowser @('screenshot', "--filename=output/playwright/$sessionName.png", '--full-page')
    Write-Host 'PASS immutable v1 reopen, same-key replay and real second-owner 404s.'
    Write-Host 'PASS 5/5 real-service checkpoints. Only AI transport is a fixture; generated code was not executed.'
    }
} catch { $failed = $true; [Console]::Error.WriteLine($_.Exception.Message) }
finally {
    if ($opened) {
        try { Invoke-RealBrowser @('close') } catch { $failed = $true; [Console]::Error.WriteLine('Test browser cleanup failed.') }
    }
}
if ($failed) { exit 1 }
