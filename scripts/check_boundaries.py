#!/usr/bin/env python3
r"""Enforce the main/renderer process boundary.

Exit codes: 0 = clean, 2 = violation, bad invocation or internal error. Never anything else
(decision D-003; Claude Code hooks treat exit 2 as "blocking, feed stderr back to the agent").

The rule is an ALLOW-LIST (interface.md section 1), not a list of known bad spellings.

renderer/  Every text file under renderer/ is scanned, whatever its extension. Only the top-level
           build/vendor directories renderer/node_modules and renderer/dist are skipped; a directory
           with the same name deeper in the source is scanned like any other.
           Every path-like token in a file - quoted or not: import/export/require specifiers,
           import() templates, import.meta.glob patterns, new URL(...), ?raw/?url, fs paths, vite
           aliases, tsconfig paths, package.json scripts, shell commands, CSS url(), HTML
           attributes - is resolved lexically:
             * from the file's own directory, always;
             * from renderer/ as well (the cwd of every npm script and of vitest), unless the token
               is provably file-relative: a module specifier, new URL(x, import.meta.url), or an
               argument of a call anchored on __dirname / import.meta.dirname / import.meta.url;
             * '/x' the way vite reads it (renderer/x) and as an absolute filesystem path.
           Every reading must land inside renderer/, on artifacts/ or artifacts/<name>.json, or on
           contracts/ or contracts/<name>.json. Everything else is a violation: main/, scripts/,
           data/, the repository root, anything above it, and a wildcard or ${...} that can match
           outside the allowed set.
           Absolute filesystem spellings (file:, /@fs/, C:\..., \\host\share, //host/share) are
           violations on every OS. A '/'-rooted path is a violation when it points into this
           checkout under any of its spellings (/mnt/d/x, D:/x, /cygdrive/d/x).
           Running the backend counts: `labyrinth_main.<module>`, `-m labyrinth_main`, `cd main`,
           `--prefix main` in package.json scripts, shell files and strings.
main/      Python is parsed with ast: imports of `renderer`, importlib / __import__ of it, and every
           non-docstring string that names the renderer directory as a path or a command target
           ("renderer", "../renderer", "npm --prefix ../renderer run build", "cd renderer && ...",
           a glob that can match it). Every other text file under main/ gets the same path rules.
           Top-level caches (main/.venv, .pytest_cache, .ruff_cache, .mypy_cache, __pycache__) are
           skipped; the same names deeper in the package are scanned.

All path logic is pure string / posixpath, never the host's Path semantics, so a verdict is the
same on Linux, WSL and native Windows (the PostToolUse hook runs under native Windows Python, the
verify gate under WSL).

Usage:
  check_boundaries.py                 scan the whole repo
  check_boundaries.py FILE [FILE...]  scan only these files (used by the edit hook)
  check_boundaries.py --self-test     prove the checker catches every known violation shape
"""
from __future__ import annotations

import ast
import bisect
import fnmatch
import functools
import os
import posixpath
import re
import sys
import tempfile
import traceback
from pathlib import Path

ROOT = Path(os.environ.get("LABYRINTH_ROOT") or Path(__file__).resolve().parent.parent).resolve()

SIDES = ("main", "renderer")
BACKEND_TREES = frozenset({"main", "scripts", "data"})  # only limits the url_only exemption; the rule itself is the allow-list
# Skipped ONLY directly under main/ or renderer/.
SKIP_TOP = {
    "renderer": frozenset({"node_modules", "dist"}),
    "main": frozenset({".venv", "venv", ".pytest_cache", ".ruff_cache", ".mypy_cache", "__pycache__"}),
}
JS_EXT = frozenset({".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue", ".svelte", ".astro"})
MARKUP_EXT = frozenset({".css", ".scss", ".sass", ".less", ".html", ".htm", ".svg", ".md", ".mdx"})
DOC_EXT = frozenset({".md", ".mdx"})
PY_EXT = frozenset({".py", ".pyi", ".pyw"})
# Always source text: a NUL byte in one of these is reported, not skipped as "binary".
TEXT_EXT = JS_EXT | MARKUP_EXT | PY_EXT | frozenset({".json", ".sh", ".bash", ".toml", ".yaml", ".yml", ".cfg", ".ini", ".txt", ".env"})
# Never text, not opened (compiled bytecode, images, fonts, data): nothing in them is a specifier.
BINARY_EXT = frozenset({".pyc", ".pyo", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".eot",
                        ".pdf", ".zip", ".gz", ".nc", ".h5", ".npy", ".npz", ".wasm", ".mp3", ".mp4", ".webm"})

INTERP = re.compile(r"\$\{[^}\n]*\}")
TOKEN = re.compile(r"[^\s'\"`<>(),;|&=]+")
STRING = re.compile(r"""'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`""")
STRING_ARG = re.compile(r"\s*(" + STRING.pattern + r")\s*(?:,|$)")
WILD = re.compile(r"[*?\[\]{}$]")
DRIVE = re.compile(r"^[A-Za-z]:[/\\]")
UNC = re.compile(r"^/{2,}[A-Za-z0-9][\w.$-]*/+[\w.$-]+(?:/|$)")  # //host/share; not a regex like \/\/.*$/gm
TEST_FILE = re.compile(r"\.(?:test|spec)\.[cm]?[jt]sx?$")
URL_SCHEME = re.compile(r"^([A-Za-z][A-Za-z0-9+.-]+)://")  # two letters or more: 'C://x' is a drive, not a scheme
WSL_UNC = re.compile(r"^//(?:wsl\.localhost|wsl\$)/[^/]+(?=/)", re.I)

# --- renderer: contexts in which a string is resolved from the file's directory only -------------
ANCHOR = re.compile(r"\b__dirname\b|\b__filename\b|\bimport\.meta\.(?:dirname|filename|url)\b")
SPEC_KEYWORD = re.compile(r"(?:\bfrom|\bimport)\s*$")
SPEC_CALLEES = frozenset({
    "import", "require", "require.resolve", "import.meta.glob", "import.meta.globEager", "import.meta.resolve",
    "vi.mock", "vi.doMock", "vi.unmock", "vi.doUnmock", "vi.importActual", "vi.importMock",
    "jest.mock", "jest.doMock", "jest.unmock", "jest.requireActual", "jest.requireMock",
})
LEADING_STRINGS = re.compile(r"""[\s\[,]*(?:(?:'[^'\n]*'|"[^"\n]*"|`[^`]*`)[\s,]*)*""")
CALLEE = re.compile(r"([\w$.]+)\s*$")
NEW_URL = re.compile(r"\bnew\s+URL\s*$")
META_URL_NEXT = re.compile(r"\s*,\s*import\.meta\.url\b")
# A bare '..' / '../' compared or searched for, never opened: x.startsWith('..'), seg === '..'.
INERT_METHODS = frozenset({"startsWith", "endsWith", "includes", "indexOf", "lastIndexOf", "split", "replace", "replaceAll",
                           "toBe", "toEqual", "toStrictEqual", "toContain", "toMatch"})
