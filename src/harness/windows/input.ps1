param(
  [string]$Points = '',     # "x,y;x,y;…" — relative to the window when -Process is given, else screen pixels
  [string]$Keys = '',       # SendKeys text, e.g. "{TAB}{ENTER}" or "hello"
  [int]$Pause = 400,
  [string]$Process = ''
)
# Synthetic mouse and keyboard input.
#
# Points are window-relative when -Process names one, because a window that
# opened cascaded is not at the screen origin and a click computed from a
# screenshot would land somewhere else.
#
# SetCursorPos alone raises no pointer-move, so hover never fires from it; the
# click below moves and then presses, which the renderer sees as a real pointer.
#
# With -Process, a click is sent only where the window at the point is one of
# that process's own, and keys only while one of its windows is in front:
# otherwise they would land in whatever window is there.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class HarnessInput {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  // The process whose window is at a point of the screen.
  public static uint OwnerAt(int x, int y) {
    POINT at; at.X = x; at.Y = y;
    uint owner;
    GetWindowThreadProcessId(GetAncestor(WindowFromPoint(at), 2), out owner);
    return owner;
  }
  // The process whose window is in front.
  public static uint OwnerInFront() {
    uint owner;
    GetWindowThreadProcessId(GetForegroundWindow(), out owner);
    return owner;
  }
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  public static void Click(int x, int y) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(80);
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);   // left down
    System.Threading.Thread.Sleep(60);
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);   // left up
  }
}
"@

$originX = 0
$originY = 0
if ($Process) {
  $proc = Get-Process $Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $proc) { Write-Error "no window for $Process"; exit 1 }
  $rect = New-Object HarnessInput+RECT
  [void][HarnessInput]::GetWindowRect($proc.MainWindowHandle, [ref]$rect)
  $originX = $rect.Left
  $originY = $rect.Top
}

foreach ($point in $Points.Split(';')) {
  if (-not $point.Trim()) { continue }
  $xy = $point.Split(',')
  $x = [int]$xy[0] + $originX
  $y = [int]$xy[1] + $originY
  if ($Process) {
    $owner = [HarnessInput]::OwnerAt($x, $y)
    if ($owner -ne $proc.Id) {
      $other = (Get-Process -Id $owner -ErrorAction SilentlyContinue).ProcessName
      Write-Error "a window of $(if ($other) { $other } else { 'another process' }) is in front of $Process at $x,$y, so the press would land in it"
      exit 1
    }
  }
  [HarnessInput]::Click($x, $y)
  Write-Output "clicked $x,$y"
  Start-Sleep -Milliseconds $Pause
}

if ($Keys) {
  if ($Process) {
    $owner = [HarnessInput]::OwnerInFront()
    if ($owner -ne $proc.Id) {
      $other = (Get-Process -Id $owner -ErrorAction SilentlyContinue).ProcessName
      Write-Error "$Process is not the window in front, so the keys would go to $(if ($other) { $other } else { 'another process' })"
      exit 1
    }
  }
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.SendKeys]::SendWait($Keys)
  Start-Sleep -Milliseconds $Pause
  Write-Output "sent $Keys"
}
