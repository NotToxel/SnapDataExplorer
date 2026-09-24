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

#[derive(Debug, Clone)]
pub struct MediaTimestampEntry {
    pub timestamp: i64,
    pub is_video: bool,
    pub priority: u8,
    pub file_path: PathBuf,
}

pub struct MediaLinker {
    /// Maps media ID (or filename / stem) -> clean absolute file path
    id_map: HashMap<String, PathBuf>,
    /// Maps filename -> unix timestamp in seconds
    timestamp_map: HashMap<String, i64>,
    /// Sorted index for binary search timestamp matching
    timestamp_index: Vec<MediaTimestampEntry>,
}

impl MediaLinker {
    pub fn new(media_dir: &Path) -> Self {
        let mut linker = Self {
            id_map: HashMap::new(),
            timestamp_map: HashMap::new(),
            timestamp_index: Vec::new(),
        };
        linker.add_media_directory(media_dir);
        linker
    }

    pub fn load_timestamps_from_manifest(&mut self, manifest_path: &Path) {
        if let Ok(file) = fs::File::open(manifest_path) {
            if let Ok(map) = serde_json::from_reader::<_, HashMap<String, i64>>(file) {
                log::info!("MediaLinker: loaded {} timestamps from manifest {:?}", map.len(), manifest_path.file_name());
                self.timestamp_map.extend(map);
            }
        }
    }

    pub fn load_timestamps_from_zips(&mut self, zip_paths: &[PathBuf]) {
        for zip_path in zip_paths {
            if !zip_path.exists() { continue; }
            if let Ok(file) = fs::File::open(zip_path) {
                if let Ok(mut archive) = zip::ZipArchive::new(file) {
                    let mut loaded = 0;
                    for i in 0..archive.len() {
                        if let Ok(file) = archive.by_index(i) {
                            let name = file.name();
                            if (name.contains("chat_media/") || name.contains("media/")) && !name.ends_with('/') {
                                if let Some(file_name) = Path::new(name).file_name().and_then(|n| n.to_str()) {
                                    if let Some(unix) = crate::ingestion::extractor::zip_datetime_to_unix(file.last_modified()) {
                                        self.timestamp_map.insert(file_name.to_string(), unix);
                                        loaded += 1;
                                    }
                                }
                            }
                        }
                    }
                    log::info!("MediaLinker: loaded {} timestamps from zip {:?}", loaded, zip_path.file_name());
                }
            }
        }
    }

    pub fn build_timestamp_index(&mut self) {
        let mut index = Vec::new();
        for (filename, path) in &self.id_map {
            // Only include filenames with extensions
            let ext = match path.extension().and_then(|e| e.to_str()) {
                Some(e) => e.to_lowercase(),
                None => continue,
            };

            // Skip unknown / non-media files (e.g. metadata.unknown)
            if ext == "unknown" || ext == "json" || ext == "nomedia" {
                continue;
            }

            let ts = self.timestamp_map.get(filename).copied().or_else(|| {
                fs::metadata(path).ok().and_then(|m| m.modified().ok()).map(|sys_time| {
                    chrono::DateTime::<chrono::Utc>::from(sys_time).timestamp()
                })
            });

            if let Some(timestamp) = ts {
                let is_video = ext == "mp4" || ext == "mov" || ext == "webm";
                let priority = if filename.contains("_b~") || filename.contains("_media~") || filename.starts_with("b~") || filename.starts_with("media~") {
                    0 // Primary media content
                } else if filename.contains("_thumbnail~") || filename.starts_with("thumbnail~") {
                    1 // Preview thumbnail
                } else if filename.contains("_overlay~") || filename.starts_with("overlay~") {
                    2 // Overlay graphic / stickers
                } else {
                    3
                };

                index.push(MediaTimestampEntry {
                    timestamp,
                    is_video,
                    priority,
                    file_path: path.clone(),
                });
            }
        }
        index.sort_unstable_by_key(|e| e.timestamp);
        log::info!("MediaLinker: built timestamp index with {} media entries", index.len());
        self.timestamp_index = index;
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
        let mut allocated_counts: HashMap<PathBuf, usize> = HashMap::new();

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

            let mut matched_by_id = false;
            if !media_ids.is_empty() {
                for mid in &media_ids {
                    if let Some(file_path) = self.id_map.get(mid) {
                        event.media_references.push(file_path.clone());
                        matched_by_id = true;
                    }
                }

                if matched_by_id {
                    id_matched += 1;
                    continue;
                } else {
                    id_not_found += 1;
                }
            } else {
                no_ids += 1;
            }

            // Fallback: If media_references is still empty and we have a timestamp index,
            // attempt temporal matching for SNAP, SNAP_VIDEO, or MEDIA events.
            if event.media_references.is_empty() && !self.timestamp_index.is_empty() {
                let event_ts = event.timestamp.timestamp();
                let is_video = event.event_type == "SNAP_VIDEO";

                let start_idx = self.timestamp_index.partition_point(|e| e.timestamp < event_ts - 2);
                let mut best_match: Option<&PathBuf> = None;
                let mut best_score = (usize::MAX, u8::MAX, i64::MAX);

                for entry in &self.timestamp_index[start_idx..] {
                    if entry.timestamp > event_ts + 2 {
                        break;
                    }
                    if entry.is_video == is_video {
                        let diff = (entry.timestamp - event_ts).abs();
                        let alloc_count = allocated_counts.get(&entry.file_path).copied().unwrap_or(0);
                        let score = (alloc_count, entry.priority, diff);
                        if score < best_score {
                            best_score = score;
                            best_match = Some(&entry.file_path);
                        }
                    }
                }

                if let Some(path) = best_match {
                    *allocated_counts.entry(path.clone()).or_insert(0) += 1;
                    event.media_references.push(path.clone());
                    id_matched += 1;
                }
            }
        }

