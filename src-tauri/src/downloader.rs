use crate::db::DatabaseManager;
use crate::error::AppResult;
use crate::models::{DownloadStatus, Memory};
use crate::storage::StorageManager;
use futures_util::StreamExt;
use reqwest::Client;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::fs as tokio_fs;
use tokio::io::AsyncWriteExt;

#[derive(Debug, Serialize, Clone)]
pub struct DownloadProgress {
    pub memory_id: String,
    pub progress: f32,
    pub status: String,
    pub bytes_downloaded: u64,
    pub total_bytes: Option<u64>,
}

pub struct MemoryDownloader {
    client: Client,
    app_handle: AppHandle,
    db: Arc<DatabaseManager>,
}

impl MemoryDownloader {
    pub fn new(app_handle: AppHandle, db: Arc<DatabaseManager>) -> Self {
        Self {
            client: Client::new(),
            app_handle,
            db,
        }
    }

    pub async fn download_memory(&self, mut memory: Memory, storage_root: PathBuf) -> AppResult<()> {
        // Check disk space before starting (require > 500MB buffer)
        match StorageManager::get_disk_space(storage_root.clone()) {
            Ok(info) => {
                if info.available_bytes < 500 * 1024 * 1024 {
                    let msg = format!("Insufficient disk space. Available: {} MB, Required Buffer: 500 MB", info.available_bytes / (1024 * 1024));
                    log::error!("{}", msg);
                    
                    memory.download_status = DownloadStatus::Failed;
                    self.db.batch_insert_memories(&[memory])?;
                    
                    self.app_handle.emit("download-error", msg.clone()).ok();
                    return Err(crate::error::AppError::Generic(msg));
                }
            }
            Err(e) => {
                log::warn!("Could not check disk space: {}", e);
                // We proceed with caution if check fails, but log it
            }
        }

        let url_candidate = memory.download_url.as_ref().or(memory.proxy_url.as_ref());
        let url = match url_candidate {
            Some(url) => url,
            None => {
                log::error!("No download URL for memory {}", memory.id);
                return Ok(());
            }
        };

        // If the URL is a Snapchat proxy / dmd link, request the direct AWS S3 URL via POST
        let final_url = if url.contains("app.snapchat.com/dmd") || url.contains("/dmd/memories") {
            match self.client.post(url).send().await {
                Ok(res) if res.status().is_success() => {
                    match res.text().await {
                        Ok(body) if body.trim().starts_with("http") => body.trim().to_string(),
                        _ => url.clone(),
                    }
                }
                _ => url.clone(),
            }
        } else {
            url.clone()
        };

        // Determine file extension
        let ext = if memory.media_type.to_lowercase() == "video" {
            "mp4"
        } else {
            "jpg"
        };

        // Build subfolder structure: Memories/YYYY/MM/id.ext
        let year = memory.timestamp.format("%Y").to_string();
        let month = memory.timestamp.format("%m").to_string();
        let target_dir = storage_root.join("Memories").join(year).join(month);

        if !target_dir.exists() {
            tokio_fs::create_dir_all(&target_dir).await?;
        }

        let file_name = format!("{}.{}", memory.id, ext);
        let file_path = target_dir.join(file_name);

        log::info!("Downloading memory {} to {:?}", memory.id, file_path);

        // Update status to Downloading
        memory.download_status = DownloadStatus::Downloading;
        self.db.batch_insert_memories(&[memory.clone()])?;

        let response = match self.client.get(&final_url).send().await {
            Ok(res) => res,
            Err(e) => {
                log::error!("Failed to start download for {}: {}", memory.id, e);
                memory.download_status = DownloadStatus::Failed;
                self.db.batch_insert_memories(&[memory])?;
                return Ok(());
            }
        };

        let total_size = response.content_length();
        let mut downloaded: u64 = 0;
        let mut stream = response.bytes_stream();

        let mut file = tokio_fs::File::create(&file_path).await?;

        while let Some(item) = stream.next().await {
            let chunk = match item {
                Ok(chunk) => chunk,
                Err(e) => {
                    log::error!("Error while downloading {}: {}", memory.id, e);
                    memory.download_status = DownloadStatus::Failed;
                    self.db.batch_insert_memories(&[memory])?;
                    return Ok(());
                }
            };
            file.write_all(&chunk).await?;
            downloaded += chunk.len() as u64;

            if let Some(total) = total_size {
                let progress = downloaded as f32 / total as f32;
                self.app_handle
                    .emit(
                        "download-progress",
                        DownloadProgress {
                            memory_id: memory.id.clone(),
                            progress,
                            status: "Downloading".to_string(),
                            bytes_downloaded: downloaded,
                            total_bytes: Some(total),
                        },
                    )
                    .ok();
            }
        }

        file.flush().await?;

        // Update status to Downloaded
        let clean_file_path = crate::ingestion::media_linker::clean_path(&file_path);
        memory.download_status = DownloadStatus::Downloaded;
        memory.media_path = Some(clean_file_path);
        self.db.batch_insert_memories(&[memory.clone()])?;

        self.app_handle
            .emit(
                "download-progress",
                DownloadProgress {
                    memory_id: memory.id.clone(),
                    progress: 1.0,
                    status: "Downloaded".to_string(),
                    bytes_downloaded: downloaded,
                    total_bytes: total_size,
                },
            )
            .ok();

        log::info!("Successfully downloaded memory {}", memory.id);
        Ok(())
    }

    pub async fn download_all_pending(&self) -> AppResult<()> {
        let storage_path = self.db.get_setting("storage_path")?;
        let storage_root = match storage_path {
            Some(p) => PathBuf::from(p),
            None => {
                log::error!("No storage path set for downloads");
                return Ok(());
            }
        };

        let memories = self.db.get_memories(None)?;
        let pending: Vec<Memory> = memories
            .into_iter()
            .filter(|m| m.download_status == DownloadStatus::Pending || m.download_status == DownloadStatus::Failed)
            .collect();

        log::info!("Starting batch download for {} pending memories", pending.len());

        for memory in pending {
            if let Err(e) = self.download_memory(memory, storage_root.clone()).await {
                log::error!("Failed to download memory: {}", e);
                // Stop batch on disk space error
                if e.to_string().contains("Insufficient disk space") {
                    break;
                }
            }
        }

        Ok(())
    }
}
