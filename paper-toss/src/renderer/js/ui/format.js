// Human-friendly formatting for file details.

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown';
  if (bytes < 1024) return `${bytes} byte${bytes === 1 ? '' : 's'}`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function formatDate(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 'Unknown';
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function plural(n, word) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

export function describeKind(info) {
  switch (info.kind) {
    case 'directory':
      return 'Folder';
    case 'symlink':
      return 'Link';
    default:
      return info.extension ? `${info.extension.toUpperCase()} file` : 'File';
  }
}

export function describeContents(contents) {
  if (!contents) return '';
  const { files, folders, truncated } = contents;
  if (files === 0 && folders === 0) return truncated ? 'Too many items to count' : 'Empty folder';
  const text = `${plural(files, 'file')}, ${plural(folders, 'folder')}`;
  return truncated ? `At least ${text}` : text;
}

/** Badge colour for the paper's file-type label. */
export function colorForExtension(ext) {
  const groups = [
    [/^(pdf)$/, '#d9452f'],
    [/^(docx?|rtf|odt|pages|txt|md)$/, '#2f6fd6'],
    [/^(xlsx?|csv|ods|numbers)$/, '#23925a'],
    [/^(pptx?|key|odp)$/, '#d9772f'],
    [/^(png|jpe?g|gif|webp|svg|bmp|heic|tiff?)$/, '#8c4fd1'],
    [/^(mp4|mov|avi|mkv|webm|mp3|wav|flac|m4a)$/, '#c73c7f'],
    [/^(zip|rar|7z|tar|gz|iso)$/, '#7b6a4e'],
    [/^(js|ts|py|java|c|cpp|cs|go|rs|rb|php|html|css|json|xml|sh|ps1)$/, '#3a4a5c'],
    [/^(exe|msi|dmg|app|bat|cmd)$/, '#5a5f66'],
  ];
  for (const [re, color] of groups) if (re.test(ext)) return color;
  return '#6b7280';
}