        on_progress(total, total);

        log::info!("MediaLinker: ID/temporal matched {}, no-ids-in-metadata {}, id-not-found {}, already-linked {}",
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

    #[test]
    fn test_link_media_by_timestamp() {
        let dir = tempfile::tempdir().unwrap();
        let media_file = dir.path().join("2024-06-13_sample.jpg");
        File::create(&media_file).unwrap().write_all(b"fake").unwrap();

        let mut linker = MediaLinker::new(dir.path());
        let event_time = chrono::DateTime::from_timestamp(1718283669, 0).unwrap();
        linker.timestamp_map.insert("2024-06-13_sample.jpg".to_string(), 1718283670); // 1 sec diff
        linker.build_timestamp_index();

        let mut event = make_event("SNAP", None, vec![]);
        event.timestamp = event_time;
        let mut events = vec![event];

        linker.link_media(&mut events);
        assert_eq!(events[0].media_references.len(), 1);
        assert_eq!(events[0].media_references[0], media_file);
    }

    #[test]
    fn test_link_media_priority_and_deduplication() {
        let dir = tempfile::tempdir().unwrap();
        // File 1: overlay png (priority 2)
        let overlay_file = dir.path().join("2024-06-13_overlay~xyz.png");
        File::create(&overlay_file).unwrap().write_all(b"overlay").unwrap();

        // File 2: primary image 1 (priority 0)
        let primary_file1 = dir.path().join("2024-06-13_b~abc.jpg");
        File::create(&primary_file1).unwrap().write_all(b"primary1").unwrap();

        // File 3: primary image 2 (priority 0)
        let primary_file2 = dir.path().join("2024-06-13_b~def.jpg");
        File::create(&primary_file2).unwrap().write_all(b"primary2").unwrap();

        let mut linker = MediaLinker::new(dir.path());
        linker.timestamp_map.insert("2024-06-13_overlay~xyz.png".to_string(), 1718283670);
        linker.timestamp_map.insert("2024-06-13_b~abc.jpg".to_string(), 1718283670);
        linker.timestamp_map.insert("2024-06-13_b~def.jpg".to_string(), 1718283670);
        linker.build_timestamp_index();

        let event_time = chrono::DateTime::from_timestamp(1718283670, 0).unwrap();
        let mut event1 = make_event("SNAP", None, vec![]);
        event1.timestamp = event_time;
        let mut event2 = make_event("SNAP", None, vec![]);
        event2.timestamp = event_time;

        let mut events = vec![event1, event2];
        linker.link_media(&mut events);

        // Both events should have matched a primary image, neither should have matched the overlay
        assert_eq!(events[0].media_references.len(), 1);
        assert_eq!(events[1].media_references.len(), 1);
        assert_ne!(events[0].media_references[0], overlay_file);
        assert_ne!(events[1].media_references[0], overlay_file);
        // And each should get a unique primary file (deduplicated allocation)
        assert_ne!(events[0].media_references[0], events[1].media_references[0]);
    }
}
