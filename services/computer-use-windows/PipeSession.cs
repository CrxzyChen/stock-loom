using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace StockLoom.ComputerUse;

internal static class PipeSession
{
    [DllImport("kernel32.dll",SetLastError=true)] private static extern bool GetNamedPipeClientProcessId(nint pipe,out uint processId);
    private static readonly JsonSerializerOptions Json=new(){PropertyNamingPolicy=JsonNamingPolicy.CamelCase,PropertyNameCaseInsensitive=true};
    private static async Task<string?> ReadLine(StreamReader reader)
    {
        var buffer=new char[1];var line=new StringBuilder();
        while(await reader.ReadAsync(buffer.AsMemory())!=0){if(buffer[0]=='\n')return line.ToString();if(line.Length>=65536)throw new DesktopException("INVALID_ARGUMENT","Request exceeds 64 KiB.");line.Append(buffer[0]);}
        return line.Length==0?null:line.ToString();
    }
    public static Task Run(string pipeName)=>Task.Factory.StartNew(()=>RunCore(pipeName),CancellationToken.None,TaskCreationOptions.LongRunning,TaskScheduler.Default);
    // All UIA COM references and operations stay on one dedicated MTA thread.
    private static void RunCore(string pipeName)
    {
        var secret=Environment.GetEnvironmentVariable("STOCK_DESKTOP_TOKEN")??throw new DesktopException("ACCESS_DENIED","Missing host token.");
        var parent=int.Parse(Environment.GetEnvironmentVariable("STOCK_DESKTOP_PARENT")??"0");
        var grants=JsonSerializer.Deserialize<string[]>(Environment.GetEnvironmentVariable("STOCK_DESKTOP_WINDOWS")??"[]")??[];
        var apps=JsonSerializer.Deserialize<string[]>(Environment.GetEnvironmentVariable("STOCK_DESKTOP_APPS")??"[]")??[];
        Environment.SetEnvironmentVariable("STOCK_DESKTOP_TOKEN",null);
        using var pipe=new NamedPipeServerStream(pipeName,PipeDirection.InOut,1,PipeTransmissionMode.Byte,PipeOptions.Asynchronous|PipeOptions.CurrentUserOnly);
        var version=typeof(PipeSession).Assembly.GetCustomAttributes(typeof(System.Reflection.AssemblyInformationalVersionAttribute),false)
            .Cast<System.Reflection.AssemblyInformationalVersionAttribute>().Single().InformationalVersion;
        Console.WriteLine(JsonSerializer.Serialize(new{ready=true,protocol=1,version,capabilities=new[]{"windows.observe","windows.capture","windows.input"}},Json));
        using var connectDeadline=new CancellationTokenSource(TimeSpan.FromSeconds(10));
        pipe.WaitForConnectionAsync(connectDeadline.Token).GetAwaiter().GetResult();
        if(!GetNamedPipeClientProcessId(pipe.SafePipeHandle.DangerousGetHandle(),out var clientPid)||clientPid!=parent)throw new DesktopException("ACCESS_DENIED","Pipe client is not the owning host.");
        using var reader=new StreamReader(pipe,new UTF8Encoding(false,true),leaveOpen:true);
        using var writer=new StreamWriter(pipe,new UTF8Encoding(false),leaveOpen:true){AutoFlush=true};
        var hello=ReadLine(reader).WaitAsync(TimeSpan.FromSeconds(5)).GetAwaiter().GetResult();
        using var handshake=JsonDocument.Parse(hello??"{}");
        var supplied=handshake.RootElement.GetProperty("token").GetString()??"";
        if(!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(secret),Encoding.UTF8.GetBytes(supplied)))throw new DesktopException("ACCESS_DENIED","Invalid host token.");
        writer.WriteLine("{\"ready\":true,\"protocol\":1}");
        using var observer=new DesktopObservation();
        var allowed=new HashSet<string>(grants,StringComparer.Ordinal);
        var allowedApps=new HashSet<string>(apps,StringComparer.OrdinalIgnoreCase);
        bool IsAllowed(WindowRef reference)
        {
            // Executable identity is read locally; never trust the caller's path field.
            var actual=DesktopObservation.Identify((nint)reference.Handle);
            return actual.Id==reference.Id&&(allowed.Contains(actual.Id)||actual.Executable is {} executable&&allowedApps.Contains(executable));
        }
        while(ReadLine(reader).GetAwaiter().GetResult() is {} line)
        {
            string? id=null;string stage="request";
            try
            {
                using var request=JsonDocument.Parse(line);var root=request.RootElement;
                id=root.GetProperty("id").GetString();
                var method=root.GetProperty("method").GetString();var args=root.GetProperty("args");
                void Stage(string next){stage=next;writer.WriteLine(JsonSerializer.Serialize(new{id,stage},Json));}
                object result;
                if(method=="listWindows")result=DesktopObservation.ListWindows().Where(IsAllowed).ToList();
                else
                {
                    var window=JsonSerializer.Deserialize<WindowRef>(args.GetProperty("window").GetRawText(),Json)??throw new DesktopException("INVALID_ARGUMENT","Window required.");
                    Stage("authorize");
                    if(!IsAllowed(window))throw new DesktopException("ACCESS_DENIED","Window is not authorized for this session.");
                    DesktopObservation.Validate(window);
                    if(method=="inspectWindow")
                    {
                        Stage("observe");var observation=observer.Inspect(window);
                        var bounds=DesktopObservation.CaptureBounds(window);
                        Stage("capture");var capture=WindowCapture.Capture(window,CancellationToken.None).GetAwaiter().GetResult();
                        observer.BindCapture(window,observation.SnapshotId,bounds,capture.Width,capture.Height);
                        result=new{observation=observation with {ScreenshotBounds=bounds},capture};
                    }
                    else
                    {
                        using var inputLock=new Mutex(false,"Local\\StockLoomDesktopInput-v1");
                        bool acquired;
                        Stage("input-lock");
                        try{acquired=inputLock.WaitOne(TimeSpan.FromSeconds(3));}catch(AbandonedMutexException){acquired=true;}
                        if(!acquired)throw new DesktopException("DESKTOP_BUSY","Another session is operating the desktop.");
                        try
                        {
                            var snapshot=args.GetProperty("snapshotId").GetString()??"";
                            Stage("validate-snapshot");
                            observer.ValidateSnapshot(window,snapshot);
                            if(method=="drag")
                            {
                                var from=args.GetProperty("from");var to=args.GetProperty("to");
                                var start=observer.MapPoint(window,snapshot,from.GetProperty("x").GetDouble(),from.GetProperty("y").GetDouble());
                                var end=observer.MapPoint(window,snapshot,to.GetProperty("x").GetDouble(),to.GetProperty("y").GetDouble());
                                observer.FocusWindow(window);DesktopInput.Activate(window);DesktopInput.Drag(window,start,end,CancellationToken.None);
                            }
                            else if(method is "click" or "scroll")
                            {
                                var point=observer.MapPoint(window,snapshot,args.GetProperty("x").GetDouble(),args.GetProperty("y").GetDouble());
                                observer.FocusWindow(window);DesktopInput.Activate(window);
                                if(method=="click")DesktopInput.ClickScreen(window,point.X,point.Y,CancellationToken.None,args.TryGetProperty("button",out var button)?button.GetString()??"left":"left");
                                else DesktopInput.Scroll(window,point.X,point.Y,args.GetProperty("delta").GetInt32(),CancellationToken.None);
                            }
                            else if(method=="pressKey")
                            {
                                observer.FocusWindow(window);DesktopInput.Activate(window);
                                if(args.TryGetProperty("elementId",out var keyElementId))
                                {
                                    var keyElement=observer.Resolve(window,snapshot,keyElementId.GetString()??"");
                                    keyElement.Focus();
                                }
                                DesktopInput.PressKey(window,JsonSerializer.Deserialize<string[]>(args.GetProperty("keys").GetRawText())??[],CancellationToken.None);
                            }
                            else
                            {
                            var elementId=args.GetProperty("elementId").GetString()??"";
                            Stage("resolve-element");
                            var element=observer.Resolve(window,snapshot,elementId);
                            if(method=="setValue"){
                                Stage("value-pattern");var value=element.Patterns.Value.Pattern;
                                Stage("value-write");value.SetValue(args.GetProperty("text").GetString()??"");
                            }
                            else if(method=="invokeElement")
                            {
                                if(element.Patterns.Invoke.IsSupported)element.Patterns.Invoke.Pattern.Invoke();
                                else if(element.Patterns.SelectionItem.IsSupported)element.Patterns.SelectionItem.Pattern.Select();
                                else if(element.Patterns.Toggle.IsSupported)element.Patterns.Toggle.Pattern.Toggle();
                                else throw new DesktopException("UNSUPPORTED_ACTION","This control has no supported default action.");
                            }
                            else if(method=="typeText")
                            {
                                element.Focus();DesktopInput.Activate(window);element.Focus();
                                DesktopInput.Type(window,args.GetProperty("text").GetString()??"",CancellationToken.None);
                            }
                            else throw new DesktopException("UNSUPPORTED_METHOD","Desktop method has not been implemented.");
                            }
                            result=new{completed=true};
                        }
                        finally{inputLock.ReleaseMutex();}
                    }
                }
                writer.WriteLine(JsonSerializer.Serialize(new{id,result},Json));
            }
            catch(Exception e){var code=(e as DesktopException)?.Code??(e is TimeoutException||e.HResult==unchecked((int)0x80131505)?"TIMEOUT":"TOOL_ERROR");writer.WriteLine(JsonSerializer.Serialize(new{id,error=new{code,message=code=="TIMEOUT"?$"Desktop operation timed out at {stage}; {e.Message}":e.Message}},Json));}
        }
    }
}
