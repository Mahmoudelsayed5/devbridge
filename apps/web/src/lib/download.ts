import type { GeneratedFile } from "@devbridge/core";

import { createZip } from "./zip.js";

/** Triggers a browser download for `data` without touching the network. */
export function downloadBlob(fileName: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

export function downloadText(fileName: string, content: string): void {
  downloadBlob(fileName, content, "text/plain;charset=utf-8");
}

export function downloadZip(fileName: string, files: readonly GeneratedFile[]): void {
  const zip = createZip(files.map((file) => ({ path: file.path, content: file.content })));

  downloadBlob(fileName, zip, "application/zip");
}

/**
 * Copies `text` to the clipboard, falling back for browsers (or insecure
 * origins) where the async clipboard API is unavailable.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText !== undefined) {
      await navigator.clipboard.writeText(text);

      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }

  try {
    const area = document.createElement("textarea");

    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();

    const copied = document.execCommand("copy");

    area.remove();

    return copied;
  } catch {
    return false;
  }
}
