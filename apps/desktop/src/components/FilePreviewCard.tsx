import { theme } from "@hims/ui";

interface FileAttachment {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageRef?: string; // base64 data URL
}

interface FilePreviewCardProps {
  attachment: FileAttachment;
  isOutgoing: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "🖼️";
  if (mimeType.startsWith("audio/")) return "🎵";
  if (mimeType.startsWith("video/")) return "🎬";
  if (mimeType.includes("pdf")) return "📄";
  if (mimeType.includes("word") || mimeType.includes("document")) return "📝";
  if (mimeType.includes("excel") || mimeType.includes("spreadsheet") || mimeType.includes("csv")) return "📊";
  if (mimeType.includes("powerpoint") || mimeType.includes("presentation")) return "📊";
  if (mimeType.includes("zip") || mimeType.includes("rar") || mimeType.includes("archive")) return "📦";
  return "📎";
}

/**
 * Renders a file attachment as a preview card inside a chat bubble.
 * Shows file icon, name, size, and a download/open button.
 */
export default function FilePreviewCard({ attachment, isOutgoing }: FilePreviewCardProps) {
  const isImage = attachment.mimeType.startsWith("image/");
  const isAudio = attachment.mimeType.startsWith("audio/");

  function handleDownload() {
    if (!attachment.storageRef) return;
    const link = document.createElement("a");
    link.href = attachment.storageRef;
    link.download = attachment.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Image preview
  if (isImage && attachment.storageRef) {
    return (
      <div style={{
        borderRadius: 8,
        overflow: "hidden",
        maxWidth: 280,
        cursor: "pointer",
      }} onClick={handleDownload}>
        <img
          src={attachment.storageRef}
          alt={attachment.fileName}
          style={{ width: "100%", maxHeight: 200, objectFit: "cover", display: "block" }}
        />
        <div style={{
          padding: "4px 8px",
          fontSize: 11,
          color: isOutgoing ? "rgba(255,255,255,0.8)" : theme.text.muted,
          display: "flex",
          justifyContent: "space-between",
        }}>
          <span>{attachment.fileName}</span>
          <span>{formatFileSize(attachment.sizeBytes)}</span>
        </div>
      </div>
    );
  }

  // Audio preview (use HTML5 audio)
  if (isAudio && attachment.storageRef) {
    return (
      <div style={{
        background: isOutgoing ? "rgba(255,255,255,0.1)" : theme.surface.subtle,
        borderRadius: 8,
        padding: "8px 12px",
        maxWidth: 280,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 20 }}>🎵</span>
          <div>
            <div style={{ fontSize: 12, color: isOutgoing ? "#fff" : theme.text.primary, fontWeight: 600 }}>{attachment.fileName}</div>
            <div style={{ fontSize: 11, color: isOutgoing ? "rgba(255,255,255,0.7)" : theme.text.muted }}>{formatFileSize(attachment.sizeBytes)}</div>
          </div>
        </div>
        <audio controls style={{ width: "100%", height: 32 }} preload="metadata">
          <source src={attachment.storageRef} type={attachment.mimeType} />
        </audio>
      </div>
    );
  }

  // Generic file card
  return (
    <div
      onClick={handleDownload}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        borderRadius: 8,
        background: isOutgoing ? "rgba(255,255,255,0.1)" : theme.surface.subtle,
        cursor: "pointer",
        maxWidth: 280,
        border: `1px solid ${isOutgoing ? "rgba(255,255,255,0.15)" : theme.surface.border}`,
      }}
    >
      <div style={{
        width: 40,
        height: 40,
        borderRadius: 8,
        background: isOutgoing ? "rgba(255,255,255,0.15)" : theme.surface.card,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 20,
        flexShrink: 0,
      }}>
        {getFileIcon(attachment.mimeType)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13,
          fontWeight: 600,
          color: isOutgoing ? "#fff" : theme.text.primary,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {attachment.fileName}
        </div>
        <div style={{ fontSize: 11, color: isOutgoing ? "rgba(255,255,255,0.7)" : theme.text.muted }}>
          {formatFileSize(attachment.sizeBytes)}
        </div>
      </div>
      <div style={{
        width: 32,
        height: 32,
        borderRadius: 999,
        background: isOutgoing ? "rgba(255,255,255,0.2)" : theme.surface.card,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 14,
        flexShrink: 0,
      }}>
        ⬇
      </div>
    </div>
  );
}