CMP_BEFORE = re.compile(r"(?:[=!]==?|\bcase)\s*$")
CMP_AFTER = re.compile(r"\s*[=!]==?")

# --- naming or running the other side ------------------------------------------------------------
_CD = r"(?:\bcd|\bpushd|--prefix|--cwd|--dir|--root|-C)(?:=|\s+)[\"']?(?:\.{1,2}[/\\])*"
CD_BACKEND = re.compile(_CD + r"main(?![\w.-])")
CD_FRONTEND = re.compile(_CD + r"renderer(?![\w.-])", re.I)
BACKEND_MODULE = re.compile(r"labyrinth_main[./]\w|-m\s+[\"']?labyrinth_main\b")
BACKEND_WORD = re.compile(r"\blabyrinth_main\b")
BARE_BACKEND = re.compile(r"^@?main/[\w.*$\{@-]")  # 'main/x', '@main/x'; the bare label 'main/' is not a path
BARE_BACKEND_TOKEN = re.compile(r"^@?main/[\w*$\{]")
RENDERER_SEG = re.compile(r"[/\\]renderer(?![\w.-])|^renderer[/\\]", re.I)
RENDERER_MODULE = re.compile(r"^renderer(?:\.\w+)*$")
MODULE_LOADERS = frozenset({"import_module", "__import__", "run_module", "find_spec", "resolve_name", "walk_packages", "get_data"})


# ================================ pure path logic (no host semantics) ============================

def _posix(s: str) -> str:
    return s.replace("\\", "/")


@functools.lru_cache(maxsize=32)
def root_aliases(root: str) -> tuple[str, ...]:
    """Lower-cased spellings under which the same checkout is reachable on a Windows + WSL machine."""
    r = _posix(root).rstrip("/") or "/"
    out = {r}
    m = re.match(r"^([A-Za-z]):(/.*)?$", r) or re.match(r"^/(?:mnt|cygdrive)/([A-Za-z])(/.*)?$", r)
    if m:
        d, rest = m.group(1).lower(), m.group(2) or ""
        out |= {f"{d}:{rest}", f"/mnt/{d}{rest}", f"/cygdrive/{d}{rest}", f"/{d}{rest}"}
    return tuple(sorted({a.lower() for a in out}))


def rel_of(path: str, root: str) -> str | None:
    """Repo-relative posix path of `path` ('' for the root itself), or None when it is outside the checkout."""
    p = posixpath.normpath(WSL_UNC.sub("", _posix(path)))
    low = p.lower()
    for a in root_aliases(root):
        if low == a:
            return ""
        if low.startswith(a + "/"):
            return p[len(a) + 1:]
    return None


def _resolve(base: list[str], segs: list[str]) -> list[str] | None:
    """Lexical join of repo-relative segments. None = the path climbs above the repository root."""
    out = list(base)
    for s in segs:
        if s in ("", "."):
            continue
        if s == "..":
            if not out:
                return None
            if "**" in out.pop():  # '**' may have matched nothing: the parent goes too
                if not out:
                    return None
                out.pop()
            continue
        out.append(s)
    return out


def _renderer_ok(p: list[str] | None, importing: bool) -> str | None:
    """None when the repo-relative path `p` is inside the renderer's allow-list, else the reason it is not."""
    if p is None:
        return "climbs above the repository root"
    if not p:
        return "resolves to the repository root"
    head = p[0]
    if head == "renderer":
        if importing and len(p) > 1 and p[1] in SKIP_TOP["renderer"]:
            return f"imports from the unscanned directory renderer/{p[1]}/"
        return None
    if head in ("artifacts", "contracts") and (len(p) == 1 or (len(p) == 2 and p[1].endswith(".json"))):
        return None
    if WILD.search(head):
        return f"has a wildcard ('{head}') that can match outside renderer/"
    return f"resolves to {'/'.join(p)}, outside renderer/ (allowed: contracts/*.json, artifacts/*.json)"


def _pieces(token: str, escapes: bool = False):
    """Split one whitespace/quote-delimited token into path candidates (PATH-style a:b lists, URLs).

    escapes=True (JS/TS/JSON source): a backslash is an escape character, so only '\\\\' (an escaped
    backslash, i.e. a Windows separator inside a string) and '\\/' become '/'; a regex such as
    /\\.test\\.tsx?$/ is not turned into a path. Elsewhere every backslash is a separator.
    """
    t = (token.replace("\\\\", "/").replace("\\/", "/") if escapes else _posix(token)).lstrip("!")
    m = URL_SCHEME.match(t)
    if m:
        if m.group(1).lower() == "file":
            yield t
        return
    if t[:5].lower() == "file:":
        yield t
        return
    parts = t.split(":")
    if len(parts) > 1 and len(parts[0]) == 1 and parts[0].isalpha() and parts[1][:1] in ("/", "\\"):
        parts[:2] = [parts[0] + ":" + parts[1]]  # a drive letter, not a separator
    for p in parts:
        if p:
            yield _trim(p)


def _trim(piece: str) -> str:
    cut = min((i for i in (piece.find("?"), piece.find("#")) if i >= 0), default=-1)
    if cut >= 0 and "/" not in piece[cut:]:
        piece = piece[:cut]  # ?raw, ?url, #hash
    if piece.rsplit("/", 1)[-1] not in (".", ".."):
        piece = piece.rstrip(".,:;!?")  # sentence punctuation; Windows ignores trailing dots anyway
    return piece


def _renderer_piece(piece: str, ctx: str, file_dir: list[str], aliases: tuple[str, ...], url_only: bool = False) -> str | None:
    """Reason why one path candidate in a renderer file violates the allow-list, or None.

    url_only: a '/'-rooted string that is not a module specifier, in a test file (a request path handed
    to the code under test, e.g. '/../package.json' to prove the dev middleware rejects it) or outside
    any string (comment, regex). Vite never resolves it, so its vite-root reading is tolerated - unless
    it names main/, scripts/ or data/ or carries a wildcard, which no such test needs to spell.
    """
    low = piece.lower()
    if low.startswith("file:"):
        return "is a file: URL (an absolute filesystem path)" if len(piece.rstrip("/")) > 5 else None
    if DRIVE.match(piece):
        return "is a drive-letter absolute path"
    if low.startswith("/@fs"):
        return "is a vite /@fs/ raw-filesystem URL"
    if piece.startswith("//"):
        if ctx == "loose":
            return None  # a // comment in JS/TS source
        if UNC.match(piece):
            return "is a UNC or protocol-relative absolute path"
        piece = "/" + piece.lstrip("/")
    segs = piece.split("/")
    climbs = ".." in segs
    importing = ctx == "spec"
    if piece.startswith("/"):
        norm = posixpath.normpath(piece)
        nl = norm.lower()
        for a in aliases:
            if nl == a or nl.startswith(a + "/"):
                why = _renderer_ok([s for s in norm[len(a):].split("/") if s], importing)
                if why:
                    return f"is an absolute path into this checkout: {why}"
                break
        if climbs or importing:
            why = _renderer_ok(_resolve(["renderer"], segs), importing)
            # url_only admits a request path such as '/../package.json' or '/../../etc/passwd', never one
            # that names a backend tree or carries a wildcard
            if why and not (url_only and not any(s in BACKEND_TREES or WILD.search(s) for s in segs)):
                return f"{why} (vite reads '/x' from renderer/)"
        return None
    if not climbs:
        return None
    bare_up = all(s in ("", ".", "..") for s in segs)  # '..', '../..': names nothing by itself
    if ctx == "cmp" and bare_up:
        return None
    bases = [file_dir] if bare_up or ctx in ("spec", "file", "anchored", "loose") else [file_dir, ["renderer"]]
    for base in bases:
        why = _renderer_ok(_resolve(base, segs), importing)
        if why:
            hint = "" if len(bases) == 1 else " - anchor it with import.meta.dirname or new URL(x, import.meta.url) if it is file-relative"
            return f"{why} when read from {'/'.join(base)}/{hint}"
    return None


