using System.Diagnostics;
using System.Runtime.InteropServices;
using FlaUI.Core.AutomationElements;
using FlaUI.UIA3;

namespace StockLoom.ComputerUse;

internal sealed record WindowRef(string Id, int ProcessId, string StartedAt, long Handle, string Title, string? Executable);
internal sealed record ElementRef(string Id, string Name, string ControlType, string AutomationId, bool Enabled, bool Password, Rect Bounds);
internal sealed record Rect(double X,double Y,double Width,double Height);
internal sealed record WindowObservation(WindowRef Window,string SnapshotId,Rect Bounds,List<ElementRef> Elements,bool Truncated,Rect? ScreenshotBounds=null);
internal sealed class DesktopException(string code,string message) : Exception(message) { public string Code {get;}=code; }

internal sealed class DesktopObservation : IDisposable
{
    private readonly UIA3Automation automation = new();
    private readonly Dictionary<string,AutomationElement> elements = new();
    private string? currentSnapshot;
    private WindowRef? currentWindow;
    private DateTime observedAt;
    private Rect? capturedBounds;
    private int capturedWidth,capturedHeight;
    private const int MaxElements=250;

    [DllImport("user32.dll",SetLastError=true)] private static extern bool EnumWindows(EnumWindow callback,nint extra);
    private delegate bool EnumWindow(nint hwnd,nint extra);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(nint hwnd);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint hwnd,out uint processId);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] private static extern int GetWindowText(nint hwnd,System.Text.StringBuilder text,int count);
    [DllImport("user32.dll")] private static extern bool IsWindow(nint hwnd);
    [DllImport("user32.dll")] private static extern bool ShowWindowAsync(nint hwnd,int command);
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(nint context);
    public static void ConfigureDpi()=>SetProcessDpiAwarenessContext((nint)(-4));
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(nint hwnd,int attribute,out NativeRect rect,int size);
    [StructLayout(LayoutKind.Sequential)] private struct NativeRect {public int Left,Top,Right,Bottom;}

    public static Rect CaptureBounds(WindowRef window)
    {
        Validate(window);
        if(DwmGetWindowAttribute((nint)window.Handle,9,out var rect,Marshal.SizeOf<NativeRect>())!=0)
            throw new DesktopException("CAPTURE_UNAVAILABLE","Window frame bounds are unavailable.");
        return new Rect(rect.Left,rect.Top,rect.Right-rect.Left,rect.Bottom-rect.Top);
    }
    public void BindCapture(WindowRef window,string snapshot,Rect bounds,int width,int height)
    {
        ValidateSnapshot(window,snapshot);
        if(width<=0||height<=0||CaptureBounds(window)!=bounds)
            throw new DesktopException("STALE_OBSERVATION","Window moved during capture; inspect again.");
        capturedBounds=bounds;capturedWidth=width;capturedHeight=height;
    }
    public (int X,int Y) MapPoint(WindowRef window,string snapshot,double x,double y)
    {
        ValidateSnapshot(window,snapshot);
        if(capturedBounds is not {} bounds||CaptureBounds(window)!=bounds)
            throw new DesktopException("STALE_OBSERVATION","Window moved since capture; inspect again.");
        if(!double.IsFinite(x)||!double.IsFinite(y)||x<0||y<0||x>=capturedWidth||y>=capturedHeight)
            throw new DesktopException("INVALID_ARGUMENT","Coordinates must be inside the captured image.");
        return ((int)Math.Floor(bounds.X+x*bounds.Width/capturedWidth),(int)Math.Floor(bounds.Y+y*bounds.Height/capturedHeight));
    }
    public void ValidateSnapshot(WindowRef reference,string snapshot)
    {
        Validate(reference);
        if(currentWindow?.Id!=reference.Id||currentSnapshot!=snapshot||DateTime.UtcNow-observedAt>TimeSpan.FromSeconds(30))
            throw new DesktopException("STALE_OBSERVATION","Inspect the window again before acting.");
    }

    public static WindowRef Identify(nint hwnd)
    {
        if(!IsWindow(hwnd))throw new DesktopException("WINDOW_GONE","Window is no longer available.");
        GetWindowThreadProcessId(hwnd,out var pid);
        using var process=Process.GetProcessById(checked((int)pid));
        var started=process.StartTime.ToUniversalTime().Ticks;
        var title=new System.Text.StringBuilder(1024);GetWindowText(hwnd,title,title.Capacity);
        string? executable=null;
        try {executable=process.MainModule?.FileName;}catch(System.ComponentModel.Win32Exception){}
        return new WindowRef($"{pid}:{started}:{hwnd}",(int)pid,started.ToString(System.Globalization.CultureInfo.InvariantCulture),hwnd.ToInt64(),title.ToString(),executable);
    }

    public static List<WindowRef> ListWindows(bool includeHidden=false)
    {
        var windows=new List<WindowRef>();
        Marshal.SetLastPInvokeError(0);
        var enumerated=EnumWindows((hwnd,_)=>{
            if(!includeHidden&&!IsWindowVisible(hwnd))return true;
            // Search suggestions and other owned popup windows can have no title.
            // They still need their own reference and capture for safe interaction.
            try{windows.Add(Identify(hwnd));}
            catch(Exception e) when(e is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception or DesktopException){}
            return true;
        },0);
        if(!enumerated)throw new DesktopException("WINDOW_ENUMERATION_FAILED",$"Windows could not enumerate windows (win32={Marshal.GetLastPInvokeError()}).");
        return windows;
    }
    public static void RevealNotepadFixture()
    {
        foreach(var window in ListWindows(true))
            if(window.Title.Contains("StockLoom-R5-Notepad",StringComparison.Ordinal)&&string.Equals(System.IO.Path.GetFileName(window.Executable),"Notepad.exe",StringComparison.OrdinalIgnoreCase))
                ShowWindowAsync((nint)window.Handle,5);
    }

    public static void Validate(WindowRef reference)
    {
        var actual=Identify((nint)reference.Handle);
        if(actual.Id!=reference.Id)throw new DesktopException("WINDOW_GONE","Window identity changed.");
        if(!IsWindowVisible((nint)reference.Handle))throw new DesktopException("WINDOW_GONE","Window is no longer visible; list windows again.");
    }

    public WindowObservation Inspect(WindowRef reference)
    {
        Validate(reference);reference=Identify((nint)reference.Handle);elements.Clear();capturedBounds=null;currentSnapshot=Guid.NewGuid().ToString("N");currentWindow=reference;observedAt=DateTime.UtcNow;
        var root=automation.FromHandle((nint)reference.Handle);
        var output=new List<ElementRef>();var queue=new Queue<AutomationElement>();queue.Enqueue(root);
        // Avoid full-tree FindAllDescendants: some providers expose unbounded trees.
        while(queue.Count>0 && output.Count<MaxElements)
        {
            var element=queue.Dequeue();
            try
            {
                var id=$"{currentSnapshot}:{output.Count}";
                var bounds=element.BoundingRectangle;
                bool password=element.Properties.IsPassword.ValueOrDefault;
                output.Add(new ElementRef(id,password?"":element.Properties.Name.ValueOrDefault??"",element.Properties.ControlType.ValueOrDefault.ToString(),element.Properties.AutomationId.ValueOrDefault??"",element.Properties.IsEnabled.ValueOrDefault,password,new Rect(bounds.X,bounds.Y,bounds.Width,bounds.Height)));
                elements[id]=element;
                if(!password)foreach(var child in element.FindAllChildren().Take(MaxElements-queue.Count))queue.Enqueue(child);
            }
            catch(FlaUI.Core.Exceptions.ElementNotAvailableException){}
        }
        var rect=root.BoundingRectangle;
        return new WindowObservation(reference,currentSnapshot,new Rect(rect.X,rect.Y,rect.Width,rect.Height),output,queue.Count>0);
    }

    public AutomationElement Resolve(WindowRef reference,string snapshotId,string elementId)
    {
        ValidateSnapshot(reference,snapshotId);
        if(!elements.TryGetValue(elementId,out var element))
            throw new DesktopException("STALE_OBSERVATION","Inspect the window again before acting.");
        return element;
    }
    public void FocusWindow(WindowRef reference)
    {
        Validate(reference);
        // Preserve the focused child (search/edit controls) between keystrokes.
        if(!DesktopInput.IsForeground(reference))automation.FromHandle((nint)reference.Handle).Focus();
    }
    public void Dispose(){elements.Clear();automation.Dispose();}
}
