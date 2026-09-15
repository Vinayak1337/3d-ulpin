"use client";
import { useEffect, useState } from "react";
import type { CanvasSource } from "./types";
export function useSourceRaster(
  source: CanvasSource | undefined,
  page: number,
) {
  const [state, setState] = useState({
    url: "",
    width: 1000,
    height: 700,
    pages: 1,
    loading: false,
    error: "",
    key: "",
  });
  const key = `${source?.id || "none"}:${source?.hash || ""}:${page}`;
  useEffect(() => {
    if (!source?.url || !["image", "pdf"].includes(source.kind)) {
      setState({
        url: "",
        width: 1000,
        height: 700,
        pages: 1,
        loading: false,
        error: "",
        key,
      });
      return;
    }
    let active = true;
    let destroy: (() => void) | undefined;
    setState((old) => ({ ...old, key, url: "", loading: true, error: "" }));
    const fail = (cause: unknown) => {
      if (active)
        setState((old) => ({
          ...old,
          loading: false,
          error:
            cause instanceof Error
              ? cause.message
              : "This source preview could not be opened.",
        }));
    };
    if (source.kind === "image") {
      const image = new Image();
      image.onload = () => {
        if (active)
          setState({
            url: source.url!,
            width: image.naturalWidth,
            height: image.naturalHeight,
            pages: 1,
            loading: false,
            error: "",
            key,
          });
      };
      image.onerror = () => fail("The retained image could not be loaded.");
      image.src = source.url;
      destroy = () => {
        image.onload = null;
        image.onerror = null;
      };
    } else {
      void (async () => {
        const pdfjs = await import("pdfjs-dist");
        if (!active) return;
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const task = pdfjs.getDocument({ url: source.url! });
        destroy = () => {
          void task.destroy();
        };
        const pdf = await task.promise;
        const sheet = await pdf.getPage(Math.min(page, pdf.numPages));
        if (!active) return;
        const viewport = sheet.getViewport({ scale: 1.5 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Document rendering is unavailable.");
        await sheet.render({ canvas, canvasContext: context, viewport })
          .promise;
        if (active)
          setState({
            url: canvas.toDataURL("image/png"),
            width: viewport.width,
            height: viewport.height,
            pages: pdf.numPages,
            loading: false,
            error: "",
            key,
          });
      })().catch(fail);
    }
    return () => {
      active = false;
      destroy?.();
    };
  }, [source?.id, source?.hash, source?.url, source?.kind, page, key]);
  return state.key === key
    ? state
    : { ...state, url: "", loading: true, error: "" };
}
