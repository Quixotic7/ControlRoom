#!/bin/sh
HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$HERE" || exit 1
exec "$HERE/workboard" serve --open
