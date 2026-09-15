using System.Text.Json;
using StockLoom.ComputerUse;

// Private session endpoints require a host-bound pipe and explicit window grants.
var options=new JsonSerializerOptions{PropertyNamingPolicy=JsonNamingPolicy.CamelCase};
DesktopObservation.ConfigureDpi();
try
{
    if(args.Length==2 && args[0]=="--serve")await PipeSession.Run(args[1]);
    else if(args.Length==1 && args[0]=="--probe-session-state")Console.WriteLine(JsonSerializer.Serialize(DesktopAvailability.ProbeSessionState(),options));
    else if(args.Length==1 && args[0]=="--probe-desktop-isolation")Console.WriteLine(JsonSerializer.Serialize(DesktopAvailability.ProbeIsolation(),options));
    else if(args.Length==1 && args[0]=="--probe-reveal-notepad")DesktopObservation.RevealNotepadFixture();
    else if(args.Length==1 && args[0]=="--probe-windows-all")Console.WriteLine(JsonSerializer.Serialize(DesktopObservation.ListWindows(true),options));
    else if(args.Length==1 && args[0]=="--probe-windows")
        Console.WriteLine(JsonSerializer.Serialize(DesktopObservation.ListWindows(),options));
    else if(args.Length==2 && args[0]=="--probe-activation")Console.WriteLine(JsonSerializer.Serialize(DesktopInput.ActivationInfo(DesktopObservation.Identify((nint)long.Parse(args[1]))),options));
    else if(args.Length==2 && args[0]=="--probe-inspect")
    {
        var window=DesktopObservation.Identify((nint)long.Parse(args[1]));
        using var observer=new DesktopObservation();
        Console.WriteLine(JsonSerializer.Serialize(observer.Inspect(window),options));
    }
    else if(args.Length==2 && args[0]=="--probe-capture")
        Console.WriteLine(JsonSerializer.Serialize(await WindowCapture.Capture(DesktopObservation.Identify((nint)long.Parse(args[1])),CancellationToken.None),options));
    else if(args.Length==2 && args[0]=="--probe-fixture-input")
    {
        var window=DesktopObservation.Identify((nint)long.Parse(args[1]));
        if(window.Title!="Stock Loom Computer Use Test")throw new DesktopException("ACCESS_DENIED","Input probe only targets the dedicated fixture.");
        using var observer=new DesktopObservation();var snapshot=observer.Inspect(window);
        var field=snapshot.Elements.Single(e=>e.AutomationId=="ResearchInput");
        var button=snapshot.Elements.Single(e=>e.AutomationId=="ApplyButton");
        var input=observer.Resolve(window,snapshot.SnapshotId,field.Id);
        input.Patterns.Value.Pattern.SetValue("控件写入验证");
        if(input.Patterns.Value.Pattern.Value.Value!="控件写入验证")throw new Exception("UIA write mismatch");
        input.Patterns.Value.Pattern.SetValue("");input.Focus();DesktopInput.Activate(window);
        DesktopInput.ClickScreen(window,(int)(field.Bounds.X+20),(int)(field.Bounds.Y+20),CancellationToken.None);
        DesktopInput.Type(window,"中文输入验证 Stock Loom 123",CancellationToken.None);
        await Task.Delay(200);
        if(input.Patterns.Value.Pattern.Value.Value!="中文输入验证 Stock Loom 123")throw new Exception("Unicode text mismatch");
        observer.Resolve(window,snapshot.SnapshotId,button.Id).Patterns.Invoke.Pattern.Invoke();
        await Task.Delay(200);
        var root=observer.Resolve(window,snapshot.SnapshotId,snapshot.Elements[0].Id);
        var label=root.FindFirstDescendant(x=>x.ByAutomationId("ResultLabel"));
        if(label?.Properties.Name.ValueOrDefault!="已确认：中文输入验证 Stock Loom 123")throw new Exception("Invoke did not update the result");
        Console.WriteLine(JsonSerializer.Serialize(new{passed=true,uiaSetValue=true,unicodeCharacterInput=true,coordinateClick=true,invoke=true},options));
    }
    else throw new DesktopException("INVALID_ARGUMENT","Use --probe-windows, --probe-inspect <handle> or --probe-capture <handle>.");
}
catch(Exception error)
{
    Console.WriteLine(JsonSerializer.Serialize(new{error=new{code=(error as DesktopException)?.Code??"TOOL_ERROR",message=error.Message}},options));
    Environment.ExitCode=1;
}
