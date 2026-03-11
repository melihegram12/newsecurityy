#!/usr/bin/env python3
"""
Framework-agnostic API discovery + frontend usage mapper.

Heuristic (regex) scanning with zero third-party dependencies.
Generates a business mapping markdown + CSV + mermaid diagrams.
"""

from __future__ import annotations

import argparse
import ast
import csv
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple


DEFAULT_EXCLUDES: Set[str] = {
    ".git",
    "node_modules",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".output",
    "__pycache__",
    ".venv",
    "venv",
    ".tox",
    ".pytest_cache",
    ".mypy_cache",
    ".cache",
    ".idea",
    ".vscode",
    "coverage",
}


DEFAULT_EXCLUDE_PATH_PREFIXES: Tuple[str, ...] = (
    # Common generated outputs (Capacitor/Android)
    "android/app/src/main/assets/",
    "android/app/src/main/assets/public/",
    # Common generated outputs (iOS)
    "ios/App/public/",
)


def _read_text(path: Path, max_bytes: int = 2_000_000) -> str:
    try:
        data = path.read_bytes()
        if len(data) > max_bytes:
            data = data[:max_bytes]
        return data.decode("utf-8", errors="replace")
    except Exception:
        return ""


def _iter_files(
    root: Path, excludes: Set[str], exclude_path_prefixes: Sequence[str] = ()
) -> Iterable[Path]:
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        rel_parts = p.relative_to(root).parts
        rel = "/".join(rel_parts).replace("\\", "/")
        if any(rel.startswith(pref.rstrip("/") + "/") or rel == pref.rstrip("/") for pref in exclude_path_prefixes):
            continue
        if any(part in excludes for part in rel_parts):
            continue
        yield p


def _safe_rel(root: Path, p: Path) -> str:
    try:
        return str(p.relative_to(root)).replace("\\", "/")
    except Exception:
        return str(p).replace("\\", "/")


def _load_package_json(root: Path) -> Dict[str, Any]:
    pkg = root / "package.json"
    if not pkg.exists():
        return {}
    try:
        return json.loads(_read_text(pkg))
    except Exception:
        return {}


def _guess_project_name(root: Path) -> str:
    pkg = _load_package_json(root)
    name = pkg.get("name")
    return str(name) if name else root.name


def _detect_frontend_framework(pkg: Dict[str, Any]) -> Optional[str]:
    deps: Dict[str, str] = {}
    deps.update(pkg.get("dependencies") or {})
    deps.update(pkg.get("devDependencies") or {})
    if "next" in deps:
        return "Next.js"
    if "react" in deps:
        return "React"
    if "vue" in deps:
        return "Vue"
    if "@angular/core" in deps:
        return "Angular"
    if "svelte" in deps:
        return "Svelte"
    return None


def _detect_backend_framework(root: Path, pkg: Dict[str, Any]) -> Optional[str]:
    if (root / "backend" / "manage.py").exists() or (root / "manage.py").exists():
        return "Django"
    deps: Dict[str, str] = {}
    deps.update(pkg.get("dependencies") or {})
    deps.update(pkg.get("devDependencies") or {})
    if "@nestjs/core" in deps:
        return "NestJS"
    if "express" in deps:
        return "Express"
    if "fastify" in deps:
        return "Fastify"
    if "koa" in deps:
        return "Koa"
    if "next" in deps:
        return "Next.js API Routes"
    return None


def _parse_requirements_txt(path: Path) -> Set[str]:
    if not path.exists():
        return set()
    pkgs: Set[str] = set()
    for line in _read_text(path).splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        line = line.split(";", 1)[0].strip()
        line = line.split("#", 1)[0].strip()
        m = re.match(r"([A-Za-z0-9_.-]+)", line)
        if m:
            pkgs.add(m.group(1).lower())
    return pkgs


def _discover_dependency_hints(root: Path, pkg: Dict[str, Any]) -> Dict[str, List[str]]:
    deps: Dict[str, str] = {}
    deps.update(pkg.get("dependencies") or {})
    deps.update(pkg.get("devDependencies") or {})
    node = set(deps.keys())
    py = _parse_requirements_txt(root / "requirements.txt") | _parse_requirements_txt(root / "backend" / "requirements.txt")

    def has_any(names: Sequence[str]) -> bool:
        return any(n in node or n.lower() in py for n in names)

    out: Dict[str, List[str]] = {}
    http_clients: List[str] = []
    for n in ["axios", "node-fetch", "cross-fetch", "superagent", "ky", "@tanstack/react-query", "swr"]:
        if n in node:
            http_clients.append(n)
    if "requests" in py:
        http_clients.append("python:requests")
    if http_clients:
        out["http_clients"] = sorted(http_clients)

    docs: List[str] = []
    for n in ["swagger-ui-express", "swagger-jsdoc", "@nestjs/swagger", "drf-spectacular", "drf-yasg", "fastapi", "flasgger"]:
        if n in node or n.lower() in py:
            docs.append(n)
    if docs:
        out["api_docs"] = sorted(docs)

    tests: List[str] = []
    for n in ["jest", "vitest", "supertest", "cypress", "playwright", "msw", "nock"]:
        if n in node:
            tests.append(n)
    for n in ["pytest", "pytest-django"]:
        if n in py:
            tests.append(f"python:{n}")
    if tests:
        out["testing_mocking"] = sorted(tests)

    auth: List[str] = []
    for n in ["passport", "passport-jwt", "jsonwebtoken", "next-auth", "firebase-admin", "@auth/core"]:
        if n in node:
            auth.append(n)
    for n in ["djangorestframework-simplejwt", "django-allauth"]:
        if n in py:
            auth.append(f"python:{n}")
    if auth:
        out["auth_libs"] = sorted(auth)

    realtime: List[str] = []
    for n in ["socket.io", "socket.io-client", "ws"]:
        if n in node:
            realtime.append(n)
    for n in ["channels"]:
        if n in py:
            realtime.append(f"python:{n}")
    if realtime:
        out["realtime"] = sorted(realtime)

    rate_limit: List[str] = []
    for n in ["express-rate-limit"]:
        if n in node:
            rate_limit.append(n)
    for n in ["django-ratelimit"]:
        if n in py:
            rate_limit.append(f"python:{n}")
    if rate_limit:
        out["rate_limiting"] = sorted(rate_limit)

    if has_any(["@supabase/supabase-js"]) or "supabase" in node or "supabase" in py:
        out["third_party"] = sorted(set(out.get("third_party", []) + ["supabase"]))

    return out


def _detect_api_architecture(files: Sequence[Path]) -> str:
    has_graphql = any(p.suffix in {".graphql", ".gql"} for p in files)
    has_grpc = any(p.suffix == ".proto" for p in files)
    has_ws = False
    for p in files:
        if p.suffix not in {".js", ".ts", ".jsx", ".tsx", ".py"}:
            continue
        txt = _read_text(p)
        if "socket.io" in txt or "new WebSocket(" in txt or "channels.layers" in txt or "django_channels" in txt:
            has_ws = True
            break

    parts: List[str] = ["REST"]
    if has_graphql:
        parts.append("GraphQL")
    if has_grpc:
        parts.append("gRPC")
    if has_ws:
        parts.append("WebSocket")
    if len(parts) == 1:
        return "REST"
    return "Mixed (" + " + ".join(parts) + ")"


def _detect_auth(root: Path, pkg: Dict[str, Any], files: Sequence[Path]) -> str:
    req = root / "backend" / "requirements.txt"
    if req.exists() and "djangorestframework-simplejwt" in _read_text(req):
        return "JWT (SimpleJWT) + Device Token (custom) + Optional API Key"

    deps: Dict[str, str] = {}
    deps.update(pkg.get("dependencies") or {})
    deps.update(pkg.get("devDependencies") or {})
    if "jsonwebtoken" in deps or "passport-jwt" in deps:
        return "JWT"

    for p in files:
        if p.suffix == ".py" and "rest_framework_simplejwt" in _read_text(p):
            return "JWT (SimpleJWT)"

    return "Unknown/Custom"


@dataclass
class UsageSite:
    file: str
    line: int
    symbol: str = ""
    notes: str = ""


@dataclass
class ApiEndpoint:
    kind: str  # rest/graphql/ws/ipc/external
    service: str
    path: str
    method: str = ""
    purpose: str = ""
    auth: str = ""
    request_schema: Dict[str, Any] = field(default_factory=dict)
    response_schema: Dict[str, Any] = field(default_factory=dict)
    query_params: Dict[str, Any] = field(default_factory=dict)
    path_params: Dict[str, Any] = field(default_factory=dict)
    source: str = ""
    used_by: List[UsageSite] = field(default_factory=list)


@dataclass
class ApiClientConfig:
    kind: str  # axios/fetch/supabase/graphql/etc
    name: str = ""
    base_url: str = ""
    headers: Dict[str, Any] = field(default_factory=dict)
    interceptors: List[str] = field(default_factory=list)
    source: str = ""
    notes: str = ""


def _find_line_number(text: str, match_start: int) -> int:
    return text.count("\n", 0, match_start) + 1


def _md_escape(value: str) -> str:
    return (value or "").replace("|", "\\|").replace("\n", " ")


def _fmt_schema(schema: Dict[str, Any]) -> str:
    if not schema:
        return ""
    return json.dumps(schema, ensure_ascii=False)


def _python_module_to_path(root: Path, base_dir: Path, module: str) -> Optional[Path]:
    parts = module.split(".")
    candidate = base_dir
    for part in parts:
        candidate = candidate / part
    if candidate.with_suffix(".py").exists():
        return candidate.with_suffix(".py")
    if (candidate / "__init__.py").exists():
        return candidate / "__init__.py"

    # fallback: search
    rel = "/".join(parts) + ".py"
    for p in _iter_files(root, DEFAULT_EXCLUDES):
        if _safe_rel(root, p).endswith(rel):
            return p
    return None


DJANGO_PATH_RE = re.compile(
    r"""path\(\s*['"](?P<route>[^'"]+)['"]\s*,\s*(?P<target>[^\n]+)\)\s*,?""",
    re.MULTILINE,
)
DJANGO_INCLUDE_RE = re.compile(r"""include\(\s*['"](?P<module>[^'"]+)['"]\s*\)""", re.MULTILINE)


def _parse_django_urls(
    root: Path, urls_path: Path, prefix: str, base_dir: Path, visited: Set[Path]
) -> List[Tuple[str, str, str]]:
    if urls_path in visited:
        return []
    visited.add(urls_path)

    txt = _read_text(urls_path)
    out: List[Tuple[str, str, str]] = []

    for m in DJANGO_PATH_RE.finditer(txt):
        route = m.group("route").strip()
        target = m.group("target").strip()
        full = (prefix.rstrip("/") + "/" + route.lstrip("/")).replace("//", "/")
        full = "/" + full.lstrip("/")
        source = f"{_safe_rel(root, urls_path)}:{_find_line_number(txt, m.start())}"

        inc = DJANGO_INCLUDE_RE.search(target)
        if inc:
            module = inc.group("module")
            mod_path = _python_module_to_path(root, base_dir, module)
            if mod_path:
                out.extend(_parse_django_urls(root, mod_path, full, base_dir, visited))
            else:
                out.append((full, f"include({module})", source))
            continue

        out.append((full, target, source))

    return out


