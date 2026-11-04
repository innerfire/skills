#!/bin/sh
set -eu

test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT HUP INT TERM
# ── Test A (Positive): Pure ASCII filenames (English/digits/slugs) ──────
template_dir="$test_root/sample-course-ascii"
mkdir -p "$template_dir/chapters/001-introduction/pages"
mkdir -p "$template_dir/chapters/001-introduction/materials/001"
mkdir -p "$template_dir/chapters/001-introduction/milestones/001-basic-task"
printf 'schemaVersion: 1\nname: Test\n' > "$template_dir/course.yaml"
printf 'name: Introduction\n' > "$template_dir/chapters/001-introduction/chapter.yaml"
printf 'image' > "$template_dir/chapters/001-introduction/pages/001-cover.png"
printf 'video' > "$template_dir/chapters/001-introduction/materials/001/001-export-1781076721832.mp4"
printf 'docx' > "$template_dir/chapters/001-introduction/milestones/001-basic-task/task-template.docx"
printf 'metadata' > "$template_dir/.DS_Store"

"$(dirname "$0")/package-template.sh" "$template_dir" >/dev/null
entries=$(unzip -Z1 "${template_dir}.zip")

test -d "$template_dir"
printf '%s\n' "$entries" | grep -qx 'course.yaml'
printf '%s\n' "$entries" | grep -qx 'chapters/001-introduction/chapter.yaml'
printf '%s\n' "$entries" | grep -qx 'chapters/001-introduction/pages/001-cover.png'
printf '%s\n' "$entries" | grep -qx 'chapters/001-introduction/materials/001/001-export-1781076721832.mp4'
printf '%s\n' "$entries" | grep -qx 'chapters/001-introduction/milestones/001-basic-task/task-template.docx'
if printf '%s\n' "$entries" | grep -qE '(^|/)\.DS_Store$|^sample-course-ascii/'; then
  exit 1
fi
printf 'Test A passed: valid ASCII template packaged successfully.\n'

# ── Test B (Negative): Material with Chinese filename ───────────────────
template_dir_b="$test_root/sample-course-chinese-material"
mkdir -p "$template_dir_b/chapters/001-introduction/materials/001"
printf 'schemaVersion: 1\nname: Test\n' > "$template_dir_b/course.yaml"
printf 'name: Introduction\n' > "$template_dir_b/chapters/001-introduction/chapter.yaml"
printf 'video' > "$template_dir_b/chapters/001-introduction/materials/001/001-课件演示.mp4"

err_out_b=$("$(dirname "$0")/package-template.sh" "$template_dir_b" 2>&1 || true)
if [ ! -f "${template_dir_b}.zip" ] && printf '%s\n' "$err_out_b" | grep -q 'non-ASCII'; then
  printf 'Test B passed: Chinese material correctly rejected.\n'
else
  printf 'Test B failed: Chinese material was not rejected properly.\n' >&2
  exit 1
fi

# ── Test C (Negative): Page image with Chinese filename ────────────────
template_dir_c="$test_root/sample-course-chinese-page"
mkdir -p "$template_dir_c/chapters/001-introduction/pages"
printf 'schemaVersion: 1\nname: Test\n' > "$template_dir_c/course.yaml"
printf 'name: Introduction\n' > "$template_dir_c/chapters/001-introduction/chapter.yaml"
printf 'image' > "$template_dir_c/chapters/001-introduction/pages/001-封面.png"

err_out_c=$("$(dirname "$0")/package-template.sh" "$template_dir_c" 2>&1 || true)
if [ ! -f "${template_dir_c}.zip" ] && printf '%s\n' "$err_out_c" | grep -q 'non-ASCII'; then
  printf 'Test C passed: Chinese page image correctly rejected.\n'
else
  printf 'Test C failed: Chinese page image was not rejected properly.\n' >&2
  exit 1
fi

# ── Test D (Negative): Task template with Chinese filename ─────────────
template_dir_d="$test_root/sample-course-chinese-task"
mkdir -p "$template_dir_d/chapters/001-introduction/milestones/001-task"
printf 'schemaVersion: 1\nname: Test\n' > "$template_dir_d/course.yaml"
printf 'name: Introduction\n' > "$template_dir_d/chapters/001-introduction/chapter.yaml"
printf 'docx' > "$template_dir_d/chapters/001-introduction/milestones/001-task/任务模板.docx"

err_out_d=$("$(dirname "$0")/package-template.sh" "$template_dir_d" 2>&1 || true)
if [ ! -f "${template_dir_d}.zip" ] && printf '%s\n' "$err_out_d" | grep -q 'non-ASCII'; then
  printf 'Test D passed: Chinese task template correctly rejected.\n'
else
  printf 'Test D failed: Chinese task template was not rejected properly.\n' >&2
  exit 1
fi

printf 'All A/B tests passed!\n'
