#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
profile_dir="${XDG_CACHE_HOME:-$HOME/.cache}/linesim-chrome-gpu"
url="$(python3 -c 'from pathlib import Path; import sys; print(Path(sys.argv[1]).as_uri())' "$project_dir/index.html")"
exec google-chrome --user-data-dir="$profile_dir" --no-first-run \
  --enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan \
  --disable-vulkan-surface --app="$url"
