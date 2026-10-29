'use strict';

/**
 * Read-only stats about the OS Recycle Bin (how many items, how many bytes),
 * used to show how full the on-screen bin is. Never modifies anything.
 *
 * Windows: calls SHQueryRecycleBin (all drives) through a fixed PowerShell
 * script; no user input is ever part of the command. Other platforms
 * report "unsupported" and the app falls back to counting this session.
 */

const { execFile } = require('node:child_process');

const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -Namespace PaperToss -Name RecycleBin -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)]
public struct Info { public int cbSize; public long Size; public long Items; }
[DllImport("shell32.dll", CharSet = CharSet.Unicode)]
public static extern int SHQueryRecycleBin(string root, ref Info info);
'@
$i = New-Object 'PaperToss.RecycleBin+Info'
$i.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($i)
$hr = [PaperToss.RecycleBin]::SHQueryRecycleBin($null, [ref]$i)
Write-Output "$hr $($i.Items) $($i.Size)"
`;

/** Parse "hr items bytes" from the script. Exported for tests. */
function parseStats(stdout) {
  const match = /^\s*(-?\d+)\s+(\d+)\s+(\d+)\s*$/m.exec(String(stdout));
  if (!match) return { ok: false, code: 'unreadable' };
  if (Number(match[1]) !== 0) return { ok: false, code: 'query-failed' };
  return { ok: true, items: Number(match[2]), bytes: Number(match[3]) };
}

function createRecycleBinStats({ platform = process.platform, run = execFile } = {}) {
  let inFlight = null;

  function query() {
    if (platform !== 'win32') return Promise.resolve({ ok: false, code: 'unsupported' });
    // Coalesce overlapping requests into one PowerShell run.
    if (inFlight) return inFlight;
    inFlight = new Promise((resolve) => {
      run(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_SCRIPT],
        { timeout: 15000, windowsHide: true },
        (err, stdout) => resolve(err ? { ok: false, code: 'query-failed' } : parseStats(stdout)),
      );
    }).finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return { query };
}

module.exports = { createRecycleBinStats, parseStats };
