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
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(POINT point, uint flags);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attribute, out RECT value, int size);
  delegate bool WindowVisit(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(WindowVisit visit, IntPtr data);

  // What a person can act on. Text and images are structure, not affordances.
  static readonly HashSet<string> Actionable = new HashSet<string>(new string[] {
    "Button", "Edit", "CheckBox", "ComboBox", "Slider", "Tab", "TabItem",
    "ListItem", "Hyperlink", "MenuItem", "RadioButton", "Spinner", "Thumb", "SplitButton"
  });

  static readonly string[] LiveNames = new string[] { "off", "polite", "assertive" };

  // `LiveSetting` has no named field in the managed client, so it is looked up by its UIA id.
  static readonly AutomationProperty LiveSetting = Lookup(30135);

  // The patterns the snapshot names on a node, each with the property that says it is there.
  static readonly string[] PatternNames = new string[] { "Invoke", "Toggle", "SelectionItem", "Value", "ScrollItem", "ExpandCollapse", "Scroll" };
  static readonly AutomationProperty[] PatternProperties = new AutomationProperty[] {
    AutomationElement.IsInvokePatternAvailableProperty,
    AutomationElement.IsTogglePatternAvailableProperty,
    AutomationElement.IsSelectionItemPatternAvailableProperty,
    AutomationElement.IsValuePatternAvailableProperty,
    AutomationElement.IsScrollItemPatternAvailableProperty,
    AutomationElement.IsExpandCollapsePatternAvailableProperty,
    AutomationElement.IsScrollPatternAvailableProperty
  };

  static CacheRequest tree;

  // The number each element was given, by its process and runtime id, kept
  // for the host's life: a ref lasts as long as its element, as a web ref
  // does, so nodes coming and going around it, such as an overlay's, leave it
  // as it was, and a ref read before they went still names that element, not
  // the node that came to stand where it was.
  static readonly Dictionary<string, int> numbers = new Dictionary<string, int>();
  static int lastNumber;

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
      case "click": return Click(Text(request, "process"), request.ContainsKey("points") ? request["points"] as IEnumerable : null, Number(request, "count", 1));
      case "hold": return Hold(Text(request, "process"), Number(request, "x", 0), Number(request, "y", 0), Number(request, "ms", 800));
      case "move": return Move(Text(request, "process"), Number(request, "x", 0), Number(request, "y", 0));
      case "wheel": return Wheel(Text(request, "process"), Number(request, "x", 0), Number(request, "y", 0), Number(request, "dx", 0), Number(request, "dy", 0));
      case "scroll": return Scroll(Text(request, "ref"), Number(request, "dx", 0), Number(request, "dy", 0));
      case "focus": return Focus(Text(request, "ref"));
      case "keys": return Keys(Text(request, "process"), Text(request, "keys"));
      case "screen": return Screen(Text(request, "process"), Text(request, "out"));
      case "idle": return Idle();
      case "foreground": return Json(ProcessName(ForegroundProcess()));
      case "clipboard": return Json(OnSta(delegate { return System.Windows.Forms.Clipboard.ContainsText() ? System.Windows.Forms.Clipboard.GetText() : ""; }));
      case "setClipboard": return SetClipboard(Text(request, "text") ?? "");
      case "raise": return Raise(Text(request, "process"));
      case "invoke": return Act(Text(request, "ref"), "Invoke");
      case "toggle": return Act(Text(request, "ref"), "Toggle");
      case "select": return Act(Text(request, "ref"), "SelectionItem");
      case "scrollInto": return Act(Text(request, "ref"), "ScrollItem");
      case "expand": return Act(Text(request, "ref"), "Expand");
      case "collapse": return Act(Text(request, "ref"), "Collapse");
      case "setValue": return SetValue(Text(request, "ref"), Text(request, "text") ?? "");
      default: throw new InvalidOperationException("unknown op " + op);
    }
  }

  /** An element of the newest snapshot, by the ref it was given there. */
  static AutomationElement Element(string reference) {
    AutomationElement element;
    if (reference == null || !refs.TryGetValue(reference, out element)) throw new InvalidOperationException("no " + (reference ?? "ref") + " in the newest snapshot");
    return element;
  }

  const string Unsupported = "{\"unsupported\":true}";

  // How long a pattern's effect is given to show in the control's state. In
  // react-native-windows, Toggle on any view but a Switch, and Select and
  // SetValue on any view but a TextInput, only send an accessibility action,
  // which the app may never answer and answers through a render when it does.
  // UI Automation reports success either way.
  const int EffectMs = 1000;

  /** Whether done() came to hold within EffectMs. An element that went away counts, since the action moved the screen on. */
  static bool Until(Func<bool> done) {
    int started = Environment.TickCount;
    while (true) {
      try { if (done()) return true; } catch (ElementNotAvailableException) { return true; }
      if (Environment.TickCount - started >= EffectMs) return false;
      Thread.Sleep(25);
    }
  }

  // A control driven through its UI Automation pattern, which reaches it on
  // UI Automation's own channel: no pointer, no foreground window, and so
  // nothing that minds someone being at the desk.
  // A scroll by a distance in the element's own pixels, through its Scroll
  // pattern: the percent that distance is of what the element can scroll,
  // with whether the position was seen to move. A positive distance moves the
  // content down or right, as a finger drawn up or left does.
  static string Scroll(string reference, int dx, int dy) {
    AutomationElement element = Element(reference);
    object pattern;
    if (!element.TryGetCurrentPattern(ScrollPattern.Pattern, out pattern)) return Unsupported;
    ScrollPattern scroll = (ScrollPattern)pattern;
    System.Windows.Rect box = element.Current.BoundingRectangle;
    double beforeX = scroll.Current.HorizontalScrollPercent;
    double beforeY = scroll.Current.VerticalScrollPercent;
    double x = ScrollTo(scroll.Current.HorizontallyScrollable, beforeX, scroll.Current.HorizontalViewSize, box.Width, dx);
    double y = ScrollTo(scroll.Current.VerticallyScrollable, beforeY, scroll.Current.VerticalViewSize, box.Height, dy);
    if (x == ScrollPattern.NoScroll && y == ScrollPattern.NoScroll) return "{\"pattern\":\"Scroll\",\"changed\":false}";
    scroll.SetScrollPercent(x, y);
    bool changed = Until(() => scroll.Current.HorizontalScrollPercent != beforeX || scroll.Current.VerticalScrollPercent != beforeY);
    return "{\"pattern\":\"Scroll\",\"changed\":" + Bool(changed) + "}";
  }

  // The percent to scroll an axis to for a move of `pixels` over a viewport
  // `size` pixels long, of which `view` percent of the content is in view;
  // NoScroll where the axis does not scroll or the move is nothing.
  static double ScrollTo(bool scrollable, double percent, double view, double size, int pixels) {
    if (!scrollable || pixels == 0 || view <= 0 || view >= 100 || size <= 0) return ScrollPattern.NoScroll;
    double range = size * 100 / view - size;
    return Math.Max(0, Math.Min(100, percent + pixels * 100 / range));
  }

  // The wheel turned at a point in the window's own pixels, a notch for each
  // 48 pixels of the distance, what a scroll viewer moves for one. A positive
  // distance moves the content down or right, as for a scroll.
  static string Wheel(string name, int x, int y, int dx, int dy) {
    int originX = 0;
    int originY = 0;
    uint pid = 0;
    if (!string.IsNullOrEmpty(name)) {
      Process process = Window(name);
      RECT rect = WindowRect(process);
      originX = rect.Left;
      originY = rect.Top;
      pid = (uint)process.Id;
    }
    int atX = x + originX;
    int atY = y + originY;
    Owns(pid, name, atX, atY, "wheel");
    SetCursorPos(atX, atY);
    Thread.Sleep(80);
    // Content moved down is the wheel turned towards the user, a negative delta.
    int down = Notches(dy);
    int right = Notches(dx);
    if (down != 0) mouse_event(0x0800, 0, 0, unchecked((uint)(-120 * down)), UIntPtr.Zero);
    if (right != 0) mouse_event(0x01000, 0, 0, unchecked((uint)(120 * right)), UIntPtr.Zero);
    Thread.Sleep(200);
    return Json("turned the wheel " + down + " notches down and " + right + " right at " + atX + "," + atY);
  }

  static int Notches(int pixels) {
    return pixels == 0 ? 0 : Math.Sign(pixels) * Math.Max(1, (int)Math.Round(Math.Abs(pixels) / 48.0));
  }

  static string Act(string reference, string name) {
    AutomationElement element = Element(reference);
    object pattern;
    switch (name) {
      case "Invoke":
        if (!element.TryGetCurrentPattern(InvokePattern.Pattern, out pattern)) return Unsupported;
        // No state to read back. react-native-windows offers Invoke only on a
        // view with onAccessibilityTap, and fires that.
        ((InvokePattern)pattern).Invoke();
        return "{\"pattern\":\"Invoke\"}";
      case "Toggle": {
        if (!element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)) return Unsupported;
        TogglePattern toggle = (TogglePattern)pattern;
        ToggleState before = toggle.Current.ToggleState;
        toggle.Toggle();
        bool changed = Until(() => toggle.Current.ToggleState != before);
        return "{\"pattern\":\"Toggle\",\"changed\":" + Bool(changed) + "}";
      }
      case "SelectionItem": {
        if (!element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern)) return Unsupported;
        SelectionItemPattern item = (SelectionItemPattern)pattern;
        // Selecting what is selected shows nothing, where a press on it may
        // still do something, such as take a tab back to its first screen.
        if (item.Current.IsSelected) return "{\"pattern\":\"SelectionItem\",\"changed\":false}";
        item.Select();
        bool changed = Until(() => item.Current.IsSelected);
        return "{\"pattern\":\"SelectionItem\",\"changed\":" + Bool(changed) + "}";
      }
      case "ScrollItem":
        if (!element.TryGetCurrentPattern(ScrollItemPattern.Pattern, out pattern)) return Unsupported;
        ((ScrollItemPattern)pattern).ScrollIntoView();
        return "{\"pattern\":\"ScrollItem\"}";
      case "Expand":
      case "Collapse": {
        if (!element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pattern)) return Unsupported;
        ExpandCollapsePattern expander = (ExpandCollapsePattern)pattern;
        ExpandCollapseState wanted = name == "Expand" ? ExpandCollapseState.Expanded : ExpandCollapseState.Collapsed;
        if (name == "Expand") expander.Expand();
        else expander.Collapse();
        bool changed = Until(() => expander.Current.ExpandCollapseState == wanted);
        return "{\"pattern\":\"ExpandCollapse\",\"changed\":" + Bool(changed) + "}";
      }
      default:
        throw new InvalidOperationException("no pattern called " + name);
    }
  }

  /** Text put in a field through its Value pattern, and what the field reads back afterwards. */
  static string SetValue(string reference, string text) {
    AutomationElement element = Element(reference);
    object pattern;
    if (!element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) return Unsupported;
    ValuePattern value = (ValuePattern)pattern;
    if (value.Current.IsReadOnly) return "{\"pattern\":\"Value\",\"readOnly\":true}";
    // A secure field reads back a mask, a character for each it holds, so new
    // text as long as the old reads the same as before. Emptied first, the
    // field shows by its length that the text went in.
    bool secure = element.Current.IsPassword;
    string before = value.Current.Value;
    if (secure && text.Length > 0 && before.Length == text.Length) {
      value.SetValue("");
      Until(() => value.Current.Value.Length == 0);
      before = value.Current.Value;
    }
    value.SetValue(text);
    if (text != before) Until(() => value.Current.Value != before);
    string after;
    try { after = value.Current.Value; } catch (ElementNotAvailableException) { return "{\"pattern\":\"Value\",\"changed\":true}"; }
    // Taken when the field reads the text, or reads something new the app
    // made of it, as a field that keeps capitals or a length does.
    bool changed = after == text || after != before;
    // Never what a secure field reads back, which a step's message would carry.
    if (secure) return "{\"pattern\":\"Value\",\"changed\":" + Bool(changed) + "}";
    return "{\"pattern\":\"Value\",\"changed\":" + Bool(changed) + ",\"value\":" + Json(after) + "}";
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
      AutomationElement.RuntimeIdProperty,
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
      AutomationElement.IsDialogProperty,
      AutomationElement.IsPasswordProperty,
      TogglePattern.ToggleStateProperty,
      SelectionItemPattern.IsSelectedProperty,
      ExpandCollapsePattern.ExpandCollapseStateProperty,
      ValuePattern.ValueProperty
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
    /** Each property read from the app as it is reached, rather than from the cache. */
    public bool Live;
    /** The app's process, whose runtime ids number its elements. */
    public int Pid;
    /** The numbers given in this walk, so that no two of its nodes share a ref. */
    public HashSet<int> Given = new HashSet<int>();
  }

  static Walk Start(bool interactive, int max, RECT window, bool live) {
    Walk walk = new Walk();
    walk.OnlyInteractive = interactive;
    walk.Max = max;
    walk.Window = window;
    walk.Live = live;
    return walk;
  }

  static string Snapshot(string name, bool interactive, int max) {
    Process process = Window(name);
    RECT window = WindowRect(process);
    AutomationElement found = AutomationElement.FromHandle(process.MainWindowHandle);
    Walk walk = Start(interactive, max, window, false);
    walk.Pid = process.Id;
    try {
      Visit(walk, found.GetUpdatedCache(TreeRequest()), 0, null);
    } catch (IndexOutOfRangeException) {
      // The managed client's reader of a cached tree throws on some of
      // react-native-windows' screens, inside GetUpdatedCache. The same tree
      // read an element at a time is slower and does not fail.
      walk = Start(interactive, max, window, true);
      walk.Pid = process.Id;
      Visit(walk, found, 0, null);
    }
    refs = walk.Refs;
    return "{\"process\":" + Json(process.ProcessName)
      + ",\"read\":" + Json(walk.Live ? "walked" : "cached")
      + ",\"window\":{\"x\":" + window.Left + ",\"y\":" + window.Top + ",\"width\":" + (window.Right - window.Left) + ",\"height\":" + (window.Bottom - window.Top) + "}"
      + ",\"nodes\":[" + walk.Nodes.ToString() + "]}";
  }

  /** One element and what is inside it. `parent` is the ref of the nearest ancestor kept, which passes through one that is not. */
  static void Visit(Walk walk, AutomationElement element, int depth, string parent) {
    if (walk.Count >= walk.Max) return;
    string childParent;
    try {
      if (!Node(walk, element, depth, parent, out childParent)) return;
    } catch (ElementNotAvailableException) {
      // Read live, an element can go while the walk is on it; the rest of the
      // tree is still worth having.
      return;
    }
    if (walk.Live) {
      TreeWalker walker = TreeWalker.ControlViewWalker;
      AutomationElement child;
      try { child = walker.GetFirstChild(element); } catch (ElementNotAvailableException) { return; }
      while (child != null) {
        Visit(walk, child, depth + 1, childParent);
        try { child = walker.GetNextSibling(child); } catch (ElementNotAvailableException) { return; }
      }
    } else {
      foreach (AutomationElement child in element.CachedChildren) {
        Visit(walk, child, depth + 1, childParent);
      }
    }
  }

  /** The number an element's ref carries: the one it was given before, or the next. An element with no runtime id, or one this walk gave already, is numbered afresh. */
  static int Number(Walk walk, AutomationElement element) {
    int[] id = null;
    try { id = (walk.Live ? element.GetCurrentPropertyValue(AutomationElement.RuntimeIdProperty) : element.GetCachedPropertyValue(AutomationElement.RuntimeIdProperty)) as int[]; } catch (Exception) { }
    int number;
    string key = id == null || id.Length == 0 ? null : walk.Pid + ":" + string.Join(".", id);
    if (key == null || !numbers.TryGetValue(key, out number) || walk.Given.Contains(number)) {
      number = ++lastNumber;
      if (key != null) numbers[key] = number;
    }
    walk.Given.Add(number);
    return number;
  }

  /**
   * Writes one element when it is kept, and says whether to go on into it.
   * `childParent` is the parent its children name: its own ref when it is
   * kept, the one it was given when it is not.
   */
  static bool Node(Walk walk, AutomationElement element, int depth, string parent, out string childParent) {
    childParent = parent;
    AutomationElement.AutomationElementInformation current = walk.Live ? element.Current : element.Cached;
    string role = current.ControlType.ProgrammaticName.Replace("ControlType.", "");
    // A title bar is the window's chrome, which a walk of the control view
    // never reached. A cache built over the subtree hands back the window's
    // own and, in a react-native-windows app, more of them through its lists,
    // offscreen and nameless, that a search of the same tree does not find.
    // Each is left out with everything inside it.
    if (role == "TitleBar") return false;
    string name = current.Name;
    bool interactive = Actionable.Contains(role);
    // The kit sets this from React Native's testID. It is not the text a person
    // reads, so it survives relabelling and localisation.
    string testId = current.AutomationId;
    // A node earns a place if it is actionable, says something, or was
    // deliberately marked with a testID. An interactive snapshot numbers the
    // same nodes as a full one and writes only those that can be acted on, so
    // a ref names one node in both, and a press, which looks a ref up in a
    // full tree, presses what the interactive one showed.
    bool listed = interactive || !string.IsNullOrEmpty(name) || !string.IsNullOrEmpty(testId);
    if (!listed) return true;
    walk.Count++;
    string reference = "@e" + Number(walk, element);
    walk.Refs[reference] = element;
    if (interactive || !walk.OnlyInteractive) {
      childParent = reference;
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
      object help = Prop(walk, element, AutomationElement.HelpTextProperty, true);
      if (help != null) node.Append(",\"help\":").Append(Json(help.ToString()));
      object position = Prop(walk, element, AutomationElement.PositionInSetProperty, true);
      object size = Prop(walk, element, AutomationElement.SizeOfSetProperty, true);
      // "2 of 5", the way it is announced, rather than two numbers to pair up.
      if (position != null && size != null) node.Append(",\"inSet\":").Append(Json(position + " of " + size));
      object heading = Prop(walk, element, AutomationElement.HeadingLevelProperty, true);
      if (heading is int) node.Append(",\"heading\":").Append((int)heading);
      object live = Prop(walk, element, LiveSetting, true);
      if (live is int && (int)live > 0 && (int)live < LiveNames.Length) node.Append(",\"live\":").Append(Json(LiveNames[(int)live]));
      object status = Prop(walk, element, AutomationElement.ItemStatusProperty, true);
      if (status != null) node.Append(",\"status\":").Append(Json(status.ToString()));
      object dialog = Prop(walk, element, AutomationElement.IsDialogProperty, false);
      if (dialog is bool && (bool)dialog) node.Append(",\"dialog\":true");
      // The state a control is in, present only where it has one. A toggle is
      // checked or not, as a switch is: react-native-windows gives a switch the
      // control type Button, with Toggle and no Invoke. Only a Button that
      // also invokes is a toggle button, pressed in or not.
      object toggle = Raw(walk, element, TogglePattern.ToggleStateProperty);
      if (toggle is ToggleState) {
        ToggleState on = (ToggleState)toggle;
        object invokable = Prop(walk, element, AutomationElement.IsInvokePatternAvailableProperty, false);
        bool pressable = role == "Button" && invokable is bool && (bool)invokable;
        node.Append(pressable ? ",\"pressed\":" : ",\"checked\":").Append(on == ToggleState.On ? "true" : on == ToggleState.Off ? "false" : "\"mixed\"");
      }
      object selected = Raw(walk, element, SelectionItemPattern.IsSelectedProperty);
      if (selected is bool) node.Append(",\"selected\":").Append(Bool((bool)selected));
      object expanded = Raw(walk, element, ExpandCollapsePattern.ExpandCollapseStateProperty);
      if (expanded is ExpandCollapseState && (ExpandCollapseState)expanded != ExpandCollapseState.LeafNode) {
        node.Append(",\"expanded\":").Append(Bool((ExpandCollapseState)expanded != ExpandCollapseState.Collapsed));
      }
      object password = Raw(walk, element, AutomationElement.IsPasswordProperty);
      if (password is bool && (bool)password) {
        node.Append(",\"secure\":true");
      } else {
        // Never a secure field's value, which a tree must not carry.
        string value = Raw(walk, element, ValuePattern.ValueProperty) as string;
        if (value != null) node.Append(",\"value\":").Append(Json(value));
      }
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
        object available = Prop(walk, element, PatternProperties[at], false);
        if (available is bool && (bool)available) patterns.Add(Json(PatternNames[at]));
      }
      if (patterns.Count > 0) node.Append(",\"patterns\":[").Append(string.Join(",", patterns.ToArray())).Append("]");
      node.Append("}");
      if (walk.Nodes.Length > 0) walk.Nodes.Append(",");
      walk.Nodes.Append(node.ToString());
    }
    return true;
  }

  // One property, from the cache or from the app as the walk reads them, as
  // null for "not set" in all the ways UIA says it: absent, NotSupported, an
  // empty string, or a number below 1. That last one matters more than it
  // looks: react-native-windows returns -1 for an unset position or set size,
  // not 0.
  static object Prop(Walk walk, AutomationElement element, AutomationProperty property, bool unsetBelowOne) {
    object value = Read(walk, element, property, false);
    string text = value as string;
    if (text != null && text.Length == 0) return null;
    if (unsetBelowOne && value is int && (int)value < 1) return null;
    return value;
  }

  // A control's state, as UIA gave it, null where the control does not
  // support it: asked for without its default, so a node with no Toggle
  // pattern reads as no toggle rather than as one switched off. An empty
  // string stays, since an empty field's value is "".
  static object Raw(Walk walk, AutomationElement element, AutomationProperty property) {
    return Read(walk, element, property, true);
  }

  static object Read(Walk walk, AutomationElement element, AutomationProperty property, bool ignoreDefault) {
    if (property == null) return null;
    object value;
    try { value = walk.Live ? element.GetCurrentPropertyValue(property, ignoreDefault) : element.GetCachedPropertyValue(property, ignoreDefault); } catch { return null; }
    return value == null || value == AutomationElement.NotSupported ? null : value;
  }

  // Synthetic mouse input. SetCursorPos alone raises no pointer move, so the
  // click moves and then presses, which the renderer sees as a real pointer.
  static string Click(string name, IEnumerable points, int count) {
    int originX = 0;
    int originY = 0;
    uint pid = 0;
    if (!string.IsNullOrEmpty(name)) {
      Process process = Window(name);
      RECT rect = WindowRect(process);
      originX = rect.Left;
      originY = rect.Top;
      pid = (uint)process.Id;
    }
    List<string> clicked = new List<string>();
    if (points != null) {
      foreach (object point in points) {
        object[] xy = Pair(point);
        int x = Convert.ToInt32(xy[0], CultureInfo.InvariantCulture) + originX;
        int y = Convert.ToInt32(xy[1], CultureInfo.InvariantCulture) + originY;
        Owns(pid, name, x, y, "press");
        SetCursorPos(x, y);
        Thread.Sleep(80);
        // The clicks of one press on the one point, well inside the system's
        // double-click time, so that two are a double click.
        for (int each = 0; each < Math.Max(count, 1); each++) {
          if (each > 0) Thread.Sleep(50);
          mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
          Thread.Sleep(60);
          mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
        }
        clicked.Add(x + "," + y + (count > 1 ? " " + count + " times" : ""));
        Thread.Sleep(400);
      }
    }
    return Json("clicked " + string.Join("; ", clicked.ToArray()));
  }

  // Pointer input lands on whatever window is at the point, so with an app
  // named it is sent only where that window is one of the app's own, and
  // only to a point on a screen: the pointer stops at the edge of the last
  // one, and a press meant for a point past it lands on whatever is there.
  static void Owns(uint pid, string name, int x, int y, string what) {
    if (pid == 0) return;
    POINT at;
    at.X = x;
    at.Y = y;
    if (MonitorFromPoint(at, 0) == IntPtr.Zero) throw new InvalidOperationException(name + "'s window reaches past the screen, and " + x + "," + y + " is off it, so the " + what + " would land elsewhere");
    uint owner;
    GetWindowThreadProcessId(GetAncestor(WindowFromPoint(at), 2), out owner);
    if (owner != pid) throw new InvalidOperationException("a window of " + ProcessName(owner) + " is in front of " + name + " at " + x + "," + y + ", so the " + what + " would land in it");
  }

  /** The app's window's top left, and its process id, or nothing where no app is named. */
  static int[] Origin(string name) {
    if (string.IsNullOrEmpty(name)) return new int[] { 0, 0, 0 };
    Process process = Window(name);
    RECT rect = WindowRect(process);
    return new int[] { rect.Left, rect.Top, process.Id };
  }

  /** A process by its name, which says whose window was in the way without reading anything it shows. */
  static string ProcessName(uint pid) {
    try { return Process.GetProcessById((int)pid).ProcessName; } catch { return "another process"; }
  }

  // The clipboard answers only a thread of a single-threaded apartment, which
  // the host's own loop need not be, so the work gets one of its own.
  static string OnSta(Func<string> work) {
    string answer = null;
    Exception failure = null;
    Thread thread = new Thread(delegate () {
      try { answer = work(); } catch (Exception error) { failure = error; }
    });
    thread.SetApartmentState(ApartmentState.STA);
    thread.Start();
    thread.Join();
    if (failure != null) throw failure;
    return answer;
  }

  static string SetClipboard(string text) {
    OnSta(delegate {
      if (text.Length == 0) System.Windows.Forms.Clipboard.Clear(); else System.Windows.Forms.Clipboard.SetText(text);
      return null;
    });
    return Json("put " + text.Length + " characters on the clipboard");
  }

  // The process whose window is in front, which keys and a raise go by.
  static uint ForegroundProcess() {
    uint owner;
    GetWindowThreadProcessId(GetForegroundWindow(), out owner);
    return owner;
  }

  static object[] Pair(object point) {
    ArrayList list = point as ArrayList;
    if (list != null && list.Count == 2) return new object[] { list[0], list[1] };
    object[] array = point as object[];
    if (array != null && array.Length == 2) return array;
    throw new InvalidOperationException("a point is [x, y]");
  }

  static string Hold(string name, int x, int y, int ms) {
    int[] origin = Origin(name);
    int originX = origin[0];
    int originY = origin[1];
    Owns((uint)origin[2], name, x + originX, y + originY, "press");
    SetCursorPos(x + originX, y + originY);
    Thread.Sleep(80);
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
    Thread.Sleep(Math.Max(0, ms));
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
    Thread.Sleep(400);
    return Json("held " + (x + originX) + "," + (y + originY) + " for " + ms + " ms");
  }

  // The pointer moved over a point without a press, for a hover. SetCursorPos
  // raises no pointer move, so an absolute move over the whole desktop
  // follows it, which the renderer sees as the pointer arriving there.
  static string Move(string name, int x, int y) {
    int[] origin = Origin(name);
    int screenX = x + origin[0];
    int screenY = y + origin[1];
    Owns((uint)origin[2], name, screenX, screenY, "hover");
    SetCursorPos(screenX, screenY);
    int left = GetSystemMetrics(76);
    int top = GetSystemMetrics(77);
    int width = Math.Max(2, GetSystemMetrics(78));
    int height = Math.Max(2, GetSystemMetrics(79));
    uint normalX = (uint)((screenX - left) * 65535L / (width - 1));
    uint normalY = (uint)((screenY - top) * 65535L / (height - 1));
    mouse_event(0x0001 | 0x8000 | 0x4000, normalX, normalY, 0, UIntPtr.Zero);
    Thread.Sleep(200);
    return Json("moved to " + screenX + "," + screenY);
  }

  // The keyboard focus given on UI Automation's own channel, which needs no
  // quiet desk, and read back from the control.
  static string Focus(string reference) {
    AutomationElement element = Element(reference);
    element.SetFocus();
    bool focused = Until(() => element.Current.HasKeyboardFocus);
    return "{\"pattern\":\"Focus\",\"changed\":" + Bool(focused) + "}";
  }

  // Keys go to the window in front, so with an app named they are sent only
  // while that window is one of its own: an app that did not come to the
  // front would leave them to whatever was there, such as a window someone
  // left open when they stepped away.
  static string Keys(string name, string keys) {
    if (!string.IsNullOrEmpty(name)) {
      Process process = Window(name);
      uint owner;
      GetWindowThreadProcessId(GetForegroundWindow(), out owner);
      if (owner != (uint)process.Id) throw new InvalidOperationException(name + " is not the window in front, so the keys would go to " + ProcessName(owner));
    }
    System.Windows.Forms.SendKeys.SendWait(keys);
    Thread.Sleep(400);
    return Json("sent " + keys);
  }

  // A window's picture, drawn by the window itself, so a window over it on
  // the screen is not in it and nothing is raised. Two cases take the picture
  // from the screen instead. One is a menu or popup of the app's own open
  // over it: a WinUI menu opens in a window of its own, which a picture the
  // main window draws would leave out, though it is often the thing being
  // looked at. The other is a window that draws nothing.
  static string Screen(string name, string output) {
    if (string.IsNullOrEmpty(output)) throw new InvalidOperationException("no file to save the screen to");
    if (string.IsNullOrEmpty(name)) {
      System.Drawing.Rectangle screen = System.Windows.Forms.SystemInformation.VirtualScreen;
      SaveScreen(screen.X, screen.Y, screen.Width, screen.Height, output);
      return Json("saved " + output + " (" + screen.Width + " x " + screen.Height + " at " + screen.X + "," + screen.Y + ")");
    }
    Process process = Window(name);
    IntPtr handle = process.MainWindowHandle;
    // There is no picture of a minimized window short of raising it, and a
    // screenshot never raises a window.
    if (IsIconic(handle)) throw new InvalidOperationException(process.ProcessName + "'s window is minimized, and a screenshot does not raise it");
    RECT rect = WindowRect(process);
    int width = rect.Right - rect.Left;
    int height = rect.Bottom - rect.Top;
    if (PopupOver(process, handle, rect)) {
      SaveScreen(rect.Left, rect.Top, width, height, output);
      return Json("saved " + output + " (" + width + " x " + height + " at " + rect.Left + "," + rect.Top + ", from the screen, since a menu or popup of its own is open over it)");
    }
    using (Bitmap bitmap = new Bitmap(width, height, PixelFormat.Format24bppRgb)) {
      bool drawn;
      using (Graphics graphics = Graphics.FromImage(bitmap)) {
        IntPtr dc = graphics.GetHdc();
        // PW_RENDERFULLCONTENT, so what DirectComposition draws is in it too:
        // that is how react-native-windows draws.
        try { drawn = PrintWindow(handle, dc, 2); } finally { graphics.ReleaseHdc(dc); }
      }
      if (drawn && !Blank(bitmap)) {
        bitmap.Save(output, ImageFormat.Png);
        return Json("saved " + output + " (" + width + " x " + height + ", drawn by the window)");
      }
    }
    SaveScreen(rect.Left, rect.Top, width, height, output);
    return Json("saved " + output + " (" + width + " x " + height + " at " + rect.Left + "," + rect.Top + ", from the screen, since the window drew nothing)");
  }

  /** Whether another visible window of the process, a menu or a popup, lies over its main window. */
  static bool PopupOver(Process process, IntPtr main, RECT area) {
    bool found = false;
    uint pid = (uint)process.Id;
    EnumWindows(delegate (IntPtr window, IntPtr data) {
      uint owner;
      GetWindowThreadProcessId(window, out owner);
      if (window == main || owner != pid || !IsWindowVisible(window) || IsIconic(window)) return true;
      RECT rect;
      GetWindowRect(window, out rect);
      if (rect.Right <= rect.Left || rect.Bottom <= rect.Top) return true;
      if (rect.Right <= area.Left || rect.Left >= area.Right || rect.Bottom <= area.Top || rect.Top >= area.Bottom) return true;
      found = true;
      return false;
    }, IntPtr.Zero);
    return found;
  }

  static void SaveScreen(int x, int y, int width, int height, string output) {
    using (Bitmap bitmap = new Bitmap(width, height)) {
      using (Graphics graphics = Graphics.FromImage(bitmap)) {
        graphics.CopyFromScreen(x, y, 0, 0, bitmap.Size);
      }
      bitmap.Save(output, ImageFormat.Png);
    }
  }

  /** Whether every pixel is black, which is what a window that did not draw itself leaves. */
  static bool Blank(Bitmap bitmap) {
    BitmapData data = bitmap.LockBits(new System.Drawing.Rectangle(0, 0, bitmap.Width, bitmap.Height), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
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
    IntoView(window);
    SetWindowPos(window, new IntPtr(-1), 0, 0, 0, 0, 0x0003);
    SetWindowPos(window, new IntPtr(-2), 0, 0, 0, 0, 0x0003);
    BringWindowToTop(window);
    bool set = SetForegroundWindow(window);
    AttachThreadInput(foregroundThread, me, false);
    Thread.Sleep(300);
    return Json("foreground " + (GetForegroundWindow() == window ? "True" : "False") + " (set " + (set ? "True" : "False") + ")");
  }

  // A window that reaches past its screen's work area is moved inside it,
  // as far as it fits, keeping its size, since synthetic input is sent to a
  // point on the screen and the part of a window past the edge, or under the
  // taskbar, has none. Windows opens each new window a step down and right of
  // the last, so an app launched again and again ends up partly off a small
  // screen. A maximized window fills the work area already.
  static void IntoView(IntPtr window) {
    if (IsZoomed(window)) return;
    // The frame as drawn: GetWindowRect counts the invisible borders a window
    // is resized by, which lie past the edge of a window that is not.
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

  /** How far a span moves to lie inside another; one longer than it keeps its start at the other's, as a title bar stays on screen. */
  static int Inside(int start, int end, int from, int to) {
    if (start < from || end - start >= to - from) return from - start;
    return end > to ? to - end : 0;
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
    // UI Automation throws these two with no message of their own: the first
    // for a pattern called on a disabled control, the second for an element
    // or a window that went while it was read.
    if (inner is ElementNotEnabledException) return "it is not enabled";
    if (inner is ElementNotAvailableException) return "it is no longer there";
    return string.IsNullOrEmpty(inner.Message) ? inner.GetType().Name : inner.Message;
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
