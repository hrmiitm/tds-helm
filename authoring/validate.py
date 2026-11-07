#!/usr/bin/env python3
"""
Studio Universal - Declarative Course Specification Validator
Validates course specifications against schemas (v1 and v2) and enforces
mandatory semantic requirements, resource limits, tasks references, and slides references.
Strictly zero emojis in all code and outputs.
"""

import sys
import os
import json
import re
import argparse
from pathlib import Path
from html.parser import HTMLParser
from typing import Dict, Any, List, Set, Tuple, Optional

import yaml
try:
    import jsonschema
    from jsonschema import Draft202012Validator, Draft7Validator
    JSONSCHEMA_AVAILABLE = True
except ImportError:
    JSONSCHEMA_AVAILABLE = False


class SlideIdParser(HTMLParser):
    """Extract slide identifiers from section elements in presentation decks."""
    def __init__(self):
        super().__init__()
        self.slide_ids: List[str] = []

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]):
        if tag.lower() == "section":
            attr_map = {k.lower(): v for k, v in attrs if v is not None}
            s_id = attr_map.get("data-slide-id") or attr_map.get("id") or attr_map.get("data-id")
            if s_id and s_id not in self.slide_ids:
                self.slide_ids.append(s_id)


def load_yaml(file_path: Path) -> Dict[str, Any]:
    """Load YAML file with duplicate key detection."""
    class UniqueKeyLoader(yaml.SafeLoader):
        pass

    def construct_mapping(loader, node, deep=False):
        mapping = {}
        for key_node, value_node in node.value:
            key = loader.construct_object(key_node, deep=deep)
            if key in mapping:
                raise ValueError(f"Duplicate key found in YAML: '{key}' at line {key_node.start_mark.line + 1}")
            mapping[key] = loader.construct_object(value_node, deep=deep)
        return mapping

    UniqueKeyLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, construct_mapping)

    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()
    return yaml.load(content, Loader=UniqueKeyLoader)


def load_json(file_path: Path) -> Dict[str, Any]:
    with open(file_path, "r", encoding="utf-8") as f:
        return json.load(f)


def check_path_safety(base_dir: Path, rel_path: str, must_exist: bool = True, is_dir: bool = False) -> List[str]:
    """Validate path against absolute paths, traversal, symlink escapes, and existence."""
    errors: List[str] = []
    if not rel_path or not isinstance(rel_path, str):
        errors.append(f"Invalid path specification: {rel_path}")
        return errors

    if rel_path.startswith("/") or rel_path.startswith("\\"):
        errors.append(f"Absolute paths not permitted in manifest: '{rel_path}'")
        return errors

    parts = Path(rel_path).parts
    if ".." in parts:
        errors.append(f"Path traversal ('..') not permitted in manifest: '{rel_path}'")
        return errors

    target = (base_dir / rel_path).resolve()
    base_resolved = base_dir.resolve()

    try:
        target.relative_to(base_resolved)
    except ValueError:
        errors.append(f"Path escapes course directory root via symlink or redirection: '{rel_path}'")
        return errors

    if must_exist:
        if not target.exists():
            errors.append(f"Referenced path does not exist: '{rel_path}' (resolved: {target})")
        elif is_dir and not target.is_dir():
            errors.append(f"Path must be a directory: '{rel_path}'")
        elif not is_dir and not target.is_file():
            errors.append(f"Path must be a regular file: '{rel_path}'")

    return errors


def check_acyclic(graph: Dict[str, List[str]], node_type: str = "task") -> List[str]:
    """Detect cycles in prerequisite directed graph."""
    errors = []
    visited: Dict[str, int] = {}

    def dfs(node: str, path: List[str]):
        visited[node] = 1
        for neighbor in graph.get(node, []):
            if neighbor not in graph:
                continue
            state = visited.get(neighbor, 0)
            if state == 1:
                cycle_str = " -> ".join(path + [neighbor])
                errors.append(f"Cyclic prerequisite dependency detected in {node_type}s: {cycle_str}")
            elif state == 0:
                dfs(neighbor, path + [neighbor])
        visited[node] = 2

    for node in graph:
        if visited.get(node, 0) == 0:
            dfs(node, [node])

    return errors


