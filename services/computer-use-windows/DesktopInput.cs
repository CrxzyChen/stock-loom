using System.Runtime.InteropServices;

namespace StockLoom.ComputerUse;

internal static class DesktopInput
{
    [StructLayout(LayoutKind.Sequential)] private struct Input {public uint Type;public InputUnion Data;}
    [StructLayout(LayoutKind.Explicit)] private struct InputUnion {[FieldOffset(0)]public MouseInput Mouse;[FieldOffset(0)]public KeyboardInput Keyboard;}
    [StructLayout(LayoutKind.Sequential)] private struct MouseInput {public int X,Y;public uint Data,Flags,Time;public nuint Extra;}
    [StructLayout(LayoutKind.Sequential)] private struct KeyboardInput {public ushort VirtualKey,Scan;public uint Flags,Time;public nuint Extra;}
    [DllImport("user32.dll",SetLastError=true)] private static extern uint SendInput(uint count,Input[] inputs,int size);
    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(nint window);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll",SetLastError=true)] private static extern bool AttachThreadInput(uint thread,uint other,bool attach);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")] private static extern nint GetWindowLongPtr(nint window,int index);
    [DllImport("user32.dll")] private static extern nint GetWindow(nint window,uint command);
    [DllImport("user32.dll")] private static extern bool IsWindowEnabled(nint window);
    [StructLayout(LayoutKind.Sequential)] private struct Message {public nint Window;public uint Id;public nuint WParam;public nint LParam;public uint Time;public Point Position;public uint Private;}
    [DllImport("user32.dll")] private static extern bool PeekMessageW(out Message message,nint window,uint min,uint max,uint remove);
    [DllImport("user32.dll")] private static extern bool SetCursorPos(int x,int y);
    [StructLayout(LayoutKind.Sequential)] private struct Point {public int X,Y;}
    [DllImport("user32.dll")] private static extern nint WindowFromPoint(Point point);
    [DllImport("user32.dll")] private static extern nint GetAncestor(nint window,uint flags);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [StructLayout(LayoutKind.Sequential)] private struct GuiThreadInfo {public uint Size,Flags;public nint Active,Focus,Capture,MenuOwner,MoveSize,Caret;public int Left,Top,Right,Bottom;}
    [DllImport("user32.dll")] private static extern bool GetGUIThreadInfo(uint thread,ref GuiThreadInfo info);
    [DllImport("user32.dll")] private static extern bool IsWindowUnicode(nint window);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint window,out uint process);
    [DllImport("user32.dll",SetLastError=true)] private static extern nint SendMessageTimeoutW(nint window,uint message,nuint wParam,nint lParam,uint flags,uint timeout,out nuint result);
    private static nint TextTarget(WindowRef window)
    {
        var info=new GuiThreadInfo{Size=(uint)Marshal.SizeOf<GuiThreadInfo>()};
        if(!GetGUIThreadInfo(0,ref info)||info.Focus==0||GetAncestor(info.Focus,2)!=(nint)window.Handle)
            throw new DesktopException("FOCUS_CHANGED","No focused control belongs to the target window.");
        GetWindowThreadProcessId(info.Focus,out var process);
        if(process!=window.ProcessId)throw new DesktopException("FOCUS_CHANGED","Focused control belongs to another process.");
        return info.Focus;
    }

    public static void Drag(WindowRef window,(int X,int Y) from,(int X,int Y) to,CancellationToken token)
    {
        var left=GetSystemMetrics(76);var top=GetSystemMetrics(77);var width=GetSystemMetrics(78);var height=GetSystemMetrics(79);
        if(width<2||height<2)throw new DesktopException("INPUT_FAILED","Interactive desktop bounds are unavailable.");
        var events=new List<Input>{MouseAt(from.X,from.Y,2)};
        for(var i=1;i<=16;i++)
        {
            var x=from.X+(to.X-from.X)*i/16;var y=from.Y+(to.Y-from.Y)*i/16;
            if(GetAncestor(WindowFromPoint(new Point{X=x,Y=y}),2)!=(nint)window.Handle)
                throw new DesktopException("FOCUS_CHANGED","Another window covers the drag path.");
            events.Add(new Input{Type=0,Data=new InputUnion{Mouse=new MouseInput{X=(int)Math.Round((x-left)*65535d/(width-1)),Y=(int)Math.Round((y-top)*65535d/(height-1)),Flags=0xE001}}});
        }
        events.Add(MouseAt(to.X,to.Y,4));
        Position(window,from.X,from.Y,token);
        // Bounded batch includes release. There is no worker wait while a button is held.
        Send(events.ToArray());
        Check(window,token);
    }

    private static void Position(WindowRef window,int x,int y,CancellationToken token)
    {
        Check(window,token);
        if(GetAncestor(WindowFromPoint(new Point{X=x,Y=y}),2)!=(nint)window.Handle)
            throw new DesktopException("FOCUS_CHANGED","Another window covers the target point.");
        if(!SetCursorPos(x,y))throw new DesktopException("INPUT_FAILED","Cannot position cursor.");
        Check(window,token);
    }
    public static void PressKey(WindowRef window,string[] keys,CancellationToken token)
    {
        if(keys.Length is <1 or >4)throw new DesktopException("INVALID_ARGUMENT","Use one key with at most three modifiers.");
        ushort Convert(string key)=>key.ToUpperInvariant() switch {
            "CTRL"=>0x11,"ALT"=>0x12,"SHIFT"=>0x10,"ENTER"=>0x0D,"TAB"=>0x09,"ESCAPE"=>0x1B,
            "BACKSPACE"=>0x08,"DELETE"=>0x2E,"SPACE"=>0x20,"LEFT"=>0x25,"UP"=>0x26,"RIGHT"=>0x27,"DOWN"=>0x28,
            "HOME"=>0x24,"END"=>0x23,"PAGEUP"=>0x21,"PAGEDOWN"=>0x22,
            var text when text.Length==1&&char.IsAsciiLetterOrDigit(text[0])=>(ushort)text[0],
            _=>throw new DesktopException("INVALID_ARGUMENT","Unsupported key name.")};
        var codes=keys.Select(Convert).ToArray();
        if(codes.Distinct().Count()!=codes.Length||codes.Take(codes.Length-1).Any(c=>c is not (0x10 or 0x11 or 0x12)))
            throw new DesktopException("INVALID_ARGUMENT","Only modifiers may precede the final key.");
        Check(window,token);
        // Submit key-down and key-up together; there is no await with a held modifier.
        Send(codes.Select(c=>new Input{Type=1,Data=new InputUnion{Keyboard=new KeyboardInput{VirtualKey=c}}})
            .Concat(codes.Reverse().Select(c=>new Input{Type=1,Data=new InputUnion{Keyboard=new KeyboardInput{VirtualKey=c,Flags=2}}})).ToArray());
        Check(window,token);
    }
    public static void Scroll(WindowRef window,int x,int y,int delta,CancellationToken token)
    {
        if(delta==0||Math.Abs((long)delta)>12000)throw new DesktopException("INVALID_ARGUMENT","Scroll delta must be between -12000 and 12000 and nonzero.");
        Position(window,x,y,token);
        Send([new Input{Type=0,Data=new InputUnion{Mouse=new MouseInput{Flags=0x0800,Data=unchecked((uint)delta)}}}]);
        Check(window,token);
    }

    private static nint ActivationWindow(WindowRef window)
    {
        var target=(nint)window.Handle;
        // Some suggestion popups reject activation in WM_MOUSEACTIVATE rather
        // than setting WS_EX_NOACTIVATE. A borderless owned WS_POPUP can also
        // use its enabled owner; modal/disabled owners and captioned dialogs cannot.
        var style=(long)GetWindowLongPtr(target,-16);
        if(((long)GetWindowLongPtr(target,-20)&0x08000000)!=0||(window.Title.Length==0&&(style&0x80000000)!=0&&(style&0x00C00000)==0))
        {
            var owner=GetWindow(target,4);
            if(owner!=0&&IsWindowEnabled(owner)){GetWindowThreadProcessId(owner,out var process);if(process==window.ProcessId)return owner;}
        }
        return target;
    }
    public static object ActivationInfo(WindowRef window)=>new{handle=window.Handle,owner=(long)GetWindow((nint)window.Handle,4),style=(long)GetWindowLongPtr((nint)window.Handle,-16),exStyle=(long)GetWindowLongPtr((nint)window.Handle,-20),foreground=(long)GetForegroundWindow()};
    public static bool IsForeground(WindowRef window)=>GetForegroundWindow()==ActivationWindow(window);
    public static void Activate(WindowRef window)
    {
        DesktopObservation.Validate(window);
        var target=ActivationWindow(window);
        if(GetForegroundWindow()!=target)SetForegroundWindow(target);
        // UIA / cross-thread foreground activation can complete asynchronously.
        // Wait without injecting input or repeatedly stealing focus.
        for(var attempt=0;attempt<10&&GetForegroundWindow()!=target;attempt++)
        {
            Thread.Sleep(25);DesktopObservation.Validate(window);
        }
        if(GetForegroundWindow()==target)return;
        // Only activation shares the foreground queue. No input is injected while
        // attached; the host timeout can terminate this disposable worker if a
        // foreign UI thread hangs. Never change global foreground-lock settings.
        var foreground=GetForegroundWindow();
        var currentThread=GetCurrentThreadId();
        var foregroundThread=GetWindowThreadProcessId(foreground,out _);
        for(var key=1;key<256;key++)
            if((GetAsyncKeyState(key)&0x8000)!=0)
                throw new DesktopException("FOCUS_CHANGED","Release held keys and mouse buttons before activating the target.");
        DesktopObservation.Validate(window);
        // Pipe requests can resume on a fresh thread-pool thread with no USER
        // message queue. AttachThreadInput requires a queue on both threads.
        PeekMessageW(out _,0,0,0,0);
        var attached=foreground!=0&&foregroundThread!=0&&foregroundThread!=currentThread&&GetForegroundWindow()==foreground&&AttachThreadInput(currentThread,foregroundThread,true);
        var attachError=attached?0:Marshal.GetLastPInvokeError();
        if(attached)
        {
            var targetThread=GetWindowThreadProcessId(target,out _);
            var targetAttached=targetThread!=0&&targetThread!=currentThread&&targetThread!=foregroundThread&&AttachThreadInput(currentThread,targetThread,true);
            try
            {
                DesktopObservation.Validate(window);SetForegroundWindow(target);
                // Wait for the target's asynchronous activation before detaching.
                // WM_NULL is bounded and carries no user input.
                SendMessageTimeoutW(target,0,0,0,0x23,250,out _);
                for(var attempt=0;attempt<10&&GetForegroundWindow()!=target;attempt++)
                {Thread.Sleep(25);DesktopObservation.Validate(window);}
            }
            finally
            {
                var targetDetached=!targetAttached||AttachThreadInput(currentThread,targetThread,false);
                var foregroundDetached=AttachThreadInput(currentThread,foregroundThread,false);
                if(!targetDetached||!foregroundDetached)
                    throw new DesktopException("FOCUS_STATE_UNCERTAIN","Could not detach the temporary foreground input queue; reset the worker.");
            }
        }
        for(var attempt=0;attempt<10&&GetForegroundWindow()!=target;attempt++)
        {Thread.Sleep(25);DesktopObservation.Validate(window);}
        if(GetForegroundWindow()!=target)throw new DesktopException("FOCUS_CHANGED",$"The target window could not receive focus (queueAttached={attached}, win32={attachError}).");
    }
    private static void Check(WindowRef window,CancellationToken token)
    {
        token.ThrowIfCancellationRequested();DesktopObservation.Validate(window);
        if(!IsForeground(window))throw new DesktopException("FOCUS_CHANGED","Foreground window changed; input stopped.");
    }
    private static void Send(Input[] inputs)
    {
        var accepted=SendInput((uint)inputs.Length,inputs,Marshal.SizeOf<Input>());
        if(accepted!=inputs.Length)
        {
            // Release only inputs accepted from this batch, never unrelated user keys.
            var releases=new List<Input>();
            foreach(var input in inputs.Take((int)accepted))
            {
                if(input.Type==1&&(input.Data.Keyboard.Flags&2)==0){var release=input;release.Data.Keyboard.Flags|=2;releases.Add(release);}
                else if(input.Type==0&&(input.Data.Mouse.Flags&2)!=0)releases.Add(new Input{Type=0,Data=new InputUnion{Mouse=new MouseInput{Flags=4}}});
                else if(input.Type==0&&(input.Data.Mouse.Flags&8)!=0)releases.Add(new Input{Type=0,Data=new InputUnion{Mouse=new MouseInput{Flags=16}}});
            }
            if(releases.Count>0)SendInput((uint)releases.Count,releases.ToArray(),Marshal.SizeOf<Input>());
            throw new DesktopException("ACCESS_DENIED","Windows did not accept all input events.");
        }
        // SendInput only enqueues. Yield before a subsequent synchronous UIA /
        // WM_CHAR call can overtake queued keyboard or mouse messages. This is
        // not application-result verification; the caller still must observe.
        Thread.Sleep(20);
    }
    private static Input MouseAt(int x,int y,uint flags,uint data=0)
    {
        var left=GetSystemMetrics(76);var top=GetSystemMetrics(77);var width=GetSystemMetrics(78);var height=GetSystemMetrics(79);
        if(width<2||height<2)throw new DesktopException("INPUT_FAILED","Interactive desktop bounds are unavailable.");
        return new Input{Type=0,Data=new InputUnion{Mouse=new MouseInput{X=(int)Math.Round((x-left)*65535d/(width-1)),Y=(int)Math.Round((y-top)*65535d/(height-1)),Flags=flags|0xE001,Data=data}}};
    }
    public static void Type(WindowRef window,string text,CancellationToken token)
    {
        if(text.Length>16000)throw new DesktopException("INVALID_ARGUMENT","Text is too long.");
        Check(window,token);
        var target=TextTarget(window);
        var unicode=IsWindowUnicode(target);
        var useUnichar=false;
        if(!unicode&&text.Any(c=>c>127))
        {
            // Probe support before writing anything. Do not guess the foreign
            // process code page or silently replace unrepresentable characters.
            useUnichar=SendMessageTimeoutW(target,0x0109,0xFFFF,0,0x23,1000,out var supported)!=0&&supported!=0;
            if(!useUnichar)throw new DesktopException("UNSUPPORTED_ACTION","This ANSI control does not support Unicode input; use setValue if supported, or ASCII search codes.");
        }
        foreach(var rune in text.EnumerateRunes())
        {
            Check(window,token);
            if(TextTarget(window)!=target)throw new DesktopException("FOCUS_CHANGED","Focused control changed; text input stopped.");
            // Bind characters to the verified control, not the global input queue.
            // The receiving procedure handles each message before the next is sent.
            foreach(var unit in useUnichar?new[]{(uint)rune.Value}:rune.ToString().Select(c=>(uint)c))
            {
                Marshal.SetLastPInvokeError(0);
                if(SendMessageTimeoutW(target,useUnichar?0x0109u:0x0102u,unit,1,0x23,1000,out _)==0)
                {
                    var error=Marshal.GetLastPInvokeError();
                    throw new DesktopException(error==5?"ACCESS_DENIED":error==1460?"TIMEOUT":"INPUT_FAILED","Target control did not acknowledge the character message.");
                }
            }
            Check(window,token);
            if(TextTarget(window)!=target)throw new DesktopException("FOCUS_CHANGED","Focused control changed; text input stopped.");
        }
    }
    public static void ClickScreen(WindowRef window,int x,int y,CancellationToken token,string button="left")
    {
        var flags=button switch {"left"=>(2u,4u),"right"=>(8u,16u),_=>throw new DesktopException("INVALID_ARGUMENT","Unknown mouse button.")};
        Position(window,x,y,token);
        Send([MouseAt(x,y,flags.Item1),MouseAt(x,y,flags.Item2)]);
        Check(window,token);
    }
}