PY_CLASS_RE = re.compile(
    r"^class\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*\((?P<bases>[^)]*)\)\s*:",
    re.MULTILINE,
)
PY_DEF_RE = re.compile(r"^\s+def\s+(?P<name>[a-zA-Z_][a-zA-Z0-9_]*)\s*\(", re.MULTILINE)
PY_ATTR_RE = re.compile(
    r"^\s*(?P<attr>permission_classes|authentication_classes)\s*=\s*\[(?P<val>[^\]]*)\]",
    re.MULTILINE,
)
PY_SERIALIZER_USE_RE = re.compile(
    r"(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?P<ser>[A-Za-z_][A-Za-z0-9_]*)\(",
    re.MULTILINE,
)
PY_SERIALIZER_DATA_RE = re.compile(
    r"(?P<ser>[A-Za-z_][A-Za-z0-9_]*Serializer)\s*\(\s*data\s*=",
    re.MULTILINE,
)
PY_RESPONSE_SER_RE = re.compile(
    r"""Response\(\s*(?P<ser>[A-Za-z_][A-Za-z0-9_]*Serializer)\([^)]*\)\.data""",
    re.MULTILINE,
)
PY_RESPONSE_DICT_RE = re.compile(r"""Response\(\s*\{(?P<body>.*?)\}\s*[,)]""", re.S)
PY_PAYLOAD_FROM_SER_RE = re.compile(
    r"""(?P<var>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?P<ser>[A-Za-z_][A-Za-z0-9_]*Serializer)\([^)]*\)\.data""",
    re.MULTILINE,
)
PY_PAYLOAD_KEY_SET_RE = re.compile(
    r"""(?P<var>[A-Za-z_][A-Za-z0-9_]*)\s*\[\s*['"](?P<key>[^'"]+)['"]\s*\]\s*=""",
    re.MULTILINE,
)


def _parse_django_views(views_path: Path) -> Dict[str, Dict[str, Any]]:
    txt = _read_text(views_path)
    classes: Dict[str, Dict[str, Any]] = {}

    for cm in PY_CLASS_RE.finditer(txt):
        cls = cm.group("name")
        bases = cm.group("bases")
        start = cm.end()
        next_m = PY_CLASS_RE.search(txt, start)
        block = txt[start : next_m.start() if next_m else len(txt)]

        methods = sorted(
            {
                m.group("name")
                for m in PY_DEF_RE.finditer(block)
                if m.group("name") in {"get", "post", "put", "patch", "delete"}
            }
        )
        attrs = {m.group("attr"): m.group("val") for m in PY_ATTR_RE.finditer(block)}
        serializers = []
        for sm in PY_SERIALIZER_USE_RE.finditer(block):
            if sm.group("ser").endswith("Serializer"):
                serializers.append(sm.group("ser"))

        request_serializer = ""
        rm = PY_SERIALIZER_DATA_RE.search(block)
        if rm:
            request_serializer = rm.group("ser")

        response_serializers = sorted({m.group("ser") for m in PY_RESPONSE_SER_RE.finditer(block)})

        response_dict_keys: Set[str] = set()
        # direct dict literal
        for dm in PY_RESPONSE_DICT_RE.finditer(block):
            body = dm.group("body") or ""
            for km in re.finditer(r"""['"](?P<k>[^'"]+)['"]\s*:""", body):
                response_dict_keys.add(km.group("k"))

        # payload var derived from serializer .data with extra keys added
        payload_vars: Dict[str, str] = {m.group("var"): m.group("ser") for m in PY_PAYLOAD_FROM_SER_RE.finditer(block)}
        extra_payload_keys: Dict[str, Set[str]] = {v: set() for v in payload_vars.keys()}
        for km in PY_PAYLOAD_KEY_SET_RE.finditer(block):
            v = km.group("var")
            if v in extra_payload_keys:
                extra_payload_keys[v].add(km.group("key"))

        response_payloads = {v: {"serializer": payload_vars[v], "extra_keys": sorted(extra_payload_keys[v])} for v in payload_vars}

        extra_auth = []
        if "X-Api-Key" in block or "LOCAL_SYNC_API_KEY" in block:
            extra_auth.append("Optional X-Api-Key (env-gated)")

        classes[cls] = {
            "bases": bases,
            "methods": methods,
            "permission_classes": attrs.get("permission_classes", ""),
            "authentication_classes": attrs.get("authentication_classes", ""),
            "serializers": sorted(set(serializers)),
            "request_serializer": request_serializer,
            "response_serializers": response_serializers,
            "response_dict_keys": sorted(response_dict_keys),
            "response_payloads": response_payloads,
            "extra_auth": "; ".join(extra_auth),
        }

    return classes


SER_FIELD_RE = re.compile(
    r"(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*serializers\.(?P<type>[A-Za-z_][A-Za-z0-9_]*)\((?P<args>[^)]*)\)"
)
SER_NESTED_RE = re.compile(
    r"(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?P<type>[A-Za-z_][A-Za-z0-9_]*Serializer)\((?P<args>[^)]*)\)"
)
SER_META_FIELDS_TUPLE_RE = re.compile(r"""fields\s*=\s*\((?P<body>[^)]*)\)""", re.S)
SER_META_FIELDS_LIST_RE = re.compile(r"""fields\s*=\s*\[(?P<body>[^\]]*)\]""", re.S)


def _parse_django_serializers(serializers_path: Path) -> Dict[str, Dict[str, Any]]:
    txt = _read_text(serializers_path)
    out: Dict[str, Dict[str, Any]] = {}
    for cm in PY_CLASS_RE.finditer(txt):
        cls = cm.group("name")
        start = cm.end()
        next_m = PY_CLASS_RE.search(txt, start)
        block = txt[start : next_m.start() if next_m else len(txt)]
        fields: Dict[str, Any] = {}
        for fm in SER_FIELD_RE.finditer(block):
            name = fm.group("name")
            ftype = fm.group("type")
            args = fm.group("args")
            required = "required=False" not in args
            allow_blank = "allow_blank=True" in args
            fields[name] = {"type": ftype, "required": required, "allow_blank": allow_blank}
        for nm in SER_NESTED_RE.finditer(block):
            name = nm.group("name")
            ftype = nm.group("type")
            args = nm.group("args")
            required = "required=False" not in args
            fields.setdefault(name, {"type": f"Nested({ftype})", "required": required, "allow_blank": False})

        # ModelSerializer Meta.fields support (very common in DRF)
        meta_idx = block.find("class Meta")
        if meta_idx >= 0:
            meta_block = block[meta_idx : meta_idx + 2000]
            mm = SER_META_FIELDS_TUPLE_RE.search(meta_block) or SER_META_FIELDS_LIST_RE.search(meta_block)
            if mm:
                body = mm.group("body") or ""
                for sm in re.finditer(r"""['"](?P<f>[^'"]+)['"]""", body):
                    fname = sm.group("f")
                    fields.setdefault(fname, {"type": "ModelField", "required": False, "allow_blank": False})
        if fields:
            out[cls] = fields
    return out


def _discover_django_endpoints(root: Path) -> List[ApiEndpoint]:
    backend = root / "backend"
    manage = backend / "manage.py"
    if not manage.exists():
        return []

    settings_path = backend / "security_api" / "settings.py"
    urls_conf = "security_api.urls"
    if settings_path.exists():
        m = re.search(r"ROOT_URLCONF\s*=\s*['\"]([^'\"]+)['\"]", _read_text(settings_path))
        if m:
            urls_conf = m.group(1)

    urls_path = _python_module_to_path(root, backend, urls_conf)
    if not urls_path:
        return []

    raw = _parse_django_urls(root, urls_path, "", backend, visited=set())

    views_path = backend / "core" / "views.py"
    serializers_path = backend / "core" / "serializers.py"
    views_meta = _parse_django_views(views_path) if views_path.exists() else {}
    ser_meta = _parse_django_serializers(serializers_path) if serializers_path.exists() else {}

    out: List[ApiEndpoint] = []
    for path, target, source in raw:
        ep = ApiEndpoint(kind="rest", service="backend(django)", path=path, source=source)

        if "TokenObtainPairView" in target:
            ep.method = "POST"
            ep.purpose = "Obtain JWT access/refresh tokens"
            ep.auth = "Public"
        elif "TokenRefreshView" in target:
            ep.method = "POST"
            ep.purpose = "Refresh JWT access token"
            ep.auth = "Public"
        elif "admin.site.urls" in target or path.startswith("/admin"):
            ep.method = "GET"
            ep.purpose = "Django admin UI"
            ep.auth = "Admin session"
        else:
            view_cls = None
            vm = re.search(r"(?P<cls>[A-Za-z_][A-Za-z0-9_]*)\.as_view", target)
            if vm:
                view_cls = vm.group("cls")

            if view_cls and view_cls in views_meta:
                methods = views_meta[view_cls].get("methods") or []
                ep.method = ",".join([m.upper() for m in methods]) if methods else ""
                perm = views_meta[view_cls].get("permission_classes") or ""
                authc = views_meta[view_cls].get("authentication_classes") or ""
                if "AllowAny" in perm:
                    ep.auth = "Public"
                elif "DeviceAuthentication" in authc:
                    ep.auth = "Device token (Authorization: Device <token>)"
                else:
                    ep.auth = "JWT Bearer (default) / project defaults"

                extra_auth = (views_meta[view_cls].get("extra_auth") or "").strip()
                if extra_auth:
                    ep.auth = (ep.auth + " (" + extra_auth + ")").strip()

                ep.purpose = view_cls
                serializers = views_meta[view_cls].get("serializers") or []
                req_ser = views_meta[view_cls].get("request_serializer") or ""
                if req_ser and ser_meta.get(req_ser):
                    ep.request_schema = ser_meta.get(req_ser) or {}
                elif serializers and ser_meta.get(serializers[0]):
                    ep.request_schema = ser_meta.get(serializers[0]) or {}

                # Response schema (best-effort)
                resp_ser = ""
                resp_sers = views_meta[view_cls].get("response_serializers") or []
                for s in resp_sers:
                    if ser_meta.get(s):
                        resp_ser = s
                        break
                if resp_ser:
                    ep.response_schema = ser_meta.get(resp_ser) or {}

                # payload var derived from serializer .data with extra keys
                payloads = views_meta[view_cls].get("response_payloads") or {}
                if payloads and not ep.response_schema:
                    for v, info in payloads.items():
                        s = info.get("serializer") or ""
                        if s and ser_meta.get(s):
                            schema = dict(ser_meta.get(s) or {})
                            for k in info.get("extra_keys") or []:
                                schema.setdefault(k, {"type": "DerivedField", "required": False, "allow_blank": False})
                            ep.response_schema = schema
                            break

                # direct dict literal keys
                if not ep.response_schema:
                    keys = views_meta[view_cls].get("response_dict_keys") or []
                    if keys:
                        ep.response_schema = {k: {"type": "Unknown", "required": False, "allow_blank": False} for k in keys}
            else:
                ep.purpose = target

        out.append(ep)

    return out


def _discover_netlify_functions(root: Path) -> List[ApiEndpoint]:
    out: List[ApiEndpoint] = []
    # Support both correct and misspelled directory names (some repos use custom folders)
    for base in [root / "netlify" / "functions", root / "netfliy" / "functions"]:
        if not base.exists():
            continue
        for p in base.glob("*.js"):
            name = p.stem
            txt = _read_text(p)
            method = "ANY"
            if "event.httpMethod" in txt:
                method = "ANY (Netlify handler)"
            source = f"{_safe_rel(root, p)}:1"
            out.append(
                ApiEndpoint(
                    kind="rest",
                    service="serverless(netlify)",
                    path=f"/.netlify/functions/{name}",
                    method=method,
                    purpose=f"Netlify function: {name}",
                    auth="Env secrets / custom",
                    source=source,
                )
            )
    return out


