// Paper Toss Installer.
// One window, one button. It installs per-user (no admin needed) to
// %LOCALAPPDATA%\Programs\Paper Toss, adds Start menu and desktop shortcuts,
// and registers an uninstaller in Windows "Installed apps". Once installed it
// deletes itself.
// build-installer.ps1 compiles this file twice: first without the app as the
// small "Uninstall Paper Toss.exe", then with the app (Electron runtime + src,
// as app.zip) and that uninstaller packed inside as the installer.
// Run with /uninstall to remove it again.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Paper Toss Installer")]
[assembly: AssemblyProduct("Paper Toss")]
[assembly: AssemblyDescription("Installs Paper Toss")]

static partial class Installer
{
    const string AppName = "Paper Toss";

    // Where things go. Kept in one place so a self-test can point them somewhere harmless.
    class Targets
    {
        public string Dir, DesktopDir, StartDir, DataDir, RegKey;
        public static Targets Real()
        {
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            Targets t = new Targets();
            t.Dir = Path.Combine(local, "Programs", AppName);
            t.DesktopDir = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            t.StartDir = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
            // Electron keeps settings (the bin skin) under the package name.
            t.DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "paper-toss");
            t.RegKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\PaperToss";
            return t;
        }
        public static Targets Test(string dir)
        {
            Targets t = new Targets();
            t.Dir = Path.Combine(dir, "app");
            t.DesktopDir = Path.Combine(dir, "desktop");
            t.StartDir = Path.Combine(dir, "start");
            t.DataDir = Path.Combine(dir, "data");
            t.RegKey = @"Software\PaperTossInstallerSelfTest";
            return t;
        }
        public string AppExe { get { return Path.Combine(Dir, AppName + ".exe"); } }
        public string Uninstaller { get { return Path.Combine(Dir, "Uninstall " + AppName + ".exe"); } }
        public string DesktopLnk { get { return Path.Combine(DesktopDir, AppName + ".lnk"); } }
        public string StartLnk { get { return Path.Combine(StartDir, AppName + ".lnk"); } }
    }

    static string Self { get { return Assembly.GetExecutingAssembly().Location; } }

    static bool HasApp { get { return Assembly.GetExecutingAssembly().GetManifestResourceInfo("app.zip") != null; } }

    [STAThread]
    static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        if ((args.Length >= 1 && args[0] == "/uninstall") || !HasApp) { Uninstall(Targets.Real(), true); return 0; }
        if (args.Length >= 2 && args[0] == "/selftest") return SelfTest(args[1]);
        Application.Run(new Window());
        return 0;
    }

    // ---------- the actual work ----------
    static void Install(Targets t, Action<int> progress)
    {
        // Start clean so files from an older version don't linger.
        if (Directory.Exists(t.Dir)) Directory.Delete(t.Dir, true);
        Directory.CreateDirectory(t.Dir);

        using (Stream src = Assembly.GetExecutingAssembly().GetManifestResourceStream("app.zip"))
        using (ZipArchive zip = new ZipArchive(src, ZipArchiveMode.Read))
        {
            long total = 0, done = 0;
            foreach (ZipArchiveEntry e in zip.Entries) total += e.Length;
            foreach (ZipArchiveEntry e in zip.Entries)
            {
                string dest = Path.GetFullPath(Path.Combine(t.Dir, e.FullName));
                if (!dest.StartsWith(Path.GetFullPath(t.Dir) + "\\", StringComparison.OrdinalIgnoreCase))
                    continue; // never write outside the install folder
                if (e.FullName.EndsWith("/")) { Directory.CreateDirectory(dest); continue; }
                Directory.CreateDirectory(Path.GetDirectoryName(dest));
                e.ExtractToFile(dest, true);
                done += e.Length;
                if (progress != null) progress((int)(done * 100 / Math.Max(total, 1)));
            }
        }
        using (Stream src = Assembly.GetExecutingAssembly().GetManifestResourceStream("Uninstall.exe"))
        using (FileStream dst = File.Create(t.Uninstaller))
            src.CopyTo(dst);

        MakeShortcut(t.StartLnk, t.AppExe);
        MakeShortcut(t.DesktopLnk, t.AppExe);

        using (RegistryKey k = Registry.CurrentUser.CreateSubKey(t.RegKey))
        {
            k.SetValue("DisplayName", AppName);
            k.SetValue("DisplayVersion", Version);
            k.SetValue("Publisher", AppName);
            k.SetValue("DisplayIcon", t.AppExe + ",0");
            k.SetValue("InstallLocation", t.Dir);
            k.SetValue("UninstallString", "\"" + t.Uninstaller + "\" /uninstall");
            k.SetValue("NoModify", 1, RegistryValueKind.DWord);
            k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            k.SetValue("EstimatedSize", (int)(FolderSize(t.Dir) / 1024), RegistryValueKind.DWord);
        }
    }

    static long FolderSize(string dir)
    {
        long size = 0;
        foreach (string f in Directory.GetFiles(dir, "*", SearchOption.AllDirectories))
            size += new FileInfo(f).Length;
        return size;
    }

    static void MakeShortcut(string lnk, string target)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(lnk));
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        object shell = Activator.CreateInstance(shellType);
        object sc = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnk });
        Type st = sc.GetType();
        st.InvokeMember("TargetPath", BindingFlags.SetProperty, null, sc, new object[] { target });
        st.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, sc, new object[] { Path.GetDirectoryName(target) });
        st.InvokeMember("IconLocation", BindingFlags.SetProperty, null, sc, new object[] { target + ",0" });
        st.InvokeMember("Description", BindingFlags.SetProperty, null, sc, new object[] { "Delete files by throwing them in the bin" });
        st.InvokeMember("Save", BindingFlags.InvokeMethod, null, sc, null);
    }

    // Paper Toss runs as several processes, all from the install folder. Files in
    // use can't be replaced, so they have to go first. Returns false if the user says no.
    static bool CloseRunningApp(Targets t, bool interactive)
    {
        Process[] running = Array.FindAll(Process.GetProcessesByName(AppName), p =>
        {
            try { return SamePath(p.MainModule.FileName, t.AppExe); } catch (Exception) { return false; }
        });
        if (running.Length == 0) return true;
        if (interactive && MessageBox.Show(AppName + " is open. Close it and continue?", AppName,
                MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK)
            return false;
        foreach (Process p in running)
            try { p.Kill(); p.WaitForExit(5000); } catch (Exception) { }
        return true;
    }

    static void Uninstall(Targets t, bool interactive)
    {
        if (interactive && MessageBox.Show("Remove " + AppName + " from this computer?", AppName,
                MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes)
            return;
        if (!CloseRunningApp(t, interactive)) return;
        bool wipeData = interactive && MessageBox.Show(
            "Also delete your settings (like your bin skin)?\n\nChoose No to keep them in case you install " + AppName + " again.",
            AppName, MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) == DialogResult.Yes;

        TryDelete(t.DesktopLnk);
        TryDelete(t.StartLnk);
        if (Directory.Exists(t.Dir))
        {
            foreach (string f in Directory.GetFiles(t.Dir))
                if (!SamePath(f, Self)) TryDelete(f);
            foreach (string d in Directory.GetDirectories(t.Dir))
                try { Directory.Delete(d, true); } catch (Exception) { }
        }
        try { Registry.CurrentUser.DeleteSubKeyTree(t.RegKey, false); } catch (Exception) { }
        if (wipeData) try { Directory.Delete(t.DataDir, true); } catch (Exception) { }

        if (SamePath(Self, t.Uninstaller))
        {
            DeleteSelfLater("rmdir \"" + t.Dir + "\"");
        }
        else
        {
            TryDelete(t.Uninstaller);
            try { Directory.Delete(t.Dir); } catch (Exception) { }
        }
        if (interactive)
            MessageBox.Show(AppName + " was removed.", AppName, MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    // A running program can't delete itself, so a tiny helper removes it a moment
    // after it exits. `then` runs after the delete (or is null).
    static void DeleteSelfLater(string then)
    {
        string cmd = "/c ping 127.0.0.1 -n 3 > nul & del /f /q \"" + Self + "\"";
        if (then != null) cmd += " & " + then;
        ProcessStartInfo psi = new ProcessStartInfo("cmd.exe", cmd);
        psi.CreateNoWindow = true;
        psi.UseShellExecute = false;
        Process.Start(psi);
    }

    static bool SamePath(string a, string b)
    {
        return string.Equals(Path.GetFullPath(a), Path.GetFullPath(b), StringComparison.OrdinalIgnoreCase);
    }

    static void TryDelete(string f) { try { if (File.Exists(f)) File.Delete(f); } catch (Exception) { } }

    // Installs into a scratch folder, checks everything, then uninstalls and checks again.
    static int SelfTest(string dir)
    {
        Targets t = Targets.Test(dir);
        Directory.CreateDirectory(dir);
        string log = Path.Combine(dir, "result.txt");
        try
        {
            Install(t, null);
            bool ok = File.Exists(t.AppExe) && File.Exists(t.Uninstaller) && File.Exists(t.DesktopLnk) && File.Exists(t.StartLnk)
                      && File.Exists(Path.Combine(t.Dir, @"resources\app\package.json"))
                      && File.Exists(Path.Combine(t.Dir, @"resources\app\src\main\main.js"));
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(t.RegKey))
                ok = ok && k != null && (string)k.GetValue("DisplayName") == AppName;
            File.AppendAllText(log, "install ok: " + ok + ", installed size: " + FolderSize(t.Dir) + Environment.NewLine);
            Uninstall(t, false);
            bool gone = !Directory.Exists(t.Dir) && !File.Exists(t.DesktopLnk) && !File.Exists(t.StartLnk)
                        && Registry.CurrentUser.OpenSubKey(t.RegKey) == null;
            File.AppendAllText(log, "uninstall ok: " + gone + Environment.NewLine);
            return ok && gone ? 0 : 1;
        }
        catch (Exception e) { File.AppendAllText(log, "error: " + e + Environment.NewLine); return 2; }
    }

    // ---------- the window: logo, one line of text, one button ----------
    class Window : Form
    {
        readonly Label text = new Label();
        readonly Button button = new Button();
        bool installed = false;

        public Window()
        {
            Text = AppName + " Installer";
            Icon = Icon.ExtractAssociatedIcon(Self);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(380, 300);
            Font = new Font("Segoe UI", 10f);
            BackColor = Color.FromArgb(253, 252, 248);

            PictureBox logo = new PictureBox();
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("logo.png"))
                logo.Image = new Bitmap(s);
            logo.SizeMode = PictureBoxSizeMode.Zoom;
            logo.SetBounds((380 - 88) / 2, 28, 88, 88);

            Label title = new Label();
            title.Text = AppName;
            title.Font = new Font("Segoe UI", 16f, FontStyle.Bold);
            title.ForeColor = Color.FromArgb(32, 36, 43);
            title.TextAlign = ContentAlignment.MiddleCenter;
            title.SetBounds(0, 124, 380, 34);

            text.Text = "Adds Paper Toss to your Start menu and desktop.\nNo admin password needed.";
            text.ForeColor = Color.FromArgb(74, 80, 90);
            text.TextAlign = ContentAlignment.TopCenter;
            text.SetBounds(16, 162, 348, 48);

            button.Text = "Install";
            button.Font = new Font("Segoe UI", 11f, FontStyle.Bold);
            button.FlatStyle = FlatStyle.System;
            button.SetBounds((380 - 160) / 2, 226, 160, 40);
            button.Click += Clicked;
            AcceptButton = button;

            Controls.AddRange(new Control[] { logo, title, text, button });

            // The installer isn't needed once the app is in.
            FormClosed += delegate
            {
                if (installed) try { DeleteSelfLater(null); } catch (Exception) { }
            };
        }

        void Clicked(object sender, EventArgs e)
        {
            Targets t = Targets.Real();
            if (installed)
            {
                try { Process.Start(t.AppExe); } catch (Exception) { }
                Close();
                return;
            }
            if (!CloseRunningApp(t, true)) return;
            button.Enabled = false;
            text.Text = "Installing...";

            // Unpacking takes a few seconds, so do it off the UI thread.
            Thread worker = new Thread(() =>
            {
                Exception error = null;
                try { Install(t, pct => BeginInvoke((Action)(() => text.Text = "Installing... " + pct + "%"))); }
                catch (Exception ex) { error = ex; }
                BeginInvoke((Action)(() => Finished(error)));
            });
            worker.SetApartmentState(ApartmentState.STA); // WScript.Shell for the shortcuts
            worker.IsBackground = true;
            worker.Start();
        }

        void Finished(Exception error)
        {
            if (error == null)
            {
                installed = true;
                text.Text = "Installed! Find it in the Start menu or on your desktop.\nThis installer removes itself when you close it.";
                button.Text = "Play now";
            }
            else
            {
                text.Text = "Something went wrong:\n" + error.Message;
                button.Text = "Try again";
            }
            button.Enabled = true;
        }
    }
}