def validate_schema(data: Dict[str, Any], schema: Dict[str, Any], course_path: Path) -> List[str]:
    """Validate data against given JSON Schema using Draft 2020-12 / Draft 7."""
    errors = []
    if not JSONSCHEMA_AVAILABLE:
        errors.append("jsonschema library is not installed in the python environment.")
        return errors

    try:
        validator_cls = Draft202012Validator if hasattr(jsonschema, "Draft202012Validator") else Draft7Validator
        validator = validator_cls(schema)
        schema_errors = sorted(validator.iter_errors(data), key=lambda e: e.path)
        for err in schema_errors:
            loc = " -> ".join([str(p) for p in err.path]) if err.path else "root"
            errors.append(f"Schema error at [{loc}]: {err.message}")
    except Exception as e:
        errors.append(f"Schema validation exception: {str(e)}")

    return errors


def validate_resource_limits(cpu_milli: Optional[int], memory_mib: Optional[int], context_label: str) -> List[str]:
    """Enforce universal resource limits: <= 2000 milliCPU and <= 3072 MiB memory."""
    errors = []
    if cpu_milli is not None:
        if not isinstance(cpu_milli, int) or cpu_milli <= 0:
            errors.append(f"{context_label}: cpuMilli must be a positive integer, got {cpu_milli}")
        elif cpu_milli > 2000:
            errors.append(f"{context_label}: cpuMilli ({cpu_milli}) exceeds maximum allowed 2000 milliCPU")

    if memory_mib is not None:
        if not isinstance(memory_mib, int) or memory_mib <= 0:
            errors.append(f"{context_label}: memoryMiB must be a positive integer, got {memory_mib}")
        elif memory_mib > 3072:
            errors.append(f"{context_label}: memoryMiB ({memory_mib}) exceeds maximum allowed 3072 MiB")

    return errors


def extract_slide_ids(slides_file: Path) -> Tuple[Set[str], List[str]]:
    """Parse slide IDs from HTML deck."""
    errors = []
    if not slides_file.exists():
        errors.append(f"Slides deck entry not found: {slides_file}")
        return set(), errors

    try:
        with open(slides_file, "r", encoding="utf-8") as f:
            html = f.read()
        parser = SlideIdParser()
        parser.feed(html)
        return set(parser.slide_ids), errors
    except Exception as e:
        errors.append(f"Failed to parse slides file {slides_file}: {str(e)}")
        return set(), errors


def load_tasks_from_file(tasks_path: Path) -> Tuple[Dict[str, Dict[str, Any]], List[str]]:
    """Extract all task records from tasks.json (supporting modules and tasks list schemas)."""
    errors = []
    task_map: Dict[str, Dict[str, Any]] = {}

    if not tasks_path.exists():
        errors.append(f"Tasks file not found: {tasks_path}")
        return task_map, errors

    try:
        data = load_json(tasks_path)
    except Exception as e:
        errors.append(f"Failed to parse tasks JSON {tasks_path}: {str(e)}")
        return task_map, errors

    raw_tasks: List[Dict[str, Any]] = []
    if isinstance(data, list):
        raw_tasks = data
    elif isinstance(data, dict):
        if "modules" in data and isinstance(data["modules"], list):
            for m in data["modules"]:
                if isinstance(m, dict) and "tasks" in m and isinstance(m["tasks"], list):
                    raw_tasks.extend(m["tasks"])
        elif "tasks" in data and isinstance(data["tasks"], list):
            raw_tasks = data["tasks"]
        else:
            errors.append(f"{tasks_path}: No 'modules' or 'tasks' list found in tasks definition")

    for idx, t in enumerate(raw_tasks):
        if not isinstance(t, dict):
            errors.append(f"{tasks_path}: Task at index {idx} must be a dictionary")
            continue
        t_id = t.get("id")
        if not t_id:
            errors.append(f"{tasks_path}: Task at index {idx} missing required 'id'")
        elif t_id in task_map:
            errors.append(f"{tasks_path}: Duplicate task ID found: '{t_id}'")
        else:
            task_map[t_id] = t

    return task_map, errors