def _discover_supabase_edge_functions(root: Path) -> List[ApiEndpoint]:
    out: List[ApiEndpoint] = []
    base = root / "supabase" / "functions"
    if not base.exists():
        return out
    for fn_dir in base.iterdir():
        if not fn_dir.is_dir():
            continue
        entry = fn_dir / "index.ts"
        if not entry.exists():
            continue
        source = f"{_safe_rel(root, entry)}:1"
        out.append(
            ApiEndpoint(
                kind="rest",
                service="serverless(supabase-edge)",
                path=f"/functions/v1/{fn_dir.name}",
                method="ANY",
                purpose=f"Supabase Edge Function: {fn_dir.name}",
                auth="Supabase JWT/service role/env secrets",
                source=source,
            )
        )
    return out


IPC_HANDLE_RE = re.compile(r"""ipcMain\.handle\(\s*['"](?P<ch>[^'"]+)['"]""")


def _discover_electron_ipc(root: Path) -> List[ApiEndpoint]:
    main = root / "electron" / "main.js"
    if not main.exists():
        return []
    txt = _read_text(main)
    out: List[ApiEndpoint] = []
    for m in IPC_HANDLE_RE.finditer(txt):
        ch = m.group("ch")
        source = f"{_safe_rel(root, main)}:{_find_line_number(txt, m.start())}"
        out.append(
            ApiEndpoint(
                kind="ipc",
                service="electron(main)",
                path=ch,
                method="invoke",
                purpose="Electron IPC handler",
                auth="Local app (no network)",
                source=source,
            )
        )
    return out


JS_IMPORT_RE = re.compile(
    r"""import\s+(?P<var>[A-Za-z_$][A-Za-z0-9_$]*)\s+from\s+['"](?P<mod>\.[^'"]+)['"]"""
)
JS_REQUIRE_RE = re.compile(
    r"""(?:const|let|var)\s+(?P<var>[A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*require\(\s*['"](?P<mod>\.[^'"]+)['"]\s*\)"""
)
JS_EXPRESS_USE_RE = re.compile(
    r"""\b(?P<host>app|router)\.use\(\s*(?P<q>['"`])(?P<prefix>[^'"`]+)(?P=q)\s*,\s*(?P<arg>require\(\s*['"][^'"]+['"]\s*\)|[A-Za-z_$][A-Za-z0-9_$]*)""",
    re.MULTILINE,
)
JS_EXPRESS_ROUTE_RE = re.compile(
    r"""\b(?P<host>app|router)\.(?P<meth>get|post|put|patch|delete|options|head|all)\(\s*(?P<q>['"`])(?P<path>[^'"`]+)(?P=q)""",
    re.IGNORECASE,
)
JS_EXPRESS_ROUTE_CHAIN_RE = re.compile(
    r"""\b(?P<host>app|router)\.route\(\s*(?P<q>['"`])(?P<path>[^'"`]+)(?P=q)\s*\)(?P<chain>(?:\s*\.\s*(?:get|post|put|patch|delete|options|head|all)\s*\([^;]+?\))+)\s*;?""",
    re.IGNORECASE | re.DOTALL,
)
JS_NEXT_REQ_METHOD_RE = re.compile(r"""\breq\.method\s*===\s*['"](?P<m>[A-Z]+)['"]""")


def _resolve_js_module(from_file: Path, spec: str) -> Optional[Path]:
    """
    Resolve a relative JS/TS module specifier to a file path.
    Best-effort; does not handle node resolution beyond local files.
    """
    if not spec.startswith("."):
        return None
    base = (from_file.parent / spec).resolve()
    candidates = [
        base,
        base.with_suffix(".js"),
        base.with_suffix(".ts"),
        base.with_suffix(".jsx"),
        base.with_suffix(".tsx"),
        base / "index.js",
        base / "index.ts",
        base / "index.jsx",
        base / "index.tsx",
    ]
    for c in candidates:
        if c.exists() and c.is_file():
            return c
    return None


def _index_js_mount_prefixes(root: Path, files: Sequence[Path]) -> Dict[str, List[str]]:
    """
    Map router module files to mount prefixes via `app.use('/prefix', require('./router'))`
    and `import router from './router'; app.use('/prefix', router)`.
    """
    mounts: Dict[str, List[str]] = {}
    js_files = [p for p in files if p.suffix in {".js", ".ts", ".jsx", ".tsx"}]
    for p in js_files:
        txt = _read_text(p)
        imports: Dict[str, Path] = {}
        for m in JS_IMPORT_RE.finditer(txt):
            target = _resolve_js_module(p, m.group("mod"))
            if target:
                imports[m.group("var")] = target
        for m in JS_REQUIRE_RE.finditer(txt):
            target = _resolve_js_module(p, m.group("mod"))
            if target:
                imports[m.group("var")] = target

        for m in JS_EXPRESS_USE_RE.finditer(txt):
            prefix = m.group("prefix").rstrip("/")
            arg = m.group("arg").strip()
            target: Optional[Path] = None
            if arg.startswith("require("):
                mm = re.search(r"""require\(\s*['"](?P<mod>\.[^'"]+)['"]\s*\)""", arg)
                if mm:
                    target = _resolve_js_module(p, mm.group("mod"))
            else:
                target = imports.get(arg)
            if not target:
                continue
            rel = _safe_rel(root, target)
            mounts.setdefault(rel, []).append(prefix or "/")
    return mounts


def _join_paths(*parts: str) -> str:
    out = ""
    for part in parts:
        if not part:
            continue
        if not out:
            out = part
        else:
            out = out.rstrip("/") + "/" + part.lstrip("/")
    if not out.startswith("/"):
        out = "/" + out
    out = out.replace("//", "/")
    return out


def _discover_express_endpoints(root: Path, files: Sequence[Path]) -> List[ApiEndpoint]:
    """
    Heuristic discovery of Express-style routes in JS/TS.
    Attempts to apply mount prefixes discovered via `app.use('/prefix', routerModule)`.
    """
    mounts = _index_js_mount_prefixes(root, files)
    out: List[ApiEndpoint] = []
    for p in files:
        if p.suffix not in {".js", ".ts"}:
            continue
        txt = _read_text(p)
        if "express" not in txt and ".route(" not in txt and ".get(" not in txt and ".post(" not in txt:
            continue

        rel = _safe_rel(root, p)
        base_prefixes = mounts.get(rel) or [""]

        # chained router.route('/x').get(...).post(...)
        for m in JS_EXPRESS_ROUTE_CHAIN_RE.finditer(txt):
            route_path = m.group("path")
            chain = m.group("chain") or ""
            methods = sorted({mm.upper() for mm in re.findall(r"""\.\s*(get|post|put|patch|delete|options|head|all)\s*\(""", chain, flags=re.I)})
            if not methods:
                methods = ["ANY"]
            line = _find_line_number(txt, m.start())
            for pref in base_prefixes:
                full = _join_paths(pref, route_path)
                out.append(
                    ApiEndpoint(
                        kind="rest",
                        service="backend(express)",
                        path=full,
                        method=",".join(methods),
                        purpose="Express route",
                        auth=_guess_auth_from_js_call(chain),
                        source=f"{rel}:{line}",
                    )
                )

        # direct router.get('/x', ...)
        for m in JS_EXPRESS_ROUTE_RE.finditer(txt):
            meth = m.group("meth").upper()
            route_path = m.group("path")
            line = _find_line_number(txt, m.start())
            tail = txt[m.start() : m.start() + 400]
            auth = _guess_auth_from_js_call(tail)
            for pref in base_prefixes:
                full = _join_paths(pref, route_path)
                out.append(
                    ApiEndpoint(
                        kind="rest",
                        service="backend(express)",
                        path=full,
                        method=meth if meth != "ALL" else "ANY",
                        purpose="Express route",
                        auth=auth,
                        source=f"{rel}:{line}",
                    )
                )
    return _dedupe_endpoints(out)


def _guess_auth_from_js_call(call_snippet: str) -> str:
    snippet = (call_snippet or "").lower()
    auth_hints = [
        "passport.authenticate",
        "auth",
        "authenticate",
        "authorization",
        "jwt",
        "verifytoken",
        "requireauth",
        "require_auth",
        "bearer",
    ]
    if any(h in snippet for h in auth_hints):
        return "Likely auth middleware (heuristic)"
    return ""


def _dedupe_endpoints(endpoints: Sequence[ApiEndpoint]) -> List[ApiEndpoint]:
    seen: Set[Tuple[str, str, str, str]] = set()
    out: List[ApiEndpoint] = []
    for e in endpoints:
        key = (e.kind, e.service, e.method, e.path)
        if key in seen:
            continue
        seen.add(key)
        out.append(e)
    return out


def _discover_next_api_routes(root: Path, files: Sequence[Path]) -> List[ApiEndpoint]:
    out: List[ApiEndpoint] = []
    for p in files:
        if p.suffix not in {".js", ".ts", ".jsx", ".tsx"}:
            continue
        rel = _safe_rel(root, p)
        rel_norm = rel.replace("\\", "/")
        is_pages_api = "/pages/api/" in ("/" + rel_norm) or rel_norm.startswith("pages/api/")
        is_app_api = "/app/api/" in ("/" + rel_norm) or rel_norm.startswith("app/api/")
        if not (is_pages_api or is_app_api):
            continue

        txt = _read_text(p)
        methods: Set[str] = set()

        if is_app_api and p.name.startswith("route."):
            for m in re.finditer(r"""\bexport\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b""", txt):
                methods.add(m.group(1))
            for m in re.finditer(r"""\bexport\s+const\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b""", txt):
                methods.add(m.group(1))
        else:
            for m in JS_NEXT_REQ_METHOD_RE.finditer(txt):
                methods.add(m.group("m"))

        if not methods:
            methods = {"ANY"}

        if is_pages_api:
            sub = rel_norm.split("pages/api/", 1)[1]
            sub = re.sub(r"\.(js|ts|jsx|tsx)$", "", sub)
            if sub.endswith("/index"):
                sub = sub[: -len("/index")]
            path = _join_paths("/api", sub)
        else:
            # app/api/**/route.ts -> /api/**
            sub = rel_norm.split("app/api/", 1)[1]
            sub = re.sub(r"/route\.(js|ts|jsx|tsx)$", "", sub)
            path = _join_paths("/api", sub)

        # next dynamic segments: [id] -> :id, [...slug] -> *slug
        path = re.sub(r"\[\.\.\.(?P<name>[^\]]+)\]", r"*\g<name>", path)
        path = re.sub(r"\[(?P<name>[^\]]+)\]", r":\g<name>", path)

        line = 1
        out.append(
            ApiEndpoint(
                kind="rest",
                service="backend(nextjs)",
                path=path,
                method=",".join(sorted(methods)),
                purpose="Next.js API route",
                auth="Unknown/Custom",
                source=f"{rel}:{line}",
            )
        )
    return _dedupe_endpoints(out)


