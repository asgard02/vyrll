"use client";

import { useEffect } from "react";

export function FaviconDebug() {
  useEffect(() => {
    const links = [...document.querySelectorAll("link")].filter((link) =>
      /icon/i.test(link.rel)
    ).map((link) => ({
      rel: link.rel,
      href: link.href,
      type: link.type,
    }));
    const resources = performance.getEntriesByType("resource").flatMap((entry) => {
      if (!/favicon|apple-touch|\/icon/i.test(entry.name)) return [];
      const timing = entry as PerformanceResourceTiming;
      return [{
        name: timing.name,
        initiatorType: timing.initiatorType,
        transferSize: timing.transferSize,
        decodedBodySize: timing.decodedBodySize,
      }];
    });
    const urls = ["/favicon.ico", "/favicon-ta.png", "/apple-touch-icon.png", "/icon.svg"];
    void Promise.all(urls.map(async (url) => {
      const response = await fetch(url, { cache: "no-store" });
      const bytes = [...new Uint8Array(await response.arrayBuffer()).slice(0, 8)];
      return {
        url,
        status: response.status,
        type: response.headers.get("content-type"),
        bytes,
      };
    })).then((files) => {
      // #region agent log
      fetch("http://127.0.0.1:7643/ingest/b37da798-c53b-4745-aa61-be4fd04389e8", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "b9b88c" },
        body: JSON.stringify({
          sessionId: "b9b88c",
          runId: "safari-favicon",
          hypothesisId: "A-B-C-D-E",
          location: "FaviconDebug.tsx:useEffect",
          message: "browser favicon document and fetches",
          data: {
            href: location.href,
            title: document.title,
            userAgent: navigator.userAgent,
            links,
            resources,
            files,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
    }).catch(() => {});
  }, []);
  return null;
}
