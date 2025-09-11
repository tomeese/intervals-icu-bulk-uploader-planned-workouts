/* src/lib/io-utils.ts */

// Utility functions for downloading files and copying to clipboard
export function downloadTextFile(filename: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    alert("Copied JSON to clipboard.");
  } catch {
    // fallback: open a prompt
    window.prompt("Copy JSON:", text);
  }
}
