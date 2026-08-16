// Preload bridge: exposes a minimal, safe API to the renderer. The renderer
// stays sandboxed (no Node access); it can only ask the main process about the
// bundled server status and, on a server install, the generated superadmin
// credentials so the operator can sign in on first launch.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hims", {
  getServerInfo: () => ipcRenderer.invoke("hims:server-info"),
});
