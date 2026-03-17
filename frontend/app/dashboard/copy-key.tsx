"use client";

import { useState } from "react";

export function CopyKey({ apiKey }: { apiKey: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 bg-slate-800 rounded-lg px-4 py-2.5 text-sm font-mono text-violet-300 truncate">
        {apiKey}
      </code>
      <button
        onClick={handleCopy}
        className="bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-2.5 rounded-lg text-sm transition-colors whitespace-nowrap"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}
