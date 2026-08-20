import { useCallback, useRef, useState } from "react";
import { theme } from "@hims/ui";

export interface SelectedFile {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string; // base64 data URL
  thumbnail?: string; // for images
}

interface FileAttachmentPickerProps {
  onFilesSelected: (files: SelectedFile[]) => void;
  disabled?: boolean;
  accept?: string;
}

/**
 * Attachment picker button that opens a file dialog.
 * Returns selected files as SelectedFile objects with base64 data URLs.
 */
export default function FileAttachmentPicker({ onFilesSelected, disabled, accept }: FileAttachmentPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const processFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    const results: SelectedFile[] = [];

    for (const file of files) {
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });

      let thumbnail: string | undefined;
      if (file.type.startsWith("image/")) {
        thumbnail = dataUrl;
      }

      results.push({
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        dataUrl,
        thumbnail,
      });
    }

    onFilesSelected(results);
  }, [onFilesSelected]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      await processFiles(e.dataTransfer.files);
    }
  }, [processFiles]);

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        title="Attach file"
        style={{
          width: 36,
          height: 36,
          borderRadius: 999,
          border: "none",
          background: dragOver ? theme.badge.aft.bg : theme.surface.subtle,
          color: disabled ? theme.text.muted : theme.text.primary,
          cursor: disabled ? "default" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 16,
          flexShrink: 0,
        }}
      >
        📎
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept || "*/*"}
        style={{ display: "none" }}
        onChange={async (e) => {
          if (e.target.files && e.target.files.length > 0) {
            await processFiles(e.target.files);
            e.target.value = "";
          }
        }}
      />
      {dragOver && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            background: "rgba(37, 99, 235, 0.15)",
            border: "3px dashed #2563eb",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 24,
            color: "#2563eb",
            fontWeight: 700,
          }}
        >
          Drop files here
        </div>
      )}
    </>
  );
}

// Expose drag-over listener on the document level
export function useDragDrop(onDrop: (files: File[]) => void) {
  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer?.files.length) {
      onDrop(Array.from(e.dataTransfer.files));
    }
  }, [onDrop]);

  // We'll keep this simple - the picker button handles most cases
  return { handleDragOver, handleDrop };
}