def _js_context(text: str, q: int, end: int) -> tuple[str, int]:
    """Classify the string literal opening at text[q] whose first token ends at `end`.

    spec      module specifier: resolved from the file's directory
    file      new URL(x, import.meta.url)
    anchored  argument of a call whose earlier arguments contain __dirname / import.meta.dirname / .url
    cmp       compared or searched for, not opened (only a bare '..' is exempted)
    plain     anything else: must be valid from the file's directory AND from renderer/
    Returns (context, absolute index of the enclosing '(' for anchored calls or -1).
    """
    start = max(0, q - 240)
    pre = text[start:q]
    after = text[end + 1:end + 60] if text[end:end + 1] == text[q] else ""
    if SPEC_KEYWORD.search(pre):
        return "spec", -1
    depth, open_at = 0, -1
    for i in range(len(pre) - 1, -1, -1):
        c = pre[i]
        if c == ")":
            depth += 1
        elif c == "(":
            if depth == 0:
                open_at = i
                break
            depth -= 1
    if open_at >= 0:
        head, args = pre[:open_at].rstrip(), pre[open_at + 1:]
        if head.endswith(">") and not head.endswith("=>"):  # vi.importActual<typeof import('./x')>('./x')
            depth = 0
            for j in range(len(head) - 1, -1, -1):
                if head[j] == ">":
                    depth += 1
                elif head[j] == "<":
                    depth -= 1
                    if depth == 0:
                        head = head[:j]
                        break
        m = CALLEE.search(head)
        callee = m.group(1) if m else ""
        first = not args.strip(" \t\r\n[")
        if callee in SPEC_CALLEES and LEADING_STRINGS.fullmatch(args):
            return "spec", -1
        if callee == "URL" and first and NEW_URL.search(head) and META_URL_NEXT.match(after):
            return "file", -1
        if ANCHOR.search(args):
            return "anchored", start + open_at
        if first and "." in callee and callee.rsplit(".", 1)[1] in INERT_METHODS:
            return "cmp", -1
    if CMP_BEFORE.search(pre) or CMP_AFTER.match(after):
        return "cmp", -1
    return "plain", -1


def _anchored_join(text: str, open_at: int) -> str | None:
    """join(__dirname, '..', '..', 'main') -> '../../main': the string arguments after the first one."""
    depth, close = 0, -1
    for i in range(open_at, min(len(text), open_at + 600)):
        c = text[i]
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                close = i
                break
    if close < 0:
        return None
    body, prev = text[open_at + 1:close], None
    while prev != body:
        prev, body = body, re.sub(r"\([^()]*\)", "", body)
    _, comma, rest = body.partition(",")
    parts, pos = [], 0
    while comma:
        m = STRING_ARG.match(rest, pos)
        if not m:
            break
        parts.append(m.group(1)[1:-1])
        pos = m.end()
    return "/".join(parts) if len(parts) > 1 else None


def scan_renderer(rel: str, text: str, aliases: tuple[str, ...]) -> dict[int, str]:
    """{line: message} for every allow-list violation in one renderer file. Pure: no filesystem access."""
    ext = posixpath.splitext(rel)[1].lower()
    kind = "js" if ext in JS_EXT else "markup" if ext in MARKUP_EXT else "json" if ext == ".json" else "other"
    file_dir = rel.split("/")[:-1]
    escapes = kind in ("js", "json")
    is_test = kind == "js" and bool(TEST_FILE.search(rel))
    masked = INTERP.sub(lambda m: "${" + "_" * (len(m.group()) - 3) + "}", text)
    found: dict[int, str] = {}

    def report(pos: int, msg: str) -> None:
        found.setdefault(masked.count("\n", 0, pos) + 1, msg)

    spans = [m.span() for m in STRING.finditer(masked)] if kind == "js" else []
    starts = [s for s, _ in spans]

    def in_string(pos: int) -> bool:
        i = bisect.bisect_right(starts, pos) - 1
        return i >= 0 and pos < spans[i][1]

    # In JS/TS source both rules apply inside string literals only: JSX text and comments may show the
    # regeneration command to a human; a string can be handed to a shell.
    for m in CD_BACKEND.finditer(masked):
        if kind != "js" or in_string(m.start()):
            report(m.start(), f"command enters or targets the backend tree ('{m.group()}')")
    if ext not in DOC_EXT:
        for m in (BACKEND_WORD if kind == "other" else BACKEND_MODULE).finditer(masked):
            if kind != "js" or in_string(m.start()):
                report(m.start(), f"names the backend package ('{m.group()}'): the renderer never imports or runs labyrinth_main")

    for m in TOKEN.finditer(masked):
        tok = m.group()
        if "/" not in tok and "\\" not in tok and tok != "..":
            continue
        pos = m.start()
        quoted = pos > 0 and masked[pos - 1] in "'\"`"
        if (quoted and kind in ("js", "json") and BARE_BACKEND.match(tok)) or (kind == "other" and BARE_BACKEND_TOKEN.match(tok)):
            report(pos, f"renderer references the backend tree by name ('{tok}')")
            continue
        ctx: str | None = "file" if kind == "markup" else None if kind == "js" else "plain"
        call_open = -1
        for piece in _pieces(tok, escapes):
            if not (piece.startswith("/") or ".." in piece or DRIVE.match(piece) or piece[:5].lower() == "file:"):
                continue
            if ctx is None:  # computed once, and only for tokens that can leave
                if quoted:
                    ctx, call_open = _js_context(masked, pos - 1, m.end())
                else:
                    ctx = "plain" if in_string(pos) else "loose"
            why = _renderer_piece(piece, ctx, file_dir, aliases, url_only=ctx == "loose" or (is_test and ctx in ("plain", "cmp")))
            if why:
                report(pos, f"renderer path '{tok}' {why}")
                break
        if ctx == "anchored":
            joined = _anchored_join(masked, call_open)
            why = _renderer_piece(_trim(next(_pieces(joined, escapes), "")), "anchored", file_dir, aliases) if joined else None
            if why:
                report(pos, f"renderer path '{joined}' (joined arguments) {why}")
    return found


