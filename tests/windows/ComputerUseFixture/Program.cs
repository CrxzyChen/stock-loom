namespace StockLoom.ComputerUseFixture;

static class Program
{
    [System.Runtime.InteropServices.DllImport("user32.dll",CharSet=System.Runtime.InteropServices.CharSet.Ansi,ExactSpelling=true)]
    private static extern nint CreateWindowExA(uint exStyle,string className,string text,uint style,int x,int y,int width,int height,nint parent,nint menu,nint instance,nint param);
    [System.Runtime.InteropServices.DllImport("user32.dll",CharSet=System.Runtime.InteropServices.CharSet.Unicode)]
    private static extern int GetWindowTextW(nint window,System.Text.StringBuilder text,int count);
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int key);
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern nint GetForegroundWindow();
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(nint window,out uint processId);
    private sealed class SuggestionPopup:Form
    {
        protected override bool ShowWithoutActivation=>true;
        protected override CreateParams CreateParams{get{var p=base.CreateParams;p.ExStyle|=0x08000000;return p;}}
    }
    [STAThread]
    static void Main(string[] args)
    {
        if(args.Length==2&&args[0]=="--hold-input-lock")
        {
            using var inputLock=new Mutex(false,"Local\\StockLoomDesktopInput-v1");
            if(!inputLock.WaitOne(TimeSpan.FromSeconds(5)))return;
            try{File.WriteAllText(args[1],"ready");Thread.Sleep(15000);}finally{inputLock.ReleaseMutex();}
            return;
        }
        ApplicationConfiguration.Initialize();
        using var form=new Form{Text="Stock Loom Computer Use Test",Width=620,Height=600,StartPosition=FormStartPosition.CenterScreen};
        var input=new TextBox{Name="ResearchInput",AccessibleName="研究笔记",Multiline=true,Left=20,Top=20,Width=560,Height=100};
        var apply=new Button{Name="ApplyButton",AccessibleName="确认笔记",Text="确认笔记",Left=20,Top=140,Width=120,Height=36};
        var result=new Label{Name="ResultLabel",AccessibleName="结果",Text="尚未确认",Left=20,Top=200,Width=560,Height=40};
        apply.Click+=(_,_)=>{result.Text="已确认："+input.Text;result.AccessibleName=result.Text;};
        if(args.Length==2&&args[0]=="--input-trace")
        {
            void Trace(string kind){var foreground=GetForegroundWindow();GetWindowThreadProcessId(foreground,out var foregroundPid);File.AppendAllText(args[1],System.Text.Json.JsonSerializer.Serialize(new{at=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),kind,inputLength=input.Text.Length,confirmed=result.Text.StartsWith("已确认："),active=Form.ActiveForm==form,foregroundPid,fixturePid=Environment.ProcessId,foregroundIsFixture=foreground==form.Handle})+Environment.NewLine);}
            apply.MouseDown+=(_,_)=>Trace("apply.down");
            apply.MouseUp+=(_,_)=>Trace("apply.up");
            apply.Click+=(_,_)=>Trace("apply.click");
            input.TextChanged+=(_,_)=>Trace("input.changed");
            form.Activated+=(_,_)=>Trace("activated");
            form.Deactivate+=(_,_)=>Trace("deactivated");
        }
        form.Controls.AddRange([input,apply,result]);
        if(args.Length==2&&args[0]=="--slow-text")
            input.TextChanged+=(_,_)=>{File.WriteAllText(args[1],input.Text.Length.ToString());Thread.Sleep(20);};
        var canvas=new Panel{Name="DragSurface",AccessibleName="拖拽测试区域",Left=20,Top=250,Width=560,Height=100,BackColor=Color.DarkSlateBlue};
        var dragResult=new Label{Name="DragResult",Text="尚未拖拽",AccessibleName="尚未拖拽",Left=20,Top=370,Width=560,Height=30};
        Point? start=null;
        canvas.MouseDown+=(_,e)=>{if(e.Button==MouseButtons.Left){start=e.Location;canvas.Capture=true;}};
        canvas.MouseUp+=(_,e)=>{if(start is {} origin){dragResult.Text=$"拖拽完成：{e.X-origin.X},{e.Y-origin.Y}";dragResult.AccessibleName=dragResult.Text;start=null;canvas.Capture=false;}};
        form.Controls.AddRange([canvas,dragResult]);
        if(args.Length==2&&args[0]=="--input-release")
        {
            var marker=args[1];
            void Down(string kind){File.WriteAllText(marker+"."+kind+".down","received");Thread.Sleep(300);}
            void Up(string kind)=>File.WriteAllText(marker+"."+kind+".up","received");
            canvas.MouseDown+=(_,e)=>{if(e.Button==MouseButtons.Left)Down("drag");};
            canvas.MouseUp+=(_,e)=>{if(e.Button==MouseButtons.Left)Up("drag");};
            input.KeyDown+=(_,e)=>{if(e.KeyCode==Keys.A&&e.Control&&e.Shift)Down("chord");};
            input.KeyUp+=(_,e)=>{if(e.KeyCode==Keys.A)Up("chord");};
            var releaseTimer=new System.Windows.Forms.Timer{Interval=50};
            releaseTimer.Tick+=(_,_)=>File.WriteAllText(marker+".state",System.Text.Json.JsonSerializer.Serialize(new{left=(GetAsyncKeyState(1)&0x8000)!=0,ctrl=(GetAsyncKeyState(0x11)&0x8000)!=0,shift=(GetAsyncKeyState(0x10)&0x8000)!=0,a=(GetAsyncKeyState(0x41)&0x8000)!=0,capture=canvas.Capture}));
            releaseTimer.Start();form.FormClosed+=(_,_)=>releaseTimer.Dispose();
        }
        var password=new TextBox{Name="PasswordInput",AccessibleName="测试密码",UseSystemPasswordChar=true,Text="fixture-secret",Left=20,Top=410,Width=180};
        var passwordStatus=new Label{Name="PasswordStatus",AccessibleName="unchanged",Text="unchanged",Left=400,Top=410,Width=160};
        password.TextChanged+=(_,_)=>{passwordStatus.Text="changed";passwordStatus.AccessibleName="changed";};
        form.Controls.Add(passwordStatus);
        var move=new Button{Name="MoveWindow",Text="移动测试窗口",Left=220,Top=410,Width=160};
        move.Click+=(_,_)=>form.Left+=30;
        var wheel=new Label{Name="WheelResult",Text="尚未滚动",AccessibleName="尚未滚动",Left=20,Top=450,Width=560};
        input.MouseWheel+=(_,e)=>{wheel.Text=$"滚动：{e.Delta}";wheel.AccessibleName=wheel.Text;};
        form.Controls.AddRange([password,move,wheel]);
        var dpiLabel=new Label{Name="ObservedDpi",Left=20,Top=520,Width=180};
        void ReportDpi(){dpiLabel.Text=form.DeviceDpi.ToString();dpiLabel.AccessibleName=dpiLabel.Text;}
        form.Controls.Add(dpiLabel);form.Shown+=(_,_)=>ReportDpi();form.DpiChanged+=(_,_)=>ReportDpi();
        if(args.Contains("--legacy-controls"))
        {
            nint ansi=0;
            form.Shown+=(_,_)=>ansi=CreateWindowExA(0,"EDIT","",0x50010080,20,485,300,25,form.Handle,4321,0,0);
            var openPopup=new Button{Name="OpenPopup",Text="测试搜索浮层",Left=350,Top=485,Width=170};
            var popup=new SuggestionPopup{Text="",FormBorderStyle=FormBorderStyle.None,ShowInTaskbar=false,Width=260,Height=100,StartPosition=FormStartPosition.Manual};
            var choose=new Button{Name="ChooseResult",Text="选择测试结果",Left=15,Top=15,Width=220,Height=45};
            choose.Click+=(_,_)=>{var text=new System.Text.StringBuilder(256);GetWindowTextW(ansi,text,256);result.Text="Legacy:"+text;result.AccessibleName=result.Text;popup.Hide();};
            popup.Controls.Add(choose);
            openPopup.Click+=(_,_)=>{popup.Location=form.PointToScreen(new Point(330,300));popup.Show(form);};
            form.FormClosed+=(_,_)=>popup.Dispose();form.Controls.Add(openPopup);
        }
        using var focusTarget=new Form{Text="Stock Loom Focus Test",Width=360,Height=180,StartPosition=FormStartPosition.Manual,Left=50,Top=50};
        if(args.Length==2&&args[0] is "--focus-switch" or "--focus-control")
        {
            var otherInput=new TextBox{Name="OtherInput",AccessibleName="焦点切换接收区",Left=20,Top=20,Width=280};
            var sameWindow=args[0]=="--focus-control";
            if(sameWindow){otherInput.Top=485;form.Controls.Add(otherInput);}else focusTarget.Controls.Add(otherInput);
            otherInput.TextChanged+=(_,_)=>File.WriteAllText(args[1]+".other",otherInput.Text.Length.ToString());
            var switched=false;
            input.TextChanged+=(_,_)=>{
                if(switched||input.Text.Length==0)return;
                switched=true;if(!sameWindow){focusTarget.Show();focusTarget.Activate();}otherInput.Focus();
                File.WriteAllText(args[1],"switched");
            };
        }
        if(args.Length==2&&args[0]=="--hang-ready")
        {
            var hang=new Button{Name="HangButton",Text="暂时阻塞测试窗口",Left=20,Top=485,Width=200};
            hang.Click+=(_,_)=>form.BeginInvoke(()=>{File.WriteAllText(args[1],"blocked");Thread.Sleep(15000);result.Text="界面已恢复";result.AccessibleName=result.Text;File.WriteAllText(args[1],"recovered");});
            form.Controls.Add(hang);
        }
        if(args.Length==2&&args[0]=="--dialog-folder")
        {
            var open=new Button{Name="OpenFileButton",Text="选择测试文件",AccessibleName="选择测试文件",Left=20,Top=485,Width=180};
            open.Click+=(_,_)=>form.BeginInvoke(()=>{
                using var dialog=new OpenFileDialog{Title="StockLoom R5 File Dialog",InitialDirectory=Path.GetFullPath(args[1]),Filter="Text files|*.txt",RestoreDirectory=true,AddToRecent=false};
                if(dialog.ShowDialog(form)==DialogResult.OK){result.Text="文件内容："+File.ReadAllText(dialog.FileName);result.AccessibleName=result.Text;}
            });
            form.Controls.Add(open);
        }
        using var reveal=new System.Windows.Forms.Timer{Interval=250};
        reveal.Tick+=(_,_)=>{reveal.Stop();form.Show();form.Activate();};reveal.Start();
        // Test-owned window automatically closes even if the probe crashes.
        using var timer=new System.Windows.Forms.Timer{Interval=180000};timer.Tick+=(_,_)=>form.Close();timer.Start();
        Application.Run(form);
    }
}
