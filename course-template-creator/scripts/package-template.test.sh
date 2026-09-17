#!/bin/sh
set -eu

test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT HUP INT TERM
template_dir="$test_root/sample-course"
mkdir -p "$template_dir/chapters/001-introduction/pages"
printf 'schemaVersion: 1\nname: Test\n' > "$template_dir/course.yaml"
printf 'name: Introduction\n' > "$template_dir/chapters/001-introduction/chapter.yaml"
printf 'image' > "$template_dir/chapters/001-introduction/pages/001-cover.png"
printf 'metadata' > "$template_dir/.DS_Store"

"$(dirname "$0")/package-template.sh" "$template_dir" >/dev/null
entries=$(unzip -Z1 "${template_dir}.zip")

test -d "$template_dir"
printf '%s\n' "$entries" | grep -qx 'course.yaml'
printf '%s\n' "$entries" | grep -qx 'chapters/001-introduction/chapter.yaml'
if printf '%s\n' "$entries" | grep -qE '(^|/)\.DS_Store$|^sample-course/'; then
  exit 1
fi