def validate_course_v2(data: Dict[str, Any], course_dir: Path) -> List[str]:
    """Validate course specification adhering to apiVersion: studio.course/v2."""
    errors = []

    # 1. Disallow duplicate embedded tasks in v2 YAML
    if "tasks" in data:
        errors.append("Duplicating embedded tasks in course.yaml is forbidden in v2; tasks.json is the sole task source")

    # 2. Metadata validation
    meta = data.get("metadata", {})
    if not isinstance(meta, dict):
        errors.append("Field 'metadata' must be a dictionary")
        meta = {}

    c_id = meta.get("id")
    if not c_id or not re.match(r"^[a-z][a-z0-9_-]{0,63}$", str(c_id)):
        errors.append(f"metadata.id must match ^[a-z][a-z0-9_-]{{0,63}}$, got '{c_id}'")

    version = meta.get("version")
    if not version or not re.match(r"^[0-9]+\.[0-9]+\.[0-9]+$", str(version)):
        errors.append(f"metadata.version must be valid semver, got '{version}'")

    title = meta.get("title")
    if not title or len(str(title).strip()) == 0 or len(str(title)) > 120:
        errors.append("metadata.title must be non-empty string <= 120 characters")

    badge = meta.get("badge")
    if not badge or len(str(badge).strip()) == 0 or len(str(badge)) > 60:
        errors.append("metadata.badge must be non-empty string <= 60 characters")

    description = meta.get("description")
    if not description or len(str(description).strip()) == 0 or len(str(description)) > 2000:
        errors.append("metadata.description must be non-empty string <= 2000 characters")

    difficulty = str(meta.get("difficulty", "")).lower()
    if difficulty not in ["beginner", "intermediate", "advanced"]:
        errors.append(f"metadata.difficulty must be beginner/intermediate/advanced, got '{meta.get('difficulty')}'")

    est_minutes = meta.get("estimatedMinutes")
    if not isinstance(est_minutes, int) or est_minutes < 1 or est_minutes > 1440:
        errors.append(f"metadata.estimatedMinutes must be integer between 1 and 1440, got '{est_minutes}'")

    # 3. Runtime & Resource Limits
    runtime = data.get("runtime", {})
    if isinstance(runtime, dict):
        res = runtime.get("resources", {})
        if isinstance(res, dict):
            cpu_milli = res.get("cpuMilli")
            mem_mib = res.get("memoryMiB")
            errors.extend(validate_resource_limits(cpu_milli, mem_mib, "runtime.resources"))
        else:
            errors.append("runtime.resources must be a dictionary")

    # 4. Content paths safety and existence
    content = data.get("content", {})
    if not isinstance(content, dict):
        errors.append("Field 'content' must be a dictionary")
        content = {}

    tasks_rel = content.get("tasks")
    slides_rel = content.get("slides")
    workspace_rel = content.get("workspace")

    tasks_path = None
    if tasks_rel:
        p_errs = check_path_safety(course_dir, tasks_rel, must_exist=True, is_dir=False)
        errors.extend(p_errs)
        if not p_errs:
            tasks_path = (course_dir / tasks_rel).resolve()
    else:
        errors.append("content.tasks path is required")

    slides_path = None
    if slides_rel:
        p_errs = check_path_safety(course_dir, slides_rel, must_exist=True, is_dir=False)
        errors.extend(p_errs)
        if not p_errs:
            slides_path = (course_dir / slides_rel).resolve()
    else:
        errors.append("content.slides path is required")

    if workspace_rel:
        p_errs = check_path_safety(course_dir, workspace_rel, must_exist=True, is_dir=True)
        errors.extend(p_errs)
    else:
        errors.append("content.workspace path is required")

    # 5. Tasks references and acyclic check
    task_map: Dict[str, Dict[str, Any]] = {}
    if tasks_path and tasks_path.exists():
        loaded_tasks, t_errs = load_tasks_from_file(tasks_path)
        errors.extend(t_errs)
        task_map = loaded_tasks

    # 6. Slides references
    slide_ids: Set[str] = set()
    if slides_path and slides_path.exists():
        found_slides, s_errs = extract_slide_ids(slides_path)
        errors.extend(s_errs)
        slide_ids = found_slides

    # 7. Modules validation
    modules = data.get("modules", [])
    module_ids: Set[str] = set()
    referenced_tasks: Set[str] = set()

    for idx, mod in enumerate(modules):
        if not isinstance(mod, dict):
            errors.append(f"Module at index {idx} must be a dictionary")
            continue

        m_id = mod.get("id")
        if not m_id:
            errors.append(f"Module at index {idx} is missing required 'id'")
        elif m_id in module_ids:
            errors.append(f"Duplicate module ID found: '{m_id}'")
        else:
            module_ids.add(m_id)

        # Check taskIds
        t_ids = mod.get("taskIds", [])
        if not isinstance(t_ids, list) or len(t_ids) == 0:
            errors.append(f"Module '{m_id}' must specify a non-empty list of 'taskIds'")
        else:
            for tid in t_ids:
                if task_map and tid not in task_map:
                    errors.append(f"Module '{m_id}' references unknown taskId '{tid}' not found in {tasks_rel}")
                if tid in referenced_tasks:
                    errors.append(f"Task '{tid}' is referenced by multiple modules")
                referenced_tasks.add(tid)

        # Check slideIds
        s_ids = mod.get("slideIds", [])
        if not isinstance(s_ids, list) or len(s_ids) == 0:
            errors.append(f"Module '{m_id}' must specify a non-empty list of 'slideIds'")
        else:
            for sid in s_ids:
                if slide_ids and sid not in slide_ids:
                    errors.append(f"Module '{m_id}' references unknown slideId '{sid}' not found in {slides_rel}")

        # Check defaultTool
        tool = mod.get("defaultTool")
        available_tools = runtime.get("tools", [])
        if tool and available_tools and tool not in available_tools:
            errors.append(f"Module '{m_id}' defaultTool '{tool}' is not declared in runtime.tools {available_tools}")

    # Check task prerequisites acyclic
    if task_map:
        task_graph = {
            tid: task_obj.get("prerequisites", []) for tid, task_obj in task_map.items()
        }
        for tid, prereqs in task_graph.items():
            for p in prereqs:
                if p not in task_map:
                    errors.append(f"Task '{tid}' references unknown prerequisite task '{p}'")
        errors.extend(check_acyclic(task_graph, "task"))

    return errors