def _discover_nestjs_endpoints(root: Path, files: Sequence[Path]) -> List[ApiEndpoint]:
    """
    Detect NestJS controllers + routes via decorator patterns.
    """
    ctrl_re = re.compile(r"""@Controller\(\s*(?P<q>['"])(?P<p>[^'"]*)(?P=q)\s*\)""")
    route_re = re.compile(
        r"""@(?P<meth>Get|Post|Put|Patch|Delete|Options|Head)\(\s*(?:(?P<q>['"])(?P<p>[^'"]*)(?P=q))?\s*\)"""
    )
    guard_re = re.compile(r"""@UseGuards\(""")
    out: List[ApiEndpoint] = []
    for p in files:
        if p.suffix != ".ts":
            continue
        txt = _read_text(p)
        if "@Controller" not in txt:
            continue
        rel = _safe_rel(root, p)
        for cm in ctrl_re.finditer(txt):
            ctrl_path = cm.group("p") or ""
            # limit to nearby class block by scanning forward until next @Controller or EOF
            start = cm.end()
            next_cm = ctrl_re.search(txt, start)
            block = txt[start : next_cm.start() if next_cm else len(txt)]
            is_guarded = bool(guard_re.search(block))
            for rm in route_re.finditer(block):
                meth = rm.group("meth").upper()
                sub = rm.group("p") or ""
                full = _join_paths(ctrl_path, sub)
                line = _find_line_number(txt, rm.start())
                out.append(
                    ApiEndpoint(
                        kind="rest",
                        service="backend(nestjs)",
                        path=full,
                        method=meth,
                        purpose="NestJS controller route",
                        auth="Likely guarded (UseGuards)" if is_guarded else "",
                        source=f"{rel}:{line}",
                    )
                )
    return _dedupe_endpoints(out)


def _discover_spring_endpoints(root: Path, files: Sequence[Path]) -> List[ApiEndpoint]:
    """
    Heuristic Spring Boot controller route discovery (Java/Kotlin annotations).
    """
    class_prefix_re = re.compile(r"""@RequestMapping\(\s*(?:path\s*=\s*)?["'](?P<p>[^"']+)["']""")
    get_re = re.compile(r"""@GetMapping\(\s*(?:path\s*=\s*)?["'](?P<p>[^"']*)["']""")
    post_re = re.compile(r"""@PostMapping\(\s*(?:path\s*=\s*)?["'](?P<p>[^"']*)["']""")
    put_re = re.compile(r"""@PutMapping\(\s*(?:path\s*=\s*)?["'](?P<p>[^"']*)["']""")
    patch_re = re.compile(r"""@PatchMapping\(\s*(?:path\s*=\s*)?["'](?P<p>[^"']*)["']""")
    del_re = re.compile(r"""@DeleteMapping\(\s*(?:path\s*=\s*)?["'](?P<p>[^"']*)["']""")
    auth_re = re.compile(r"""@(PreAuthorize|Secured)\b""")

    out: List[ApiEndpoint] = []
    for p in files:
        if p.suffix not in {".java", ".kt"}:
            continue
        txt = _read_text(p)
        if "@RestController" not in txt and "@Controller" not in txt:
            continue
        rel = _safe_rel(root, p)
        prefix = ""
        # naive: first class-level RequestMapping in file
        cm = class_prefix_re.search(txt)
        if cm:
            prefix = cm.group("p") or ""
        guarded = bool(auth_re.search(txt))
        mapping = [
            ("GET", get_re),
            ("POST", post_re),
            ("PUT", put_re),
            ("PATCH", patch_re),
            ("DELETE", del_re),
        ]
        for meth, rr in mapping:
            for m in rr.finditer(txt):
                sub = (m.group("p") or "").strip()
                full = _join_paths(prefix, sub)
                line = _find_line_number(txt, m.start())
                out.append(
                    ApiEndpoint(
                        kind="rest",
                        service="backend(spring)",
                        path=full,
                        method=meth,
                        purpose="Spring controller route",
                        auth="Annotated auth (@PreAuthorize/@Secured)" if guarded else "",
                        source=f"{rel}:{line}",
                    )
                )
    return _dedupe_endpoints(out)


def _discover_graphql_schema(root: Path, files: Sequence[Path]) -> List[ApiEndpoint]:
    """
    Parse `.graphql` / `.gql` schema files for Query/Mutation fields.
    """
    out: List[ApiEndpoint] = []
    schema_files = [p for p in files if p.suffix in {".graphql", ".gql"}]
    type_block_re = re.compile(r"""type\s+(Query|Mutation|Subscription)\s*\{(?P<body>[^}]+)\}""", re.S)
    field_re = re.compile(r"""^\s*(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*(?:\((?P<args>[^)]*)\))?\s*:\s*(?P<ret>[!\[\]A-Za-z0-9_]+)""", re.M)
    for p in schema_files:
        txt = _read_text(p)
        rel = _safe_rel(root, p)
        for tm in type_block_re.finditer(txt):
            op_type = tm.group(1).upper()
            body = tm.group("body") or ""
            for fm in field_re.finditer(body):
                name = fm.group("name")
                args = (fm.group("args") or "").strip()
                ret = (fm.group("ret") or "").strip()
                req: Dict[str, Any] = {}
                if args:
                    for a in args.split(","):
                        a = a.strip()
                        mm = re.match(r"""(?P<k>[A-Za-z_][A-Za-z0-9_]*)\s*:\s*(?P<t>.+)$""", a)
                        if mm:
                            req[mm.group("k")] = {"type": mm.group("t").strip()}
                out.append(
                    ApiEndpoint(
                        kind="graphql",
                        service="graphql(schema)",
                        path=name,
                        method=op_type,
                        purpose=f"{op_type.title()} field",
                        auth="Unknown/Custom",
                        request_schema=req,
                        response_schema={"type": ret} if ret else {},
                        source=f"{rel}:{_find_line_number(txt, tm.start())}",
                    )
                )
    return _dedupe_endpoints(out)


def _discover_grpc_from_proto(root: Path, files: Sequence[Path]) -> List[ApiEndpoint]:
    out: List[ApiEndpoint] = []
    proto_files = [p for p in files if p.suffix == ".proto"]
    if not proto_files:
        return out
    service_re = re.compile(r"""service\s+(?P<svc>[A-Za-z_][A-Za-z0-9_]*)\s*\{(?P<body>[^}]+)\}""", re.S)
    rpc_re = re.compile(
        r"""rpc\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*\(\s*(?P<req>stream\s+)?(?P<reqt>[A-Za-z_][A-Za-z0-9_]*)\s*\)\s*returns\s*\(\s*(?P<res>stream\s+)?(?P<rest>[A-Za-z_][A-Za-z0-9_]*)\s*\)""",
        re.I,
    )
    for p in proto_files:
        txt = _read_text(p)
        rel = _safe_rel(root, p)
        for sm in service_re.finditer(txt):
            svc = sm.group("svc")
            body = sm.group("body") or ""
            for rm in rpc_re.finditer(body):
                name = rm.group("name")
                reqt = rm.group("reqt")
                rest = rm.group("rest")
                streaming = "stream" if (rm.group("req") or rm.group("res")) else ""
                out.append(
                    ApiEndpoint(
                        kind="grpc",
                        service=f"grpc({svc})",
                        path=f"{svc}/{name}",
                        method="rpc",
                        purpose="gRPC method",
                        auth="Unknown/Custom",
                        request_schema={"type": reqt, "streaming": bool(rm.group("req"))},
                        response_schema={"type": rest, "streaming": bool(rm.group("res"))},
                        source=f"{rel}:{_find_line_number(txt, sm.start())}",
                    )
                )
    return _dedupe_endpoints(out)


def _discover_websocket_events(root: Path, files: Sequence[Path]) -> List[ApiEndpoint]:
    """
    Heuristic WS event discovery for socket.io and native WebSocket usage.
    """
    out: List[ApiEndpoint] = []
    socket_on_re = re.compile(r"""socket\.on\(\s*['"](?P<ev>[^'"]+)['"]""")
    socket_emit_re = re.compile(r"""socket\.emit\(\s*['"](?P<ev>[^'"]+)['"]""")
    io_emit_re = re.compile(r"""\bio\.emit\(\s*['"](?P<ev>[^'"]+)['"]""")
    ws_new_re = re.compile(r"""new\s+WebSocket\(\s*['"](?P<url>[^'"]+)['"]""")
    for p in files:
        if p.suffix not in {".js", ".ts", ".jsx", ".tsx", ".py"}:
            continue
        txt = _read_text(p)
        rel = _safe_rel(root, p)
        if "socket.io" in txt or "WebSocket" in txt or "websocket_urlpatterns" in txt:
            for m in socket_on_re.finditer(txt):
                ev = m.group("ev")
                out.append(
                    ApiEndpoint(
                        kind="ws",
                        service="ws(socket.io)",
                        path=ev,
                        method="client->server",
                        purpose="socket.io inbound event",
                        source=f"{rel}:{_find_line_number(txt, m.start())}",
                    )
                )
            for m in socket_emit_re.finditer(txt):
                ev = m.group("ev")
                out.append(
                    ApiEndpoint(
                        kind="ws",
                        service="ws(socket.io)",
                        path=ev,
                        method="server->client",
                        purpose="socket.io outbound event",
                        source=f"{rel}:{_find_line_number(txt, m.start())}",
                    )
                )
            for m in io_emit_re.finditer(txt):
                ev = m.group("ev")
                out.append(
                    ApiEndpoint(
                        kind="ws",
                        service="ws(socket.io)",
                        path=ev,
                        method="server->client",
                        purpose="socket.io broadcast event",
                        source=f"{rel}:{_find_line_number(txt, m.start())}",
                    )
                )
            for m in ws_new_re.finditer(txt):
                url = m.group("url")
                out.append(
                    ApiEndpoint(
                        kind="ws",
                        service="ws(native)",
                        path=url,
                        method="connect",
                        purpose="WebSocket connection",
                        source=f"{rel}:{_find_line_number(txt, m.start())}",
                    )
                )
    return _dedupe_endpoints(out)


