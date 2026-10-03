import type { FileAttachment } from '@/types/types';

const ATTACHMENTS_REGEX = /<!--\s*attachments:(\[.*?\])\s*-->/s;

/** 扩展名到编程语言的映射（用于代码块高亮） */
const EXT_LANG_MAP: Record<string, string> = {
  py: 'python',
  js: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  java: 'java',
  go: 'go',
  rs: 'rust',
  swift: 'swift',
  kt: 'kotlin',
  rb: 'ruby',
  php: 'php',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  bat: 'batch',
  cmd: 'batch',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
  csv: 'csv',
  log: 'log',
  cmake: 'cmake',
  makefile: 'makefile',
  dockerfile: 'dockerfile',
  tex: 'latex',
  vue: 'vue',
  svelte: 'svelte',
  r: 'r',
  m: 'matlab',
  scala: 'scala',
  dart: 'dart',
  lua: 'lua',
  perl: 'perl',
  pl: 'perl',
  pm: 'perl',
};

/** 可视为纯文本的文件扩展名 */
const TEXT_EXTS = new Set([
  'txt', 'py', 'c', 'cpp', 'h', 'hpp', 'js', 'ts', 'jsx', 'tsx',
  'java', 'go', 'rs', 'swift', 'kt', 'rb', 'php', 'sh', 'bash',
  'zsh', 'ps1', 'bat', 'cmd', 'sql', 'md', 'markdown', 'csv',
  'log', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'properties',
  'json', 'xml', 'html', 'htm', 'css', 'scss', 'sass', 'less',
  'cmake', 'makefile', 'dockerfile', 'tex', 'vue', 'svelte',
  'r', 'm', 'scala', 'dart', 'lua', 'perl', 'pl', 'pm',
]);

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, 'UTF-8');
  });
}

export function isTextFile(type: string, name: string): boolean {
  if (type.startsWith('text/')) return true;
  if (type === 'application/json' || type === 'application/javascript' ||
      type === 'application/xml' || type === 'application/yaml' ||
      type === 'application/x-yaml' || type === 'application/toml') return true;

  const ext = name.split('.').pop()?.toLowerCase() || '';
  return TEXT_EXTS.has(ext);
}

export function getLanguageFromFilename(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return EXT_LANG_MAP[ext] || '';
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = parseFloat((bytes / Math.pow(k, i)).toFixed(1));
  return `${size} ${units[i]}`;
}

export function serializeAttachments(attachments: FileAttachment[]): string {
  if (attachments.length === 0) return '';
  return `\n\n<!-- attachments:${JSON.stringify(attachments)} -->`;
}

export function parseAttachments(content: string): {
  text: string;
  attachments: FileAttachment[];
} {
  const match = content.match(ATTACHMENTS_REGEX);
  if (!match) {
    return { text: content, attachments: [] };
  }
  try {
    const attachments: FileAttachment[] = JSON.parse(match[1]);
    const text = content.replace(ATTACHMENTS_REGEX, '').trimEnd();
    return { text, attachments };
  } catch {
    return { text: content, attachments: [] };
  }
}

import { invoke } from '@/services/bridge';

export async function parseDocument(base64Data: string, ext: string): Promise<string> {
  return invoke('parse_document', { data: base64Data, ext });
}

export function isDocumentFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return ext === 'pdf' || ext === 'docx' || ext === 'doc';
}

export function getFileIcon(type: string): string {
  if (type.startsWith('image/')) return 'image';
  if (type.includes('pdf')) return 'pdf';
  if (type.includes('word') || type.includes('document')) return 'doc';
  if (type.includes('excel') || type.includes('sheet') || type.includes('csv')) return 'sheet';
  if (type.includes('powerpoint') || type.includes('presentation')) return 'slide';
  if (type.includes('zip') || type.includes('rar') || type.includes('7z')) return 'archive';
  if (type.startsWith('text/') || type.includes('json') || type.includes('xml')) return 'text';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'video';
  return 'file';
}
