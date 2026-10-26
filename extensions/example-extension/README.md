# Sample extension

Aryan IDE discovers extension folders by reading `manifest.json`. The first version deliberately treats manifests as metadata and does not evaluate `entryPoint` code. This avoids silently granting downloaded JavaScript unrestricted access to the user's files or processes.

Manifests require `name`, `version`, and `description`. Future extension APIs should use explicit, narrowly scoped capabilities and run in an isolated process. Do not put secrets in an extension folder.
