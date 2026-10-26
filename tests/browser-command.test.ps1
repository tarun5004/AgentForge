$ErrorActionPreference = 'Stop'
$nodeCommand = (Get-Command node.exe).Source
$npxEntry = Join-Path $PSScriptRoot 'native-browser-command.fixture.mjs'
$sessionName = 'native-command-unit-fixture'
$checks = 0
$argumentChecks = 0

# Extract the actual runner function without executing its startup/browser/database workflow.
foreach ($testCase in @(
    @{ Path = 'scripts/verify-workspace-real.ps1'; Name = 'Invoke-RealBrowser' },
    @{ Path = 'scripts/verify-workspace-links.ps1'; Name = 'Invoke-BrowserCommand' }
)) {
    $parseErrors = $null
    $tokens = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Split-Path $PSScriptRoot) $testCase.Path), [ref]$tokens, [ref]$parseErrors)
    if ($parseErrors.Count) { throw 'Runner parse failure.' }
    $definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $testCase.Name }, $true)
    if (-not $definition) { throw 'Native wrapper function missing.' }
    Invoke-Expression $definition.Extent.Text
    foreach ($direct in @($false, $true)) {
        $env:AGENTFORGE_PLAYWRIGHT_CLI = if ($direct) { $npxEntry } else { $null }
        & $testCase.Name @('notice')
        if ($ErrorActionPreference -ne 'Stop') { throw 'Native wrapper did not restore error handling.' }
        $checks += 1
        foreach ($mode in @('exit-failure', 'browser-error')) {
            $caught = $false
            try { & $testCase.Name @($mode) } catch { $caught = $true }
            if (-not $caught) { throw 'Native/browser failure was incorrectly accepted.' }
            $checks += 1
        }
        # Exercise actual inline selector snippets: embedded quotes/spaces previously split argv.
        $selectorSnippets = $ast.FindAll({ param($node)
            $node -is [System.Management.Automation.Language.StringConstantExpressionAst] -and
            $node.Value.StartsWith('async page =>') -and $node.Value.Contains('page.locator(')
        }, $true)
        foreach ($snippet in $selectorSnippets) {
            $env:AGENTFORGE_EXPECTED_BROWSER_CODE = $snippet.Value
            try { & $testCase.Name @('run-code', $snippet.Value) }
            finally { Remove-Item Env:AGENTFORGE_EXPECTED_BROWSER_CODE -ErrorAction SilentlyContinue }
            $argumentChecks += 1
        }
    }
}
Write-Host "PASS $checks/12 native-command regression checks; npx/direct paths, harmless stderr and true failures."
Write-Host "PASS $argumentChecks exact native selector-argument checks; actual runner snippets remain one unchanged argument."
