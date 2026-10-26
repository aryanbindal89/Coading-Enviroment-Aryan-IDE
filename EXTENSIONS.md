# Aryan IDE extension manifest, version 1

Aryan IDE discovers an extension folder containing `manifest.json` under the bundled `extensions/` folder or `%APPDATA%/aryan-ide/extensions/`.

```json
{
  "name": "Example Tools",
  "version": "1.0.0",
  "description": "Example extension metadata",
  "entryPoint": "index.js",
  "permissions": [],
  "settings": [
    { "id": "signature", "label": "Comment signature", "type": "string", "default": "Aryan IDE" }
  ]
}
```

Version 1 validates and displays the metadata, persists enable/disable state, and stores string-valued settings in the IDE settings file. A setting id should be stable within the extension. The IDE limits an individual setting to 1,000 characters. Setting values are local configuration and must not contain credentials.

`entryPoint` and `permissions` are reserved metadata. Aryan IDE does not load or execute the entry point. This keeps installed extensions from receiving implicit filesystem, process, network, or credential access. Command, theme, and editor-action contributions require a future permission-scoped API and are not supported by version 1.
