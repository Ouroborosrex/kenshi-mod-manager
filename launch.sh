#!/bin/sh
app_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$app_dir" || exit 1
exec "$app_dir/node_modules/electron/dist/electron" "$app_dir" "$@"
