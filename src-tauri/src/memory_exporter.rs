use std::fs;
use std::path::Path;
use tauri::{AppHandle, Emitter, State};
use chrono::Datelike;
use crate::error::{AppError, AppResult};
use crate::models::{ExportMemoriesOptions, ExportMemoriesProgress, ExportMemoriesResult, Memory};
use crate::DbState;

pub struct MemoryExporter;

impl MemoryExporter {
    pub async fn export(
        options: ExportMemoriesOptions,
        app_handle: &AppHandle,
        db_state: &State<'_, DbState>,
    ) -> AppResult<ExportMemoriesResult> {
        let db = match crate::db_from_state(db_state, app_handle)? {
            Some(db) => db,
            None => return Err(AppError::Generic("Database not initialized".to_string())),
        };

        let all_memories = db.get_memories(Some(&options.export_id))?;
        let target_memories: Vec<Memory> = if let Some(ref ids) = options.memory_ids {
            let id_set: std::collections::HashSet<_> = ids.iter().collect();
            all_memories.into_iter().filter(|m| id_set.contains(&m.id)).collect()
        } else {
            all_memories
        };

        let total = target_memories.len();
        if total == 0 {
            return Ok(ExportMemoriesResult {
                exported_count: 0,
                failed_count: 0,
                target_dir: options.target_dir,
                errors: Vec::new(),
            });
        }

        if !options.target_dir.exists() {
            fs::create_dir_all(&options.target_dir)?;
        }

        let naming_format = options.naming_format.as_deref().unwrap_or("{date}_{time}");
        let folder_structure = options.folder_structure.as_deref().unwrap_or("Flat");
        let composite_overlay = options.composite_overlay.unwrap_or(true);
        let embed_exif = options.embed_exif.unwrap_or(true);
        let set_file_times = options.set_file_times.unwrap_or(true);

        let mut exported_count = 0;
        let mut failed_count = 0;
        let mut errors = Vec::new();

        for (idx, memory) in target_memories.iter().enumerate() {
            let media_path = match &memory.media_path {
                Some(p) if p.exists() => p,
                _ => {
                    failed_count += 1;
                    errors.push(format!("Memory {} media file not found on disk", memory.id));
                    continue;
                }
            };

            let ext = media_path.extension().and_then(|e| e.to_str()).unwrap_or("jpg");
            let date_str = memory.timestamp.format("%Y-%m-%d").to_string();
            let time_str = memory.timestamp.format("%H-%M-%S").to_string();

            // Compute subfolder
            let dest_dir = match folder_structure {
                "ByYear" => {
                    let year_dir = options.target_dir.join(memory.timestamp.year().to_string());
                    if !year_dir.exists() {
                        let _ = fs::create_dir_all(&year_dir);
                    }
                    year_dir
                }
                "ByYearMonth" => {
                    let ym_dir = options.target_dir
                        .join(memory.timestamp.year().to_string())
                        .join(format!("{:02}", memory.timestamp.month()));
                    if !ym_dir.exists() {
                        let _ = fs::create_dir_all(&ym_dir);
                    }
                    ym_dir
                }
                _ => options.target_dir.clone(), // Flat
            };

            // Format base filename
            let base_name = if naming_format == "Compact" {
                format!("Snapchat_{}{}", memory.timestamp.format("%Y%m%d"), memory.timestamp.format("%H%M%S"))
            } else if naming_format == "Original" {
                media_path.file_stem().and_then(|s| s.to_str()).unwrap_or("memory").to_string()
            } else {
                format!("{}_{}", date_str, time_str)
            };

            let mut target_filename = format!("{}.{}", base_name, ext);
            let mut target_path = dest_dir.join(&target_filename);
            let mut collision_counter = 1;

            while target_path.exists() {
                target_filename = format!("{}_{}.{}", base_name, collision_counter, ext);
                target_path = dest_dir.join(&target_filename);
                collision_counter += 1;
            }

            // Emit progress
            let _ = app_handle.emit("export-memories-progress", ExportMemoriesProgress {
                current: idx + 1,
                total,
                current_file: target_filename.clone(),
                percentage: ((idx + 1) as f32 / total as f32) * 100.0,
            });

            // Perform copy or overlay composite
            let is_image = !memory.media_type.eq_ignore_ascii_case("Video");
            let has_overlay = memory.overlay_path.as_ref().is_some_and(|p| p.exists());
            let mut composited = false;

            if is_image && has_overlay && composite_overlay {
                if let (Ok(mut base_img), Ok(overlay_img)) = (
                    image::open(media_path),
                    image::open(memory.overlay_path.as_ref().unwrap()),
                ) {
                    image::imageops::overlay(&mut base_img, &overlay_img, 0, 0);
                    if base_img.save(&target_path).is_ok() {
                        composited = true;
                    }
                }
            }

            if !composited {
                if let Err(e) = fs::copy(media_path, &target_path) {
                    failed_count += 1;
                    errors.push(format!("Failed to copy {}: {}", media_path.display(), e));
                    continue;
                }

                // If overlay exists and separate export requested
                if has_overlay && !composite_overlay {
                    if let Some(ref ov_path) = memory.overlay_path {
                        let ov_target = dest_dir.join(format!("{}_overlay.png", base_name));
                        let _ = fs::copy(ov_path, &ov_target);
                    }
                }
            }

            // EXIF Tagging for Photos
            if is_image && embed_exif {
                Self::write_exif_metadata(&target_path, memory);
            }

            // File timestamps (Creation & Modification)
            if set_file_times {
                let unix_ts = memory.timestamp.timestamp();
                let ft = filetime::FileTime::from_unix_time(unix_ts, 0);
                let _ = filetime::set_file_times(&target_path, ft, ft);
            }

            exported_count += 1;
        }

        Ok(ExportMemoriesResult {
            exported_count,
            failed_count,
            target_dir: options.target_dir,
            errors,
        })
    }

    fn write_exif_metadata(path: &Path, memory: &Memory) {
        use little_exif::metadata::Metadata;
        use little_exif::exif_tag::ExifTag;

        let mut metadata = Metadata::new();
        let formatted_date = memory.timestamp.format("%Y:%m:%d %H:%M:%S").to_string();

        metadata.set_tag(ExifTag::DateTimeOriginal(formatted_date.clone()));
        metadata.set_tag(ExifTag::CreateDate(formatted_date.clone()));
        metadata.set_tag(ExifTag::ModifyDate(formatted_date));
        metadata.set_tag(ExifTag::Software("SnapDataExplorer".to_string()));

        let _ = metadata.write_to_file(path);
    }
}
