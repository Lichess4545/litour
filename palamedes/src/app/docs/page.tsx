"use client";

import { createApiReference } from "@scalar/api-reference";
import "@scalar/api-reference/style.css";
import { useEffect, useRef } from "react";

export default function DocsPage() {
  const containerRef = useRef<HTMLDivElement>(null);

  // Scalar is an imperative widget that owns the container DOM node directly —
  // an external-library mount, not derived state, so an effect is the right tool.
  useEffect(() => {
    if (containerRef.current === null) {
      return;
    }
    const reference = createApiReference(containerRef.current, {
      url: "/api/v1/openapi.json",
      withDefaultFonts: false,
    });
    return () => reference.destroy();
  }, []);

  return <div ref={containerRef} />;
}