def _main_path(token: str, file_dir: list[str]) -> str | None:
    """Reason why one path token in a main/ file reaches the renderer tree, or None."""
    if RENDERER_SEG.search(token):
        return "names the renderer directory"
    for piece in _pieces(token):
        segs = piece.split("/")
        if ".." not in segs or piece.startswith("/"):
            continue
        for base in (file_dir, ["main"]):
            p = _resolve(base, segs)
            if not p:
                continue
            head = p[0]
            if head.lower() == "renderer" or (WILD.search(head) and (re.search(r"[{$]", head) or fnmatch.fnmatchcase("renderer", head))):
                return f"can reach the renderer directory when read from {'/'.join(base)}/"
    return None


def _main_string(value: str, file_dir: list[str]) -> str | None:
    if value == "renderer":
        return "names the renderer directory or module"
    m = CD_FRONTEND.search(value)
    if m:
        return f"command enters or targets the frontend tree ('{m.group()}')"
    if "/" not in value and "\\" not in value:
        return None
    for tm in TOKEN.finditer(INTERP.sub("${}", value)):
        why = _main_path(tm.group(), file_dir)
        if why:
            return why
    return None


def _docstring_nodes(tree: ast.AST) -> set[int]:
    ids = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            body = getattr(node, "body", [])
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) and isinstance(body[0].value.value, str):
                ids.add(id(body[0].value))
    return ids


def _is_renderer_module(name: str | None) -> bool:
    return bool(name) and (name == "renderer" or name.startswith("renderer."))


def scan_main_py(rel: str, text: str) -> list[str]:
    errors: list[str] = []
    file_dir = rel.split("/")[:-1]
    try:
        tree = ast.parse(text, filename=rel)
    except (SyntaxError, ValueError) as e:
        return [f"{rel}:{getattr(e, 'lineno', None) or '?'}: cannot parse ({getattr(e, 'msg', e)}); boundary cannot be verified"]
    docstrings = _docstring_nodes(tree)
    for node in ast.walk(tree):
        where = f"{rel}:{getattr(node, 'lineno', '?')}"
        if isinstance(node, ast.Import):
            for a in node.names:
                if _is_renderer_module(a.name):
                    errors.append(f"{where}: main imports frontend module '{a.name}'")
        elif isinstance(node, ast.ImportFrom):
            if node.level == 0 and _is_renderer_module(node.module):
                errors.append(f"{where}: main imports frontend module '{node.module}'")
        elif isinstance(node, ast.Call):
            fn = node.func
            name = fn.attr if isinstance(fn, ast.Attribute) else fn.id if isinstance(fn, ast.Name) else ""
            if name in MODULE_LOADERS:
                for a in node.args:
                    if isinstance(a, ast.Constant) and isinstance(a.value, str) and RENDERER_MODULE.match(a.value) and a.value != "renderer":
                        errors.append(f"{where}: main dynamically imports frontend module '{a.value}'")
        elif isinstance(node, ast.Constant) and isinstance(node.value, (str, bytes)) and id(node) not in docstrings:
            value = node.value if isinstance(node.value, str) else node.value.decode("latin-1")
            why = _main_string(value, file_dir)
            if why:
                shown = value if len(value) <= 120 else value[:117] + "..."
                errors.append(f"{where}: main string {shown!r} {why}")
    return errors


def scan_main_text(rel: str, text: str) -> list[str]:
    file_dir = rel.split("/")[:-1]
    masked = INTERP.sub("${}", text)
    found: dict[int, str] = {}
    for m in CD_FRONTEND.finditer(masked):
        found.setdefault(masked.count("\n", 0, m.start()) + 1, f"command enters or targets the frontend tree ('{m.group()}')")
    for m in TOKEN.finditer(masked):
        tok = m.group()
        if "/" in tok or "\\" in tok:
            why = _main_path(tok, file_dir)
            if why:
                found.setdefault(masked.count("\n", 0, m.start()) + 1, f"main path '{tok}' {why}")
    return [f"{rel}:{line}: {msg}" for line, msg in sorted(found.items())]


def scan_text(rel: str, text: str, root: str) -> list[str]:
    """Violations in one file given as (repo-relative posix path, text). `root` is only used to recognise
    absolute spellings of this checkout; nothing here touches the filesystem or depends on the host OS."""
    side = rel.split("/", 1)[0]
    if side == "renderer":
        return [f"{rel}:{line}: {msg}" for line, msg in sorted(scan_renderer(rel, text, root_aliases(root)).items())]
    if side == "main":
        return scan_main_py(rel, text) if posixpath.splitext(rel)[1].lower() in PY_EXT else scan_main_text(rel, text)
    return []


def check_link(rel: str, target: str, root: str) -> list[str]:
    """A symlink inside main/ or renderer/ is judged by where it points, lexically."""
    t = _posix(target)
    if t.startswith("//?/"):
        t = t[4:]
    if t.startswith("/") or DRIVE.match(t):
        inside = rel_of(t, root)
        p = None if inside is None else [s for s in inside.split("/") if s]
    else:
        p = _resolve(rel.split("/")[:-1], t.split("/"))
    if rel.split("/", 1)[0] == "renderer":
        why = _renderer_ok(p, False)
        return [f"{rel}: symlink -> '{target}' {why}"] if why else []
    return [f"{rel}: symlink -> '{target}' points into the renderer directory"] if p and p[0].lower() == "renderer" else []


# ======================================= filesystem layer ========================================

def _decode(data: bytes) -> str | None:
    for bom, enc in ((b"\xef\xbb\xbf", "utf-8-sig"), (b"\xff\xfe\x00\x00", "utf-32"), (b"\x00\x00\xfe\xff", "utf-32"),
                     (b"\xff\xfe", "utf-16"), (b"\xfe\xff", "utf-16")):
        if data.startswith(bom):
            return data.decode(enc, errors="replace")
    if b"\0" in data[:8192]:
        return None
    return data.decode("utf-8", errors="replace")


def check_file(path: Path | str, root: Path | str, is_link: bool | None = None) -> list[str] | None:
    """Violations in one file on disk; None when the file is not scanned at all (outside main/ and
    renderer/, in a skipped top-level directory, or a binary asset)."""
    rel = rel_of(os.path.abspath(path), str(root))
    if not rel:
        return None
    parts = rel.split("/")
    if parts[0] not in SIDES or (len(parts) > 1 and parts[1] in SKIP_TOP[parts[0]]):
        return None
    if os.path.islink(path) if is_link is None else is_link:
        try:
            target = os.readlink(path)
        except OSError as e:
            return [f"{rel}: unreadable symlink ({e}); boundary cannot be verified"]
        return check_link(rel, target, str(root))
    ext = posixpath.splitext(rel)[1].lower()
    if ext in BINARY_EXT:
        return None
    with open(path, "rb") as fh:
        text = _decode(fh.read())
    if text is None:
        if ext in TEXT_EXT:
            return [f"{rel}: contains NUL bytes and cannot be read as text; boundary cannot be verified"]
        return None  # binary asset
    return scan_text(rel, text, str(root))


