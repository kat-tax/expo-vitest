// The Windows host: one process for a driver's whole life, reading a JSON
// request per line on stdin and writing a JSON answer per line on stdout.
//
// It is compiled once when the host starts, so no step pays a PowerShell start
// or a C# compile of its own, and the tree is read in one call across to the
// app rather than one per element and per property: a CacheRequest over the
// whole subtree, walked here over the values it brought back.
//
// C# 5, because that is what the compiler that ships with Windows reads: no
// string interpolation, no `?.`, no expression-bodied members.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;

public static class HarnessHost {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int c, uint flags);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);

  // What a person can act on. Text and images are structure, not affordances.
  static readonly HashSet<string> Actionable = new HashSet<string>(new string[] {
    "Button", "Edit", "CheckBox", "ComboBox", "Slider", "Tab", "TabItem",
    "ListItem", "Hyperlink", "MenuItem", "RadioButton", "Spinner", "Thumb", "SplitButton"
  });

  static readonly string[] LiveNames = new string[] { "off", "polite", "assertive" };

  // `LiveSetting` has no named field in the managed client, so it is looked up by its UIA id.
  static readonly AutomationProperty LiveSetting = Lookup(30135);

  // The patterns the snapshot names on a node, each with the property that says it is there.
  static readonly string[] PatternNames = new string[] { "Invoke", "Toggle", "SelectionItem", "Value", "ScrollItem", "ExpandCollapse" };
  static readonly AutomationProperty[] PatternProperties = new AutomationProperty[] {
    AutomationElement.IsInvokePatternAvailableProperty,
    AutomationElement.IsTogglePatternAvailableProperty,
    AutomationElement.IsSelectionItemPatternAvailableProperty,
    AutomationElement.IsValuePatternAvailableProperty,
    AutomationElement.IsScrollItemPatternAvailableProperty,
    AutomationElement.IsExpandCollapsePatternAvailableProperty
  };

  static CacheRequest tree;

  // The newest snapshot's elements by ref, for the operations that act on one.
  static Dictionary<string, AutomationElement> refs = new Dictionary<string, AutomationElement>();

  static AutomationProperty Lookup(int id) {
    try { return AutomationProperty.LookupById(id); } catch { return null; }
  }

  /** Reads requests until stdin closes, answering each on its own line. */
  public static void Serve(TextReader input, TextWriter output, string host) {
    JavaScriptSerializer serializer = new JavaScriptSerializer();
    string line;
    while ((line = input.ReadLine()) != null) {
      if (line.Trim().Length == 0) continue;
      int started = Environment.TickCount;
      object id = null;
      string answer;
      try {
        Dictionary<string, object> request = serializer.Deserialize<Dictionary<string, object>>(line);
        if (request.ContainsKey("id")) id = request["id"];
        string op = Text(request, "op");
        if (op == "quit") {
          output.WriteLine(Envelope(id, Environment.TickCount - started, "null", null));
          output.Flush();
          return;
        }
        string result = Handle(op, request, host);
        answer = Envelope(id, Environment.TickCount - started, result, null);
      } catch (Exception error) {
        answer = Envelope(id, Environment.TickCount - started, null, Describe(error));
      }
      output.WriteLine(answer);
      output.Flush();
    }
  }

  static string Handle(string op, Dictionary<string, object> request, string host) {
    switch (op) {
      case "hello": return Hello(host);
      case "rect": return Rect(Text(request, "process"));
      case "snapshot": return Snapshot(Text(request, "process"), Flag(request, "interactive"), Number(request, "max", 400));
      case "click": return Click(Text(request, "process"), request.ContainsKey("points") ? request["points"] as IEnumerable : null);
      case "hold": return Hold(Text(request, "process"), Number(request, "x", 0), Number(request, "y", 0), Number(request, "ms", 800));
      case "keys": return Keys(Text(request, "keys"));
      case "screen": return Screen(Text(request, "process"), Text(request, "out"));
      case "idle": return Idle();
      case "raise": return Raise(Text(request, "process"));
      default: throw new InvalidOperationException("unknown op " + op);
    }
  }

  static string Hello(string host) {
    return "{\"pid\":" + Process.GetCurrentProcess().Id
      + ",\"host\":" + Json(host)
      + ",\"apartment\":" + Json(Thread.CurrentThread.GetApartmentState().ToString())
      + ",\"uia\":true}";
  }

  static Process Window(string name) {
    if (string.IsNullOrEmpty(name)) throw new InvalidOperationException("no process was named");
    foreach (Process process in Process.GetProcessesByName(name)) {
      if (process.MainWindowHandle != IntPtr.Zero) return process;
    }
    throw new InvalidOperationException("no window for " + name);
  }

  static RECT WindowRect(Process process) {
    RECT rect;
    GetWindowRect(process.MainWindowHandle, out rect);
    return rect;
  }

  static string Rect(string name) {
    RECT rect = WindowRect(Window(name));
    return "{\"x\":" + rect.Left + ",\"y\":" + rect.Top + ",\"width\":" + (rect.Right - rect.Left) + ",\"height\":" + (rect.Bottom - rect.Top) + "}";
  }

  static CacheRequest TreeRequest() {
    if (tree != null) return tree;
    CacheRequest request = new CacheRequest();
    request.TreeScope = TreeScope.Subtree;
    request.TreeFilter = Automation.ControlViewCondition;
    request.AutomationElementMode = AutomationElementMode.Full;
    AutomationProperty[] properties = new AutomationProperty[] {
      AutomationElement.ControlTypeProperty,
      AutomationElement.NameProperty,
      AutomationElement.AutomationIdProperty,
      AutomationElement.BoundingRectangleProperty,
      AutomationElement.IsOffscreenProperty,
      AutomationElement.IsEnabledProperty,
      AutomationElement.HasKeyboardFocusProperty,
      AutomationElement.IsKeyboardFocusableProperty,
      AutomationElement.HelpTextProperty,
      AutomationElement.PositionInSetProperty,
      AutomationElement.SizeOfSetProperty,
      AutomationElement.HeadingLevelProperty,
      AutomationElement.ItemStatusProperty,
      AutomationElement.IsDialogProperty
    };
    foreach (AutomationProperty property in properties) request.Add(property);
    foreach (AutomationProperty property in PatternProperties) request.Add(property);
    if (LiveSetting != null) request.Add(LiveSetting);
    tree = request;
    return tree;
  }

  class Walk {
    public StringBuilder Nodes = new StringBuilder();
    public Dictionary<string, AutomationElement> Refs = new Dictionary<string, AutomationElement>();
    public int Count;
    public bool OnlyInteractive;
    public int Max;
    public RECT Window;
  }

  static string Snapshot(string name, bool interactive, int max) {
    Process process = Window(name);
    RECT window = WindowRect(process);
    AutomationElement root = AutomationElement.FromHandle(process.MainWindowHandle).GetUpdatedCache(TreeRequest());
    Walk walk = new Walk();
    walk.OnlyInteractive = interactive;
    walk.Max = max;
    walk.Window = window;
    Visit(walk, root, 0, null);
    refs = walk.Refs;
    return "{\"process\":" + Json(process.ProcessName)
      + ",\"window\":{\"x\":" + window.Left + ",\"y\":" + window.Top + ",\"width\":" + (window.Right - window.Left) + ",\"height\":" + (window.Bottom - window.Top) + "}"
      + ",\"nodes\":[" + walk.Nodes.ToString() + "]}";
  }

  /** One element and what is inside it. `parent` is the ref of the nearest ancestor kept, which passes through one that is not. */
  static void Visit(Walk walk, AutomationElement element, int depth, string parent) {
    if (walk.Count >= walk.Max) return;
    string childParent = parent;
    AutomationElement.AutomationElementInformation current = element.Cached;
    string role = current.ControlType.ProgrammaticName.Replace("ControlType.", "");
    // A title bar is the window's chrome, which a walk of the control view
    // never reached. A cache built over the subtree hands back the window's
    // own and, in a react-native-windows app, more of them through its lists,
    // offscreen and nameless, that a search of the same tree does not find.
    // Each is left out with everything inside it.
    if (role == "TitleBar") return;
    string name = current.Name;
    bool interactive = Actionable.Contains(role);
    // The kit sets this from React Native's testID. It is not the text a person
    // reads, so it survives relabelling and localisation.
    string testId = current.AutomationId;
    bool keep = walk.OnlyInteractive ? interactive : interactive || !string.IsNullOrEmpty(name) || !string.IsNullOrEmpty(testId);
    if (keep) {
      walk.Count++;
      string reference = "@e" + walk.Count;
      childParent = reference;
      walk.Refs[reference] = element;
      StringBuilder node = new StringBuilder();
      node.Append("{\"ref\":").Append(Json(reference));
      if (parent != null) node.Append(",\"parent\":").Append(Json(parent));
      node.Append(",\"role\":").Append(Json(role));
      node.Append(",\"name\":").Append(Json(name ?? ""));
      if (!string.IsNullOrEmpty(testId)) node.Append(",\"testId\":").Append(Json(testId));
      node.Append(",\"depth\":").Append(depth);
      node.Append(",\"interactive\":").Append(Bool(interactive));
      node.Append(",\"focused\":").Append(Bool(current.HasKeyboardFocus));
      node.Append(",\"focusable\":").Append(Bool(current.IsKeyboardFocusable));
      node.Append(",\"enabled\":").Append(Bool(current.IsEnabled));
      node.Append(",\"offscreen\":").Append(Bool(current.IsOffscreen));
      // Everything a screen reader says past the name and the role, present
      // only when set, so a property that is missing is visibly missing.
      object help = Prop(element, AutomationElement.HelpTextProperty, true);
      if (help != null) node.Append(",\"help\":").Append(Json(help.ToString()));
      object position = Prop(element, AutomationElement.PositionInSetProperty, true);
      object size = Prop(element, AutomationElement.SizeOfSetProperty, true);
      // "2 of 5", the way it is announced, rather than two numbers to pair up.
      if (position != null && size != null) node.Append(",\"inSet\":").Append(Json(position + " of " + size));
      object heading = Prop(element, AutomationElement.HeadingLevelProperty, true);
      if (heading is int) node.Append(",\"heading\":").Append((int)heading);
      object live = Prop(element, LiveSetting, true);
      if (live is int && (int)live > 0 && (int)live < LiveNames.Length) node.Append(",\"live\":").Append(Json(LiveNames[(int)live]));
      object status = Prop(element, AutomationElement.ItemStatusProperty, true);
      if (status != null) node.Append(",\"status\":").Append(Json(status.ToString()));
      object dialog = Prop(element, AutomationElement.IsDialogProperty, false);
      if (dialog is bool && (bool)dialog) node.Append(",\"dialog\":true");
      System.Windows.Rect box = current.BoundingRectangle;
      if (double.IsInfinity(box.X) || box.Width <= 0) {
        node.Append(",\"bounds\":null");
      } else {
        // Window-relative, so a press does not care where the window sits.
        node.Append(",\"bounds\":{\"x\":").Append(Convert.ToInt32(box.X - walk.Window.Left))
          .Append(",\"y\":").Append(Convert.ToInt32(box.Y - walk.Window.Top))
          .Append(",\"width\":").Append(Convert.ToInt32(box.Width))
          .Append(",\"height\":").Append(Convert.ToInt32(box.Height)).Append("}");
      }
      List<string> patterns = new List<string>();
      for (int at = 0; at < PatternProperties.Length; at++) {
        object available = Prop(element, PatternProperties[at], false);
        if (available is bool && (bool)available) patterns.Add(Json(PatternNames[at]));
      }
      if (patterns.Count > 0) node.Append(",\"patterns\":[").Append(string.Join(",", patterns.ToArray())).Append("]");
      node.Append("}");
      if (walk.Nodes.Length > 0) walk.Nodes.Append(",");
      walk.Nodes.Append(node.ToString());
    }
    foreach (AutomationElement child in element.CachedChildren) {
      Visit(walk, child, depth + 1, childParent);
    }
  }

  // One cached property, as null for "not set" in all the ways UIA says it:
  // absent, NotSupported, an empty string, or a number below 1. That last one
  // matters more than it looks: react-native-windows returns -1 for an unset
  // position or set size, not 0.
  static object Prop(AutomationElement element, AutomationProperty property, bool unsetBelowOne) {
    if (property == null) return null;
    object value;
    try { value = element.GetCachedPropertyValue(property); } catch { return null; }
    if (value == null || value == AutomationElement.NotSupported) return null;
    string text = value as string;
    if (text != null && text.Length == 0) return null;
    if (unsetBelowOne && value is int && (int)value < 1) return null;
    return value;
  }

  // Synthetic mouse input. SetCursorPos alone raises no pointer move, so the
  // click moves and then presses, which the renderer sees as a real pointer.
  static string Click(string name, IEnumerable points) {
    int originX = 0;
    int originY = 0;
    if (!string.IsNullOrEmpty(name)) {
      RECT rect = WindowRect(Window(name));
      originX = rect.Left;
      originY = rect.Top;
    }
    List<string> clicked = new List<string>();
    if (points != null) {
      foreach (object point in points) {
        object[] xy = Pair(point);
        int x = Convert.ToInt32(xy[0], CultureInfo.InvariantCulture) + originX;
        int y = Convert.ToInt32(xy[1], CultureInfo.InvariantCulture) + originY;
        SetCursorPos(x, y);
        Thread.Sleep(80);
        mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
        Thread.Sleep(60);
        mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
        clicked.Add(x + "," + y);
        Thread.Sleep(400);
      }
    }
    return Json("clicked " + string.Join("; ", clicked.ToArray()));
  }

  static object[] Pair(object point) {
    ArrayList list = point as ArrayList;
    if (list != null && list.Count == 2) return new object[] { list[0], list[1] };
    object[] array = point as object[];
    if (array != null && array.Length == 2) return array;
    throw new InvalidOperationException("a point is [x, y]");
  }

  static string Hold(string name, int x, int y, int ms) {
    int originX = 0;
    int originY = 0;
    if (!string.IsNullOrEmpty(name)) {
      RECT rect = WindowRect(Window(name));
      originX = rect.Left;
      originY = rect.Top;
    }
    SetCursorPos(x + originX, y + originY);
    Thread.Sleep(80);
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
    Thread.Sleep(Math.Max(0, ms));
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
    Thread.Sleep(400);
    return Json("held " + (x + originX) + "," + (y + originY) + " for " + ms + " ms");
  }

  static string Keys(string keys) {
    System.Windows.Forms.SendKeys.SendWait(keys);
    Thread.Sleep(400);
    return Json("sent " + keys);
  }

  // A region of the screen as it is, without touching any window's z-order:
  // raising the app would hide a share sheet or a flyout that is over it,
  // which is usually the thing being looked at.
  static string Screen(string name, string output) {
    if (string.IsNullOrEmpty(output)) throw new InvalidOperationException("no file to save the screen to");
    int x, y, width, height;
    if (!string.IsNullOrEmpty(name)) {
      RECT rect = WindowRect(Window(name));
      x = rect.Left;
      y = rect.Top;
      width = rect.Right - rect.Left;
      height = rect.Bottom - rect.Top;
    } else {
      System.Drawing.Rectangle screen = System.Windows.Forms.SystemInformation.VirtualScreen;
      x = screen.X;
      y = screen.Y;
      width = screen.Width;
      height = screen.Height;
    }
    using (Bitmap bitmap = new Bitmap(width, height)) {
      using (Graphics graphics = Graphics.FromImage(bitmap)) {
        graphics.CopyFromScreen(x, y, 0, 0, bitmap.Size);
      }
      bitmap.Save(output, ImageFormat.Png);
    }
    return Json("saved " + output + " (" + width + " x " + height + " at " + x + "," + y + ")");
  }

  static string Idle() {
    LASTINPUTINFO info = new LASTINPUTINFO();
    info.cbSize = (uint)Marshal.SizeOf(info);
    GetLastInputInfo(ref info);
    return ((Environment.TickCount - (int)info.dwTime) / 1000.0).ToString("0.###", CultureInfo.InvariantCulture);
  }

  // Windows refuses SetForegroundWindow to a process that does not own the
  // foreground, so this attaches to the foreground thread's input queue first,
  // which is the documented way past that lock.
  static string Raise(string name) {
    IntPtr window = Window(name).MainWindowHandle;
    IntPtr foreground = GetForegroundWindow();
    uint owner;
    uint foregroundThread = GetWindowThreadProcessId(foreground, out owner);
    uint me = GetCurrentThreadId();
    AttachThreadInput(foregroundThread, me, true);
    ShowWindow(window, 9);
    SetWindowPos(window, new IntPtr(-1), 0, 0, 0, 0, 0x0003);
    SetWindowPos(window, new IntPtr(-2), 0, 0, 0, 0, 0x0003);
    BringWindowToTop(window);
    bool set = SetForegroundWindow(window);
    AttachThreadInput(foregroundThread, me, false);
    Thread.Sleep(300);
    return Json("foreground " + (GetForegroundWindow() == window ? "True" : "False") + " (set " + (set ? "True" : "False") + ")");
  }

  static string Envelope(object id, int ms, string result, string error) {
    StringBuilder answer = new StringBuilder();
    answer.Append("{\"id\":").Append(Value(id)).Append(",\"ok\":").Append(error == null ? "true" : "false").Append(",\"ms\":").Append(ms);
    if (error == null) answer.Append(",\"result\":").Append(result);
    else answer.Append(",\"error\":").Append(Json(error));
    return answer.Append("}").ToString();
  }

  static string Describe(Exception error) {
    Exception inner = error;
    while (inner.InnerException != null) inner = inner.InnerException;
    return inner.Message;
  }

  static string Text(Dictionary<string, object> request, string key) {
    object value;
    return request.TryGetValue(key, out value) && value != null ? value.ToString() : null;
  }

  static bool Flag(Dictionary<string, object> request, string key) {
    object value;
    return request.TryGetValue(key, out value) && value is bool && (bool)value;
  }

  static int Number(Dictionary<string, object> request, string key, int otherwise) {
    object value;
    if (!request.TryGetValue(key, out value) || value == null) return otherwise;
    return Convert.ToInt32(value, CultureInfo.InvariantCulture);
  }

  static string Bool(bool value) {
    return value ? "true" : "false";
  }

  static string Value(object value) {
    if (value == null) return "null";
    if (value is string) return Json((string)value);
    if (value is int || value is long) return Convert.ToString(value, CultureInfo.InvariantCulture);
    if (value is decimal || value is double) return Convert.ToString(value, CultureInfo.InvariantCulture);
    return Json(value.ToString());
  }

  /** A string as a JSON string. */
  static string Json(string text) {
    if (text == null) return "null";
    StringBuilder json = new StringBuilder(text.Length + 2);
    json.Append('"');
    foreach (char character in text) {
      switch (character) {
        case '"': json.Append("\\\""); break;
        case '\\': json.Append("\\\\"); break;
        case '\n': json.Append("\\n"); break;
        case '\r': json.Append("\\r"); break;
        case '\t': json.Append("\\t"); break;
        default:
          if (character < ' ') json.Append("\\u").Append(((int)character).ToString("x4"));
          else json.Append(character);
          break;
      }
    }
    return json.Append('"').ToString();
  }
}
