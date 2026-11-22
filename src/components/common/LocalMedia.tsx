import { convertFileSrc } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
import {
  type CSSProperties,
  type ImgHTMLAttributes,
  useEffect,
  useState,
  type VideoHTMLAttributes,
} from "react";
import { isVideoFileName } from "@/utils/playerProfile";

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  webm: "video/webm",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  ogv: "video/ogg",
};

function mimeForPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME_TYPES[extension] ?? "application/octet-stream";
}

export default function LocalMedia({
  src,
  alt,
  className,
  style,
  videoProps,
  imageProps,
  onError,
  onLoad,
}: {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  style?: CSSProperties;
  videoProps?: VideoHTMLAttributes<HTMLVideoElement>;
  imageProps?: ImgHTMLAttributes<HTMLImageElement>;
  onError?: (message: string) => void;
  onLoad?: () => void;
}) {
  const [mediaSrc, setMediaSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMediaSrc(null);
    setFailed(false);
    setBlobUrl((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous);
      }
      return null;
    });

    if (!src) {
      return;
    }

    void (async () => {
      try {
        const converted = src.startsWith("http") ? src : await convertFileSrc(src);
        if (!cancelled) {
          setMediaSrc(converted);
        }
      } catch (error) {
        if (!cancelled) {
          setFailed(true);
          onError?.(String(error));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [blobUrl]);

  const handleError = async () => {
    if (!src) {
      return;
    }
    if (failed) {
      onError?.(src);
      return;
    }

    setFailed(true);
    try {
      const bytes = await readFile(src);
      const url = URL.createObjectURL(new Blob([bytes], { type: mimeForPath(src) }));
      setBlobUrl((previous) => {
        if (previous) {
          URL.revokeObjectURL(previous);
        }
        return url;
      });
      setMediaSrc(url);
    } catch (error) {
      setMediaSrc(null);
      onError?.(String(error));
    }
  };

  if (!mediaSrc) {
    return null;
  }

  if (isVideoFileName(src ?? "")) {
    return (
      <video
        autoPlay
        loop
        muted
        playsInline
        {...videoProps}
        src={mediaSrc}
        className={className}
        style={style}
        onError={() => void handleError()}
        onLoadedData={onLoad}
      />
    );
  }

  return (
    <img
      alt={alt ?? ""}
      {...imageProps}
      src={mediaSrc}
      className={className}
      style={style}
      onError={() => void handleError()}
      onLoad={onLoad}
    />
  );
}
