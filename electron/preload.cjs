const { contextBridge, ipcRenderer } = require("electron");
const methods = [
  "initial",
  "refresh",
  "reloadGame",
  "session",
  "saveProfile",
  "loadProfile",
  "deleteProfile",
  "apply",
  "analyze",
  "conflicts",
  "scale",
  "chooseGame",
  "import",
  "export",
  "openFolder",
  "workshop",
  "openBackups",
  "launch",
];
contextBridge.exposeInMainWorld(
  "manager",
  Object.fromEntries(
    methods.map((method) => [
      method,
      async (arg) => {
        const result = await ipcRenderer.invoke(`manager:${method}`, arg);
        if (!result.ok) throw new Error(result.error);
        return result.value;
      },
    ]),
  ),
);
