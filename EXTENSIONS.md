# Aryan IDE declarative extension manifest, version 1

Aryan IDE discovers an extension folder containing `manifest.json` under the bundled `extensions/` folder or `%APPDATA%/aryan-ide/extensions/`.

```json
{
  "name": "Example Tools",
  "version": "1.0.0",
  "description": "Safe sample contributions",
  "permissions": [],
  "settings": [
    { "id": "signature", "label": "Comment signature", "type": "string", "default": "Aryan IDE" }
  ],
  "contributions": {
    "commands": [
      { "id": "insert-greeting", "title": "Insert a greeting", "snippet": "// Hello\n" }
    ],
    "editorActions": [
      { "id": "insert-todo", "title": "Insert TODO comment", "snippet": "// TODO\n" }
    ],
    "themes": [
      { "id": "violet-dawn", "name": "Violet Dawn", "base": "dark", "accent": "#a78bfa" }
    ]
  }
}
```

The IDE validates and displays metadata, persists enable/disable state, stores string-valued settings, and exposes the declarative contributions. A setting id should be stable within the extension. The IDE limits a manifest to 256 KiB, each setting to 1,000 characters, snippets to 5,000 characters, and each contribution list to 30 entries. Setting values are local configuration and must not contain credentials.

Commands and editor actions can insert declared snippets into the active editor. The user invokes each action from the Command Palette or the Extensions panel and can review the inserted text before saving. Snippets may use `{{settingId}}` placeholders, which Aryan IDE expands using that extension's saved string settings. Themes may select a dark or light base and a validated six-digit accent color. The active theme is saved between launches.

Aryan IDE only parses JSON manifests; it does not load or execute JavaScript entry points. This keeps installed extensions from receiving implicit filesystem, process, network, or credential access. Extensions have no dynamic code permissions in version 1.
