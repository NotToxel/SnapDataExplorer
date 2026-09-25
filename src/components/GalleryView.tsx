import { useState, useEffect, useCallback, useRef, useMemo, useDeferredValue } from "react";
import { invoke } from "@tauri-apps/api/core";
import { VirtuosoGrid } from "react-virtuoso";
import { MediaStreamEntry, MediaViewerItem, PaginatedMedia } from "../types";
import { cn } from "../lib/utils";
import { MediaThumbnail } from "./ui/MediaThumbnail";
import { MediaViewer } from "./ui/MediaViewer";
import { Image as ImageIcon, Loader2 } from "lucide-react";

interface GalleryViewProps {
  addToast?: (type: 'info' | 'success' | 'warning' | 'error', message: string) => void;
}

export function GalleryView({ addToast }: GalleryViewProps = {}) {
  const [media, setMedia] = useState<MediaStreamEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [viewerIndex, setViewerIndex] = useState(-1);
  const [filter, setFilter] = useState<"all" | "Image" | "Video">("all");
  const deferredFilter = useDeferredValue(filter);
  const offsetRef = useRef(0);

  const loadMedia = useCallback(async (append = false) => {
    if (!append) {
      setLoading(true);
      offsetRef.current = 0;
    } else {
      setLoadingMore(true);
    }
    try {
      const data = await invoke<PaginatedMedia>("get_unified_media_stream", {
        limit: 100,
        offset: offsetRef.current,
      });
      if (append) {
        setMedia(prev => [...prev, ...data.items]);
      } else {
        setMedia(data.items);
      }
      setTotalCount(data.total_count);
      setHasMore(data.has_more);
      offsetRef.current += data.items.length;
    } catch (e) {
      console.error("Failed to load media:", e);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    loadMedia();
  }, [loadMedia]);

  const loadMore = useCallback(() => {
    if (!loadingMore && hasMore) {
      loadMedia(true);
    }
  }, [loadingMore, hasMore, loadMedia]);

  const filtered = useMemo(() =>
    deferredFilter === "all" ? media : media.filter(m => m.media_type === deferredFilter)
    , [media, deferredFilter]);

  const viewerItems = useMemo(() => 
    filtered.map((f): MediaViewerItem => ({ ...f, media_path: f.path, media_type: f.media_type }))
  , [filtered]);

  return (
    <div className="flex-1 flex flex-col bg-surface-50 dark:bg-surface-950 text-surface-900 dark:text-surface-100 h-full overflow-hidden">
      {/* Header */}
      <header className="px-8 py-6 flex items-center justify-between border-b border-surface-200/80 dark:border-surface-800/80 bg-white/50 dark:bg-surface-900/40 backdrop-blur-xs">
        <div>
          <h1 className="text-3xl font-black text-surface-900 dark:text-white tracking-tight flex items-center gap-3">
            <ImageIcon className="w-8 h-8 text-purple-600 dark:text-purple-500" />
            Gallery
          </h1>
          <p className="text-sm text-surface-500 dark:text-surface-400 font-medium mt-1">
            {totalCount.toLocaleString()} items total • {filtered.length.toLocaleString()} visible
          </p>
        </div>
        <div className="flex gap-1.5 bg-white dark:bg-surface-900/60 border border-surface-200 dark:border-surface-800 p-1 rounded-2xl shadow-xs backdrop-blur-md">
          {(["all", "Image", "Video"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-5 py-2 rounded-xl text-sm font-bold transition-all cursor-pointer",
                filter === f
                  ? "bg-purple-600 text-white shadow-md shadow-purple-600/25"
                  : "text-surface-600 hover:text-surface-900 hover:bg-surface-100 dark:text-surface-400 dark:hover:text-white dark:hover:bg-surface-800/80"
              )}
            >
              {f === "all" ? "All" : f === "Image" ? "Photos" : "Videos"}
            </button>
          ))}
        </div>
      </header>

      {/* Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-10 h-10 text-purple-600 dark:text-purple-500 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center flex-col gap-6 text-center animate-in fade-in zoom-in">
          <div className="w-24 h-24 rounded-3xl bg-white dark:bg-surface-900 flex items-center justify-center border border-surface-200 dark:border-surface-800 shadow-md">
            <ImageIcon className="w-12 h-12 text-surface-300 dark:text-surface-600" />
          </div>
          <div className="space-y-2">
            <h3 className="text-surface-900 dark:text-white font-black text-2xl tracking-tight">No media found</h3>
            <p className="text-surface-500 dark:text-surface-400 max-w-sm text-sm font-medium">
              Your Snapchat export may not include media files in the expected locations.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 px-8 pt-6 pb-8 overflow-hidden">
          <VirtuosoGrid
            style={{ height: "100%" }}
            totalCount={filtered.length}
            overscan={400}
            listClassName="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-4 pb-10"
            endReached={loadMore}
            itemContent={(index) => {
              const item = filtered[index];
              if (!item) return null;
              return (
                <MediaThumbnail
                  path={item.path}
                  mediaType={item.media_type}
                  status="Downloaded"
                  timestamp={item.timestamp || undefined}
                  onClick={() => setViewerIndex(index)}
                />
              );
            }}
          />
        </div>
      )}

      {/* Loading more indicator */}
      {loadingMore && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 py-2 px-4 rounded-full bg-purple-600 text-white text-xs font-bold shadow-2xl backdrop-blur-md flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" />
          Loading more...
        </div>
      )}

      <MediaViewer
        isOpen={viewerIndex >= 0}
        onClose={() => setViewerIndex(-1)}
        items={viewerItems}
        currentIndex={viewerIndex}
        onIndexChange={setViewerIndex}
        addToast={addToast}
      />
    </div>
  );
}

