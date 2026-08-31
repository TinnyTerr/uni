//! Backend for the local-git notes provider.
//!
//! Everything here is deliberately generic over "a folder of markdown files"
//! so that swapping the front-end provider for a hosted service later does not
//! require touching this file: it just stops being called.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

const MAX_NOTE_BYTES: u64 = 4 * 1024 * 1024;
const NOTE_EXTS: [&str; 4] = ["md", "markdown", "mdx", "txt"];
const SKIP_DIRS: [&str; 6] = [".git", "node_modules", ".obsidian", "target", "dist", ".venv"];

#[derive(Debug, Clone, Deserialize)]
pub struct NoteRoot {
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct NoteRef {
    pub id: String,
    pub title: String,
    pub path: String,
    pub rel_path: String,
    pub root_id: String,
    pub root_name: String,
    pub modified_ms: u64,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct NoteBody {
    pub path: String,
    pub content: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct NoteHit {
    #[serde(flatten)]
    pub note: NoteRef,
    pub snippet: String,
    pub score: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct GitInfo {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub remote: Option<String>,
    pub dirty_files: u32,
    pub last_commit: Option<String>,
    pub error: Option<String>,
}

fn is_note(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| NOTE_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// First markdown H1, else a YAML front-matter `title:`, else the file stem.
fn derive_title(path: &Path, head: &str) -> String {
    let mut in_front_matter = false;
    for (i, line) in head.lines().take(60).enumerate() {
        let t = line.trim();
        if i == 0 && t == "---" {
            in_front_matter = true;
            continue;
        }
        if in_front_matter {
            if t == "---" {
                in_front_matter = false;
                continue;
            }
            if let Some(v) = t.strip_prefix("title:") {
                let v = v.trim().trim_matches(['"', '\'']).trim();
                if !v.is_empty() {
                    return v.to_string();
                }
            }
            continue;
        }
        if let Some(v) = t.strip_prefix("# ") {
            if !v.trim().is_empty() {
                return v.trim().to_string();
            }
        }
    }
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .replace(['-', '_'], " ")
}

fn read_head(path: &Path, bytes: usize) -> String {
    use std::io::Read;
    let Ok(mut f) = std::fs::File::open(path) else {
        return String::new();
    };
    let mut buf = vec![0u8; bytes];
    let n = f.read(&mut buf).unwrap_or(0);
    buf.truncate(n);
    String::from_utf8_lossy(&buf).into_owned()
}

fn modified_ms(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn index_root(root: &NoteRoot, out: &mut Vec<NoteRef>) {
    let base = PathBuf::from(&root.path);
    if !base.is_dir() {
        return;
    }
    let walker = WalkDir::new(&base)
        .max_depth(12)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !(e.file_type().is_dir() && SKIP_DIRS.contains(&name.as_ref()))
        });

    for entry in walker.flatten() {
        if !entry.file_type().is_file() || !is_note(entry.path()) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let path = entry.path();
        let rel = path
            .strip_prefix(&base)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();
        let head = read_head(path, 4096);
        out.push(NoteRef {
            id: format!("{}:{}", root.id, rel),
            title: derive_title(path, &head),
            path: path.to_string_lossy().to_string(),
            rel_path: rel,
            root_id: root.id.clone(),
            root_name: root.name.clone(),
            modified_ms: modified_ms(&meta),
            size_bytes: meta.len(),
        });
    }
}

#[tauri::command]
pub fn notes_index(roots: Vec<NoteRoot>) -> Vec<NoteRef> {
    let mut out = Vec::new();
    for root in &roots {
        index_root(root, &mut out);
    }
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    out
}

/// Reading is confined to the configured roots: a note id or path from
/// anywhere else is refused rather than silently opened.
fn ensure_within_roots(path: &Path, roots: &[NoteRoot]) -> Result<PathBuf, String> {
    let canon = path
        .canonicalize()
        .map_err(|e| format!("{}: {e}", path.display()))?;
    for root in roots {
        if let Ok(rc) = PathBuf::from(&root.path).canonicalize() {
            if canon.starts_with(&rc) {
                return Ok(canon);
            }
        }
    }
    Err(format!(
        "{} is outside every configured notes folder",
        canon.display()
    ))
}

#[tauri::command]
pub fn notes_read(path: String, roots: Vec<NoteRoot>) -> Result<NoteBody, String> {
    let safe = ensure_within_roots(Path::new(&path), &roots)?;
    let meta = std::fs::metadata(&safe).map_err(|e| e.to_string())?;
    let truncated = meta.len() > MAX_NOTE_BYTES;
    let bytes = std::fs::read(&safe).map_err(|e| e.to_string())?;
    let slice = if truncated {
        &bytes[..MAX_NOTE_BYTES as usize]
    } else {
        &bytes[..]
    };
    Ok(NoteBody {
        path: safe.to_string_lossy().to_string(),
        content: String::from_utf8_lossy(slice).into_owned(),
        truncated,
    })
}

#[tauri::command]
pub fn notes_search(roots: Vec<NoteRoot>, query: String, limit: usize) -> Vec<NoteHit> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Vec::new();
    }
    let mut hits: Vec<NoteHit> = Vec::new();

    for note in notes_index(roots) {
        let title_hit = note.title.to_lowercase().contains(&needle);
        let path_hit = note.rel_path.to_lowercase().contains(&needle);
        let body = read_head(Path::new(&note.path), 200_000);
        let lower = body.to_lowercase();
        let body_pos = lower.find(&needle);

        if !title_hit && !path_hit && body_pos.is_none() {
            continue;
        }
        let snippet = match body_pos {
            Some(pos) => {
                let start = body[..pos].rfind('\n').map(|i| i + 1).unwrap_or(0);
                let line_end = body[pos..].find('\n').map(|i| pos + i).unwrap_or(body.len());
                // Clamp to a char boundary: slicing mid-codepoint would panic.
                let mut end = line_end.min(start + 240).max(start);
                while end < body.len() && !body.is_char_boundary(end) {
                    end += 1;
                }
                body[start..end].trim().to_string()
            }
            None => body.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim().to_string(),
        };
        let score = (title_hit as i32) * 100 + (path_hit as i32) * 40 + body_pos.is_some() as i32 * 10;
        hits.push(NoteHit { note, snippet, score });
    }

    hits.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then(b.note.modified_ms.cmp(&a.note.modified_ms))
    });
    hits.truncate(limit.clamp(1, 200));
    hits
}

fn git(dir: &str, args: &[&str]) -> Option<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Best-effort repo status for a notes root, shown so you can tell at a glance
/// whether the notes you are linking to have been committed and pushed.
#[tauri::command]
pub fn notes_git_info(path: String) -> GitInfo {
    let inside = git(&path, &["rev-parse", "--is-inside-work-tree"]);
    if inside.as_deref() != Some("true") {
        return GitInfo {
            is_repo: false,
            branch: None,
            remote: None,
            dirty_files: 0,
            last_commit: None,
            error: None,
        };
    }
    let dirty = git(&path, &["status", "--porcelain"])
        .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count() as u32)
        .unwrap_or(0);
    GitInfo {
        is_repo: true,
        branch: git(&path, &["rev-parse", "--abbrev-ref", "HEAD"]),
        remote: git(&path, &["remote", "get-url", "origin"]),
        dirty_files: dirty,
        last_commit: git(&path, &["log", "-1", "--format=%h %s (%cr)"]),
        error: None,
    }
}
