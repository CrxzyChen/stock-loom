using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace StockLoom.ComputerUse;

internal static class DesktopAvailability
{
    // WTSINFOEXW / WTSINFOEX_LEVEL1_W from wtsapi32.h. The nested level
    // contains LARGE_INTEGER fields, so its alignment must not be packed to 4.
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
    private struct WtsLevel1
    {
        public uint SessionId;public int SessionState;public int SessionFlags;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=33)]public string WinStationName;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=21)]public string UserName;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=18)]public string DomainName;
        public long LogonTime,ConnectTime,DisconnectTime,LastInputTime,CurrentTime;
        public uint IncomingBytes,OutgoingBytes,IncomingFrames,OutgoingFrames,IncomingCompressedBytes,OutgoingCompressedBytes;
    }
    [StructLayout(LayoutKind.Sequential)]private struct WtsInfoEx {public uint Level;public WtsLevel1 Data;}
    [DllImport("user32.dll",SetLastError=true)] private static extern nint OpenInputDesktop(uint flags,bool inherit,uint access);
    [DllImport("user32.dll")] private static extern bool CloseDesktop(nint desktop);
    [DllImport("user32.dll")] private static extern nint GetThreadDesktop(uint thread);
    [DllImport("user32.dll")] private static extern nint GetProcessWindowStation();
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] private static extern bool GetUserObjectInformationW(nint handle,int index,StringBuilder value,uint length,out uint needed);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("wtsapi32.dll",CharSet=CharSet.Unicode)] private static extern bool WTSQuerySessionInformationW(nint server,int session,int information,out nint buffer,out uint bytes);
    [DllImport("wtsapi32.dll")] private static extern void WTSFreeMemory(nint buffer);
    [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern nint CreateDesktopW(string name,nint device,nint mode,uint flags,uint access,nint security);
    [DllImport("user32.dll")] private static extern bool SetThreadDesktop(nint desktop);
    private static DesktopException Unavailable()=>new("DESKTOP_UNAVAILABLE","The interactive desktop is unavailable. Unlock and reconnect the user session before retrying.");
    private static string Name(nint handle)
    {
        var name=new StringBuilder(256);
        if(handle==0||!GetUserObjectInformationW(handle,2,name,(uint)(name.Capacity*2),out _))throw Unavailable();
        return name.ToString();
    }
    private static WtsLevel1 SessionState(int sessionId)
    {
        const int WTSSessionInfoEx=25;
        if(!WTSQuerySessionInformationW(0,sessionId,WTSSessionInfoEx,out var buffer,out var bytes))throw Unavailable();
        try
        {
            if(buffer==0||bytes<Marshal.SizeOf<WtsInfoEx>())throw Unavailable();
            var info=Marshal.PtrToStructure<WtsInfoEx>(buffer);
            if(info.Level!=1||info.Data.SessionId!=(uint)sessionId)throw Unavailable();
            return info.Data;
        }
        finally{if(buffer!=0)WTSFreeMemory(buffer);}
    }
    public static object ProbeSessionState()
    {
        using var process=Process.GetCurrentProcess();var state=SessionState(process.SessionId);
        return new{sessionId=state.SessionId,connectionState=state.SessionState,sessionFlags=state.SessionFlags,unlocked=state.SessionFlags==1,structureBytes=Marshal.SizeOf<WtsInfoEx>()};
    }
    // Diagnostic probe only. Session lock state is not an operation policy.
    private static void EnsureProbeDesktop()
    {
        using var process=Process.GetCurrentProcess();
        if(process.SessionId==0||!Environment.UserInteractive||!string.Equals(Name(GetProcessWindowStation()),"WinSta0",StringComparison.OrdinalIgnoreCase))throw Unavailable();
        // WTSActive is a connection state, not an unlock state. A locked
        // console can stay connected; explicitly require WTS_SESSIONSTATE_UNLOCK.
        var state=SessionState(process.SessionId);
        if(state.SessionState!=0||state.SessionFlags!=1)throw Unavailable();
        var input=OpenInputDesktop(0,false,1);
        if(input==0)throw Unavailable();
        try{if(!string.Equals(Name(input),Name(GetThreadDesktop(GetCurrentThreadId())),StringComparison.Ordinal))throw Unavailable();}
        finally{CloseDesktop(input);}
    }
    // Never calls SwitchDesktop: only this disposable probe thread is reassigned.
    public static object ProbeIsolation()
    {
        EnsureProbeDesktop();Exception? failure=null;bool rejected=false,restored=false;
        var thread=new Thread(()=>{
            var previous=GetThreadDesktop(GetCurrentThreadId());
            var isolated=CreateDesktopW("StockLoomProbe-"+Guid.NewGuid().ToString("N"),0,0,0,0x83,0);
            if(isolated==0){failure=new DesktopException("ACCESS_DENIED","Could not create the private probe desktop.");return;}
            try
            {
                if(!SetThreadDesktop(isolated))throw new DesktopException("ACCESS_DENIED","Could not assign the private probe desktop.");
                try{EnsureProbeDesktop();}catch(DesktopException error) when(error.Code=="DESKTOP_UNAVAILABLE"){rejected=true;}
            }
            catch(Exception error){failure=error;}
            finally{restored=SetThreadDesktop(previous);CloseDesktop(isolated);}
        });
        thread.Start();thread.Join();if(failure is not null)throw failure;
        if(!rejected||!restored)throw new Exception("Private desktop isolation check failed.");
        EnsureProbeDesktop();return new{passed=true,activeDesktop=true,privateDesktopRejected=rejected,threadDesktopRestored=restored,visibleDesktopUnchanged=true};
    }
}
