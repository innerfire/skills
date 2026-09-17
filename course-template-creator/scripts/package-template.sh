#!/bin/sh
set -eu

if [ "$#" -ne 1 ] || [ ! -d "$1" ]; then
  printf 'usage: %s TEMPLATE_DIRECTORY\n' "$0" >&2
  exit 2
fi

command -v zip >/dev/null 2>&1 || {
  printf 'zip command not found\n' >&2
  exit 127
}

template_dir=$(cd "$1" && pwd -P)
template_zip="${template_dir}.zip"
temp_dir=$(mktemp -d "${template_zip}.tmp.XXXXXX")
trap 'rm -rf "$temp_dir"' EXIT HUP INT TERM

(
  cd "$template_dir"
  zip -q -X -r "$temp_dir/template.zip" . \
    -x '.DS_Store' '*/.DS_Store' '__MACOSX' '__MACOSX/*' '*/__MACOSX' '*/__MACOSX/*'
)
mv "$temp_dir/template.zip" "$template_zip"
printf '%s\n' "$template_zip"