def validate_course_v1(data: Dict[str, Any], course_dir: Path) -> List[str]:
    """Validate course specification adhering to apiVersion: studio.course/v1 or legacy."""
    errors = []

    # 1. Metadata / Identity
    c_id = data.get("course_id") or (data.get("metadata", {}).get("id") if isinstance(data.get("metadata"), dict) else None)
    if not c_id or not re.match(r"^[a-z][a-z0-9_-]{0,63}$", str(c_id)):
        errors.append(f"Course ID must match ^[a-z][a-z0-9_-]{{0,63}}$, got '{c_id}'")

    version = data.get("version") or (data.get("metadata", {}).get("version") if isinstance(data.get("metadata"), dict) else None)
    if not version or not re.match(r"^[0-9]+\.[0-9]+\.[0-9]+$", str(version)):
        errors.append(f"Course version must be valid semver, got '{version}'")

    title = data.get("title") or (data.get("metadata", {}).get("title") if isinstance(data.get("metadata"), dict) else None)
    if not title or len(str(title).strip()) == 0 or len(str(title)) > 120:
        errors.append("Course title must be non-empty string <= 120 characters")

    # 2. Resource Limits in v1
    if "runtime" in data and isinstance(data["runtime"], dict):
        rt_res = data["runtime"].get("resources")
        if isinstance(rt_res, dict):
            errors.extend(validate_resource_limits(rt_res.get("cpuMilli"), rt_res.get("memoryMiB"), "runtime.resources"))

    environments = data.get("environments", [])
    env_ids: Dict[str, Dict[str, Any]] = {}
    for idx, env in enumerate(environments):
        e_id = env.get("id")
        if not e_id:
            errors.append(f"Environment at index {idx} is missing an 'id'")
        elif e_id in env_ids:
            errors.append(f"Duplicate environment ID found: '{e_id}'")
        else:
            env_ids[e_id] = env
            env_res = env.get("resources", {})
            if isinstance(env_res, dict):
                errors.extend(validate_resource_limits(env_res.get("cpuMilli"), env_res.get("memoryMiB"), f"environment '{e_id}'"))

    # 3. Unique IDs
    topics = data.get("topics", [])
    topic_ids: Set[str] = set()
    for idx, topic in enumerate(topics):
        t_id = topic.get("id")
        if not t_id:
            errors.append(f"Topic at index {idx} is missing an 'id'")
        elif t_id in topic_ids:
            errors.append(f"Duplicate topic ID found: '{t_id}'")
        else:
            topic_ids.add(t_id)

    chapters = data.get("chapters", [])
    chapter_ids: Set[str] = set()
    for idx, ch in enumerate(chapters):
        ch_id = ch.get("id")
        if not ch_id:
            errors.append(f"Chapter at index {idx} is missing an 'id'")
        elif ch_id in chapter_ids:
            errors.append(f"Duplicate chapter ID found: '{ch_id}'")
        else:
            chapter_ids.add(ch_id)

    validators = data.get("validators", [])
    validator_ids: Set[str] = set()
    for idx, val in enumerate(validators):
        v_id = val.get("id")
        if not v_id:
            errors.append(f"Validator at index {idx} is missing an 'id'")
        elif v_id in validator_ids:
            errors.append(f"Duplicate validator ID found: '{v_id}'")
        else:
            validator_ids.add(v_id)

    # 4. Tasks: combine embedded tasks and tasks.json if available
    task_ids: Set[str] = set()
    task_map: Dict[str, Dict[str, Any]] = {}
    for idx, t in enumerate(data.get("tasks", [])):
        t_id = t.get("id")
        if not t_id:
            errors.append(f"Task at index {idx} is missing an 'id'")
        elif t_id in task_ids:
            errors.append(f"Duplicate task ID found: '{t_id}'")
        else:
            task_ids.add(t_id)
            task_map[t_id] = t

    # If external tasks.json exists in course directory, index it too
    tasks_json_file = course_dir / "tasks.json"
    if tasks_json_file.exists():
        ext_tasks, ext_errs = load_tasks_from_file(tasks_json_file)
        errors.extend(ext_errs)
        for tid, tobj in ext_tasks.items():
            if tid not in task_ids:
                task_ids.add(tid)
                task_map[tid] = tobj

    # 5. Chapter references & slides references
    for ch in chapters:
        c_id = ch.get("id", "unknown")
        for t_ref in ch.get("topicIds", []):
            if t_ref not in topic_ids:
                errors.append(f"Chapter '{c_id}' references unknown topicId '{t_ref}'")
        for t_ref in ch.get("taskIds", []):
            if t_ref not in task_ids:
                errors.append(f"Chapter '{c_id}' references unknown taskId '{t_ref}'")
        env_ref = ch.get("environmentId")
        if env_ref and environments and env_ref not in env_ids:
            errors.append(f"Chapter '{c_id}' references unknown environmentId '{env_ref}'")
        for p_ref in ch.get("prerequisites", []):
            if p_ref not in chapter_ids:
                errors.append(f"Chapter '{c_id}' references unknown chapter prerequisite '{p_ref}'")

        # Slide reference verification for v1
        slides_info = ch.get("slides")
        if isinstance(slides_info, dict):
            entry_rel = slides_info.get("entry", "slides/index.html")
            p_errs = check_path_safety(course_dir, entry_rel, must_exist=True, is_dir=False)
            errors.extend(p_errs)
            if not p_errs:
                entry_file = (course_dir / entry_rel).resolve()
                found_slides, s_errs = extract_slide_ids(entry_file)
                errors.extend(s_errs)
                for s_ref in slides_info.get("slideIds", []):
                    if found_slides and s_ref not in found_slides:
                        errors.append(f"Chapter '{c_id}' references unknown slideId '{s_ref}' not found in {entry_rel}")

        # Tool alignment
        if env_ref and env_ref in env_ids:
            env_tools = set(env_ids[env_ref].get("tools", []))
            layout = ch.get("defaultLayout")
            tool = ch.get("defaultTool")
            if layout == "lecture" and "jupyter" not in env_tools:
                errors.append(f"Chapter '{c_id}' requires defaultLayout 'lecture' but environment '{env_ref}' lacks 'jupyter'")
            if layout == "notebook" and "jupyter" not in env_tools:
                errors.append(f"Chapter '{c_id}' requires defaultLayout 'notebook' but environment '{env_ref}' lacks 'jupyter'")
            if layout == "guided" and "vscode" not in env_tools:
                errors.append(f"Chapter '{c_id}' requires defaultLayout 'guided' but environment '{env_ref}' lacks 'vscode'")
            if layout == "fullstack" and not ({"vscode", "preview"}.issubset(env_tools)):
                errors.append(f"Chapter '{c_id}' requires defaultLayout 'fullstack' but environment '{env_ref}' lacks 'vscode' or 'preview'")
            if tool in ["vscode", "jupyter", "preview"] and tool not in env_tools:
                errors.append(f"Chapter '{c_id}' defaultTool '{tool}' is not available in environment '{env_ref}' tools {list(env_tools)}")

    # Workspace directory check if starter_files declared
    starter_rel = data.get("starter_files")
    if starter_rel and isinstance(starter_rel, str):
        errors.extend(check_path_safety(course_dir, starter_rel, must_exist=True, is_dir=True))

    # Acyclic chapter prerequisites
    chapter_graph = {
        ch.get("id"): ch.get("prerequisites", []) for ch in chapters if ch.get("id")
    }
    errors.extend(check_acyclic(chapter_graph, "chapter"))

    # Task verification and acyclic task checks
    task_graph: Dict[str, List[str]] = {}
    for t_id, task in task_map.items():
        prereqs = task.get("prerequisites", [])
        task_graph[t_id] = prereqs
        for p_ref in prereqs:
            if p_ref not in task_ids:
                errors.append(f"Task '{t_id}' references unknown prerequisite task '{p_ref}'")

        verif = task.get("verification", {}) or task.get("question", {})
        v_type = verif.get("type")
        if v_type == "mcq":
            options = verif.get("options", [])
            opt_ids = set()
            for opt in options:
                opt_id = opt.get("id")
                if opt_id in opt_ids:
                    errors.append(f"Task '{t_id}' MCQ has duplicate option ID '{opt_id}'")
                opt_ids.add(opt_id)
            correct_id = verif.get("correctOptionId")
            if correct_id not in opt_ids:
                errors.append(f"Task '{t_id}' correctOptionId '{correct_id}' not found in options {list(opt_ids)}")
        elif v_type == "numeric":
            expected = verif.get("expected")
            if expected is None or not isinstance(expected, (int, float)):
                errors.append(f"Task '{t_id}' numeric expected value must be a valid number, got {expected}")
            int_only = verif.get("integerOnly", False)
            if int_only and isinstance(expected, float) and not expected.is_integer():
                errors.append(f"Task '{t_id}' specifies integerOnly: true but expected is float {expected}")
            abs_tol = verif.get("absoluteTolerance", 0)
            rel_tol = verif.get("relativeTolerance", 0)
            if abs_tol < 0 or rel_tol < 0:
                errors.append(f"Task '{t_id}' tolerances must be non-negative: abs={abs_tol}, rel={rel_tol}")
        elif v_type in ["cli", "test"]:
            val_id = verif.get("validatorId")
            if val_id and validators and val_id not in validator_ids:
                errors.append(f"Task '{t_id}' references unknown validatorId '{val_id}'")

    errors.extend(check_acyclic(task_graph, "task"))

    return errors


