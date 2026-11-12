/* ==========================================================================
   净界 JingJie —— 原生外壳（WinForms + WebView2）
   职责：
     1. 隐蔽启动内置 Node 服务（app\server\server.js），读取它打印的 READY 行拿到端口；
     2. 打开 WebView2 指向 http://127.0.0.1:<port>/，呈现网页界面；
     3. 无边框窗口：自绘标题栏拖动、双击最大化、边缘拖拽缩放、最小化/关闭；
     4. 退出时结束子进程，确保不留僵尸 node。
   编译：csc /target:winexe /platform:x64 ... （见 build.ps1）
   ========================================================================== */
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace JingJie
{
    static class Program
    {
        public static string ExeDir;
        public static string LogPath;
        static System.Threading.Mutex _mutex;

        [DllImport("user32.dll")] static extern IntPtr FindWindow(string cls, string name);
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);

        /* 提权重启前把互斥体让出来，否则新进程会被当成“已有实例”直接退出 */
        internal static void ReleaseSingleInstance()
        {
            try
            {
                if (_mutex != null) { _mutex.ReleaseMutex(); _mutex.Dispose(); _mutex = null; }
            }
            catch (Exception) { }
        }

        internal static void AcquireSingleInstance()
        {
            try
            {
                bool isNew;
                _mutex = new System.Threading.Mutex(true, "JingJieSingleInstance_" + Environment.UserName, out isNew);
            }
            catch (Exception) { }
        }

        /* 已有实例在跑：把它的窗口叫到最前面 */
        static void ActivateExisting()
        {
            IntPtr h = FindWindow(null, "净界 · 系统清理与优化");
            if (h != IntPtr.Zero)
            {
                ShowWindow(h, 9);      /* SW_RESTORE */
                SetForegroundWindow(h);
            }
        }

        [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);

        [STAThread]
        static void Main()
        {
            /* 先设 DPI 感知（Per-Monitor V2），再建任何窗口，避免界面发虚 */
            try { SetProcessDpiAwarenessContext(new IntPtr(-4)); }
            catch (Exception) { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            ExeDir = Path.GetDirectoryName(Application.ExecutablePath);
            LogPath = Path.Combine(DataRoot(), "jingjie.log");

            /* 单实例：已经有窗口在前台就把它叫出来，避免重复启动 */
            bool isNew;
            _mutex = new System.Threading.Mutex(true, "JingJieSingleInstance_" + Environment.UserName, out isNew);
            if (!isNew)
            {
                ActivateExisting();
                return;
            }
            AppDomain.CurrentDomain.UnhandledException += delegate(object s, UnhandledExceptionEventArgs e)
            {
                Log("UNHANDLED " + (e.ExceptionObject as Exception));
            };
            Application.ThreadException += delegate(object s, System.Threading.ThreadExceptionEventArgs e)
            {
                Log("THREAD " + e.Exception);
            };

            try { Application.Run(new MainForm()); }
            catch (Exception ex)
            {
                Log("FATAL " + ex);
                MessageBox.Show("净界启动失败：\n\n" + ex.Message, "净界", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        /// <summary>数据根目录：优先程序目录（绿色版），不可写时回退到 %LOCALAPPDATA%\JingJie。</summary>
        public static string DataRoot()
        {
            string a = Path.Combine(ExeDir ?? ".", "data");
            if (TryWritable(a)) return a;
            string b = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "JingJie");
            if (TryWritable(b)) return b;
            return Path.Combine(Path.GetTempPath(), "JingJie");
        }

        static bool TryWritable(string dir)
        {
            try
            {
                Directory.CreateDirectory(dir);
                string probe = Path.Combine(dir, ".w" + Guid.NewGuid().ToString("N") + ".tmp");
                File.WriteAllText(probe, "x");
                File.Delete(probe);
                return true;
            }
            catch (Exception) { return false; }
        }

        public static void Log(string msg)
        {
            try
            {
                string line = DateTime.Now.ToString("HH:mm:ss.fff") + "  " + msg + Environment.NewLine;
                File.AppendAllText(LogPath, line, Encoding.UTF8);
            }
            catch (Exception) { }
        }

        /// <summary>读 data\settings.json 里的主题，决定启动时的底色（避免先深后浅闪一下）。</summary>
        public static bool IsLightTheme()
        {
            try
            {
                string f = Path.Combine(DataRoot(), "settings.json");
                if (!File.Exists(f)) return false;
                string s = File.ReadAllText(f, Encoding.UTF8);
                Match m = Regex.Match(s, "\"theme\"\\s*:\\s*\"(light|dark)\"");
                return m.Success && m.Groups[1].Value == "light";
            }
            catch (Exception) { return false; }
        }
    }

    public class MainForm : Form
    {
        /* ---- Win32 ---- */
        const int WM_NCHITTEST = 0x0084;
        const int WM_GETMINMAXINFO = 0x0024;
        const int WM_EXITSIZEMOVE = 0x0232;
        const int WM_NCCALCSIZE = 0x0083;
    const int WM_ENTERSIZEMOVE = 0x0231;
        const int HTCLIENT = 1, HTCAPTION = 2, HTLEFT = 10, HTRIGHT = 11, HTTOP = 12, HTTOPLEFT = 13,
                  HTTOPRIGHT = 14, HTBOTTOM = 15, HTBOTTOMLEFT = 16, HTBOTTOMRIGHT = 17;
        const int DWMWA_WINDOW_CORNER_PREFERENCE = 33, DWMWA_USE_IMMERSIVE_DARK_MODE = 20;

        [DllImport("user32.dll")] static extern bool ReleaseCapture();
        [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
        [DllImport("user32.dll")] static extern int GetSystemMetrics(int idx);
        [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr hwnd);

        WebView2 web;
        Panel splash;
        Label splashText;
        Process nodeProc;
        NotifyIcon tray;
        bool rzActive; string rzEdge = "e"; Rectangle rzStartRect;
        Rectangle unsnappedBounds;   /* 吸附前的窗口大小，拖离边缘时还原 */
        bool snapped;
        bool exiting;
        bool trayHintShown;
        readonly bool lightTheme;
        int port;

        public MainForm()
        {
            Text = "净界 · 系统清理与优化";
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            lightTheme = Program.IsLightTheme();
            BackColor = lightTheme ? Color.FromArgb(242, 245, 250) : Color.FromArgb(8, 11, 18);
            DoubleBuffered = true;
            AutoScaleMode = AutoScaleMode.None;

            Rectangle wa = Screen.PrimaryScreen.WorkingArea;
            /* 先按 96 DPI 估个尺寸，真正的尺寸在 OnHandleCreated 里用 DeviceDpi 换算 */
            ClientSize = new Size(Math.Min(1280, (int)(wa.Width * 0.92)), Math.Min(840, (int)(wa.Height * 0.92)));
            MinimumSize = new Size(700, 520);
            Padding = new Padding(0);

            splash = new Panel();
            splash.Dock = DockStyle.Fill;
            splash.BackColor = lightTheme ? Color.FromArgb(242, 245, 250) : Color.FromArgb(8, 11, 18);
            splashText = new Label();
            splashText.Dock = DockStyle.Fill;
            splashText.TextAlign = ContentAlignment.MiddleCenter;
            splashText.ForeColor = lightTheme ? Color.FromArgb(71, 84, 103) : Color.FromArgb(150, 165, 190);
            splashText.Font = new Font("Microsoft YaHei UI", 11f);
            splashText.Text = "净界正在启动…";
            splash.Controls.Add(splashText);
            Controls.Add(splash);
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            RoundedCorners();
        }

        protected override void OnLoad(EventArgs e)
        {
            /* 记录一个“正常尺寸”基准，拖离吸附边缘时还原到这里 */

            base.OnLoad(e);
            if (!_sized)
            {
                _sized = true;
                /* 这里用 GetDpiForWindow 取真实 DPI（Per-Monitor V2），按逻辑像素换算一次 */
                uint dpi = 96;
                try { dpi = GetDpiForWindow(Handle); } catch (Exception) { }
                if (dpi < 72) dpi = 96;
                float k = dpi / 96f;
                Program.Log("hwd dpi=" + dpi + " k=" + k);
                Rectangle wa = Screen.FromHandle(Handle).WorkingArea;
                int w = Math.Min((int)(1280 * k), (int)(wa.Width * 0.94));
                int h = Math.Min((int)(840 * k), (int)(wa.Height * 0.94));
                ClientSize = new Size(w, h);
                MinimumSize = new Size((int)(700 * k), (int)(520 * k));
                /* 初始尺寸就是“正常尺寸”基准，之后拖离吸附边缘还原到这里 */
                unsnappedBounds = new Rectangle(Left, Top, Width, Height);
                Program.Log("client=" + ClientSize.Width + "x" + ClientSize.Height);
            }
        }

        bool _sized;

        void RoundedCorners()
        {
            try
            {
                int round = 2, dark = 1;
                DwmSetWindowAttribute(Handle, DWMWA_WINDOW_CORNER_PREFERENCE, ref round, 4);
                DwmSetWindowAttribute(Handle, DWMWA_USE_IMMERSIVE_DARK_MODE, ref dark, 4);
            }
            catch (Exception) { }
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ClassStyle |= 0x20000; /* CS_DROPSHADOW */
                /* 无边框窗口也要带上可缩放/最大化样式，否则拖边缘不会触发系统缩放 */
                cp.Style |= 0x00040000 | 0x00020000 | 0x00010000 | 0x00080000;
                return cp;
            }
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            SetupTray();
            BootAsync();
        }

        /* ------------------------------------------------------------------ */
        async void BootAsync()
        {
            try
            {
                splashText.Text = "正在启动本地引擎…";
                int p = await StartServer();
                port = p;
                Program.Log("server ready on " + p);

                splashText.Text = "正在加载界面…";
                string udf = Path.Combine(Program.DataRoot(), "webview");
                web = new WebView2();
                web.Dock = DockStyle.Fill;
                web.BackColor = lightTheme ? Color.FromArgb(242, 245, 250) : Color.FromArgb(8, 11, 18);
                web.CreationProperties = new CoreWebView2CreationProperties { UserDataFolder = udf };
                Controls.Add(web);
                web.BringToFront();

                await web.EnsureCoreWebView2Async(null);
                CoreWebView2 c = web.CoreWebView2;
                try { web.DefaultBackgroundColor = lightTheme ? Color.FromArgb(242, 245, 250) : Color.FromArgb(8, 11, 18); } catch (Exception) { }
                c.Settings.AreDefaultContextMenusEnabled = false;
                c.Settings.IsStatusBarEnabled = false;
                c.Settings.AreDevToolsEnabled = false;
                c.Settings.IsZoomControlEnabled = false;
                c.Settings.IsPasswordAutosaveEnabled = false;
                c.Settings.IsGeneralAutofillEnabled = false;
                c.WebMessageReceived += OnWebMessage;

                c.Navigate("http://127.0.0.1:" + p + "/");
                Program.Log("navigate ok");
            }
            catch (Exception ex)
            {
                Program.Log("BOOT FAIL " + ex);
                ShowError(ex);
            }
        }

        void ShowError(Exception ex)
        {
            string hint;
            string msg = ex.Message;
            if (msg.IndexOf("WebView2", StringComparison.OrdinalIgnoreCase) >= 0 ||
                msg.IndexOf("0x8007", StringComparison.OrdinalIgnoreCase) >= 0)
                hint = "本程序需要 Microsoft Edge WebView2 运行时。\n请安装后重试：https://go.microsoft.com/fwlink/p/?LinkId=2124703";
            else if (msg.IndexOf("node", StringComparison.OrdinalIgnoreCase) >= 0)
                hint = "未能启动内置 Node 引擎，请确认程序目录完整（runtime\\node.exe 与 app\\server 均在）。";
            else hint = "请查看日志：" + Program.LogPath;

            if (splash != null && !splash.IsDisposed)
            {
                splashText.Font = new Font("Microsoft YaHei UI", 10f);
                splashText.Text = "启动失败\n\n" + msg + "\n\n" + hint;
                splashText.ForeColor = Color.FromArgb(240, 120, 140);
                splash.BringToFront();
            }
        }

        /// <summary>启动 Node 服务并解析 READY 行里的端口。</summary>
        Task<int> StartServer()
        {
            TaskCompletionSource<int> tcs = new TaskCompletionSource<int>();
            string serverJs = Path.Combine(Program.ExeDir, "app", "server", "server.js");
            if (!File.Exists(serverJs))
                throw new FileNotFoundException("缺少 app\\server\\server.js");

            string nodeExe = Path.Combine(Program.ExeDir, "runtime", "node.exe");
            if (!File.Exists(nodeExe)) nodeExe = "node.exe";

            ProcessStartInfo psi = new ProcessStartInfo(nodeExe, "\"" + serverJs + "\"");
            psi.WorkingDirectory = Program.ExeDir;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            try { psi.EnvironmentVariables["JJ_PORT"] = "0"; } catch (Exception) { }

            nodeProc = new Process();
            nodeProc.StartInfo = psi;
            nodeProc.EnableRaisingEvents = true;

            nodeProc.OutputDataReceived += delegate(object s, DataReceivedEventArgs ev)
            {
                if (ev.Data == null) return;
                Program.Log("node> " + ev.Data);
                if (ev.Data.StartsWith("READY"))
                {
                    Match m = Regex.Match(ev.Data, "\"port\"\\s*:\\s*(\\d+)");
                    if (m.Success) tcs.TrySetResult(int.Parse(m.Groups[1].Value));
                }
            };
            nodeProc.ErrorDataReceived += delegate(object s, DataReceivedEventArgs ev)
            {
                if (ev.Data != null) Program.Log("node! " + ev.Data);
            };
            nodeProc.Exited += delegate
            {
                tcs.TrySetException(new Exception("Node 引擎意外退出（代码 " + nodeProc.ExitCode + "），详见日志。"));
            };

            nodeProc.Start();
            nodeProc.BeginOutputReadLine();
            nodeProc.BeginErrorReadLine();

            Task.Delay(25000).ContinueWith(delegate
            {
                tcs.TrySetException(new TimeoutException("本地服务启动超时（25 秒）。"));
            });
            return tcs.Task;
        }

        void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string json = e.WebMessageAsJson ?? "";
            Match m = Regex.Match(json, "\"cmd\"\\s*:\\s*\"([a-zA-Z]+)\"");
            if (!m.Success) return;
            string cmd = m.Groups[1].Value;
            try
            {
                if (cmd == "min") WindowState = FormWindowState.Minimized;
                else if (cmd == "max")
                    WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
                else if (cmd == "close") HideToTray();
                else if (cmd == "exit") { exiting = true; Close(); }
                else if (cmd == "elevate") ElevateAndRestart();
                else if (cmd == "openurl")
                {
                    Match mu = Regex.Match(json, "\"url\"\\s*:\\s*\"([^\"]+)\"");
                    if (mu.Success) OpenUrl(mu.Groups[1].Value);
                }
                else if (cmd == "rzStart")
                {
                    Match me = Regex.Match(json, "\"edge\"\\s*:\\s*\"([a-z]+)\"");
                    rzEdge = me.Success ? me.Groups[1].Value : "e";
                    rzStartRect = Bounds;
                    rzActive = true;
                    Program.Log("rz start " + rzEdge + " " + rzStartRect.Width + "x" + rzStartRect.Height);
                }
                else if (cmd == "rzMove" && rzActive)
                {
                    Match mx = Regex.Match(json, "\"dx\"\\s*:\\s*(-?\\d+)");
                    Match my = Regex.Match(json, "\"dy\"\\s*:\\s*(-?\\d+)");
                    int dx = mx.Success ? int.Parse(mx.Groups[1].Value) : 0;
                    int dy = my.Success ? int.Parse(my.Groups[1].Value) : 0;
                    ApplyResize(dx, dy);
                }
                else if (cmd == "rzEnd")
                {
                    Program.Log("rz end " + Bounds.Width + "x" + Bounds.Height);
                    rzActive = false;   /* 手动改尺寸后不吸附，避免刚拖完就被吸到边上 */
                }
                else if (cmd == "drag")
                {
                    /* 如果当前是吸附状态，先还原成正常尺寸，再进入系统的拖动循环；
                       在 WM_ENTERSIZEMOVE 里改大小会被系统拖动循环覆盖掉，所以必须在这里做 */
                    if (snapped) UnsnapForDrag();
                    ReleaseCapture();
                    SendMessage(Handle, 0xA1, (IntPtr)HTCAPTION, IntPtr.Zero);
                }
            }
            catch (Exception ex) { Program.Log("msg " + cmd + " failed: " + ex.Message); }
        }

        /* ---- 以管理员身份重启（方案 B：按需提权，点一次弹一次 UAC） ---- */
        /* 用默认浏览器打开链接（比 explorer.exe 传 URL 稳） */
        void OpenUrl(string url)
        {
            try
            {
                if (!Regex.IsMatch(url, "^https?://")) return;
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
                Program.Log("openurl " + url);
            }
            catch (Exception ex) { Program.Log("openurl failed: " + ex.Message); }
        }

        void ElevateAndRestart()
        {
            try
            {
                string exe = Application.ExecutablePath;
                ProcessStartInfo psi = new ProcessStartInfo(exe);
                psi.UseShellExecute = true;
                psi.Verb = "runas";
                psi.WorkingDirectory = Path.GetDirectoryName(exe);
                Program.ReleaseSingleInstance();
                try
                {
                    Process.Start(psi);
                }
                catch
                {
                    Program.AcquireSingleInstance();   /* 用户点了「否」，把单实例锁拿回来 */
                    throw;
                }
                exiting = true;
                Close();
            }
            catch (Exception ex)
            {
                Program.Log("elevate failed: " + ex.Message);
                MessageBox.Show("获取管理员权限失败：\n\n" + ex.Message, "净界", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        /* ---- 无边框缩放 ---- */
        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_NCCALCSIZE && m.WParam != IntPtr.Zero)
            {
                m.Result = IntPtr.Zero;   /* 客户区 = 整个窗口，边框不占位 */
                return;
            }
            if (m.Msg == WM_NCHITTEST && WindowState == FormWindowState.Normal)
            {
                base.WndProc(ref m);
                if ((int)m.Result != HTCLIENT) return;
                Point p = PointToClient(new Point(m.LParam.ToInt32() & 0xFFFF, (m.LParam.ToInt32() >> 16) & 0xFFFF));
                int b = (int)(6 * (DeviceDpi / 96.0));
                bool l = p.X <= b, r = p.X >= ClientSize.Width - b, t = p.Y <= b, bo = p.Y >= ClientSize.Height - b;
                int hit = 0;
                if (t && l) hit = HTTOPLEFT;
                else if (t && r) hit = HTTOPRIGHT;
                else if (bo && l) hit = HTBOTTOMLEFT;
                else if (bo && r) hit = HTBOTTOMRIGHT;
                else if (l) hit = HTLEFT;
                else if (r) hit = HTRIGHT;
                else if (t) hit = HTTOP;
                else if (bo) hit = HTBOTTOM;
                if (hit != 0) { m.Result = (IntPtr)hit; return; }
                return;
            }
            if (m.Msg == WM_EXITSIZEMOVE && WindowState == FormWindowState.Normal)
            {
                base.WndProc(ref m);
                try { SnapToEdge(); } catch (Exception) { }
                return;
            }
            base.WndProc(ref m);
        }

        /// <summary>按鼠标位移调整窗口大小（八个方向），并遵守最小尺寸。</summary>
        void ApplyResize(int dx, int dy)
        {
            Rectangle r = rzStartRect;
            double k = DeviceDpi / 96.0;
            int minW = (int)(700 * k), minH = (int)(520 * k);
            if (rzEdge.IndexOf('e') >= 0) r.Width = rzStartRect.Width + dx;
            if (rzEdge.IndexOf('w') >= 0) { r.X = rzStartRect.X + dx; r.Width = rzStartRect.Width - dx; }
            if (rzEdge.IndexOf('s') >= 0) r.Height = rzStartRect.Height + dy;
            if (rzEdge.IndexOf('n') >= 0) { r.Y = rzStartRect.Y + dy; r.Height = rzStartRect.Height - dy; }
            if (r.Width < minW) { if (rzEdge.IndexOf('w') >= 0) r.X = rzStartRect.Right - minW; r.Width = minW; }
            if (r.Height < minH) { if (rzEdge.IndexOf('n') >= 0) r.Y = rzStartRect.Bottom - minH; r.Height = minH; }
            snapped = false;
            Bounds = r;
        }

        /// <summary>从吸附状态开始拖动时，先还原成正常尺寸，并让鼠标仍落在窗口顶部。</summary>
        void UnsnapForDrag()
        {
            Point cur = Cursor.Position;
            Rectangle b = Bounds;
            Rectangle wa = Screen.FromHandle(Handle).WorkingArea;
            int w = unsnappedBounds.Width > 0 ? unsnappedBounds.Width : b.Width;
            int h = unsnappedBounds.Height > 0 ? unsnappedBounds.Height : b.Height;
            if (w > wa.Width) w = wa.Width;
            if (h > wa.Height) h = wa.Height;
            double rx = b.Width > 0 ? (cur.X - b.Left) / (double)b.Width : 0.5;
            if (rx < 0.08) rx = 0.08;
            if (rx > 0.92) rx = 0.92;
            int left = cur.X - (int)(w * rx);
            int top = cur.Y - (int)(40 * (DeviceDpi / 96.0));
            if (left < wa.Left) left = wa.Left;
            if (left + w > wa.Right) left = wa.Right - w;
            if (top < wa.Top) top = wa.Top;
            if (top + h > wa.Bottom) top = wa.Bottom - h;
            snapped = false;
            Bounds = new Rectangle(left, top, w, h);
            Program.Log("unsnap " + left + "," + top + " " + w + "x" + h);
        }

        /// <summary>拖到屏幕左/右/上边缘时，自动铺满左半边 / 右半边 / 最大化。</summary>
        void SnapToEdge()
        {
            Rectangle wa = Screen.FromHandle(Handle).WorkingArea;
            Rectangle b = Bounds;
            int tol = (int)(12 * (DeviceDpi / 96.0));
            /* 已经差不多占满整屏时不再处理，避免和最大化打架 */
            if (b.Width <= 0 || b.Height <= 0) return;
            if (b.Width >= wa.Width - tol && b.Height >= wa.Height - tol) { snapped = false; return; }
            Program.Log("exitmove " + b.Left + "," + b.Top + " " + b.Width + "x" + b.Height + " work=" + wa.Width + "x" + wa.Height);
            int halfW = wa.Width / 2;
            Rectangle before = b;
            if (b.Left <= wa.Left + tol && b.Width < wa.Width - 40)
            {
                if (before.Width > halfW + 40) unsnappedBounds = before;
                snapped = true;
                Bounds = new Rectangle(wa.Left, wa.Top, halfW, wa.Height);
                Program.Log("snap left");
            }
            else if (b.Right >= wa.Right - tol && b.Width < wa.Width - 40)
            {
                if (before.Width > halfW + 40) unsnappedBounds = before;
                snapped = true;
                Bounds = new Rectangle(wa.Right - halfW, wa.Top, halfW, wa.Height);
                Program.Log("snap right");
            }
            else if (b.Top <= wa.Top + tol && b.Height < wa.Height - tol)
            {
                if (!snapped && before.Width > wa.Width / 2 + 40) unsnappedBounds = before;
                snapped = true;
                WindowState = FormWindowState.Maximized;
                Program.Log("snap top -> maximize");
            }
        }

        /* ---- 托盘 ---- */
        void SetupTray()
        {
            try
            {
                tray = new NotifyIcon();
                tray.Text = "净界 · 系统清理与优化";
                try { tray.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
                catch (Exception) { tray.Icon = SystemIcons.Application; }

                ContextMenuStrip menu = new ContextMenuStrip();
                ToolStripMenuItem miOpen = new ToolStripMenuItem("打开净界");
                miOpen.Click += delegate { RestoreFromTray(); };
                ToolStripMenuItem miExit = new ToolStripMenuItem("退出");
                miExit.Click += delegate { exiting = true; Close(); };
                menu.Items.Add(miOpen);
                menu.Items.Add(new ToolStripSeparator());
                menu.Items.Add(miExit);
                tray.ContextMenuStrip = menu;
                tray.DoubleClick += delegate { RestoreFromTray(); };
                tray.Visible = true;
            }
            catch (Exception ex) { Program.Log("tray init failed: " + ex.Message); }
        }

        void HideToTray()
        {
            if (tray == null) { exiting = true; Close(); return; }
            Hide();
            ShowInTaskbar = false;
            if (!trayHintShown)
            {
                trayHintShown = true;
                try { tray.ShowBalloonTip(2600, "净界仍在运行", "双击托盘图标可以重新打开，右键可退出。", ToolTipIcon.Info); }
                catch (Exception) { }
            }
        }

        void RestoreFromTray()
        {
            ShowInTaskbar = true;
            Show();
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            Activate();
        }

        /* ---- 退出清理 ---- */
        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!exiting && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                HideToTray();
                return;
            }
            if (tray != null) { try { tray.Visible = false; tray.Dispose(); } catch (Exception) { } }
            try
            {
                if (web != null && web.CoreWebView2 != null)
                {
                    /* 知会服务自行退出，随后强杀兜底 */
                    try
                    {
                        web.CoreWebView2.ExecuteScriptAsync("fetch('/shutdown',{method:'POST'}).catch(function(){})");
                    }
                    catch (Exception) { }
                }
                if (nodeProc != null && !nodeProc.HasExited)
                {
                    try
                    {
                        ProcessStartInfo k = new ProcessStartInfo("taskkill.exe", "/PID " + nodeProc.Id + " /T /F");
                        k.UseShellExecute = false;
                        k.CreateNoWindow = true;
                        k.RedirectStandardOutput = true;
                        k.RedirectStandardError = true;
                        Process.Start(k);
                    }
                    catch (Exception) { try { nodeProc.Kill(); } catch (Exception) { } }
                }
            }
            catch (Exception ex) { Program.Log("close cleanup " + ex.Message); }
            base.OnFormClosing(e);
        }
    }
}
