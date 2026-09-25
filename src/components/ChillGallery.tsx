import React, { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import { PaginatedMedia, MediaStreamEntry, MediaViewerItem } from "../types";
import { cn, safeConvertFileSrc } from "../lib/utils";
import {
    X,
    Play,
    LayoutGrid,
    Wind,
    Layers,
    Calendar,
    Sparkles,
    ArrowRight
} from "lucide-react";
import { MediaViewer } from "./ui/MediaViewer";
import { VirtuosoGrid } from "react-virtuoso";

interface ChillGalleryProps {
    onExit: () => void;
}

export function ChillGallery({ onExit }: ChillGalleryProps) {
    const [items, setItems] = useState<MediaStreamEntry[]>([]);
    const [totalCount, setTotalCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [viewerIndex, setViewerIndex] = useState(-1);
    const [isAutoScrolling, setIsAutoScrolling] = useState(false);
    const scrollRef = useRef<any>(null);
    const [hoveredItem, setHoveredItem] = useState<MediaStreamEntry | null>(null);
    const offsetRef = useRef(0);

    const loadInitial = async () => {
        setLoading(true);
        try {
            const data = await invoke<PaginatedMedia>("get_unified_media_stream", { limit: 100, offset: 0 });
            setItems(data.items);
            setTotalCount(data.total_count);
            setHasMore(data.has_more);
            offsetRef.current = data.items.length;
        } catch (err) {
            console.error("Failed to load stream:", err);
        } finally {
            setLoading(false);
        }
    };

    const loadMore = useCallback(async () => {
        if (loadingMore || !hasMore) return;
        setLoadingMore(true);
        try {
            const data = await invoke<PaginatedMedia>("get_unified_media_stream", {
                limit: 100,
                offset: offsetRef.current
            });
            setItems(prev => [...prev, ...data.items]);
            setHasMore(data.has_more);
            offsetRef.current += data.items.length;
        } catch (err) {
            console.error("Failed to load more:", err);
        } finally {
            setLoadingMore(false);
        }
    }, [loadingMore, hasMore]);

    useEffect(() => {
        loadInitial();
    }, []);

    // Ambient Auto-Scrolling — only run the rAF loop when active
    useEffect(() => {
        if (!isAutoScrolling) return;
        let animationFrame: number;
        const scroll = () => {
            if (scrollRef.current) {
                scrollRef.current.scrollTo({
                    top: scrollRef.current.getScrollTop() + 0.45,
                    behavior: 'auto'
                });
            }
            animationFrame = requestAnimationFrame(scroll);
        };
        animationFrame = requestAnimationFrame(scroll);
        return () => cancelAnimationFrame(animationFrame);
    }, [isAutoScrolling]);

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center bg-surface-50 dark:bg-zinc-950 text-surface-900 dark:text-white">
                <div className="flex flex-col items-center gap-6">
                    <div className="relative">
                        <div className="w-16 h-16 border-4 border-surface-200 dark:border-white/10 border-t-brand-500 rounded-full animate-spin" />
                        <Layers className="absolute inset-0 m-auto w-6 h-6 text-brand-500 animate-pulse" />
                    </div>
                    <p className="text-surface-500 dark:text-white/40 font-mono text-[10px] uppercase tracking-[0.4em] animate-pulse">Syncing Visual Stream...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="relative flex-1 bg-surface-50 dark:bg-zinc-950 text-surface-900 dark:text-white flex flex-col h-full overflow-hidden font-sans">
            {/* Immersive Dynamic Backdrop Glow */}
            <AnimatePresence mode="wait">
                <motion.div
                    key={hoveredItem?.id || 'default'}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.28 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 1.2, ease: "easeInOut" }}
                    className="absolute inset-0 pointer-events-none z-0 overflow-hidden"
                >
                    <div
                        className="absolute inset-0 bg-cover bg-center blur-[120px] scale-150 transition-all duration-2000"
                        style={{ backgroundImage: hoveredItem ? `url(${safeConvertFileSrc(hoveredItem.path)})` : 'none' }}
                    />
                    <div className="absolute inset-0 bg-linear-to-tr from-surface-50/80 via-transparent to-surface-50/40 dark:from-zinc-950 dark:via-transparent dark:to-zinc-950/60" />
                </motion.div>
            </AnimatePresence>

            {/* Floating Header Controls */}
            <div className="absolute inset-x-0 top-0 z-40 p-6 md:p-8 flex justify-between items-center bg-linear-to-b from-surface-50/95 via-surface-50/70 to-transparent dark:from-zinc-950/90 dark:via-zinc-950/50 dark:to-transparent backdrop-blur-[2px]">
                <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center gap-4"
                >
                    <div className="w-10 h-10 rounded-2xl bg-brand-500 flex items-center justify-center shadow-lg shadow-brand-500/25">
                        <Wind className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h1 className="text-surface-900 dark:text-white text-xl font-black tracking-tighter leading-none">GALLERY</h1>
                        <p className="text-surface-500 dark:text-white/40 text-[9px] uppercase tracking-[0.4em] mt-1 font-bold">Chill Mode</p>
                    </div>
                </motion.div>

                <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center gap-3"
                >
                    {/* Zen Mode Button with dynamic pulse */}
                    <button
                        onClick={() => setIsAutoScrolling(!isAutoScrolling)}
                        className={cn(
                            "px-5 py-2.5 rounded-2xl border text-[10px] font-black tracking-widest transition-all flex items-center gap-2.5 cursor-pointer shadow-xs",
                            isAutoScrolling
                                ? "bg-brand-500 border-brand-400 text-white shadow-lg shadow-brand-500/35"
                                : "bg-white/80 hover:bg-white dark:bg-white/5 dark:hover:bg-white/10 border-surface-200 dark:border-white/10 text-surface-700 dark:text-white/60 hover:text-surface-900 dark:hover:text-white"
                        )}
                        title={isAutoScrolling ? "Zen Mode: Auto-scrolling is active (click to pause)" : "Zen Mode: Sit back with smooth hands-free auto-scrolling"}
                    >
                        <div className={cn("w-2 h-2 rounded-full", isAutoScrolling ? "bg-white animate-ping" : "bg-surface-400 dark:bg-white/30")} />
                        {isAutoScrolling ? "ZEN MODE ON" : "ZEN MODE OFF"}
                    </button>

                    {/* Exit Chill Button */}
                    <button
                        onClick={onExit}
                        className="group flex items-center gap-3 bg-white/80 hover:bg-white dark:bg-white/5 dark:hover:bg-white/15 border border-surface-200 dark:border-white/10 px-5 py-2.5 rounded-2xl transition-all duration-300 text-surface-700 dark:text-white/70 hover:text-surface-900 dark:hover:text-white cursor-pointer shadow-xs"
                    >
                        <span className="text-[10px] font-black uppercase tracking-widest">Exit Chill</span>
                        <X className="w-4 h-4 text-surface-400 group-hover:text-surface-900 dark:text-white/40 dark:group-hover:text-white group-hover:rotate-90 transition-all duration-300" />
                    </button>
                </motion.div>
            </div>

            {/* Virtualized Grid */}
            <div className="flex-1 mt-24 mb-24 z-10 px-6 md:px-12">
                <VirtuosoGrid
                    ref={scrollRef}
                    data={items}
                    endReached={loadMore}
                    overscan={400}
                    style={{ height: "100%", width: "100%" }}
                    listClassName="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-6 pb-12"
                    itemContent={(index, item) => (
                        <GalleryItem
                            key={item.id}
                            item={item}
                            index={index}
                            onClick={() => setViewerIndex(index)}
                            onMouseEnter={() => setHoveredItem(item)}
                            onMouseLeave={() => setHoveredItem(null)}
                        />
                    )}
                />
            </div>

            {/* Master Media Viewer */}
            <MediaViewer
                isOpen={viewerIndex >= 0}
                onClose={() => setViewerIndex(-1)}
                items={items.map((i): MediaViewerItem => ({ ...i, media_path: i.path, media_type: i.media_type }))}
                currentIndex={viewerIndex}
                onIndexChange={setViewerIndex}
            />

            {/* Bottom Status Bar */}
            <div className="absolute inset-x-0 bottom-0 z-40 p-6 flex justify-center pointer-events-none">
                <motion.div
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    className="px-6 py-3 rounded-2xl bg-white/90 dark:bg-zinc-900/85 border border-surface-200 dark:border-white/10 backdrop-blur-xl pointer-events-auto flex items-center gap-6 shadow-xl"
                >
                    <div className="flex items-center gap-2.5">
                        <LayoutGrid className="w-4 h-4 text-brand-600 dark:text-brand-400" />
                        <span className="text-surface-800 dark:text-white text-xs font-bold tracking-tight">{totalCount.toLocaleString()} Moments Discovered</span>
                    </div>
                    <div className="w-px h-4 bg-surface-200 dark:bg-white/10" />
                    <div className="flex items-center gap-2.5 group cursor-help" title="Dynamic ambient background glow mirrors your hovered photo or video with smooth depth">
                        <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                        <span className="text-surface-600 dark:text-white/60 text-[10px] font-medium uppercase tracking-wider group-hover:text-surface-900 dark:group-hover:text-white transition-colors">Ambient Backdrop Active</span>
                    </div>
                </motion.div>
            </div>
        </div>
    );
}

