use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::fs;
use crate::models::Event;

/// Cleans Windows UNC extended-length path prefix (`\\?\`), while safely
/// preserving standard paths on macOS, Linux, and Windows.
pub fn clean_path(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path.to_path_buf()
    }
}

pub struct MediaLinker {
    /// Maps media ID (or filename / stem) -> clean absolute file path
    id_map: HashMap<String, PathBuf>,
}

impl MediaLinker {
    pub fn new(media_dir: &Path) -> Self {
        let mut linker = Self {
            id_map: HashMap::new(),
        };
        linker.add_media_directory(media_dir);
        linker
    }

    pub fn add_media_directory(&mut self, media_dir: &Path) {
        if !media_dir.is_dir() {
            log::warn!("MediaLinker: media directory does not exist");
            log::debug!("Missing media dir: {:?}", media_dir);
            return;
        }

        let mut file_count = 0;
        let mut id_indexed = 0;

        self.scan_recursive(media_dir, &mut file_count, &mut id_indexed);

        log::info!("MediaLinker: indexed {} files ({} by ID) recursively", file_count, id_indexed);
        log::debug!("MediaLinker: indexed from {:?}", media_dir);
    }

    fn scan_recursive(&mut self, dir: &Path, file_count: &mut usize, id_indexed: &mut usize) {
        match fs::read_dir(dir) {
            Ok(entries) => {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        self.scan_recursive(&path, file_count, id_indexed);
                        continue;
                    }
                    if !path.is_file() {
                        continue;
                    }

                    let file_name = match path.file_name().and_then(|n| n.to_str()) {
                        Some(n) => n.to_string(),
                        None => continue,
                    };

                    *file_count += 1;

                    let abs_path = fs::canonicalize(&path).unwrap_or_else(|e| {
                        log::warn!("MediaLinker: canonicalize failed for {:?}: {}", path, e);
                        path.clone()
                    });
                    let clean_abs = clean_path(&abs_path);

                    // 1. Index by full filename (e.g. "2023-01-01_ABC123.jpg" or "ABC123.jpg")
                    self.id_map.insert(file_name.clone(), clean_abs.clone());

                    // 2. Index by file stem without extension (e.g. "2023-01-01_ABC123" or "ABC123")
                    let stem = match path.file_stem().and_then(|s| s.to_str()) {
                        Some(s) => s.to_string(),
                        None => String::new(),
                    };
                    if !stem.is_empty() {
                        self.id_map.insert(stem.clone(), clean_abs.clone());
                    }

                    // 3. Extract media ID: filename format is "YYYY-MM-DD_<MEDIA_ID>.<ext>"
                    // The ID is everything between the first '_' and the last '.'
                    if let Some(underscore_pos) = file_name.find('_') {
                        let after_underscore = &file_name[underscore_pos + 1..];
                        let media_id = if let Some(dot_pos) = after_underscore.rfind('.') {
                            &after_underscore[..dot_pos]
                        } else {
                            after_underscore
                        };

                        if !media_id.is_empty() {
                            self.id_map.insert(media_id.to_string(), clean_abs.clone());
                            *id_indexed += 1;
                        }
                    } else if !stem.is_empty() {
                        *id_indexed += 1;
                    }

                    // 4. Also index after last underscore if different from after first
                    if let Some(last_underscore_pos) = stem.rfind('_') {
                        let after_last = &stem[last_underscore_pos + 1..];
                        if !after_last.is_empty() {
                            self.id_map.insert(after_last.to_string(), clean_abs.clone());
                        }
                    }
                }
            }
            Err(e) => {
                log::warn!("MediaLinker: failed to read directory {:?}: {}", dir, e);
            }
        }
    }

    pub fn link_media(&mut self, events: &mut [Event]) {
        self.link_media_with_progress(events, |_, _| {});
    }

    pub fn link_media_with_progress<F>(&mut self, events: &mut [Event], mut on_progress: F)
    where
        F: FnMut(usize, usize),
    {
        let total = events.len();
        let report_interval = (total / 20).max(1000);
        let mut id_matched = 0;
        let mut no_ids = 0;
        let mut id_not_found = 0;
        let mut already_linked = 0;

        for (idx, event) in events.iter_mut().enumerate() {
            if idx > 0 && idx % report_interval == 0 {
                on_progress(idx, total);
            }

            // If event already has media_references (e.g. from HTML parser which extracted <img src="../../chat_media/xyz.jpg">)
            if !event.media_references.is_empty() {
                let mut resolved_refs = Vec::new();
                for r in &event.media_references {
                    let cleaned = clean_path(r);
                    if cleaned.is_absolute() && cleaned.exists() {
                        resolved_refs.push(cleaned);
                    } else {
                        // Relative path or path with broken directory prefix:
                        // Extract filename and stem to check against id_map
                        let fname = r.file_name().and_then(|n| n.to_str()).unwrap_or("");
                        let fstem = r.file_stem().and_then(|s| s.to_str()).unwrap_or("");

                        if let Some(matched) = self.id_map.get(fname).or_else(|| self.id_map.get(fstem)) {
                            resolved_refs.push(matched.clone());
                            continue;
                        }

                        // Try suffix after first underscore
                        if let Some(pos) = fstem.find('_') {
                            let after = &fstem[pos + 1..];
                            if let Some(matched) = self.id_map.get(after) {
                                resolved_refs.push(matched.clone());
                                continue;
                            }
                        }
                    }
                }

                if !resolved_refs.is_empty() {
                    event.media_references = resolved_refs;
                    already_linked += 1;
                    continue;
                }

                // If existing relative references could not be resolved on disk, clear them
                // so we can fall through to ID-based linking from metadata below
                event.media_references.clear();
            }

            // Only link event types that carry media
            match event.event_type.as_str() {
                "MEDIA" | "NOTE" | "SNAP" | "SNAP_VIDEO" | "STICKER" => {}
                _ => continue,
            }

            // Only link via ID-based matching from event metadata
            let media_ids = Self::extract_media_ids(&event.metadata);

            if media_ids.is_empty() {
                no_ids += 1;
                continue;
            }

            let mut found_any = false;
            for mid in &media_ids {
                if let Some(file_path) = self.id_map.get(mid) {
                    event.media_references.push(file_path.clone());
                    found_any = true;
                }
            }

            if found_any {
                id_matched += 1;
            } else {
                id_not_found += 1;
            }
        }

        on_progress(total, total);

        log::info!("MediaLinker: ID-matched {}, no-ids-in-metadata {}, id-not-found {}, already-linked {}",
            id_matched, no_ids, id_not_found, already_linked);
    }

    #[cfg(test)]
    pub(crate) fn get_id_map(&self) -> &HashMap<String, PathBuf> {
        &self.id_map
    }

    /// Extract media_ids array from event metadata JSON string.
    /// Metadata format: {"media_ids": ["id1", "id2"], ...}
    fn extract_media_ids(metadata: &Option<String>) -> Vec<String> {
        let meta_str = match metadata {
            Some(s) => s,
            None => return Vec::new(),
        };

        let parsed: serde_json::Value = match serde_json::from_str(meta_str) {
            Ok(v) => v,
            Err(_) => return Vec::new(),
        };

        match parsed.get("media_ids").and_then(|v| v.as_array()) {
            Some(arr) => arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect(),
            None => Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use std::fs::File;
    use std::io::Write;

    fn make_event(event_type: &str, metadata: Option<String>, media_refs: Vec<PathBuf>) -> Event {
        Event {
            id: "test-id".to_string(),
            timestamp: Utc::now(),
            sender: "test-user".to_string(),
            sender_name: None,
            media_references: media_refs,
            conversation_id: Some("conv-1".to_string()),
            content: None,
            event_type: event_type.to_string(),
            metadata,
        }
    }

    #[test]
    fn test_extract_media_ids_with_ids() {
        let meta = Some(r#"{"media_ids": ["abc", "def"]}"#.to_string());
        let ids = MediaLinker::extract_media_ids(&meta);
        assert_eq!(ids, vec!["abc", "def"]);
    }

    #[test]
    fn test_extract_media_ids_none() {
        let ids = MediaLinker::extract_media_ids(&None);
        assert!(ids.is_empty());
    }

    #[test]
    fn test_extract_media_ids_invalid_json() {
        let meta = Some("not valid json".to_string());
        let ids = MediaLinker::extract_media_ids(&meta);
        assert!(ids.is_empty());

        let meta2 = Some("{}".to_string());
        let ids2 = MediaLinker::extract_media_ids(&meta2);
        assert!(ids2.is_empty());
    }

    #[test]
    fn test_extract_media_ids_no_array() {
        let meta = Some(r#"{"media_ids": "not-an-array"}"#.to_string());
        let ids = MediaLinker::extract_media_ids(&meta);
        assert!(ids.is_empty());
    }

    #[test]
    fn test_id_extraction_from_filenames() {
        let dir = tempfile::tempdir().unwrap();
        File::create(dir.path().join("2023-01-01_TESTID123.jpg")).unwrap();
        File::create(dir.path().join("2023-06-15_ID-WITH-DASHES.png")).unwrap();
        File::create(dir.path().join("nounderscorefile.jpg")).unwrap();

        let linker = MediaLinker::new(dir.path());
        let map = linker.get_id_map();

        assert!(map.contains_key("TESTID123"));
        assert!(map.contains_key("ID-WITH-DASHES"));
        // "nounderscorefile.jpg" is now indexed by filename and stem
        assert!(map.contains_key("nounderscorefile"));
        assert!(map.contains_key("nounderscorefile.jpg"));
    }

    #[test]
    fn test_clean_path_unc_and_unix() {
        // Windows UNC prefix stripped
        let win_unc = Path::new(r"\\?\C:\Users\Snapchat\image.jpg");
        assert_eq!(clean_path(win_unc), PathBuf::from(r"C:\Users\Snapchat\image.jpg"));

        // Standard Unix / macOS path untouched
        let mac_path = Path::new("/Users/john/Downloads/Snapchat/image.jpg");
        assert_eq!(clean_path(mac_path), PathBuf::from("/Users/john/Downloads/Snapchat/image.jpg"));

        // Standard Windows drive path untouched
        let win_path = Path::new(r"C:\Users\Snapchat\image.jpg");
        assert_eq!(clean_path(win_path), PathBuf::from(r"C:\Users\Snapchat\image.jpg"));
    }

    #[test]
    fn test_link_media_resolves_relative_refs() {
        let dir = tempfile::tempdir().unwrap();
        let media_file = dir.path().join("2023-01-01_XYZ999.jpg");
        File::create(&media_file).unwrap().write_all(b"fake").unwrap();

        let mut linker = MediaLinker::new(dir.path());
        // Simulating relative path parsed from HTML:
        let rel_ref = PathBuf::from("../../chat_media/2023-01-01_XYZ999.jpg");
        let mut events = vec![make_event("MEDIA", None, vec![rel_ref])];

        linker.link_media(&mut events);
        assert_eq!(events[0].media_references.len(), 1);
        assert!(events[0].media_references[0].is_absolute());
        assert!(events[0].media_references[0].exists());
    }

    #[test]
    fn test_link_media_by_id() {
        let dir = tempfile::tempdir().unwrap();
        let media_file = dir.path().join("2023-01-01_ABC123.jpg");
        File::create(&media_file).unwrap().write_all(b"fake").unwrap();

        let mut linker = MediaLinker::new(dir.path());
        let meta = r#"{"media_ids": ["ABC123"]}"#.to_string();
        let mut events = vec![make_event("MEDIA", Some(meta), vec![])];

        linker.link_media(&mut events);
        assert_eq!(events[0].media_references.len(), 1);
        assert!(events[0].media_references[0].exists());
    }

    #[test]
    fn test_link_skips_non_media_events() {
        let dir = tempfile::tempdir().unwrap();
        let media_file = dir.path().join("2023-01-01_ABC123.jpg");
        File::create(&media_file).unwrap().write_all(b"fake").unwrap();

        let mut linker = MediaLinker::new(dir.path());
        let meta = r#"{"media_ids": ["ABC123"]}"#.to_string();
        let mut events = vec![make_event("TEXT", Some(meta), vec![])];

        linker.link_media(&mut events);
        assert!(events[0].media_references.is_empty());
    }
}