def _walk(root: str):
    """(path, is_symlink) for every file and every symlink under main/ and renderer/, except the
    top-level build/vendor directories. scandir: no extra stat per file (the tree may sit on a slow mount)."""
    for side in SIDES:
        stack = [(os.path.join(root, side), True)]
        while stack:
            directory, top = stack.pop()
            try:
                entries = sorted(os.scandir(directory), key=lambda e: e.name)
            except OSError:
                continue
            for e in entries:
                if e.is_symlink():
                    yield e.path, True
                elif e.is_dir(follow_symlinks=False):
                    if not (top and e.name in SKIP_TOP[side]):
                        stack.append((e.path, False))
                else:
                    yield e.path, False


def iter_files(root: Path):
    return (Path(p) for p, _ in _walk(str(root)))


def run(files: list[Path] | None, root: Path) -> int:
    """Scan `files`, or the whole tree when `files` is None. 0 = clean, 2 = violations or nothing scanned."""
    errors: list[str] = []
    n = 0
    if files is None:
        for path, is_link in _walk(str(root)):
            found = check_file(path, root, is_link)
            if found is not None:
                n += 1
                errors.extend(found)
    else:
        for f in files:
            if os.path.islink(f) or os.path.isfile(f):
                n += 1
                errors.extend(check_file(f, root) or [])
            elif not os.path.isdir(f):
                errors.append(f"{f}: no such file")
    errors.sort()
    if errors:
        print("BOUNDARY VIOLATION: main/ and renderer/ must never import each other.", file=sys.stderr)
        print("Exchange data through artifacts/ (JSON validated by contracts/) or the HTTP API instead.", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 2
    if n == 0:
        print("boundary: scanned 0 files — wrong LABYRINTH_ROOT or empty tree; refusing to report OK", file=sys.stderr)
        return 2
    print(f"boundary: OK ({n} files scanned)")
    return 0


# ========================================== self-test ============================================
# {ROOT} is replaced by every spelling of the checkout root (posix, drive letter, backslashes, /mnt/x).
# Each entry is one bypass that got through an earlier version of this checker; the comment names the
# review finding. Every entry must be flagged, on every OS flavour.
VIOLATIONS = {
    # renderer: classic forms
    "renderer/src/v01.ts": "import x from '../../main/labyrinth_main/foo';\n",
    "renderer/src/v02.ts": 'import x from "../../main/labyrinth_main/foo";\n',
    "renderer/src/v03.ts": "const y = await import('labyrinth_main/x');\n",
    "renderer/src/v04.tsx": "export { z } from '../../scripts/thing';\n",
    "renderer/src/v05.js": "const q = require('../../data/raw/x.h5');\n",
    "renderer/src/v06.ts": "import {\n  a,\n  b,\n} from '../../main/x';\n",
    "renderer/src/v07.ts": "import '../../main/side-effect';\n",
    # 00-scaffold verifier run 1
    "renderer/src/v08.ts": "const m = await import(`../../main/labyrinth_main/build_artifacts.py?raw`);\n",
    "renderer/src/v09.ts": "const m = await import(`../../main/${name}.py`);\n",
    "renderer/vite.config.ts": "export default { resolve: { alias: { '@backend': resolve(__dirname, '../main') } } };\n",
    "renderer/tsconfig.json": '{ "compilerOptions": { "paths": { "@b/*": ["../main/*"] } } }\n',
    "renderer/src/v10.ts": "const mods = import.meta.glob('../../main/**/*.py', { as: 'raw' });\n",
    "renderer/src/v11.ts": "const u = new URL('../../main/pyproject.toml', import.meta.url);\n",
    "renderer/src/v12.ts": '/// <reference path="../../main/types.d.ts" />\n',
    "renderer/index.html": '<script type="module" src="../main/x.js"></script>\n',
    "renderer/src/v13.ts": "import x from '@main/foo';\n",
    "renderer/src/v14.ts": "import s from '../../contracts/notjson.ts';\n",
    # verifier run 2 (N1, N3, N4): absolute paths, vite /@fs/, cwd-relative paths, tsconfig.*.json
    "renderer/src/v26.ts": "import t from '{ROOT}/main/pyproject.toml?raw';\n",
    "renderer/src/v27.ts": "import t from '/@fs{ROOT}/main/pyproject.toml?raw';\n",
    "renderer/vite.config.mts": "export default { resolve: { alias: { '@b': '{ROOT}/main' } } };\n",
    "renderer/src/v28.test.ts": "const p = resolve(process.cwd(), '../main/labyrinth_main/x.py');\n",
    "renderer/src/v29.test.ts": "const raw = readFileSync('../data/raw/wout_w7x_kjm.nc');\n",
    "renderer/tsconfig.app.json": '{ "compilerOptions": { "paths": { "@b/*": ["../main/*"] } } }\n',
    # verifier run 3 (R1, R2): vite treats '/x' as renderer-root-relative; file:// URLs; segmented join
    "renderer/src/v30.ts": "import t from '/../main/pyproject.toml?raw';\n",
    "renderer/src/v31.ts": "const m = import.meta.glob('/src/../../main/*');\n",
    "renderer/src/v32.ts": "const u = 'file://{ROOT}/main/x.py';\n",
    "renderer/src/v33.test.ts": "const p = join(__dirname, '..', '..', 'main', 'pyproject.toml');\n",
    # review SC-2: a wildcard or interpolation that can match outside renderer/
    "renderer/src/sc2a.ts": "const t = import.meta.glob('/../*/pyproject.toml', { query: '?raw', eager: true });\n",
    "renderer/src/sc2b.ts": "const m = import.meta.glob('../../*/labyrinth_main/**/*.py');\n",
    "renderer/src/sc2c.ts": "const m = import.meta.glob(['./lib/*.ts', '../../{main,scripts}/*.py']);\n",
    "renderer/src/sc2d.ts": "const u = `../../${side}/pyproject.toml`;\n",
    "renderer/src/sc2e.ts": "const all = import.meta.glob('../../artifacts/*');\n",
    "renderer/src/sc2f.ts": "import s from '../../contracts/../main/pyproject.toml?raw';\n",
    "renderer/src/sc2g.ts": "const r = await fetch('/../scripts/verify.sh');\n",
    "renderer/vitest.config.ts": "export default { server: { fs: { allow: ['..'] } } };\n",
    "renderer/src/sc2h.ts": "const m = import.meta.glob('../../contracts/**');\n",
    "renderer/src/sc2i.ts": "const t = await import('../../README.md?raw');\n",
    "renderer/src/sc2j.ts": "const t = await import('../../../outside-the-repo.ts');\n",
    "renderer/vite.config.cts": "module.exports = { resolve: { alias: { '@b': '/../main' } } };\n",
    "renderer/src/sc2k.ts": "export const BACKEND = '/../main/pyproject.toml';\n",
    "renderer/src/sc2l.test.ts": "vi.mock('/../main/labyrinth_main/x', () => ({}));\n",
    "renderer/src/sc2m.test.ts": "const fixture = resolve(here, '../fixtures/../../main/pyproject.toml');\n",
    "renderer/src/sc2n.test.ts": "const leak = await request(plugin, '/../main/pyproject.toml');\n",
    "renderer/src/sc2o.test.ts": "const p = '/../*/pyproject.toml';\n",
    # review SC-3: running the other side
    "renderer/package.json": '{ "scripts": { "prebuild": "cd ../main && python3 -m labyrinth_main.build_artifacts" } }\n',
    "renderer/tools/pkg/package.json": '{ "scripts": { "gen": "python3 -m labyrinth_main.build_artifacts --out ./x" } }\n',
    "renderer/src/sc3a.test.ts": "execSync('cd ../main && python3 -m pytest -q');\n",
    "renderer/src/sc3b.test.ts": "spawnSync('python3', ['-m', 'labyrinth_main.build_artifacts'], { cwd: root });\n",
    "renderer/scripts/sc3c.mjs": "execSync('python3 main/labyrinth_main/build_artifacts.py', { cwd: '..' });\n",
    "renderer/scripts/sc3m.mjs": "execSync('cd main && python3 -m pytest -q', { cwd: repoRoot });\n",
    "renderer/scripts/sc3d.sh": "#!/bin/sh\ncd main && python3 -m pytest\n",
    "renderer/scripts/sc3e.sh": "#!/bin/sh\npython3 -m labyrinth_main.server &\n",
    "renderer/scripts/sc3k.sh": "#!/bin/sh\nPYTHONPATH=../main python3 -c 'import labyrinth_main'\n",
    "main/labyrinth_main/sc3f.py": 'import subprocess\nsubprocess.run("npm --prefix ../renderer run build", shell=True)\n',
    "main/labyrinth_main/sc3g.py": 'import os\nos.system("cd ../renderer && npm run build")\n',
    "main/labyrinth_main/sc3h.py": 'import subprocess\nsubprocess.run(["npm", "--prefix", "renderer", "run", "build"], cwd="..")\n',
    "main/labyrinth_main/sc3i.py": 'import os\nos.system("npm --prefix renderer run build")\n',
    "main/labyrinth_main/sc3j.py": 'import glob\nfiles = glob.glob("../*/src/**/*.ts", recursive=True)\n',
    "main/labyrinth_main/sc3l.py": 'import subprocess\nsubprocess.run("ls renderer/src", shell=True)\n',
    # review SC-4: files the old walker or the old extension list never opened
    "renderer/src/features/coverage/leak.ts": "import x from '../../../../main/labyrinth_main/foo';\n",
    "renderer/src/features/x/dist/leak.ts": "export * from '../../../../../main/x';\n",
    "renderer/src/node_modules/pkg/index.js": "module.exports = require('../../../../main/x');\n",
    "main/labyrinth_main/dist/p.py": "from renderer.src import app\n",
    "main/labyrinth_main/__pycache__/q.py": "import renderer\n",
    "renderer/src/test/setup.ts": "import { readFileSync } from 'node:fs';\nexport const seed = readFileSync('../main/pyproject.toml', 'utf8');\n",
    "renderer/tools/gen.mjs": "import { readFileSync } from 'node:fs';\nconst t = readFileSync('../main/labyrinth_main/__init__.py', 'utf8');\n",
    "renderer/tools/gen.py": 'import sys\nsys.path.insert(0, "../main")\nimport labyrinth_main\n',
    "renderer/tools/gen2.py": "from labyrinth_main import build_artifacts\n",
    "renderer/scripts/build.sh": '#!/usr/bin/env bash\ncd "$(dirname "$0")/../../main" && python3 -m pytest\n',
    "renderer/vitest.setup.ts": "import '../main/side-effect.js';\n",
    "renderer/src/styles/leak.css": "@import url(../../../main/theme.css);\n",
    "renderer/public/leak.html": "<img src=../../main/logo.png>\n",
    "renderer/.env.local": "VITE_BACKEND_SRC=../main/labyrinth_main\n",
    "renderer/postcss.config.cjs": "module.exports = { plugins: [require('../main/plugin.js')] };\n",
    "renderer/src/sc4a.ts": "import x from '../dist/assets/leak.js';\n",
    "main/tools/build.sh": "#!/bin/sh\nnpm --prefix ../renderer run build\n",
    "main/labyrinth_main/static.js": "import '../../renderer/src/main.tsx';\n",
    "main/pyproject.toml": '[tool.pytest.ini_options]\npythonpath = [".", "../renderer/scripts"]\n',
    "main/conf.yaml": "frontend_dir: ../renderer/dist\n",
    # review SC-11: absolute spellings must be caught under native Windows Python and under WSL alike
    "renderer/src/sc11a.ts": "const r = await fetch('/@fs/{ROOT}/main/pyproject.toml');\n",
    "renderer/src/sc11b.ts": "const u = 'file:///{ROOT}/main/x.py';\n",
    "renderer/src/sc11c.ts": "const p = '//wsl.localhost/Ubuntu/mnt/d/Labyrinth/main/x.py';\n",
    "renderer/src/sc11d.ts": "const p = '\\\\\\\\wsl$\\\\Ubuntu\\\\mnt\\\\d\\\\Labyrinth\\\\main\\\\x.py';\n",
    "renderer/src/sc11e.ts": "const p = 'D:/Labyrinth/main/pyproject.toml';\n",
    "renderer/src/sc11f.ts": "const p = 'C:\\\\Users\\\\dev\\\\Labyrinth\\\\main\\\\pyproject.toml';\n",
    "renderer/src/sc11g.test.ts": "const raw = readFileSync('{ROOT}/data/raw/wout_w7x_kjm.nc');\n",
    "renderer/src/sc11h.css": ".a { background: url({ROOT}/main/logo.png); }\n",
    # main: imports
    "main/labyrinth_main/v15.py": "from renderer.src import app\n",
    "main/labyrinth_main/v16.py": "import os, renderer.src as r\n",
    "main/labyrinth_main/v17.py": "def f():\n    import renderer\n",
    "main/labyrinth_main/v18.py": "from \\\n  renderer import x\n",
    "main/labyrinth_main/v19.py": "import importlib\nm = importlib.import_module('renderer.src')\n",
    "main/labyrinth_main/v20.py": "m = __import__('renderer')\n",
    # main: path hacks
    "main/labyrinth_main/v21.py": "import sys\nsys.path.insert(0, '../renderer')\n",
    "main/labyrinth_main/v22.py": "import os, sys\nsys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'renderer'))\n",
    "main/labyrinth_main/v23.py": "import sys\nfrom pathlib import Path\nsys.path.append(str(Path(__file__).parents[2] / 'renderer'))\n",
    "main/labyrinth_main/v24.py": "import site\nsite.addsitedir('/repo/renderer/src')\n",
    "main/labyrinth_main/v25.py": "import sys\np = 'renderer'\nsys.path += [p]\n",
}

# Shapes that must stay clean: the real config and test idioms of this repo, and ordinary frontend code.
CLEAN = {
    "renderer/vite.config.ts": (
        "import { cpSync, existsSync } from 'node:fs';\nimport { relative, resolve } from 'node:path';\n"
        "// ../artifacts (produced by main/) and talks to the main process over HTTP (/api, proxied in dev).\n"
        "const ARTIFACTS = resolve(import.meta.dirname, '../artifacts');\n"
        "/** Dev server: serve ../artifacts at /artifacts. */\n"
        "server.middlewares.use('/artifacts', (req, res, next) => {\n"
        "  const file = resolve(ARTIFACTS, '.' + (req.url ?? '').split('?')[0]);\n"
        "  const rel = relative(ARTIFACTS, file);\n"
        "  if (rel.startsWith('..') || rel === '..' || !existsSync(file)) return next();\n"
        "  import('node:fs').then((fs) => fs.createReadStream(file).pipe(res));\n});\n"
        "let outDir = resolve(import.meta.dirname, 'dist');\n"
        "cpSync(source, resolve(outDir, 'artifacts'), { recursive: true });\n"
        "export default { server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8787' } },\n"
        "  test: { setupFiles: ['./vitest.setup.ts'], include: ['src/**/*.test.{ts,tsx}'] } };\n"
    ),
    "renderer/package.json": (
        '{ "name": "labyrinth-renderer", "description": "Labyrinth frontend (\'renderer\' process). Must never import from main/.",\n'
        '  "scripts": { "dev": "vite", "build": "vite build", "typecheck": "tsc -p tsconfig.json --noEmit", "test": "vitest run",\n'
        '    "tokens": "node --experimental-strip-types --no-warnings scripts/gen-tokens-css.mjs" },\n'
        '  "dependencies": { "plotly.js-dist-min": "4.3.0", "react": "19.3.1" } }\n'
    ),
    "renderer/tsconfig.json": '{ "compilerOptions": { "types": ["vitest/globals", "node"] }, "include": ["src", "vite.config.ts", "vitest.setup.ts"] }\n',
    "renderer/index.html": '<!doctype html>\n<div id="root"></div>\n<script type="module" src="/src/main.tsx"></script>\n',
    "renderer/vitest.setup.ts": "import '@testing-library/jest-dom/vitest';\n",
    "renderer/scripts/gen-tokens-css.mjs": (
        "import { writeFileSync } from 'node:fs';\nimport { fileURLToPath } from 'node:url';\n"
        "const tokens = await import(new URL('../src/design/tokens.ts', import.meta.url).href);\n"
        "const out = fileURLToPath(new URL('../src/design/tokens.css', import.meta.url));\n"
        "writeFileSync(out, tokens.renderTokensCss());\n"
    ),
    "renderer/src/ok1.ts": "import React from 'react';\nimport s from '../../contracts/geometry.schema.json';\nimport { a } from './lib/a';\n",
    "renderer/src/ok2.ts": (
        "const r = await fetch('/artifacts/geometry.json');\nconst label = 'the main process';\n"
        "const el = document.querySelector('main');\nconst s = '/src/main.tsx';\nconst api = '/api/live/status';\n"
        "const url = `/artifacts/${id}.json`;\nconst route = '#/locate';\nconst ledger = '~/.labyrinth/ledger.json';\n"
        "const TRAVERSAL = /(^|\\/)\\.\\.(\\/|$)/;\nconst spread = [...a, ...b];\n"
    ),
    "renderer/src/ok3.test.ts": "const A = resolve(__dirname, '../../artifacts');\nconst C = resolve(__dirname, '../../contracts');\n",
    "renderer/src/features/x/ok4.tsx": "import f from '../data/fixtures';\nimport s from '../scripts/helper';\nimport { u } from '../../lib/artifacts';\n",
    "renderer/src/design/ok5.tsx": "const Plotly = (await import('plotly.js-dist-min')).default;\nconst three = await import('three');\n",
    "renderer/src/features/budget/ok6.test.tsx": (
        "import { readFileSync } from 'node:fs';\nimport { resolve } from 'node:path';\n"
        "const ARTIFACT = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/budget.json'), 'utf8'));\n"
        "const doc = readFileSync(resolve(import.meta.dirname, 'DESIGN.md'), 'utf8');\n"
        "const up = join(__dirname, '..', 'fixtures', 'a.json');\n"
    ),
    "renderer/src/lib/ok7.test.ts": (
        "// Schemas in ../contracts — the same schemas main/ validates against.\n"
        "const CONTRACTS = resolve(__dirname, '../../../contracts');\nconst ARTIFACTS = resolve(__dirname, '../../../artifacts');\n"
        "const defs = JSON.parse(readFileSync(resolve(__dirname, '../../../contracts/common.schema.json'), 'utf8')).$defs;\n"
        "const schemas = import.meta.glob('../../../contracts/*.schema.json');\nconst data = import.meta.glob('../../../artifacts/*.json');\n"
    ),
    "renderer/src/shell/ok8.test.tsx": (
        "vi.mock('../features/geometry/GeometryView', () => ({ GeometryView: () => <p>view:locate</p> }));\n"
        "const views = import.meta.glob('../features/**/*.tsx');\nconst tests = import.meta.glob('/src/**/*.test.ts');\n"
    ),
    "renderer/src/shell/ok9.tsx": (
        "export const Hint = () => (\n  <p>\n    Regenerate the artifacts with\n"
        "    <code className=\"lab-mono\">python3 -m labyrinth_main.build_artifacts</code>{' '}\n"
        "    (from <code className=\"lab-mono\">main/</code>), then reload.\n  </p>\n);\n"
        "export const fixture = { solverRevision: 'labyrinth_main 0.1.0', file: 'artifacts/geometry.json' };\n"
        "// To rebuild by hand: cd main && python3 -m labyrinth_main.build_artifacts\n"
        "expect(screen.getByText('main/')).toBeInTheDocument();\n"
        "const actual = await vi.importActual<typeof import('../lib/liveStatus')>('../lib/liveStatus');\n"
    ),
    # Negative tests of the dev middleware hand it traversal request paths; a bare '..' on a variable base.
    "renderer/src/shell/ok11.test.ts": (
        "const ARTIFACTS = resolve(__dirname, '../../../artifacts');\n"
        "for (const url of ['/nope.json', '/../package.json', '/../renderer/package.json', '/..%2f..%2fCLAUDE.md']) {}\n"
        "expect(resolveArtifactRequest(root, '/../artifacts-private/secret.json')).toBeNull();\n"
        "const leak = await request(plugin, '/../outside.json');\nconst etc = await request(plugin, '/../../../etc/passwd');\n"
    ),
    "renderer/src/design/ok12.test.ts": (
        "const SRC = resolve(import.meta.dirname, '..'); // renderer/src\nconst RENDERER = resolve(SRC, '..');\n"
        "const rel = (f: string) => relative(RENDERER, f).split('\\\\').join('/');\n"
        "const strip = (src: string) => src.replace(/\\/\\*[\\s\\S]*?\\*\\//g, ' ').replace(/(^|[^:'\"`\\\\])\\/\\/.*$/gm, '$1');\n"
        "const literal = /'((?:[^'\\\\\\n]|\\\\.)*)'|\"((?:[^\"\\\\\\n]|\\\\.)*)\"|`((?:[^`\\\\]|\\\\.)*)`/g;\n"
        "const isTest = (f: string) => /\\.test\\.tsx?$/.test(f);\n"
        "const re = new RegExp(`^[ \\\\t]*import\\\\s+(?!type\\\\s)[^;'\"]*?\\\\sfrom\\\\s*${spec}`, 'gm');\n"
        "const file = relative(SRC, f).replace(/\\\\/g, '/');\n"
    ),
    "renderer/src/design/ok10.css":"@import './tokens.css';\n.a { background: url(../assets/grid.svg); }\n.b { background: url('/icons/a.svg'); }\n",
    "renderer/src/vite-env.d.ts": '/// <reference types="vite/client" />\n',
    "renderer/src/design/DESIGN.md": "Tokens live in `./tokens.ts`; see [the gallery](../shell/Gallery.tsx) and `design-artifacts/flux-tubes/`.\n",
    "main/labyrinth_main/ok.py": (
        '"""Must never import from renderer/."""\nimport json\nfrom labyrinth_main.common import io\nmsg = "the renderer plays replay"\n'
    ),
    "main/labyrinth_main/ok2.py": (
        'from pathlib import Path\nROOT = Path(__file__).resolve().parents[2]\nRAW = ROOT / "data" / "raw"\nART = "../artifacts"\n'
        'import glob\nNC = glob.glob("../data/raw/*.nc")\nnote = "renderer process polls /api/live/status"\nname = "renderer.py"\n'
    ),
    "main/tests/ok_test.py": 'BAD = ["/artifacts/../data/raw/x.h5", "/artifacts/..%2f..%2fmain", "../../etc/passwd"]\n',
    "main/pyproject.toml": '[project]\nname = "labyrinth_main"\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\npythonpath = ["."]\n',
    "main/requirements.txt": "# Pinned backend deps. `pip install -r main/requirements.txt`\nnumpy==2.5.3\n",
}

# Files in the two skipped top-level directories: never opened, whatever they contain.
SKIPPED = {
    "renderer/node_modules/pkg/index.js": "module.exports = require('../../../main/x');\n",
    "renderer/dist/assets/app.js": "import '../../../main/x';\n",
}

# One checkout, as each OS spells it. The corpus must give the same verdicts whichever spelling the
# scanner is started with and whichever spelling a file uses (review finding SC-11).
FLAVOURS = ("/mnt/d/Labyrinth", "D:\\Labyrinth", "D:/Labyrinth")


def root_spellings(root: str) -> list[str]:
    r = _posix(root).rstrip("/")
    out = [r]
    m = re.match(r"^([A-Za-z]):(/.*)?$", r) or re.match(r"^/mnt/([A-Za-z])(/.*)?$", r)
    if m:
        d, rest = m.group(1), m.group(2) or ""
        out = [f"/mnt/{d.lower()}{rest}", f"{d.upper()}:{rest}", f"{d.upper()}:{rest}".replace("/", "\\"), f"/cygdrive/{d.lower()}{rest}"]
    return out


def corpus_verdicts(root: str) -> dict[str, bool]:
    """{'<V|C> <file> @ <spelling>': flagged?} for the whole corpus, scanned as text only (no filesystem)."""
    out: dict[str, bool] = {}
    for tag, corpus in (("V", VIOLATIONS), ("C", CLEAN)):
        for rel, body in corpus.items():
            for i, spelling in enumerate(root_spellings(root) if "{ROOT}" in body else [""]):
                out[f"{tag} {rel} #{i}"] = bool(scan_text(rel, body.replace("{ROOT}", spelling), root))
    return out


def self_test() -> int:
    failures = []
    # 1. Pure text scan, once per OS flavour: every violation flagged, every clean file clean, same verdicts.
    for flavour in FLAVOURS:
        for key, flagged in corpus_verdicts(flavour).items():
            if flagged != key.startswith("V "):
                failures.append(f"[root spelled {flavour}] {'missed violation' if key.startswith('V ') else 'false positive'}: {key[2:]}")
    # 2. The same corpus on disk: the walker must reach every violation file and skip only the two top-level dirs.
    with tempfile.TemporaryDirectory() as d:
        root = Path(d).resolve()
        bad, good = root / "bad", root / "good"
        for base, corpus in ((bad, VIOLATIONS), (good, {**CLEAN, **SKIPPED})):
            for rel, body in corpus.items():
                (base / rel).parent.mkdir(parents=True, exist_ok=True)
                (base / rel).write_text(body.replace("{ROOT}", _posix(str(base))), encoding="utf-8", newline="\n")
        walked = {rel_of(str(p), str(bad)) for p in iter_files(bad)}
        for rel in VIOLATIONS:
            if rel not in walked:
                failures.append(f"walker never opens {rel}")
            elif not check_file(bad / rel, bad):
                failures.append(f"missed violation on disk in {rel}: {VIOLATIONS[rel].strip()!r}")
        walked = {rel_of(str(p), str(good)) for p in iter_files(good)}
        for rel in SKIPPED:
            if rel in walked or check_file(good / rel, good) is not None:
                failures.append(f"top-level build/vendor file was scanned: {rel}")
        for rel in CLEAN:
            errs = check_file(good / rel, good) if rel in walked else None
            if errs is None:
                failures.append(f"clean file was never scanned: {rel}")
            elif errs:
                failures.append(f"false positive on disk in {rel}: {errs}")
        leftover = [e for path, is_link in _walk(str(good)) for e in (check_file(path, good, is_link) or [])]
        if leftover:
            failures.append(f"full scan of the clean tree is not clean: {leftover}")
    if failures:
        for f in failures:
            print(f"self-test FAIL: {f}", file=sys.stderr)
        return 2
    print(f"boundary self-test: OK ({len(VIOLATIONS)} violations caught, {len(CLEAN)} clean files passed, {len(FLAVOURS)} OS flavours agree)")
    return 0


def main(argv: list[str]) -> int:
    if argv == ["--self-test"]:
        return self_test()
    if any(a.startswith("-") for a in argv):
        print(__doc__, file=sys.stderr)
        return 2
    return run([Path(a) for a in argv] if argv else None, ROOT)


def cli(argv: list[str]) -> int:
    """Every failure path is exit 2 (D-003): an uncaught exception must not surface as Python's exit 1."""
    try:
        return 0 if main(argv) == 0 else 2
    except Exception:
        traceback.print_exc()
        print("check_boundaries.py: internal error — the boundary was NOT verified. Exiting 2.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(cli(sys.argv[1:]))
