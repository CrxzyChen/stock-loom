using System.Runtime.InteropServices;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;
using Windows.Graphics.Imaging;
using Windows.Storage.Streams;
using WinRT;

namespace StockLoom.ComputerUse;

internal sealed record CapturedWindow(int Width,int Height,string MimeType,string Data);
internal static class WindowCapture
{
    [ComImport,Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ICaptureInterop
    {
        nint CreateForWindow(nint window,ref Guid iid);
        nint CreateForMonitor(nint monitor,ref Guid iid);
    }
    [DllImport("combase.dll",CharSet=CharSet.Unicode)] private static extern int WindowsCreateString(string value,int length,out nint handle);
    [DllImport("combase.dll")] private static extern int WindowsDeleteString(nint handle);
    [DllImport("combase.dll")] private static extern int RoGetActivationFactory(nint name,ref Guid iid,out nint factory);
    [DllImport("d3d11.dll")] private static extern int D3D11CreateDevice(nint adapter,int driverType,nint software,uint flags,nint levels,uint levelCount,uint sdkVersion,out nint device,out int selectedLevel,out nint context);
    [DllImport("d3d11.dll")] private static extern int CreateDirect3D11DeviceFromDXGIDevice(nint device,out nint result);
    [DllImport("user32.dll")] private static extern bool IsIconic(nint window);

    private static GraphicsCaptureItem CreateItem(nint window)
    {
        const string name="Windows.Graphics.Capture.GraphicsCaptureItem";
        Marshal.ThrowExceptionForHR(WindowsCreateString(name,name.Length,out var hstring));
        nint factory=0,item=0;
        try
        {
            var iid=typeof(ICaptureInterop).GUID;Marshal.ThrowExceptionForHR(RoGetActivationFactory(hstring,ref iid,out factory));
            var interop=(ICaptureInterop)Marshal.GetObjectForIUnknown(factory);
            try{var itemId=new Guid("79C3F95B-31F7-4EC2-A464-632EF5D30760");item=interop.CreateForWindow(window,ref itemId);return MarshalInterface<GraphicsCaptureItem>.FromAbi(item);}
            finally{Marshal.ReleaseComObject(interop);}
        }
        finally{if(item!=0)Marshal.Release(item);if(factory!=0)Marshal.Release(factory);WindowsDeleteString(hstring);}
    }
    private static IDirect3DDevice CreateDevice()
    {
        nint native=0,context=0,dxgi=0,wrapped=0;
        try
        {
            Marshal.ThrowExceptionForHR(D3D11CreateDevice(0,1,0,0x20,0,0,7,out native,out _,out context));
            var iid=new Guid("54ec77fa-1377-44e6-8c32-88fd5f44c84c");Marshal.ThrowExceptionForHR(Marshal.QueryInterface(native,in iid,out dxgi));
            Marshal.ThrowExceptionForHR(CreateDirect3D11DeviceFromDXGIDevice(dxgi,out wrapped));
            return MarshalInterface<IDirect3DDevice>.FromAbi(wrapped);
        }
        finally{foreach(var pointer in new[]{wrapped,dxgi,context,native})if(pointer!=0)Marshal.Release(pointer);}
    }
    public static async Task<CapturedWindow> Capture(WindowRef window,CancellationToken cancellationToken)
    {
        DesktopObservation.Validate(window);
        if(IsIconic((nint)window.Handle)||!GraphicsCaptureSession.IsSupported())throw new DesktopException("CAPTURE_UNAVAILABLE","Restore the window before capturing.");
        var item=CreateItem((nint)window.Handle);
        if(item.Size.Width<=0||item.Size.Height<=0||(long)item.Size.Width*item.Size.Height>32_000_000)throw new DesktopException("CAPTURE_UNAVAILABLE","Window capture dimensions are unsupported.");
        using var device=CreateDevice();
        using var pool=Direct3D11CaptureFramePool.CreateFreeThreaded(device,DirectXPixelFormat.B8G8R8A8UIntNormalized,1,item.Size);
        using var session=pool.CreateCaptureSession(item);
        session.IsCursorCaptureEnabled=false;
        var ready=new TaskCompletionSource<Direct3D11CaptureFrame>(TaskCreationOptions.RunContinuationsAsynchronously);
        pool.FrameArrived+=(sender,_)=>{try{var frame=sender.TryGetNextFrame();if(frame!=null&&!ready.TrySetResult(frame))frame.Dispose();}catch(Exception e){ready.TrySetException(e);}};
        session.StartCapture();
        using var deadline=CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);deadline.CancelAfter(TimeSpan.FromSeconds(5));
        using var registration=deadline.Token.Register(()=>ready.TrySetCanceled(deadline.Token));
        using var captured=await ready.Task;
        using var bitmap=await SoftwareBitmap.CreateCopyFromSurfaceAsync(captured.Surface).AsTask(deadline.Token);
        using var stream=new InMemoryRandomAccessStream();
        var encoder=await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId,stream).AsTask(deadline.Token);
        encoder.SetSoftwareBitmap(bitmap);await encoder.FlushAsync().AsTask(deadline.Token);
        if(stream.Size>8*1024*1024)throw new DesktopException("OUTPUT_LIMIT","Window image exceeds 8 MiB.");
        stream.Seek(0);using var reader=new DataReader(stream.GetInputStreamAt(0));await reader.LoadAsync((uint)stream.Size).AsTask(deadline.Token);
        var bytes=new byte[(int)stream.Size];reader.ReadBytes(bytes);
        DesktopObservation.Validate(window);
        return new CapturedWindow(bitmap.PixelWidth,bitmap.PixelHeight,"image/png",Convert.ToBase64String(bytes));
    }
}
