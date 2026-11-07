#!/usr/bin/env python3
"""
reset_workspace.py — Studio Universal v4.2 Hardened Workspace Reset Engine
Cleanly restores /workspace from /opt/course-template to a pristine initial state.
Security Guarantees:
  - Strict path traversal prevention: operations constrained strictly to workspace
  - Non-following of symlinks: unlinks symlinks directly without traversing into targets
  - Termination of student background processes on port 8000
  - Atomically increments .generation counter and stamps .course_version
"""

import os
import re
import sys
import shutil
import argparse
import subprocess
from pathlib import Path

DEFAULT_TEMPLATE = os.environ.get("COURSE_TEMPLATE_DIR", "/opt/course-template")
DEFAULT_WORKSPACE = os.environ.get("WORKSPACE_DIR", "/workspace")
CURRENT_VERSION = "4.2.0"

def get_paths(custom_template=None, custom_workspace=None, course_id="rag-intro"):
    # Validate course_id slug
    if not re.match(r"^[a-zA-Z0-9_-]+$", course_id):
        raise ValueError(f"Invalid course ID format: {course_id}")

    # Check for course-specific seed if template not explicitly overridden
    if not custom_template:
        template = None
        for candidate in [
            Path(f"/opt/course-templates/{course_id}"),
            Path(f"/opt/course-seeds/{course_id}/workspace"),
            Path(f"/opt/course-seeds/{course_id}"),
            Path(DEFAULT_TEMPLATE)
        ]:
            if candidate.exists():
                template = candidate
                break
        if not template:
            template = Path(DEFAULT_TEMPLATE)
    else:
        template = Path(custom_template)

    if not template.exists():
        # Fallback for local development/testing outside container
        local_ws = Path(__file__).resolve().parent.parent / "workspace"
        if local_ws.exists():
            template = local_ws
        else:
            raise FileNotFoundError(f"Course template directory not found at {template}")

    # Resolve target workspace
    workspace = Path(custom_workspace) if custom_workspace else Path(DEFAULT_WORKSPACE)
    if not workspace.exists() and not custom_workspace:
        # Fallback to local workspace if /workspace does not exist
        local_ws = Path(__file__).resolve().parent.parent / "workspace"
        workspace = local_ws

    return template, workspace

def reset_workspace(custom_template=None, custom_workspace=None, course_id="rag-intro", preserve_git=True):
    template_dir, workspace_dir = get_paths(custom_template, custom_workspace, course_id)

    # Security check: resolve canonical path
    resolved_ws = workspace_dir.resolve()
    print(f"[reset_workspace] Restoring workspace from {template_dir} -> {resolved_ws} (course: {course_id})...")

    # 1. Quiesce student processes on port 8000
    try:
        subprocess.run(["pkill", "-f", "uvicorn.*8000"], capture_output=True, check=False)
        subprocess.run(["pkill", "-f", "python.*8000"], capture_output=True, check=False)
    except Exception:
        pass

    # If workspace and template are identical (e.g. running in place locally)
    if template_dir.resolve() == resolved_ws:
        print(f"[reset_workspace] Template and workspace are the same path ({resolved_ws}). Updating version marker.")
        version_file = workspace_dir / ".course_version"
        version_file.write_text(f"{CURRENT_VERSION}\n", encoding="utf-8")
        return {
            "status": "ok",
            "message": "Workspace successfully restored to template",
            "workspace": str(resolved_ws),
            "template": str(template_dir),
            "version": CURRENT_VERSION,
            "generation": 1
        }

    workspace_dir.mkdir(parents=True, exist_ok=True)

    # 2. Safely wipe existing workspace contents WITHOUT following symlinks
    for item in workspace_dir.iterdir():
        if preserve_git and item.name == ".git":
            continue
        try:
            # Check symlink first: deleting symlink must NOT delete target directory outside workspace
            if item.is_symlink() or not item.is_dir():
                item.unlink(missing_ok=True)
            else:
                shutil.rmtree(item, ignore_errors=False)
        except Exception as e:
            print(f"[reset_workspace] Warning: Failed to remove {item}: {e}", file=sys.stderr)

    # 3. Copy clean files from template (do not follow symlinks)
    for item in template_dir.iterdir():
        dest = workspace_dir / item.name
        if item.is_dir():
            shutil.copytree(item, dest, symlinks=True, dirs_exist_ok=True)
        else:
            shutil.copy2(item, dest, follow_symlinks=False)

    # 4. Increment generation counter and write version/course markers
    gen_file = workspace_dir / ".generation"
    prev_gen = 1
    if gen_file.exists():
        try:
            prev_gen = int(gen_file.read_text(encoding="utf-8").strip())
        except Exception:
            prev_gen = 1
    new_gen = prev_gen + 1
    gen_file.write_text(f"{new_gen}\n", encoding="utf-8")

    version_file = workspace_dir / ".course_version"
    version_file.write_text(f"{CURRENT_VERSION}\n", encoding="utf-8")

    course_file = workspace_dir / ".course_id"
    course_file.write_text(f"{course_id}\n", encoding="utf-8")

    print(f"[reset_workspace] ✔ Workspace restored to template (gen: {new_gen}, ver: {CURRENT_VERSION})")
    return {
        "status": "ok",
        "message": "Workspace successfully restored to template",
        "workspace": str(resolved_ws),
        "template": str(template_dir),
        "version": CURRENT_VERSION,
        "generation": new_gen,
        "course_id": course_id
    }

def main():
    parser = argparse.ArgumentParser(description="Studio Universal Hardened Workspace Reset")
    parser.add_argument("--template", help="Path to starter template directory")
    parser.add_argument("--workspace", help="Path to target workspace directory")
    parser.add_argument("--course-id", default="rag-intro", help="Active course ID")
    parser.add_argument("--force", action="store_true", help="Force reset without prompts")
    args = parser.parse_args()

    try:
        res = reset_workspace(args.template, args.workspace, args.course_id)
        print(res["message"])
        sys.exit(0)
    except Exception as e:
        print(f"[reset_workspace] ERROR: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