def _discover_fastapi_flask_endpoints(root: Path, files: Sequence[Path]) -> List[ApiEndpoint]:
    """
    Python HTTP frameworks: FastAPI + Flask (AST-based, best-effort).
    """
    out: List[ApiEndpoint] = []
    py_files = [p for p in files if p.suffix == ".py"]
    for p in py_files:
        txt = _read_text(p)
        if "fastapi" not in txt and "from fastapi" not in txt and "flask" not in txt and "from flask" not in txt:
            continue
        rel = _safe_rel(root, p)
        try:
            tree = ast.parse(txt)
        except Exception:
            continue

        fastapi_apps: Set[str] = set()
        fastapi_routers: Dict[str, str] = {}
        fastapi_mounts: Dict[str, str] = {}
        flask_apps: Set[str] = set()
        flask_blueprints: Set[str] = set()
        flask_mounts: Dict[str, str] = {}

        # First pass: assignments + registrations
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
                name = node.targets[0].id
                call = node.value
                if isinstance(call, ast.Call) and isinstance(call.func, (ast.Name, ast.Attribute)):
                    func_name = call.func.id if isinstance(call.func, ast.Name) else call.func.attr
                    if func_name == "FastAPI":
                        fastapi_apps.add(name)
                    if func_name == "APIRouter":
                        prefix = ""
                        for kw in call.keywords or []:
                            if kw.arg == "prefix" and isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, str):
                                prefix = kw.value.value
                        fastapi_routers[name] = prefix
                    if func_name == "Flask":
                        flask_apps.add(name)
                    if func_name == "Blueprint":
                        flask_blueprints.add(name)

            if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
                call = node.value
                if isinstance(call.func, ast.Attribute) and isinstance(call.func.value, ast.Name):
                    obj = call.func.value.id
                    if call.func.attr == "include_router" and obj in fastapi_apps:
                        if call.args and isinstance(call.args[0], ast.Name):
                            router_name = call.args[0].id
                            prefix = ""
                            for kw in call.keywords or []:
                                if kw.arg == "prefix" and isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, str):
                                    prefix = kw.value.value
                            if router_name:
                                fastapi_mounts[router_name] = prefix
                    if call.func.attr == "register_blueprint" and obj in flask_apps:
                        if call.args and isinstance(call.args[0], ast.Name):
                            bp_name = call.args[0].id
                            prefix = ""
                            for kw in call.keywords or []:
                                if kw.arg == "url_prefix" and isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, str):
                                    prefix = kw.value.value
                            if bp_name:
                                flask_mounts[bp_name] = prefix

        # Second pass: function decorators
        for node in tree.body:
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for dec in node.decorator_list or []:
                if not isinstance(dec, ast.Call) or not isinstance(dec.func, ast.Attribute):
                    continue
                if not isinstance(dec.func.value, ast.Name):
                    continue
                obj = dec.func.value.id
                attr = dec.func.attr

                # FastAPI: @app.get("/x") / @router.post("/x")
                if obj in fastapi_apps or obj in fastapi_routers:
                    if attr.lower() in {"get", "post", "put", "patch", "delete", "options", "head"}:
                        route_path = ""
                        if dec.args and isinstance(dec.args[0], ast.Constant) and isinstance(dec.args[0].value, str):
                            route_path = dec.args[0].value
                        meth = attr.upper()
                        prefix = ""
                        if obj in fastapi_routers:
                            prefix = _join_paths(fastapi_mounts.get(obj, ""), fastapi_routers.get(obj, ""))
                        full = _join_paths(prefix, route_path)
                        out.append(
                            ApiEndpoint(
                                kind="rest",
                                service="backend(fastapi)",
                                path=full,
                                method=meth,
                                purpose="FastAPI route",
                                auth="Unknown/Custom",
                                source=f"{rel}:{getattr(dec, 'lineno', 1)}",
                            )
                        )

                # Flask: @app.route("/x", methods=[...]) / @bp.route(...)
                if obj in flask_apps or obj in flask_blueprints:
                    if attr == "route":
                        route_path = ""
                        if dec.args and isinstance(dec.args[0], ast.Constant) and isinstance(dec.args[0].value, str):
                            route_path = dec.args[0].value
                        methods: List[str] = ["GET"]
                        for kw in dec.keywords or []:
                            if kw.arg == "methods" and isinstance(kw.value, (ast.List, ast.Tuple)):
                                collected = []
                                for elt in kw.value.elts:
                                    if isinstance(elt, ast.Constant) and isinstance(elt.value, str):
                                        collected.append(elt.value.upper())
                                if collected:
                                    methods = collected
                        prefix = flask_mounts.get(obj, "") if obj in flask_blueprints else ""
                        full = _join_paths(prefix, route_path)
                        out.append(
                            ApiEndpoint(
                                kind="rest",
                                service="backend(flask)",
                                path=full,
                                method=",".join(sorted(set(methods))),
                                purpose="Flask route",
                                auth="Unknown/Custom",
                                source=f"{rel}:{getattr(dec, 'lineno', 1)}",
                            )
                        )

    return _dedupe_endpoints(out)

SUPABASE_FROM_RE = re.compile(r"""supabase\.from\(\s*['"](?P<table>[^'"]+)['"]\s*\)""")
SUPABASE_OP_RE = re.compile(r"""\.(select|insert|update|delete)\(""")
FETCH_URL_RE = re.compile(r"""fetch\(\s*(?P<q>['"`])(?P<url>.+?)(?P=q)""")
AXIOS_URL_RE = re.compile(r"""axios\.(get|post|put|patch|delete)\(\s*(?P<q>['"`])(?P<url>.+?)(?P=q)""")
ABS_URL_RE = re.compile(r"""https?://[^\s'"]+""")
IPC_USAGE_RE = re.compile(r"""window\.electronAPI\.(?P<ns>[a-zA-Z0-9_]+)\.(?P<fn>[a-zA-Z0-9_]+)\(""")
AXIOS_CREATE_RE = re.compile(r"""(?:const|let|var)\s+(?P<var>[A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*axios\.create\(""")
GRAPHQL_GQL_BLOCK_RE = re.compile(r"""gql\s*`(?P<body>[\s\S]*?)`""", re.MULTILINE)
GRAPHQL_OP_TYPE_RE = re.compile(r"""\b(query|mutation)\b""", re.IGNORECASE)
GRAPHQL_ROOT_FIELD_RE = re.compile(r"""\{\s*(?P<field>[A-Za-z_][A-Za-z0-9_]*)""")
WS_NEW_RE = re.compile(r"""new\s+WebSocket\(\s*(?P<q>['"`])(?P<url>[^'"`]+)(?P=q)""")
WS_EVENT_RE = re.compile(r"""\.(emit|on)\(\s*(?P<q>['"`])(?P<ev>[^'"`]+)(?P=q)""")


def _extract_js_symbol_hint(text: str, pos: int) -> str:
    head = text[:pos][-4000:]
    m = re.search(r"(const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=", head)
    if m:
        return m.group(2)
    m2 = re.search(r"function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(", head)
    if m2:
        return m2.group(1)
    return ""


def _normalize_url_to_path(raw: str) -> str:
    """
    Best-effort conversion of a URL-ish string into a path for endpoint matching.
    Examples:
      - https://host/api/logs/sync?x=1 -> /api/logs/sync
      - ${baseUrl}/logs/sync -> /logs/sync
      - /api/check -> /api/check
    """
    value = (raw or "").strip()
    if not value:
        return ""

    m = re.search(r"https?://[^/]+(?P<path>/[^\s'\"`]+)", value)
    if m:
        return m.group("path").split("?", 1)[0]

    if value.startswith("/"):
        return value.split("?", 1)[0]

    if "}" in value:
        tail = value[value.rfind("}") + 1 :]
        if tail.startswith("/"):
            return tail.split("?", 1)[0]

    # fallback: first slash segment
    idx = value.find("/")
    if idx >= 0:
        return value[idx:].split("?", 1)[0]
    return ""


def _discover_frontend_usages(
    root: Path, files: Sequence[Path]
) -> Tuple[Dict[str, List[UsageSite]], List[ApiEndpoint]]:
    usage_map: Dict[str, List[UsageSite]] = {}
    externals: Dict[str, ApiEndpoint] = {}

    def add_usage(key: str, site: UsageSite) -> None:
        usage_map.setdefault(key, []).append(site)

    for p in files:
        if p.suffix not in {".js", ".ts", ".jsx", ".tsx", ".py"}:
            continue
        txt = _read_text(p)
        rel = _safe_rel(root, p)

        if p.suffix in {".js", ".ts", ".jsx", ".tsx"}:
            axios_clients = sorted(set(m.group("var") for m in AXIOS_CREATE_RE.finditer(txt)))
            axios_client_call_re: Optional[re.Pattern[str]] = None
            if axios_clients:
                axios_client_call_re = re.compile(
                    r"""\b(?P<client>"""
                    + "|".join(re.escape(v) for v in axios_clients)
                    + r""")\.(get|post|put|patch|delete)\(\s*(?P<q>['"`])(?P<url>.+?)(?P=q)""",
                    re.IGNORECASE,
                )

            for m in FETCH_URL_RE.finditer(txt):
                raw = m.group("url")
                line = _find_line_number(txt, m.start())
                sym = _extract_js_symbol_hint(txt, m.start())
                add_usage(f"fetch:{raw}", UsageSite(file=rel, line=line, symbol=sym))
                norm_path = _normalize_url_to_path(raw)
                if norm_path:
                    add_usage(f"fetch_path:{norm_path}", UsageSite(file=rel, line=line, symbol=sym))
                if ABS_URL_RE.search(raw):
                    externals.setdefault(
                        raw,
                        ApiEndpoint(
                            kind="external",
                            service="external(http)",
                            path=raw,
                            method="fetch",
                            purpose="Direct HTTP call (literal URL)",
                            auth="Unknown",
                            source=f"{rel}:{line}",
                        ),
                    )

            for m in AXIOS_URL_RE.finditer(txt):
                method = m.group(1).upper()
                raw = m.group("url")
                line = _find_line_number(txt, m.start())
                sym = _extract_js_symbol_hint(txt, m.start())
                add_usage(f"axios:{method}:{raw}", UsageSite(file=rel, line=line, symbol=sym))
                norm_path = _normalize_url_to_path(raw)
                if norm_path:
                    add_usage(f"axios_path:{method}:{norm_path}", UsageSite(file=rel, line=line, symbol=sym))
                if ABS_URL_RE.search(raw):
                    externals.setdefault(
                        raw,
                        ApiEndpoint(
                            kind="external",
                            service="external(http)",
                            path=raw,
                            method=method,
                            purpose="Direct HTTP call (literal URL)",
                            auth="Unknown",
                            source=f"{rel}:{line}",
                        ),
                    )

            if axios_client_call_re:
                for m in axios_client_call_re.finditer(txt):
                    method = m.group(2).upper()
                    raw = m.group("url")
                    line = _find_line_number(txt, m.start())
                    sym = _extract_js_symbol_hint(txt, m.start())
                    add_usage(f"axios:{method}:{raw}", UsageSite(file=rel, line=line, symbol=sym))
                    norm_path = _normalize_url_to_path(raw)
                    if norm_path:
                        add_usage(f"axios_path:{method}:{norm_path}", UsageSite(file=rel, line=line, symbol=sym))
                    if ABS_URL_RE.search(raw):
                        externals.setdefault(
                            raw,
                            ApiEndpoint(
                                kind="external",
                                service="external(http)",
                                path=raw,
                                method=method,
                                purpose="Direct HTTP call (literal URL)",
                                auth="Unknown",
                                source=f"{rel}:{line}",
                            ),
                        )

            for fm in SUPABASE_FROM_RE.finditer(txt):
                table = fm.group("table")
                tail = txt[fm.end() : fm.end() + 300]
                ops = SUPABASE_OP_RE.findall(tail)
                op = ops[0] if ops else ""
                line = _find_line_number(txt, fm.start())
                sym = _extract_js_symbol_hint(txt, fm.start())
                add_usage(f"supabase:{table}:{op or 'op'}", UsageSite(file=rel, line=line, symbol=sym))
                externals.setdefault(
                    f"supabase:{table}",
                    ApiEndpoint(
                        kind="external",
                        service="Supabase(PostgREST)",
                        path=f"/rest/v1/{table}",
                        method=op.upper() if op else "",
                        purpose=f"Supabase table operation on {table}",
                        auth="Anon key / RLS policies",
                        source=f"{rel}:{line}",
                    ),
                )

            for im in IPC_USAGE_RE.finditer(txt):
                ns = im.group("ns")
                fn = im.group("fn")
                line = _find_line_number(txt, im.start())
                sym = _extract_js_symbol_hint(txt, im.start())
                add_usage(f"ipc:{ns}.{fn}", UsageSite(file=rel, line=line, symbol=sym))

            # GraphQL client usage (gql`...` blocks)
            for gm in GRAPHQL_GQL_BLOCK_RE.finditer(txt):
                body = gm.group("body") or ""
                line = _find_line_number(txt, gm.start())
                sym = _extract_js_symbol_hint(txt, gm.start())
                opm = GRAPHQL_OP_TYPE_RE.search(body)
                op_type = (opm.group(1).upper() if opm else "QUERY")
                root = GRAPHQL_ROOT_FIELD_RE.search(body)
                if root:
                    field = root.group("field")
                    add_usage(f"graphql_field:{op_type}:{field}", UsageSite(file=rel, line=line, symbol=sym))

            # WebSocket usage (native + socket.io-ish events)
            for wm in WS_NEW_RE.finditer(txt):
                url = wm.group("url")
                line = _find_line_number(txt, wm.start())
                sym = _extract_js_symbol_hint(txt, wm.start())
                add_usage(f"ws_connect:{url}", UsageSite(file=rel, line=line, symbol=sym))
            if "socket" in txt or "WebSocket" in txt or "socket.io" in txt:
                for em in WS_EVENT_RE.finditer(txt):
                    ev = em.group("ev")
                    line = _find_line_number(txt, em.start())
                    sym = _extract_js_symbol_hint(txt, em.start())
                    add_usage(f"ws_event:{ev}", UsageSite(file=rel, line=line, symbol=sym))

        # External integration hints
        if "nodemailer" in txt:
            externals.setdefault(
                "nodemailer",
                ApiEndpoint(
                    kind="external",
                    service="SMTP",
                    path="smtp://",
                    method="sendMail",
                    purpose="Email delivery (SMTP)",
                    auth="SMTP credentials",
                    source=f"{rel}:1",
                ),
            )
        if "api.resend.com" in txt or "resend.com" in txt:
            externals.setdefault(
                "resend",
                ApiEndpoint(
                    kind="external",
                    service="Resend",
                    path="https://api.resend.com/emails",
                    method="POST",
                    purpose="Send transactional email",
                    auth="RESEND_API_KEY",
                    source=f"{rel}:1",
                ),
            )

    return usage_map, list(externals.values())


