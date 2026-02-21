import { useState } from "react";

export function InlineImage({ src, alt }: { src?: string; alt?: string }) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (!src || errored) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-[11px] text-zinc-500">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        {alt || "Image failed to load"}
      </span>
    );
  }

  return (
    <>
      <span className="block my-2">
        {!loaded && (
          <span className="block w-full h-32 rounded-lg bg-zinc-800 border border-zinc-700 animate-pulse" />
        )}
        <img
          src={src}
          alt={alt || ""}
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
          onClick={() => setExpanded(true)}
          className={`max-w-full max-h-96 rounded-lg border border-zinc-700 cursor-pointer hover:border-zinc-500 transition-colors ${
            loaded ? "block" : "hidden"
          }`}
        />
        {alt && loaded && (
          <span className="block text-[10px] text-zinc-600 mt-1">{alt}</span>
        )}
      </span>

      {/* Lightbox overlay */}
      {expanded && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8 cursor-pointer"
          onClick={() => setExpanded(false)}
        >
          <img
            src={src}
            alt={alt || ""}
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setExpanded(false)}
            className="absolute top-4 right-4 p-2 rounded-lg bg-zinc-800/80 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </>
  );
}