function GalleryItem({
    item,
    index,
    onClick,
    onMouseEnter,
    onMouseLeave
}: {
    item: MediaStreamEntry,
    index: number,
    onClick: () => void,
    onMouseEnter: () => void,
    onMouseLeave: () => void
}) {
    const src = safeConvertFileSrc(item.path);

    const itemStyle = React.useMemo(() => ({
        contain: "layout style paint" as const,
        willChange: "transform" as const,
    }), []);

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: (index % 6) * 0.05 }}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            onClick={onClick}
            style={itemStyle}
            className="group relative rounded-3xl overflow-hidden cursor-pointer bg-white dark:bg-zinc-900 border border-surface-200 dark:border-white/10 hover:border-brand-500/50 transition-all duration-500 shadow-md hover:shadow-xl hover:shadow-brand-500/15 aspect-3/4"
        >
            {/* Dark vignette gradient for contrast of bottom labels */}
            <div className="absolute inset-0 bg-linear-to-t from-surface-950/85 via-surface-950/20 to-transparent opacity-50 group-hover:opacity-80 transition-opacity duration-500 z-10" />

            {/* Media */}
            {item.media_type === "Video" ? (
                <div className="w-full h-full relative overflow-hidden bg-black">
                    <video
                        src={src}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-1000 ease-out"
                        muted
                        loop
                        onMouseOver={e => e.currentTarget.play().catch(() => {})}
                        onMouseOut={e => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
                    />
                    <div className="absolute top-4 right-4 bg-black/40 backdrop-blur-md rounded-full p-2.5 z-20 border border-white/15 group-hover:bg-brand-500 group-hover:border-brand-400 transition-colors shadow-lg">
                        <Play className="w-3.5 h-3.5 text-white fill-current" />
                    </div>
                </div>
            ) : (
                <img
                    src={src}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-1000 ease-out"
                    alt=""
                    loading="lazy"
                />
            )}

            {/* Info Labels */}
            <div className="absolute inset-0 p-5 z-20 flex flex-col justify-between opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-2 group-hover:translate-y-0 text-white">
                <div className="flex justify-between items-start">
                    <div className="px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-md border border-white/15">
                        <span className="text-[8px] font-black uppercase tracking-widest text-white/80">{item.source}</span>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-zinc-950 shadow-xl scale-0 group-hover:scale-100 transition-transform duration-300 delay-75">
                        <ArrowRight className="w-4 h-4" />
                    </div>
                </div>

                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <Calendar className="w-3 h-3 text-brand-400" />
                        <p className="font-bold text-[11px] tracking-tight text-white drop-shadow-sm">
                            {new Date(item.timestamp).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className={cn("w-1.5 h-1.5 rounded-full", item.media_type === 'Video' ? 'bg-amber-400' : 'bg-brand-400')} />
                        <p className="text-white/60 text-[9px] font-black uppercase tracking-[0.2em]">
                            {item.media_type} • {item.source === 'cloud' ? 'Downloaded' : 'Export File'}
                        </p>
                    </div>
                </div>
            </div>

            {/* Shimmer on Hover */}
            <div className="absolute inset-0 -translate-x-[200%] group-hover:translate-x-[200%] transition-transform duration-1000 bg-linear-to-r from-transparent via-white/15 to-transparent pointer-events-none z-30" />
        </motion.div>
    );
}