def _attach_usages(endpoints: List[ApiEndpoint], usage_map: Dict[str, List[UsageSite]]) -> None:
    for ep in endpoints:
        if ep.kind == "ipc":
            if ":" in ep.path:
                ns, fn = ep.path.split(":", 1)
                sites = usage_map.get(f"ipc:{ns}.{fn}") or []
                ep.used_by.extend(sites)
            continue

        if ep.kind == "rest":
            # attach normalized path matches (useful for template URLs like `${baseUrl}/logs/sync`)
            for key, sites in usage_map.items():
                if key.startswith("fetch_path:"):
                    path = key.split("fetch_path:", 1)[1]
                    if path and (ep.path == path or ep.path.endswith(path)):
                        ep.used_by.extend(sites)
                if key.startswith("axios_path:"):
                    rest = key.split("axios_path:", 1)[1]
                    # METHOD:/path
                    if ":" in rest:
                        mth, path = rest.split(":", 1)
                        if path and (ep.path == path or ep.path.endswith(path)):
                            if not ep.method or mth.upper() in (ep.method or ""):
                                ep.used_by.extend(sites)
            continue

        if ep.kind == "external" and ep.service.startswith("Supabase") and "/rest/v1/" in ep.path:
            table = ep.path.split("/rest/v1/")[-1].split("?")[0]
            for key, sites in usage_map.items():
                if key.startswith(f"supabase:{table}:"):
                    ep.used_by.extend(sites)
            continue

        if ep.kind == "graphql":
            for key, sites in usage_map.items():
                if not key.startswith("graphql_field:"):
                    continue
                rest = key.split("graphql_field:", 1)[1]
                # TYPE:field
                if ":" in rest:
                    op_type, field = rest.split(":", 1)
                    if field == ep.path and (not ep.method or ep.method.upper() == op_type.upper()):
                        ep.used_by.extend(sites)
            continue

        if ep.kind == "ws":
            for key, sites in usage_map.items():
                if key.startswith("ws_connect:") and ep.method == "connect":
                    url = key.split("ws_connect:", 1)[1]
                    if url and url == ep.path:
                        ep.used_by.extend(sites)
                if key.startswith("ws_event:") and ep.method != "connect":
                    ev = key.split("ws_event:", 1)[1]
                    if ev and ev == ep.path:
                        ep.used_by.extend(sites)


def _write_inventory_csv(out_path: Path, endpoints: Sequence[ApiEndpoint]) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "kind",
                "service",
                "method",
                "path",
                "purpose",
                "auth",
                "request_schema",
                "response_schema",
                "query_params",
                "path_params",
                "used_by_files",
                "used_by_symbols",
                "used_by_locations",
                "source",
            ],
        )
        w.writeheader()
        for ep in endpoints:
            used_files = ",".join(sorted({u.file for u in ep.used_by}))
            used_symbols = ",".join(sorted({u.symbol for u in ep.used_by if u.symbol}))
            locs = sorted({f"{u.file}:{u.line}" for u in ep.used_by})
            used_locations = ",".join(locs[:50]) + (",..." if len(locs) > 50 else "")
            w.writerow(
                {
                    "kind": ep.kind,
                    "service": ep.service,
                    "method": ep.method,
                    "path": ep.path,
                    "purpose": ep.purpose,
                    "auth": ep.auth,
                    "request_schema": _fmt_schema(ep.request_schema),
                    "response_schema": _fmt_schema(ep.response_schema),
                    "query_params": _fmt_schema(ep.query_params),
                    "path_params": _fmt_schema(ep.path_params),
                    "used_by_files": used_files,
                    "used_by_symbols": used_symbols,
                    "used_by_locations": used_locations,
                    "source": ep.source,
                }
            )


def _endpoint_label(ep: ApiEndpoint) -> str:
    if ep.kind == "rest":
        return f"REST {ep.method} {ep.path}"
    if ep.kind == "graphql":
        return f"GraphQL {ep.method} {ep.path}"
    if ep.kind == "ws":
        return f"WS {ep.method} {ep.path}"
    if ep.kind == "grpc":
        return f"gRPC {ep.path}"
    if ep.kind == "ipc":
        return f"IPC {ep.method} {ep.path}"
    if ep.kind == "external":
        return f"External {ep.method} {ep.path}"
    return f"{ep.kind} {ep.method} {ep.path}"