def validate_course(course_path: Path, v1_schema: Dict[str, Any], v2_schema: Dict[str, Any]) -> Tuple[bool, List[str], Dict[str, Any]]:
    """Validate a single course specification file supporting both v1 and v2 schemas."""
    all_errors: List[str] = []
    stats: Dict[str, Any] = {}

    if not course_path.exists():
        return False, [f"File not found: {course_path}"], stats

    try:
        data = load_yaml(course_path)
    except Exception as e:
        return False, [f"Failed to parse YAML: {str(e)}"], stats

    if not isinstance(data, dict):
        return False, ["Course specification must be a YAML mapping (dictionary)"], stats

    course_dir = course_path.parent
    api_version = data.get("apiVersion", "studio.course/v1")
    is_v2 = (api_version == "studio.course/v2")

    stats["apiVersion"] = api_version
    stats["is_v2"] = is_v2

    if is_v2:
        meta = data.get("metadata", {})
        stats["course_id"] = meta.get("id")
        stats["title"] = meta.get("title")
        stats["version"] = meta.get("version")
        stats["modules"] = len(data.get("modules", []))
        stats["profile"] = data.get("runtime", {}).get("profile")

        schema_errors = validate_schema(data, v2_schema, course_path)
        all_errors.extend(schema_errors)

        semantic_errors = validate_course_v2(data, course_dir)
        all_errors.extend(semantic_errors)
    else:
        stats["course_id"] = data.get("course_id") or (data.get("metadata", {}).get("id") if isinstance(data.get("metadata"), dict) else None)
        stats["title"] = data.get("title") or (data.get("metadata", {}).get("title") if isinstance(data.get("metadata"), dict) else None)
        stats["version"] = data.get("version") or (data.get("metadata", {}).get("version") if isinstance(data.get("metadata"), dict) else None)
        stats["modules"] = len(data.get("chapters", []))
        stats["topics"] = len(data.get("topics", []))
        stats["tasks"] = len(data.get("tasks", []))
        stats["environments"] = len(data.get("environments", []))
        stats["validators"] = len(data.get("validators", []))

        schema_errors = validate_schema(data, v1_schema, course_path)
        all_errors.extend(schema_errors)

        semantic_errors = validate_course_v1(data, course_dir)
        all_errors.extend(semantic_errors)

    is_valid = (len(all_errors) == 0)
    return is_valid, all_errors, stats


