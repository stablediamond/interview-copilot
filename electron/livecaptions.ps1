# Reads Windows 11 Live Captions text via UI Automation and prints each updated
# caption string to stdout as a compact JSON line: {"text":"..."}.
# Requires Live Captions to be enabled (Win + Ctrl + L). Windows-only.
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$ErrorActionPreference = 'SilentlyContinue'

# Emit UTF-8 so non-ASCII captions (e.g. Chinese) survive the pipe to Electron.
# (Windows PowerShell's ConvertTo-Json also \u-escapes non-ASCII, but this keeps
# raw output correct too, e.g. under pwsh.)
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$AutomationIdProperty = [System.Windows.Automation.AutomationElement]::AutomationIdProperty
$Descendants = [System.Windows.Automation.TreeScope]::Descendants
# The caption text lives in an element with AutomationId "CaptionsTextBlock".
$cond = New-Object System.Windows.Automation.PropertyCondition($AutomationIdProperty, 'CaptionsTextBlock')

function Get-CaptionText {
  $proc = Get-Process -Name 'LiveCaptions' -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } |
    Select-Object -First 1
  if (-not $proc) { return $null }
  try {
    $win = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
    if (-not $win) { return $null }
    # Join every caption text block in document order. Live Captions may expose a
    # finalized block plus a live one; concatenating keeps the snapshot stable
    # instead of flip-flopping between them.
    $els = $win.FindAll($Descendants, $cond)
    if (-not $els -or $els.Count -eq 0) { return $null }
    $parts = New-Object System.Collections.Generic.List[string]
    foreach ($e in $els) {
      $t = $e.Current.Name
      if ($t) { $parts.Add($t) }
    }
    if ($parts.Count -eq 0) { return $null }
    # Live Captions often exposes a finalized block plus a live block that
    # repeats it. Joining with a space doubled the caption after Clear/Answer.
    $acc = $parts[0]
    for ($i = 1; $i -lt $parts.Count; $i++) {
      $next = $parts[$i]
      if (-not $next) { continue }
      if ($acc.IndexOf($next) -ge 0) { continue }
      if ($next.IndexOf($acc) -ge 0) { $acc = $next; continue }
      $max = [Math]::Min($acc.Length, $next.Length)
      $overlap = 0
      $minOverlap = [Math]::Min(16, $max)
      for ($n = $max; $n -ge $minOverlap; $n--) {
        if ($next.StartsWith($acc.Substring($acc.Length - $n))) {
          $overlap = $n
          break
        }
      }
      if ($overlap -gt 0) {
        $acc = $acc + $next.Substring($overlap)
      } else {
        $acc = $acc + ' ' + $next
      }
    }
    return $acc
  } catch {
    return $null
  }
}

$last = ''

while ($true) {
  $text = Get-CaptionText
  if ($text -and $text -ne $last) {
    $last = $text
    $line = [pscustomobject]@{ text = $text } | ConvertTo-Json -Compress
    [Console]::Out.WriteLine($line)
    [Console]::Out.Flush()
  }
  Start-Sleep -Milliseconds 150
}
