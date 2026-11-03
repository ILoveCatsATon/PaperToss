// Build tool: swaps the icon inside an .exe for the one in an .ico file.
// Used on the renamed electron.exe so Paper Toss shows its own icon in the
// taskbar and Explorer. Usage: IconPatch.exe <target.exe> <icon.ico>
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;

static class IconPatch
{
    static readonly IntPtr RT_ICON = (IntPtr)3, RT_GROUP_ICON = (IntPtr)14;
    const ushort LangEnUs = 1033;

    delegate bool EnumNameProc(IntPtr module, IntPtr type, IntPtr name, IntPtr param);
    delegate bool EnumLangProc(IntPtr module, IntPtr type, IntPtr name, ushort lang, IntPtr param);

    [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
    [DllImport("kernel32")] static extern bool FreeLibrary(IntPtr module);
    [DllImport("kernel32", CharSet = CharSet.Unicode)] static extern bool EnumResourceNames(IntPtr module, IntPtr type, EnumNameProc proc, IntPtr param);
    [DllImport("kernel32", CharSet = CharSet.Unicode)] static extern bool EnumResourceLanguages(IntPtr module, IntPtr type, IntPtr name, EnumLangProc proc, IntPtr param);
    [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr BeginUpdateResource(string file, bool deleteExisting);
    [DllImport("kernel32", SetLastError = true)] static extern bool UpdateResource(IntPtr update, IntPtr type, IntPtr name, ushort lang, byte[] data, uint size);
    [DllImport("kernel32", SetLastError = true)] static extern bool EndUpdateResource(IntPtr update, bool discard);

    // A resource name is either a small integer ID or a string.
    class ResName
    {
        public int Id = -1; public string Str;
        public IntPtr Ptr() { return Str == null ? (IntPtr)Id : Marshal.StringToHGlobalUni(Str); }
    }
    class Res { public IntPtr Type; public ResName Name; public ushort Lang; }

    static ResName ReadName(IntPtr p)
    {
        ResName n = new ResName();
        if (((ulong)p.ToInt64() >> 16) == 0) n.Id = p.ToInt32(); else n.Str = Marshal.PtrToStringUni(p);
        return n;
    }

    static int Main(string[] args)
    {
        if (args.Length != 2) { Console.Error.WriteLine("usage: IconPatch <target.exe> <icon.ico>"); return 1; }
        string exe = args[0];

        // Read the .ico: a header, then a 16-byte entry per image pointing at its data.
        byte[] ico = File.ReadAllBytes(args[1]);
        int count = BitConverter.ToUInt16(ico, 4);
        byte[] group = new byte[6 + 14 * count];
        Array.Copy(ico, 0, group, 0, 6);
        List<byte[]> images = new List<byte[]>();
        for (int i = 0; i < count; i++)
        {
            int e = 6 + 16 * i;
            int size = BitConverter.ToInt32(ico, e + 8), offset = BitConverter.ToInt32(ico, e + 12);
            byte[] img = new byte[size];
            Array.Copy(ico, offset, img, 0, size);
            images.Add(img);
            // The group entry is the same as the file entry, but ends in a resource ID instead of an offset.
            Array.Copy(ico, e, group, 6 + 14 * i, 12);
            BitConverter.GetBytes((ushort)(i + 1)).CopyTo(group, 6 + 14 * i + 12);
        }

        // List the icons the exe has now, so they can be removed.
        List<Res> old = new List<Res>();
        ResName mainGroup = null;
        IntPtr module = LoadLibraryEx(exe, IntPtr.Zero, 0x2 /* LOAD_LIBRARY_AS_DATAFILE */);
        if (module == IntPtr.Zero) { Console.Error.WriteLine("can't open " + exe); return 1; }
        foreach (IntPtr type in new[] { RT_GROUP_ICON, RT_ICON })
        {
            EnumResourceNames(module, type, (m, t, name, p) =>
            {
                ResName n = ReadName(name);
                if (type == RT_GROUP_ICON && mainGroup == null) mainGroup = n; // the first group is the exe's icon
                EnumResourceLanguages(m, t, name, (m2, t2, n2, lang, p2) =>
                {
                    old.Add(new Res { Type = type, Name = n, Lang = lang });
                    return true;
                }, IntPtr.Zero);
                return true;
            }, IntPtr.Zero);
        }
        FreeLibrary(module);
        if (mainGroup == null) mainGroup = new ResName { Id = 1 };

        IntPtr update = BeginUpdateResource(exe, false);
        if (update == IntPtr.Zero) { Console.Error.WriteLine("can't update " + exe); return 1; }
        foreach (Res r in old)
            UpdateResource(update, r.Type, r.Name.Ptr(), r.Lang, null, 0);
        for (int i = 0; i < images.Count; i++)
            if (!UpdateResource(update, RT_ICON, (IntPtr)(i + 1), LangEnUs, images[i], (uint)images[i].Length))
                { Console.Error.WriteLine("icon write failed: " + Marshal.GetLastWin32Error()); EndUpdateResource(update, true); return 1; }
        if (!UpdateResource(update, RT_GROUP_ICON, mainGroup.Ptr(), LangEnUs, group, (uint)group.Length))
            { Console.Error.WriteLine("group write failed: " + Marshal.GetLastWin32Error()); EndUpdateResource(update, true); return 1; }
        if (!EndUpdateResource(update, false)) { Console.Error.WriteLine("save failed: " + Marshal.GetLastWin32Error()); return 1; }
        Console.WriteLine("Replaced " + old.Count + " icon resources with " + images.Count + " images");
        return 0;
    }
}
