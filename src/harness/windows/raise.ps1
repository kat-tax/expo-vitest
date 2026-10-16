param([string]$Process = 'DropFiles')
# Brings a process's main window to the front and gives it the foreground.
#
# A window that reaches past its screen's work area is moved inside it, as
# far as it fits, keeping its size: synthetic input is sent to a point on the
# screen, and Windows opens each new window a step down and right of the
# last, so an app launched again and again ends up partly off a small screen.
#
# Windows refuses SetForegroundWindow to a process that does not own the
# foreground, so this attaches to the foreground thread's input queue first,
# which is the documented way past that lock.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class HarnessRaise {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int c, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attribute, out RECT value, int size);
  // The window moved inside its screen's work area, as host.cs does it.
  public static void IntoView(IntPtr window) {
    if (IsZoomed(window)) return;
    RECT frame;
    if (DwmGetWindowAttribute(window, 9, out frame, Marshal.SizeOf(typeof(RECT))) != 0) GetWindowRect(window, out frame);
    MONITORINFO monitor = new MONITORINFO();
    monitor.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    if (!GetMonitorInfo(MonitorFromWindow(window, 2), ref monitor)) return;
    int dx = Inside(frame.Left, frame.Right, monitor.rcWork.Left, monitor.rcWork.Right);
    int dy = Inside(frame.Top, frame.Bottom, monitor.rcWork.Top, monitor.rcWork.Bottom);
    if (dx == 0 && dy == 0) return;
    RECT rect;
    GetWindowRect(window, out rect);
    SetWindowPos(window, IntPtr.Zero, rect.Left + dx, rect.Top + dy, 0, 0, 0x0015);
  }
  static int Inside(int start, int end, int from, int to) {
    if (start < from || end - start >= to - from) return from - start;
    return end > to ? to - end : 0;
  }
}
"@
$proc = Get-Process $Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
if (-not $proc) { Write-Error "no window for $Process"; exit 1 }
$window = $proc.MainWindowHandle
$foreground = [HarnessRaise]::GetForegroundWindow()
$owner = 0
$foregroundThread = [HarnessRaise]::GetWindowThreadProcessId($foreground, [ref]$owner)
$me = [HarnessRaise]::GetCurrentThreadId()
[void][HarnessRaise]::AttachThreadInput($foregroundThread, $me, $true)
[void][HarnessRaise]::ShowWindow($window, 9)                                  # restore if minimized
[HarnessRaise]::IntoView($window)
[void][HarnessRaise]::SetWindowPos($window, [IntPtr](-1), 0, 0, 0, 0, 0x0003) # topmost
[void][HarnessRaise]::SetWindowPos($window, [IntPtr](-2), 0, 0, 0, 0, 0x0003) # then back, but in front
[void][HarnessRaise]::BringWindowToTop($window)
$set = [HarnessRaise]::SetForegroundWindow($window)
[void][HarnessRaise]::AttachThreadInput($foregroundThread, $me, $false)
Start-Sleep -Milliseconds 300
Write-Output ("foreground " + ([HarnessRaise]::GetForegroundWindow() -eq $window) + " (set " + $set + ")")
