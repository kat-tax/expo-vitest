param(
  [string]$Out = "$PSScriptRoot\screen.png",
  [int]$X = 0,
  [int]$Y = 0,
  [int]$W = 0,
  [int]$H = 0,
  [string]$Process = ''
)
# Saves a picture without touching any window's z-order. Raising the app to
# capture it would hide a share sheet or a flyout that is over it, which is
# usually the thing being looked at.
#
# With -Process, the picture is that process's main window, drawn by the
# window itself, so a window over it on the screen is not in it. It is what
# the screen shows instead while a menu or popup of the app's own is open over
# it, since a WinUI menu opens in a window of its own, and where the window
# draws nothing. Otherwise it is the whole virtual screen, or the rectangle
# given.
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$fromScreen = ''
if ($Process) {
  Add-Type -ReferencedAssemblies System.Drawing @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class HarnessWindowShot {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public delegate bool WindowVisit(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(WindowVisit visit, IntPtr data);

  // Whether another visible window of the process, a menu or a popup, lies over its main window.
  public static bool PopupOver(int pid, IntPtr main, RECT area) {
    bool found = false;
    EnumWindows(delegate (IntPtr window, IntPtr data) {
      uint owner;
      GetWindowThreadProcessId(window, out owner);
      if (window == main || owner != (uint)pid || !IsWindowVisible(window) || IsIconic(window)) return true;
      RECT rect;
      GetWindowRect(window, out rect);
      if (rect.Right <= rect.Left || rect.Bottom <= rect.Top) return true;
      if (rect.Right <= area.Left || rect.Left >= area.Right || rect.Bottom <= area.Top || rect.Top >= area.Bottom) return true;
      found = true;
      return false;
    }, IntPtr.Zero);
    return found;
  }

  // The window as it draws itself, saved to output; false when it drew nothing.
  public static bool Save(IntPtr window, int width, int height, string output) {
    using (Bitmap bitmap = new Bitmap(width, height, PixelFormat.Format24bppRgb)) {
      bool drawn;
      using (Graphics graphics = Graphics.FromImage(bitmap)) {
        IntPtr dc = graphics.GetHdc();
        // PW_RENDERFULLCONTENT, so what DirectComposition draws is in it too:
        // that is how react-native-windows draws.
        try { drawn = PrintWindow(window, dc, 2); } finally { graphics.ReleaseHdc(dc); }
      }
      if (!drawn || Blank(bitmap)) return false;
      bitmap.Save(output, ImageFormat.Png);
      return true;
    }
  }

  // Whether every pixel is black, which is what a window that did not draw itself leaves.
  static bool Blank(Bitmap bitmap) {
    BitmapData data = bitmap.LockBits(new Rectangle(0, 0, bitmap.Width, bitmap.Height), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
    try {
      byte[] row = new byte[bitmap.Width * 3];
      for (int y = 0; y < bitmap.Height; y++) {
        Marshal.Copy(new IntPtr(data.Scan0.ToInt64() + (long)y * data.Stride), row, 0, row.Length);
        foreach (byte value in row) if (value != 0) return false;
      }
      return true;
    } finally {
      bitmap.UnlockBits(data);
    }
  }
}
"@
  $proc = Get-Process $Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $proc) { Write-Error "no window for $Process"; exit 1 }
  # There is no picture of a minimized window short of raising it.
  if ([HarnessWindowShot]::IsIconic($proc.MainWindowHandle)) { Write-Error "$Process's window is minimized, and a screenshot does not raise it"; exit 1 }
  $rect = New-Object HarnessWindowShot+RECT
  [void][HarnessWindowShot]::GetWindowRect($proc.MainWindowHandle, [ref]$rect)
  $X = $rect.Left; $Y = $rect.Top
  $W = $rect.Right - $rect.Left; $H = $rect.Bottom - $rect.Top
  if ([HarnessWindowShot]::PopupOver($proc.Id, $proc.MainWindowHandle, $rect)) {
    $fromScreen = ', from the screen, since a menu or popup of its own is open over it'
  } elseif ([HarnessWindowShot]::Save($proc.MainWindowHandle, $W, $H, $Out)) {
    Write-Output "saved $Out ($W x $H, drawn by the window)"
    exit 0
  } else {
    $fromScreen = ', from the screen, since the window drew nothing'
  }
}

if ($W -le 0 -or $H -le 0) {
  $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
  if ($W -le 0) { $W = $bounds.Width }
  if ($H -le 0) { $H = $bounds.Height }
}

$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($X, $Y, 0, 0, $bmp.Size)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "saved $Out ($W x $H at $X,$Y$fromScreen)"