def _write_component_api_matrix_wide(out_path: Path, endpoints: Sequence[ApiEndpoint]) -> None:
    """
    Wide CSV matrix: rows=components/files, columns=endpoints, values=call-site count.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    eps = [e for e in endpoints if e.used_by]
    labels = sorted({_endpoint_label(e) for e in eps})
    by_label: Dict[str, ApiEndpoint] = { _endpoint_label(e): e for e in eps }

    components = sorted({u.file for e in eps for u in e.used_by})
    with out_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["component", *labels])
        for comp in components:
            row = [comp]
            for lab in labels:
                e = by_label.get(lab)
                if not e:
                    row.append("0")
                    continue
                row.append(str(sum(1 for u in e.used_by if u.file == comp)))
            w.writerow(row)


def _write_mermaid_graph(out_path: Path, endpoints: Sequence[ApiEndpoint]) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)

    def node_id(prefix: str, value: str) -> str:
        safe = re.sub(r"[^A-Za-z0-9_]", "_", value)
        return f"{prefix}_{safe}"[:80]

    file_nodes: Set[str] = set()
    edges: List[str] = []
    nodes: Set[str] = set()

    for ep in endpoints:
        ep_id = node_id("ep", f"{ep.kind}:{ep.method}:{ep.path}")
        nodes.add(f'{ep_id}(["{ep.kind.upper()}\\n{ep.method} {ep.path}"])')
        for u in ep.used_by:
            f_id = node_id("f", u.file)
            file_nodes.add(f'{f_id}["{u.file}"]')
            edges.append(f"{f_id} --> {ep_id}")

    lines = ["graph TD"]
    lines.extend(sorted(file_nodes))
    lines.extend(sorted(nodes))
    # keep order but de-dup
    seen: Set[str] = set()
    for e in edges:
        if e in seen:
            continue
        seen.add(e)
        lines.append(e)
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _write_sequence_flows(out_path: Path, endpoints: Sequence[ApiEndpoint]) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    lines: List[str] = []
    lines.extend(["# API Call Flows (Mermaid)", ""])

    # Keep a generic "local-first" example if IPC + Supabase + local REST coexist in the repo.
    if any(e.kind == "ipc" for e in endpoints) and any(e.kind == "external" and "Supabase" in e.service for e in endpoints) and any(
        e.kind == "rest" and e.path.startswith("/api/") for e in endpoints
    ):
        lines.extend(
            [
                "## Local-first (example)",
                "```mermaid",
                "sequenceDiagram",
                "  participant UI as UI",
                "  participant IPC as Local IPC",
                "  participant DB as Local DB",
                "  participant Remote as Remote API",
                "  participant Local as Local API",
                "  UI->>IPC: write/read",
                "  IPC->>DB: persist",
                "  UI-->>Remote: background sync",
                "  UI-->>Local: background sync",
                "```",
                "",
            ]
        )

    lines.append("## Auto-generated endpoint flows (top used)")
    ranked = sorted([e for e in endpoints if e.used_by and e.kind in {"rest", "external", "graphql", "ws"}], key=lambda e: len(e.used_by), reverse=True)[:12]
    for ep in ranked:
        title = f"{ep.kind.upper()} {ep.method} {ep.path}"
        origin = sorted({u.file for u in ep.used_by})[:3]
        lines.append(f"### {title}")
        if origin:
            lines.append(f"- Call sites: {', '.join(origin)}" + (" ..." if len({u.file for u in ep.used_by}) > 3 else ""))
        lines.append("```mermaid")
        lines.append("sequenceDiagram")
        lines.append("  participant Client as Client")
        lines.append(f"  participant API as {ep.service}")
        lines.append(f"  Client->>API: {ep.method} {ep.path}")
        lines.append("  API-->>Client: response")
        lines.append("```")
        lines.append("")

    out_path.write_text("\n".join(lines), encoding="utf-8")


def _write_security_report(out_path: Path, root: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    findings: List[str] = []
    env = root / ".env"
    if env.exists():
        findings.append(f"- `.env` exists: `{_safe_rel(root, env)}` (ensure not committed)")
    gitignore = root / ".gitignore"
    if gitignore.exists():
        gi = _read_text(gitignore)
        if ".env" not in gi:
            findings.append("- `.gitignore` does not mention `.env`; ensure secrets are not committed.")
    settings = root / "backend" / "security_api" / "settings.py"
    if settings.exists():
        st = _read_text(settings)
        if "CORS_ALLOW_ALL_ORIGINS = True" in st:
            findings.append("- Django CORS allows all origins in DEBUG; restrict in production.")
        if "dev-insecure-secret-key-change-me" in st:
            findings.append("- Django SECRET_KEY fallback is insecure; must be set in production env.")
        if "LOCAL_SYNC_API_KEY" in st:
            findings.append("- `/api/logs/sync` supports optional `X-Api-Key`; consider requiring it in production.")
        if re.search(r"\bDEBUG\s*=\s*True\b", st):
            findings.append("- Django DEBUG is True in settings; ensure it is disabled in production.")

    # Express/Node heuristics
    pkg = _load_package_json(root)
    deps = {}
    deps.update(pkg.get("dependencies") or {})
    deps.update(pkg.get("devDependencies") or {})
    if "express" in deps:
        js_files = list(_iter_files(root, DEFAULT_EXCLUDES))
        joined = "\n".join(_read_text(p) for p in js_files if p.suffix in {".js", ".ts"})
        if "helmet(" not in joined and "helmet." not in joined:
            findings.append("- Express detected but `helmet` middleware not found (heuristic).")
        if "express-rate-limit" not in deps and "rateLimit(" not in joined:
            findings.append("- No obvious rate limiting detected for Express (heuristic).")
        if "cors(" in joined and ("origin: '*'" in joined or "origin: \"*\"" in joined):
            findings.append("- CORS appears to allow `*` origins (heuristic); restrict if sensitive.")
    mig = root / "migration_script.sql"
    if mig.exists() and "TO public" in _read_text(mig):
        findings.append("- Supabase RLS script uses `TO public` policies (anon access). Review and restrict.")

    out_path.write_text(
        "\n".join(
            [
                "# Security Audit Report (Static)",
                "",
                "## Findings",
                *(findings or ["- No obvious high-signal findings detected by heuristic scan."]),
                "",
                "## Recommendations",
                "- Add secret scanning and rotate keys that were ever committed.",
                "- Apply least privilege for Supabase RLS and local sync endpoint.",
                "- Prefer explicit CORS allow-lists and add rate limiting for public endpoints.",
                "",
            ]
        ),
        encoding="utf-8",
    )


def _write_performance_report(out_path: Path, endpoints: Sequence[ApiEndpoint]) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    ranked = sorted(endpoints, key=lambda e: len(e.used_by), reverse=True)[:15]
    large_payload = []
    for e in endpoints:
        if e.kind != "rest":
            continue
        if any((v.get("type") == "DictField") for v in (e.request_schema or {}).values() if isinstance(v, dict)):
            large_payload.append(e)
    out_path.write_text(
        "\n".join(
            [
                "# Performance Analysis Report (Static)",
                "",
                "## Most referenced endpoints (proxy for call frequency)",
                *[f"- {e.kind.upper()} {e.method} {e.path}: {len(e.used_by)} call sites" for e in ranked],
                "",
                "## Potentially large-payload endpoints (heuristic)",
                *(
                    [f"- {e.method} {e.path} ({e.service})" for e in sorted(large_payload, key=lambda x: x.path)[:20]]
                    if large_payload
                    else ["- None detected via schema heuristics."]
                ),
                "",
                "## Notes",
                "- Static call-site counts do not equal runtime frequency; use telemetry for real numbers.",
                "",
            ]
        ),
        encoding="utf-8",
    )


def _write_test_coverage_report(out_path: Path, root: Path, endpoints: Sequence[ApiEndpoint]) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tests: List[Path] = []
    for p in _iter_files(root, DEFAULT_EXCLUDES):
        rel = _safe_rel(root, p)
        if p.suffix in {".js", ".ts"} and ".test." in p.name:
            tests.append(p)
        elif p.suffix == ".py" and (p.name.startswith("test_") or "/tests/" in rel):
            tests.append(p)

    test_texts = {p: _read_text(p) for p in tests}
    covered: Set[str] = set()
    for ep in endpoints:
        if ep.kind != "rest":
            continue
        for _, txt in test_texts.items():
            if ep.path and ep.path in txt:
                covered.add(f"{ep.method} {ep.path}")

    out_path.write_text(
        "\n".join(
            [
                "# API Test Coverage Report (Static)",
                "",
                f"- Test files detected: {len(tests)}",
                f"- REST endpoints detected: {len([e for e in endpoints if e.kind == 'rest'])}",
                f"- REST endpoints referenced in tests (string match): {len(covered)}",
                "",
                "## Detected test files",
                *[f"- `{_safe_rel(root, p)}`" for p in sorted(tests, key=lambda x: _safe_rel(root, x))],
                "",
            ]
        ),
        encoding="utf-8",
    )


ENV_JS_RE = re.compile(r"\bprocess\.env\.([A-Z0-9_]+)\b")
ENV_DENO_RE = re.compile(r"Deno\.env\.get\(\s*['\"]([A-Z0-9_]+)['\"]\s*\)")
ENV_PY_RE = re.compile(r"os\.environ\.get\(\s*['\"]([A-Z0-9_]+)['\"]")
AXIOS_CREATE_CFG_RE = re.compile(r"""axios\.create\(\s*\{(?P<body>[\s\S]*?)\}\s*\)""", re.MULTILINE)
AXIOS_BASEURL_RE = re.compile(r"""baseURL\s*:\s*(?P<v>[^,\n}]+)""")
AXIOS_HEADERS_RE = re.compile(r"""headers\s*:\s*\{(?P<body>[\s\S]*?)\}""", re.MULTILINE)
AXIOS_INTERCEPTOR_RE = re.compile(r"""\.interceptors\.(request|response)\.use\(""")
SUPABASE_CREATE_RE = re.compile(r"""createClient\(\s*(?P<a1>[^,\n]+)\s*,\s*(?P<a2>[^)\n]+)\)""")
APOLLO_CLIENT_RE = re.compile(r"""new\s+ApolloClient\(\s*\{(?P<body>[\s\S]*?)\}\s*\)""", re.MULTILINE)
GRAPHQL_CLIENT_RE = re.compile(r"""new\s+GraphQLClient\(\s*(?P<q>['"`])(?P<url>[^'"`]+)(?P=q)""")


def _discover_env_vars(files: Sequence[Path]) -> Set[str]:
    out: Set[str] = set()
    for p in files:
        if p.suffix not in {".js", ".ts", ".jsx", ".tsx", ".py"}:
            continue
        txt = _read_text(p)
        out.update(ENV_JS_RE.findall(txt))
        out.update(ENV_DENO_RE.findall(txt))
        out.update(ENV_PY_RE.findall(txt))
    return out


def _discover_api_clients(root: Path, files: Sequence[Path]) -> List[ApiClientConfig]:
    """
    Heuristic API client configuration discovery (base URLs, headers, interceptors).
    """
    out: List[ApiClientConfig] = []
    for p in files:
        if p.suffix not in {".js", ".ts", ".jsx", ".tsx"}:
            continue
        txt = _read_text(p)
        rel = _safe_rel(root, p)

        for m in AXIOS_CREATE_CFG_RE.finditer(txt):
            body = m.group("body") or ""
            base = ""
            bm = AXIOS_BASEURL_RE.search(body)
            if bm:
                base = bm.group("v").strip()
            headers: Dict[str, Any] = {}
            hm = AXIOS_HEADERS_RE.search(body)
            if hm:
                hbody = hm.group("body") or ""
                for km in re.finditer(r"""['"](?P<k>[^'"]+)['"]\s*:\s*(?P<v>[^,\n}]+)""", hbody):
                    headers[km.group("k")] = km.group("v").strip()
            interceptors = []
            if AXIOS_INTERCEPTOR_RE.search(txt):
                interceptors.append("request/response interceptors present")
            out.append(
                ApiClientConfig(
                    kind="axios",
                    base_url=base,
                    headers=headers,
                    interceptors=interceptors,
                    source=f"{rel}:{_find_line_number(txt, m.start())}",
                )
            )

        for m in SUPABASE_CREATE_RE.finditer(txt):
            out.append(
                ApiClientConfig(
                    kind="supabase",
                    base_url=m.group("a1").strip(),
                    notes=f"createClient(url, key) args: {m.group('a1').strip()}, {m.group('a2').strip()}",
                    source=f"{rel}:{_find_line_number(txt, m.start())}",
                )
            )

        for m in GRAPHQL_CLIENT_RE.finditer(txt):
            out.append(
                ApiClientConfig(
                    kind="graphql-request",
                    base_url=m.group("url"),
                    source=f"{rel}:{_find_line_number(txt, m.start())}",
                )
            )

        for m in APOLLO_CLIENT_RE.finditer(txt):
            body = m.group("body") or ""
            uri = ""
            um = re.search(r"""uri\s*:\s*(?P<u>[^,\n}]+)""", body)
            if um:
                uri = um.group("u").strip()
            out.append(
                ApiClientConfig(
                    kind="apollo",
                    base_url=uri,
                    source=f"{rel}:{_find_line_number(txt, m.start())}",
                )
            )

    # de-dupe by kind+base_url+source
    seen: Set[Tuple[str, str, str]] = set()
    deduped: List[ApiClientConfig] = []
    for c in out:
        key = (c.kind, c.base_url, c.source)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(c)
    return deduped


def _write_env_template(out_path: Path, root: Path, used_vars: Set[str]) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    parts: List[str] = []
    parts.append("# Environment Configuration Template")
    parts.append("")
    parts.append("## Detected env vars referenced in code (heuristic)")
    for k in sorted(used_vars):
        parts.append(f"- `{k}`")
    parts.append("")

    def add_example(label: str, path: Path) -> None:
        if not path.exists():
            return
        parts.append(f"## {label}")
        parts.append(f"Source: `{_safe_rel(root, path)}`")
        parts.append("```dotenv")
        parts.append(_read_text(path).strip())
        parts.append("```")
        parts.append("")

    add_example("Root .env.example", root / ".env.example")
    add_example("Backend .env.example", root / "backend" / ".env.example")
    out_path.write_text("\n".join(parts), encoding="utf-8")


def _write_business_mapping_md(
    out_path: Path,
    overview: Dict[str, Any],
    endpoints: Sequence[ApiEndpoint],
    clients: Sequence[ApiClientConfig],
) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    rest = [e for e in endpoints if e.kind == "rest"]
    ipc = [e for e in endpoints if e.kind == "ipc"]
    ext = [e for e in endpoints if e.kind == "external"]
    gql = [e for e in endpoints if e.kind == "graphql"]
    ws = [e for e in endpoints if e.kind == "ws"]
    grpc = [e for e in endpoints if e.kind == "grpc"]

    by_kind = {k: len([e for e in endpoints if e.kind == k]) for k in sorted({e.kind for e in endpoints})}
    by_method: Dict[str, int] = {}
    for e in rest:
        for m in (e.method or "").split(","):
            mm = (m or "").strip() or "(unknown)"
            by_method[mm] = by_method.get(mm, 0) + 1

    public_rest = [e for e in rest if (e.auth or "").lower().startswith("public")]
    authed_rest = [e for e in rest if e not in public_rest]

    lines: List[str] = []
    lines.append("# Project API Business Mapping")
    lines.append("")
    lines.append("## Project Overview")
    lines.append(f"- Backend Framework: {overview.get('backend_framework') or 'Unknown'}")
    lines.append(f"- Frontend Framework: {overview.get('frontend_framework') or 'Unknown'}")
    lines.append(f"- API Architecture Pattern: {overview.get('api_architecture')}")
    lines.append(f"- Authentication Method: {overview.get('auth')}")
    lines.append("")
    lines.append("## 1. API Endpoints Summary")
    lines.append(f"- Total endpoints count: {len(endpoints)}")
    lines.append(f"- Endpoints by kind: {json.dumps(by_kind, ensure_ascii=False)}")
    lines.append(f"- Endpoints by HTTP method (REST): {json.dumps(by_method, ensure_ascii=False)}")
    lines.append(f"- Public vs authenticated (REST): {len(public_rest)} public / {len(authed_rest)} auth/other")
    lines.append("- API versioning strategy: (heuristic) path-prefix if present (e.g. `/api/v1`).")
    lines.append("")

    lines.append("## 2. Complete API Registry")
    lines.append("")
    lines.append("### REST APIs")
    lines.append("| Endpoint | Method | Purpose | Auth Required | Request Schema | Response Schema | Used By Components | Source |")
    lines.append("|---|---|---|---|---|---|---|---|")
    for ep in sorted(rest, key=lambda e: (e.path, e.method, e.service)):
        used = ", ".join(sorted({u.file for u in ep.used_by}))
        lines.append(
            "| "
            + " | ".join(
                [
                    _md_escape(ep.path),
                    _md_escape(ep.method),
                    _md_escape(ep.purpose or ep.service),
                    _md_escape(ep.auth),
                    _md_escape(_fmt_schema(ep.request_schema)),
                    _md_escape(_fmt_schema(ep.response_schema)),
                    _md_escape(used),
                    _md_escape(ep.source),
                ]
            )
            + " |"
        )
    lines.append("")

    lines.append("### GraphQL APIs")
    if not gql:
        lines.append("_No GraphQL schema/resolvers detected by heuristic scan._")
        lines.append("")
    else:
        lines.append("| Query/Mutation | Type | Purpose | Auth Required | Input Type | Return Type | Used By Components | Source |")
        lines.append("|---|---|---|---|---|---|---|---|")
        for ep in sorted(gql, key=lambda e: (e.method, e.path, e.service)):
            used = ", ".join(sorted({u.file for u in ep.used_by}))
            lines.append(
                "| "
                + " | ".join(
                    [
                        _md_escape(ep.path),
                        _md_escape(ep.method),
                        _md_escape(ep.purpose or ep.service),
                        _md_escape(ep.auth),
                        _md_escape(_fmt_schema(ep.request_schema)),
                        _md_escape(_fmt_schema(ep.response_schema)),
                        _md_escape(used),
                        _md_escape(ep.source),
                    ]
                )
                + " |"
            )
        lines.append("")

    lines.append("### gRPC APIs")
    if not grpc:
        lines.append("_No gRPC `.proto` services detected by heuristic scan._")
        lines.append("")
    else:
        lines.append("| Service/Method | Kind | Purpose | Auth Required | Request Type | Response Type | Used By Components | Source |")
        lines.append("|---|---|---|---|---|---|---|---|")
        for ep in sorted(grpc, key=lambda e: (e.service, e.path)):
            used = ", ".join(sorted({u.file for u in ep.used_by}))
            lines.append(
                "| "
                + " | ".join(
                    [
                        _md_escape(ep.path),
                        "rpc",
                        _md_escape(ep.purpose or ep.service),
                        _md_escape(ep.auth),
                        _md_escape(_fmt_schema(ep.request_schema)),
                        _md_escape(_fmt_schema(ep.response_schema)),
                        _md_escape(used),
                        _md_escape(ep.source),
                    ]
                )
                + " |"
            )
        lines.append("")

    lines.append("### WebSocket Events")
    if not ws:
        lines.append("_No WebSocket server/client detected by heuristic scan._")
        lines.append("")
    else:
        lines.append("| Event Name / URL | Direction | Purpose | Payload Schema | Used By Components | Source |")
        lines.append("|---|---|---|---|---|---|")
        for ep in sorted(ws, key=lambda e: (e.service, e.method, e.path)):
            used = ", ".join(sorted({u.file for u in ep.used_by}))
            lines.append(
                "| "
                + " | ".join(
                    [
                        _md_escape(ep.path),
                        _md_escape(ep.method),
                        _md_escape(ep.purpose or ep.service),
                        _md_escape(_fmt_schema(ep.request_schema)),
                        _md_escape(used),
                        _md_escape(ep.source),
                    ]
                )
                + " |"
            )
        lines.append("")

    lines.append("### Electron IPC (Internal)")
    lines.append("| Channel | Direction | Purpose | Payload Schema | Used By Components | Source |")
    lines.append("|---|---|---|---|---|---|")
    for ep in sorted(ipc, key=lambda e: e.path):
        used = ", ".join(sorted({u.file for u in ep.used_by}))
        lines.append(
            "| "
            + " | ".join(
                [
                    _md_escape(ep.path),
                    "Renderer -> Main (invoke)",
                    _md_escape(ep.purpose),
                    "",
                    _md_escape(used),
                    _md_escape(ep.source),
                ]
            )
            + " |"
        )
    lines.append("")

    lines.append("### External APIs")
    lines.append("| Service | Endpoint | Purpose | Authentication | Used By | Source |")
    lines.append("|---|---|---|---|---|---|")
    for ep in sorted(ext, key=lambda e: (e.service, e.path)):
        used = ", ".join(sorted({u.file for u in ep.used_by}))
        lines.append(
            "| "
            + " | ".join(
                [
                    _md_escape(ep.service),
                    _md_escape(ep.path),
                    _md_escape(ep.purpose),
                    _md_escape(ep.auth),
                    _md_escape(used),
                    _md_escape(ep.source),
                ]
            )
            + " |"
        )
    lines.append("")

    lines.append("## 3. Frontend API Usage Map")
    lines.append("")
    lines.append("### By Component/Page (static scan)")
    by_file: Dict[str, List[ApiEndpoint]] = {}
    for ep in endpoints:
        for u in ep.used_by:
            by_file.setdefault(u.file, []).append(ep)
    for f in sorted(by_file.keys()):
        eps = by_file[f]
        lines.append(f"**{f}**")
        for ep in sorted({(e.kind, e.method, e.path) for e in eps}):
            lines.append(f"- {ep[0].upper()} {ep[1]} {ep[2]}")
        lines.append("")

    lines.append("### By API Endpoint (static scan)")
    for ep in sorted(rest, key=lambda e: (e.path, e.method)):
        lines.append(f"**{ep.method} {ep.path}**")
        if ep.used_by:
            files = sorted({u.file for u in ep.used_by})
            lines.append(f"- Consumed by: {', '.join(files)}")
        else:
            lines.append("- Consumed by: (not found by static scan)")
        lines.append(f"- Auth: {ep.auth}")
        lines.append("")

    lines.append("## 4. API Architecture Patterns")
    lines.append("- Auth flows, middleware/guards/interceptors, caching, and rate limiting are inferred heuristically; verify against runtime config.")
    lines.append("- API versioning is inferred via path prefixes (e.g. `/api/v1`).")
    lines.append("")

    lines.append("## 5. Data Flow Analysis")
    lines.append("- Component -> API edges are derived from static call-site scanning (fetch/axios/supabase/ipc/graphql/ws).")
    lines.append("- For SSR/SSG frameworks, server-side calls may not be fully captured without runtime tracing.")
    lines.append("")

    lines.append("## 6. Dependencies and Configurations")
    lines.append("### HTTP/API clients (heuristic)")
    if clients:
        for c in clients:
            bits = [c.kind]
            if c.base_url:
                bits.append(f"base_url={c.base_url}")
            if c.headers:
                bits.append("headers=" + json.dumps(c.headers, ensure_ascii=False))
            if c.interceptors:
                bits.append("interceptors=" + ", ".join(c.interceptors))
            if c.notes:
                bits.append(c.notes)
            lines.append(f"- `{c.source}`: " + " | ".join(bits))
    else:
        lines.append("- No high-signal client configs found.")
    lines.append("")

    dep = overview.get("dependency_hints") or {}
    if dep:
        lines.append("### Detected tooling/libraries (heuristic)")
        for k in sorted(dep.keys()):
            vals = dep.get(k) or []
            if vals:
                lines.append(f"- {k}: {', '.join(vals)}")
        lines.append("")

    lines.append("## 7. Security Analysis (summary)")
    lines.append("- Review secrets management and rotate any keys that were ever committed.")
    lines.append("- Review CORS rules, auth guards, and Supabase RLS policies for least privilege.")
    lines.append("")

    lines.append("## 8. Performance Insights")
    ranked = sorted(endpoints, key=lambda e: len(e.used_by), reverse=True)[:10]
    lines.append("### Most referenced endpoints (static proxy)")
    for e in ranked:
        lines.append(f"- {e.kind.upper()} {e.method} {e.path}: {len(e.used_by)} call sites")
    lines.append("")

    lines.append("## 9. API Health Check")
    unused_rest = [e for e in rest if not e.used_by]
    lines.append(f"- Unused REST endpoints (no call sites found): {len(unused_rest)}")
    if unused_rest:
        for e in sorted(unused_rest, key=lambda x: (x.path, x.method))[:20]:
            lines.append(f"  - {e.method} {e.path} ({e.service})")
        if len(unused_rest) > 20:
            lines.append("  - ... (truncated)")
    lines.append("")

    lines.append("## 10. Recommendations")
    lines.append("- Add OpenAPI/Swagger (or equivalent) generation to make schemas authoritative.")
    lines.append("- Add contract tests for critical endpoints and automate in CI.")
    lines.append("- Add centralized error handling and consistent response envelopes where appropriate.")
    lines.append("")

    out_path.write_text("\n".join(lines), encoding="utf-8")


def main(argv: Optional[Sequence[str]] = None) -> int:
    ap = argparse.ArgumentParser(
        description="Generate a framework-agnostic API business mapping (docs + CSV + mermaid)."
    )
    ap.add_argument("--root", default=".", help="Project root (default: .)")
    ap.add_argument("--out", default="docs/api-business-mapping", help="Output directory (relative to root)")
    ap.add_argument(
        "--exclude",
        action="append",
        default=[],
        help="Extra directory names to exclude (repeatable)",
    )
    args = ap.parse_args(argv)

    root = Path(args.root).resolve()
    out_dir = (root / args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    excludes = set(DEFAULT_EXCLUDES)
    excludes.update(args.exclude)

    exclude_prefixes = list(DEFAULT_EXCLUDE_PATH_PREFIXES)
    exclude_prefixes.append(_safe_rel(root, out_dir))
    exclude_prefixes.append("scripts/api_business_mapper.py")
    files = list(_iter_files(root, excludes, exclude_path_prefixes=exclude_prefixes))
    pkg = _load_package_json(root)

    overview = {
        "backend_framework": _detect_backend_framework(root, pkg),
        "frontend_framework": _detect_frontend_framework(pkg),
        "api_architecture": _detect_api_architecture(files),
        "auth": _detect_auth(root, pkg, files),
        "dependency_hints": _discover_dependency_hints(root, pkg),
    }

    endpoints: List[ApiEndpoint] = []
    endpoints.extend(_discover_django_endpoints(root))
    endpoints.extend(_discover_fastapi_flask_endpoints(root, files))
    endpoints.extend(_discover_express_endpoints(root, files))
    endpoints.extend(_discover_next_api_routes(root, files))
    endpoints.extend(_discover_nestjs_endpoints(root, files))
    endpoints.extend(_discover_spring_endpoints(root, files))
    endpoints.extend(_discover_netlify_functions(root))
    endpoints.extend(_discover_supabase_edge_functions(root))
    endpoints.extend(_discover_electron_ipc(root))
    endpoints.extend(_discover_graphql_schema(root, files))
    endpoints.extend(_discover_grpc_from_proto(root, files))
    endpoints.extend(_discover_websocket_events(root, files))
    endpoints = _dedupe_endpoints(endpoints)

    usage_map, externals = _discover_frontend_usages(root, files)
    _attach_usages(endpoints, usage_map)
    _attach_usages(externals, usage_map)

    all_eps = endpoints + externals
    env_vars = _discover_env_vars(files)
    clients = _discover_api_clients(root, files)

    _write_business_mapping_md(out_dir / "API_BUSINESS_MAPPING.md", overview, all_eps, clients)
    _write_inventory_csv(out_dir / "api-inventory.csv", all_eps)
    _write_inventory_csv(out_dir / "component-to-api-matrix.csv", all_eps)
    _write_component_api_matrix_wide(out_dir / "component-to-api-matrix-wide.csv", all_eps)
    _write_mermaid_graph(out_dir / "api-dependency-graph.mmd", all_eps)
    _write_sequence_flows(out_dir / "api-call-flows.md", all_eps)
    _write_security_report(out_dir / "security-audit.md", root)
    _write_performance_report(out_dir / "performance-report.md", all_eps)
    _write_test_coverage_report(out_dir / "api-test-coverage.md", root, all_eps)
    _write_env_template(out_dir / "env-template.md", root, env_vars)

    print(f"Wrote outputs to: {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