def main():
    parser = argparse.ArgumentParser(
        description="Validate Studio Universal declarative course specifications (v1 and v2)"
    )
    parser.add_argument(
        "courses",
        nargs="*",
        help="Path(s) to course.yaml files. Defaults to searching courses/*/"
    )
    parser.add_argument(
        "--v1-schema",
        default="schemas/course.schema.json",
        help="Path to JSON Schema v1 (default: schemas/course.schema.json)"
    )
    parser.add_argument(
        "--v2-schema",
        default="schemas/course-v2.schema.json",
        help="Path to JSON Schema v2 (default: schemas/course-v2.schema.json)"
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Verbose output"
    )

    args = parser.parse_args()

    v1_schema_path = Path(args.v1_schema)
    if not v1_schema_path.is_absolute():
        v1_schema_path = Path.cwd() / v1_schema_path

    v2_schema_path = Path(args.v2_schema)
    if not v2_schema_path.is_absolute():
        v2_schema_path = Path.cwd() / v2_schema_path

    if not v1_schema_path.exists():
        print(f"[ERROR] Schema file not found: {v1_schema_path}", file=sys.stderr)
        sys.exit(1)

    if not v2_schema_path.exists():
        print(f"[ERROR] Schema file not found: {v2_schema_path}", file=sys.stderr)
        sys.exit(1)

    try:
        v1_schema = load_json(v1_schema_path)
        v2_schema = load_json(v2_schema_path)
    except Exception as e:
        print(f"[ERROR] Failed to load schema: {e}", file=sys.stderr)
        sys.exit(1)

    target_paths: List[Path] = []
    if args.courses:
        for p in args.courses:
            path = Path(p)
            if not path.is_absolute():
                path = Path.cwd() / path
            target_paths.append(path)
    else:
        courses_dir = Path.cwd() / "courses"
        if courses_dir.exists():
            for p in sorted(courses_dir.glob("*/course.yaml")):
                target_paths.append(p)
            for p in sorted(courses_dir.glob("*/course-spec.yaml")):
                if p not in target_paths:
                    target_paths.append(p)

    if not target_paths:
        print("[WARN] No course specification files found to validate.")
        sys.exit(0)

    print("================================================================================")
    print("  STUDIO UNIVERSAL - MULTI-COURSE SPECIFICATION VALIDATOR")
    print(f"  Schema v1: {v1_schema_path.name}")
    print(f"  Schema v2: {v2_schema_path.name}")
    print(f"  Validating {len(target_paths)} course file(s)...")
    print("================================================================================\n")

    overall_success = True
    for course_file in target_paths:
        try:
            rel_path = course_file.relative_to(Path.cwd())
        except ValueError:
            rel_path = course_file

        is_valid, errors, stats = validate_course(course_file, v1_schema, v2_schema)

        status_text = "[PASS]" if is_valid else "[FAIL]"
        course_label = stats.get("course_id") or rel_path
        api_ver = stats.get("apiVersion", "studio.course/v1")
        print(f"{status_text} {rel_path} ({course_label}) [{api_ver}]")
        print(f"       Title:        {stats.get('title', 'N/A')}")
        print(f"       Version:      {stats.get('version', 'N/A')}")
        print(f"       Modules:      {stats.get('modules', 0)} module(s)")
        if stats.get("is_v2"):
            print(f"       Profile:      {stats.get('profile', 'N/A')}")
        else:
            print(f"       Topics:       {stats.get('topics', 0)} topic(s)")
            print(f"       Tasks:        {stats.get('tasks', 0)} declared")
            print(f"       Environments: {stats.get('environments', 0)} declared")
            print(f"       Validators:   {stats.get('validators', 0)} registered")

        if not is_valid:
            overall_success = False
            print("\n   Errors encountered:")
            for err in errors:
                print(f"     * {err}")
        print()

    print("================================================================================")
    if overall_success:
        print(f"SUCCESS: All {len(target_paths)} course specification(s) passed schema and semantic validation.")
        print("================================================================================")
        sys.exit(0)
    else:
        print("FAILURE: Course validation failed for one or more files.")
        print("================================================================================")
        sys.exit(1)


if __name__ == "__main__":
    main()
