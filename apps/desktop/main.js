// Electron main process entry for the Divine Hands Hospital desktop client.
//
// The packaged app loads the production build produced by `pnpm build`
// (dist/index.html). The renderer talks to the Go API over plain HTTP at
// http://127.0.0.1:8080 (configurable in the Settings page), which the API
// allows cross-origin (Access-Control-Allow-Origin: *).
//
// For development against the Vite dev server, run:
//   VITE_DEV_SERVER_URL=http://localhost:1420 electron .
// (start the dev server first with `pnpm dev`.)

const { app, BrowserWindow, shell } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: "Divine Hands Hospital",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "src-tauri", "icons", "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.removeMenu();

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    win.loadURL(devServerUrl);
  } else {
    win.loadFile(path.join(__dirname, "dist", "index.html"));
  }

  // Open external links (e.g. receipt HTML/PDF served by the Go API) in the
  // user's default browser instead of inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  createWindow();

  // macOS convention: re-create a window when the dock icon is clicked and no
  // windows are open. On Windows/Linux the app quits when all windows close.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
